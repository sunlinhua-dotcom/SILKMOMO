/**
 * 模特脸图片的存放位置决策（库 or 对象存储），纯逻辑、不碰 prisma，可被 node --test 直接加载。
 * 数据库读写在 lib/model-face-library.ts。
 *
 * 规则：
 *  - 写入：存储启用 → 原图 + 缩略图都传对象存储，成功才返回 key；任何一个失败就把已传的清掉并返回 null，
 *    调用方回退存库（付费生成的脸绝不因为存储故障丢图）。存储未启用 → 直接 null，行为同改造前。
 *  - 读取：行里有 key 就读对象存储，没有 key 才读库列。key 行遇到存储未启用 → 抛
 *    ModelFaceStorageUnavailableError（调用方转 503），不崩溃、不返回空图。
 *  - 删除：尽力而为，失败只记日志。
 */
import { randomBytes } from 'node:crypto';
import { ObjectNotFoundError, type ObjectStorage } from './object-storage.ts';

export class ModelFaceStorageUnavailableError extends Error {
  readonly reason: 'not-configured' | 'missing' | 'failed';
  constructor(reason: 'not-configured' | 'missing' | 'failed', message: string) {
    super(message);
    this.name = 'ModelFaceStorageUnavailableError';
    this.reason = reason;
  }
}

export interface ModelFaceObjectKeys {
  imageKey: string;
  thumbnailKey: string;
}

/** 与 Prisma cuid 同形态（c + 24 位小写字母数字），库里 id 一律是字符串，格式不影响任何逻辑。 */
export function newModelFaceId(): string {
  return `c${Date.now().toString(36)}${randomBytes(9).toString('hex')}`.slice(0, 25);
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function modelFaceObjectKeys(userId: string, faceId: string): ModelFaceObjectKeys {
  const base = `model-faces/${safeSegment(userId)}/${safeSegment(faceId)}`;
  return { imageKey: `${base}/image.jpg`, thumbnailKey: `${base}/thumb.jpg` };
}

export interface ModelFaceImagesToPersist {
  userId: string;
  faceId: string;
  /** base64 JPEG */
  image: string;
  /** base64 JPEG */
  thumbnail: string;
}

type Logger = Pick<Console, 'warn'>;

/**
 * 尝试把原图与缩略图传到对象存储。返回 key；存储未启用或任一步失败返回 null（已传的会被清掉）。
 */
export async function uploadModelFaceImages(
  input: ModelFaceImagesToPersist,
  storage: ObjectStorage | null,
  log: Logger = console,
): Promise<ModelFaceObjectKeys | null> {
  if (!storage) return null;
  const keys = modelFaceObjectKeys(input.userId, input.faceId);
  try {
    await Promise.all([
      storage.put(keys.imageKey, Buffer.from(input.image, 'base64'), 'image/jpeg'),
      storage.put(keys.thumbnailKey, Buffer.from(input.thumbnail, 'base64'), 'image/jpeg'),
    ]);
    return keys;
  } catch (error) {
    log.warn('[model-face-storage] 上传对象存储失败，回退存库:', describeError(error));
    await deleteModelFaceObjects(keys, storage, log);
    return null;
  }
}

/** 取回一份图片字节：优先 key（对象存储），否则读库里的 base64。 */
export async function readModelFaceBytes(
  source: { key: string | null | undefined; inline: string | null | undefined },
  storage: ObjectStorage | null,
): Promise<Buffer> {
  if (source.key) {
    if (!storage) {
      throw new ModelFaceStorageUnavailableError(
        'not-configured',
        '图片存放在对象存储里，但当前实例未配置 OBJECT_STORAGE_* 环境变量',
      );
    }
    try {
      return await storage.get(source.key);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new ModelFaceStorageUnavailableError('missing', `对象存储中找不到 ${source.key}`);
      }
      throw new ModelFaceStorageUnavailableError('failed', `读取对象存储失败：${describeError(error)}`);
    }
  }
  if (source.inline) return Buffer.from(source.inline, 'base64');
  throw new ModelFaceStorageUnavailableError('missing', '模特脸既没有对象存储 key，库里也没有图片数据');
}

/** 删对象：尽力而为，永不抛。 */
export async function deleteModelFaceObjects(
  keys: Partial<ModelFaceObjectKeys> | { imageKey?: string | null; thumbnailKey?: string | null },
  storage: ObjectStorage | null,
  log: Logger = console,
): Promise<void> {
  if (!storage) {
    if (keys.imageKey || keys.thumbnailKey) {
      log.warn('[model-face-storage] 未配置对象存储，无法删除已有对象（留作孤儿）:', keys.imageKey ?? keys.thumbnailKey);
    }
    return;
  }
  const targets = [keys.imageKey, keys.thumbnailKey].filter((key): key is string => !!key);
  await Promise.all(targets.map(async key => {
    try {
      await storage.delete(key);
    } catch (error) {
      log.warn(`[model-face-storage] 删除对象失败（忽略）${key}:`, describeError(error));
    }
  }));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
