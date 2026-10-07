import Dexie, { type Table } from 'dexie';

// ===== 类型定义 =====

export type ProjectStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ModuleType = 'product' | 'scene';
export type SkuType = 'outfit' | 'top' | 'bottom';
export type SkinTone = 'light' | 'medium' | 'deep';
export type BodyType = 'slim' | 'standard' | 'curvy';
export type ShootingAngle = 'front' | 'side' | 'back';
export type FrameType = 'full_body' | 'upper_body' | 'lower_body' | 'close_up';
export type ImageType = 'product' | 'model_ref' | 'scene_ref' | 'bg_ref' | 'accessory' | 'anchor' | 'result' | 'result_backup';

export interface Project {
  id?: number;
  createdAt: Date;
  updatedAt: Date;
  status: ProjectStatus;
  name: string;

  // 模块类型
  moduleType?: ModuleType;

  // 共用输入层
  modelId?: string;              // 预设模特 ID（如果是预设模特）
  bodyType?: BodyType;           // 体型：slim / standard / curvy
  skinTone?: SkinTone;           // 肤色：light / medium / deep
  engine?: 'gemini' | 'openai';  // 生图引擎：gemini / openai (gpt-image-2-all)
  generationQuality?: 'low' | 'medium' | 'high'; // GPT 画质：Gemini 忽略

  // 产品图模块专属
  skuType?: SkuType;             // SKU 类型：套装 / 单件上装 / 单件下装
  selectedShots?: string;        // JSON 序列化的选中镜号数组 [1,2,3,4,9]
  outputSize?: string;           // 输出尺寸 "1200x1500" 或 "custom"
  customWidth?: number;          // 自定义宽度
  customHeight?: number;         // 自定义高度

  // 场景图模块专属
  sceneOutputSize?: string;      // 场景图输出尺寸
  sceneHasModel?: boolean;       // 场景图：true=有模特，false=氛围静物

  // 场景图·组图（换装）模式专属
  sceneGroup?: boolean;              // true=组图（N 张 lookbook → N 张换装图）
  sceneGroupMode?: string;           // swap=N景1品；products=1景N品（非索引字段，不 bump Dexie version）
  modelIdentityMode?: string;        // fresh=全新模特；follow_scene=贴近场景模特（非索引字段，不 bump Dexie version）
  sceneGroupCategories?: string;     // JSON: 分析出的主品品类（用于展示/回显）
  modelFaceChosen?: boolean;         // 用户在脸库里自己挑了模特脸（非索引字段，不 bump Dexie version）
                                     // 用来区分「用户选的脸」和「单张重做时回传的锚」——
                                     // 后者会让服务端加上"补齐已有组图"的提示词，对新任务是错的
  modelFaceId?: string;              // 被用户选中的账号脸库记录，用于标记身份锚来源

  // 失败原因（status='failed' 时记录最后一次失败的具体错误，刷新页面也能看到）
  lastError?: string;

  // 兼容旧版
  styleId?: string;
  customPrompt?: string;
}

export interface ImageItem {
  id?: number;
  projectId: number;
  stylePackId?: number;          // 风格包图片使用独立归属，避免和 Project 自增 ID 冲突
  type: ImageType;
  data: string;                  // Base64
  mimeType: string;
  prompt?: string;

  // 结果图专属
  shotIndex?: number;            // 候选池中的序号 1-9
  shootingAngle?: ShootingAngle; // 拍摄角度
  frameType?: FrameType;         // 取景框架
  hasModel?: boolean;            // 是否含模特
  outputSize?: string;           // 该图的输出尺寸
  groupIndex?: number;           // 同景换品模式：产品组序号（非索引字段，不 bump Dexie version）

  // 兼容旧版
  imageType?: 'hero' | 'full_body' | 'half_body' | 'close_up';
  index?: number;
  backup?: {
    id: number;
    data: string;
  };
}

export interface StylePack {
  id?: number;
  name: string;
  createdAt: Date;
  description?: string;
  // 风格包实际图片存在 ImageItem 中，通过 projectId 关联
}

// 图库条目（lib/image-library.ts 使用；放这里避免循环依赖）
// 之前存 localStorage：单条 dataUrl+base64 双份全图 ≈ 2MB 字符，
// 存 2-3 张就击穿 5MB 配额并静默丢图，因此迁移到 IndexedDB
export interface LibraryImageRow {
  id: string;
  dataUrl: string;
  base64: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  originalSize: number;
  addedAt: number;
  label?: string;
  category?: 'product' | 'model_ref' | 'bg_ref' | 'scene_ref' | 'accessory';
}

// ===== 存储配额（QuotaExceededError）=====
// 浏览器存储写满时，IndexedDB 抛 QuotaExceededError；Dexie 往往再包一层
// （AbortError / DatabaseClosedError / BulkError，原错误在 .inner / .failures 里）。
// 这里统一识别，调用方据此给出「存储已满」提示，而不是静默失败。

export const STORAGE_FULL_MESSAGE = '浏览器存储已满，请在图库里删除一些旧图后再试';

/** 存储配额不足的可识别错误：withQuotaGuard 会把底层配额错误统一转成它 */
export class StorageQuotaError extends Error {
  constructor(message: string = STORAGE_FULL_MESSAGE, options?: { cause?: unknown }) {
    super(message);
    this.name = 'StorageQuotaError';
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

const QUOTA_ERROR_NAMES = new Set([
  'QuotaExceededError',
  'NS_ERROR_DOM_QUOTA_REACHED', // Firefox
  'StorageQuotaError',
]);

/**
 * 判断任意错误是否由存储配额耗尽引起。
 * 会沿 inner / cause / BulkError.failures 向下找（带深度上限，防环）。
 */
export function isStorageQuotaError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) return false;
  const e = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    inner?: unknown;
    cause?: unknown;
    failures?: unknown;
  };
  if (typeof e.name === 'string' && QUOTA_ERROR_NAMES.has(e.name)) return true;
  // 旧版 DOMException：QUOTA_EXCEEDED_ERR = 22，Firefox = 1014
  if (e.code === 22 || e.code === 1014) return true;
  if (
    typeof e.message === 'string' &&
    /quota\s*(has been\s*)?(exceeded|reached)|exceeded the quota|QuotaExceeded/i.test(e.message)
  ) {
    return true;
  }
  if (isStorageQuotaError(e.inner, depth + 1)) return true;
  if (isStorageQuotaError(e.cause, depth + 1)) return true;
  if (Array.isArray(e.failures)) {
    return e.failures.some((f) => isStorageQuotaError(f, depth + 1));
  }
  return false;
}

/** 包住一次写操作：配额错误统一抛 StorageQuotaError，其余错误原样抛出 */
export async function withQuotaGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isStorageQuotaError(e)) throw new StorageQuotaError(STORAGE_FULL_MESSAGE, { cause: e });
    throw e;
  }
}

// 首次写入时申请一次「持久化存储」，降低浏览器在存储紧张时清掉本地图库的概率。失败一律忽略。
let persistRequested = false;
export function requestPersistentStorageOnce(): void {
  if (persistRequested || typeof navigator === 'undefined') return;
  persistRequested = true;
  try {
    void Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
  } catch {
    // ignore
  }
}

// ===== 图库去重指纹 =====
// 去重指纹：只取 base64 前 100 字符会把同源/同模板图片（头部相同）误判为重复而静默丢弃。
// 用 体积 + 像素尺寸 + 长度 + 尾部 64 字符 组合，区分度足够且无需哈希全量。
export function libraryFingerprint(e: { size: number; width: number; height: number; base64: string }): string {
  return `${e.size}_${e.width}x${e.height}_${e.base64.length}_${e.base64.slice(-64)}`;
}

/** 从 incoming 里去掉与 existing 指纹相同的，以及 incoming 内部重复的；返回保留项与被跳过的个数 */
export function dedupeByFingerprint<T extends { size: number; width: number; height: number; base64: string }>(
  incoming: T[],
  existingFingerprints: Set<string>,
): { unique: T[]; skipped: number } {
  const seen = new Set(existingFingerprints);
  const unique: T[] = [];
  for (const item of incoming) {
    const key = libraryFingerprint(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return { unique, skipped: incoming.length - unique.length };
}

// ===== Dexie 数据库类 =====

export class SilkMomoDB extends Dexie {
  projects!: Table<Project>;
  images!: Table<ImageItem>;
  stylePacks!: Table<StylePack>;
  libraryImages!: Table<LibraryImageRow>;

  constructor() {
    // 注意:品牌已更名 SILXINE,但 IndexedDB 库名保持 'SilkMomoDB' 不变——
    // 改名等于换库,所有用户的本地任务/图片会全部"丢失"。切勿重命名。
    super('SilkMomoDB');

    // version 1: 原始版本（保留，向后兼容）
    this.version(1).stores({
      projects: '++id, createdAt, status',
      images: '++id, projectId, type, imageType, index'
    });

    // version 2: Phase 2 升级（新增字段，新增 stylePacks 表）
    this.version(2).stores({
      projects: '++id, createdAt, status, moduleType, skuType',
      images: '++id, projectId, type, imageType, index, shotIndex',
      stylePacks: '++id, createdAt'
    });

    // version 3: 风格包图片从 projectId 关联迁移到 stylePackId，避免风格包 ID 与任务 ID 碰撞
    this.version(3).stores({
      projects: '++id, createdAt, status, moduleType, skuType',
      images: '++id, projectId, stylePackId, type, imageType, index, shotIndex',
      stylePacks: '++id, createdAt'
    });

    // version 4: 图库从 localStorage 迁入 IndexedDB（配额问题）
    this.version(4).stores({
      projects: '++id, createdAt, status, moduleType, skuType',
      images: '++id, projectId, stylePackId, type, imageType, index, shotIndex',
      stylePacks: '++id, createdAt',
      libraryImages: 'id, addedAt'
    });

    // 任一张表第一次写入时申请持久化存储（hook 只触发副作用，不改写入内容；不涉及 schema / version）
    const onFirstWrite = () => { requestPersistentStorageOnce(); };
    for (const table of [this.projects, this.images, this.stylePacks, this.libraryImages]) {
      table.hook('creating', onFirstWrite);
    }
  }
}

export const db = new SilkMomoDB();

export const STYLE_PACK_IMAGE_PROJECT_ID = 0;

// 迁移互斥：getStylePackImages 会被多个组件 / 生成入口并发调用，
// 双跑 "modernCount===0 → bulkAdd" 会把风格包图片复制成双份。
// 成功跑完一次后置 done 标记，同时避免每次全量重扫（O(N²) IndexedDB 查询）。
let stylePackMigrationPromise: Promise<void> | null = null;
let stylePackMigrationDone = false;

export function migrateLegacyStylePackImages(): Promise<void> {
  if (stylePackMigrationDone) return Promise.resolve();
  if (!stylePackMigrationPromise) {
    stylePackMigrationPromise = doMigrateLegacyStylePackImages()
      .then(() => { stylePackMigrationDone = true; })
      .finally(() => { stylePackMigrationPromise = null; });
  }
  return stylePackMigrationPromise;
}

async function doMigrateLegacyStylePackImages() {
  // 整个迁移放进一个事务：add 与 delete 要么都生效要么都回滚，
  // 中途断电/关页不会留下"已复制未删除"的双份状态
  await db.transaction('rw', db.stylePacks, db.images, db.projects, async () => {
    const packs = await db.stylePacks.toArray();

    for (const pack of packs) {
      if (!pack.id) continue;

      const legacyImages = await db.images
        .where('projectId')
        .equals(pack.id)
        .filter(img => img.type === 'scene_ref' && !img.stylePackId)
        .toArray();

      if (legacyImages.length === 0) continue;

      // 如果同 ID 的任务已经存在，legacy 图片归属无法可靠判断，避免迁移误伤任务数据。
      const collidingProject = await db.projects.get(pack.id);
      if (collidingProject) continue;

      const modernCount = await db.images.where('stylePackId').equals(pack.id).count();
      if (modernCount === 0) {
        await db.images.bulkAdd(
          legacyImages.map(img => ({
            projectId: STYLE_PACK_IMAGE_PROJECT_ID,
            stylePackId: pack.id,
            type: img.type,
            data: img.data,
            mimeType: img.mimeType,
          }))
        );
      }

      const legacyIds = legacyImages.map(img => img.id!).filter(Boolean);
      if (legacyIds.length > 0) {
        await db.images.bulkDelete(legacyIds);
      }
    }
  });
}

export async function getStylePackImages(packId: number): Promise<ImageItem[]> {
  await migrateLegacyStylePackImages();
  const modernImages = await db.images.where('stylePackId').equals(packId).toArray();
  if (modernImages.length > 0) return modernImages;

  const collidingProject = await db.projects.get(packId);
  if (collidingProject) return [];

  return db.images
    .where('projectId')
    .equals(packId)
    .filter(img => img.type === 'scene_ref' && !img.stylePackId)
    .toArray();
}

export async function deleteStylePackImages(packId: number) {
  await db.images.where('stylePackId').equals(packId).delete();

  const collidingProject = await db.projects.get(packId);
  if (!collidingProject) {
    await db.images
      .where('projectId')
      .equals(packId)
      .filter(img => img.type === 'scene_ref' && !img.stylePackId)
      .delete();
  }
}

export async function prepareProjectImageSlot(projectId: number) {
  const staleImages = await db.images
    .where('projectId')
    .equals(projectId)
    .filter(img => !img.stylePackId)
    .toArray();

  const staleIds = staleImages.map(img => img.id!).filter(Boolean);
  if (staleIds.length > 0) {
    await db.images.bulkDelete(staleIds);
  }
}
