import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface ReferenceImageInput {
  data: string;
  mimeType: string;
}

export const REFERENCE_IMAGE_MAX_BYTES = 800 * 1024;
export const REFERENCE_IMAGE_MAX_DIMENSION = 1920;

const JPEG_QUALITIES = [82, 74, 66, 58, 50, 42] as const;

export interface NormalizeReferenceImageOptions {
  preserveLossless?: boolean;
}

function safeMimeType(mimeType: string): string {
  return mimeType.replace(/[\r\n]/g, '').slice(0, 80) || 'unknown';
}

function dimensionLabel(width?: number, height?: number): string {
  return width && height ? `${width}x${height}` : 'unknown';
}

function nextMaxDimension(current: number, outputBytes: number): number {
  if (current <= 1) return 1;
  const estimatedScale = Math.sqrt(REFERENCE_IMAGE_MAX_BYTES / outputBytes) * 0.95;
  const scale = Math.min(0.85, estimatedScale);
  return Math.max(1, Math.min(current - 1, Math.floor(current * scale)));
}

async function encodeAtDimension(
  input: Buffer,
  maxDimension: number,
  preserveTransparency: boolean,
  jpegQuality?: number,
) {
  const pipeline = sharp(input)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });

  return preserveTransparency
    ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
    : pipeline.jpeg({ quality: jpegQuality ?? JPEG_QUALITIES[0], progressive: true }).toBuffer({ resolveWithObject: true });
}

interface NormalizeOutcome<T> {
  value: T;
  /** 仅「真的归一化成功」才为 true；失败回退原图不进缓存。 */
  normalized: boolean;
}

async function normalizeReferenceImageUncached<T extends ReferenceImageInput>(
  input: T,
  label: string,
  options: NormalizeReferenceImageOptions,
): Promise<NormalizeOutcome<T>> {
  const declaredMime = safeMimeType(input.mimeType);
  let inputBuffer: Buffer | undefined;
  let inputDimensions = 'unknown';

  try {
    inputBuffer = Buffer.from(input.data, 'base64');
    const metadata = await sharp(inputBuffer).metadata();
    const orientedWidth = metadata.autoOrient?.width ?? metadata.width;
    const orientedHeight = metadata.autoOrient?.height ?? metadata.height;
    inputDimensions = dimensionLabel(orientedWidth, orientedHeight);

    if (options.preserveLossless) {
      const lossless = await sharp(inputBuffer)
        .rotate()
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer({ resolveWithObject: true });
      console.info(
        `[ref-image-normalize] ${label}: ${inputBuffer.length}B ${declaredMime} ${inputDimensions} -> ` +
        `${lossless.data.length}B image/png ${dimensionLabel(lossless.info.width, lossless.info.height)} (lossless)`,
      );
      return {
        normalized: true,
        value: {
          ...input,
          data: lossless.data.toString('base64'),
          mimeType: 'image/png',
        },
      };
    }

    const stats = metadata.hasAlpha ? await sharp(inputBuffer).stats() : undefined;
    const preserveTransparency = metadata.hasAlpha && stats?.isOpaque === false;

    let maxDimension = REFERENCE_IMAGE_MAX_DIMENSION;

    while (true) {
      let encoded: Awaited<ReturnType<typeof encodeAtDimension>>;
      if (preserveTransparency) {
        encoded = await encodeAtDimension(inputBuffer, maxDimension, true);
      } else {
        encoded = await encodeAtDimension(inputBuffer, maxDimension, false, JPEG_QUALITIES[0]);
        for (const quality of JPEG_QUALITIES.slice(1)) {
          if (encoded.data.length <= REFERENCE_IMAGE_MAX_BYTES) break;
          encoded = await encodeAtDimension(inputBuffer, maxDimension, false, quality);
        }
      }

      if (encoded.data.length <= REFERENCE_IMAGE_MAX_BYTES) {
        const outputMime = preserveTransparency ? 'image/png' : 'image/jpeg';
        console.info(
          `[ref-image-normalize] ${label}: ${inputBuffer.length}B ${declaredMime} ${inputDimensions} -> ` +
          `${encoded.data.length}B ${outputMime} ${dimensionLabel(encoded.info.width, encoded.info.height)}`,
        );

        return {
          normalized: true,
          value: {
            ...input,
            data: encoded.data.toString('base64'),
            mimeType: outputMime,
          },
        };
      }
      if (maxDimension === 1) throw new Error('无法将参考图压缩到安全上限');
      maxDimension = nextMaxDimension(maxDimension, encoded.data.length);
    }
  } catch {
    console.info(
      `[ref-image-normalize] ${label}: ${inputBuffer?.length ?? 0}B ${declaredMime} ${inputDimensions} -> ` +
      `${inputBuffer?.length ?? 0}B ${declaredMime} ${inputDimensions} (fallback=original)`,
    );
    return { normalized: false, value: input };
  }
}

// ─── 进程内 LRU：同一组图任务里重复出现的场景底图 / 锚图 / 产品图不再反复跑 sharp ───
// 键 = sha1(是否无损 + 完整 data 字符串)；值只存归一化后的 data + mimeType，
// 命中时与调用方传入的 input 其余字段合并，所以 skipNormalization 等附加字段不受影响。
export const REFERENCE_CACHE_MAX_ENTRIES = 16;
export const REFERENCE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

interface CacheEntry {
  data: string;
  mimeType: string;
  bytes: number;
}

const refCache = new Map<string, CacheEntry>(); // Map 保持插入序：队首最久未用
let refCacheBytes = 0;
const inflight = new Map<string, Promise<CacheEntry | null>>();

function cacheKey(input: ReferenceImageInput, options: NormalizeReferenceImageOptions): string {
  return createHash('sha1')
    .update(options.preserveLossless ? 'L:' : 'N:')
    .update(input.data)
    .digest('hex');
}

function cacheGet(key: string): CacheEntry | undefined {
  const hit = refCache.get(key);
  if (!hit) return undefined;
  refCache.delete(key);
  refCache.set(key, hit); // 刷新为最近使用
  return hit;
}

function cachePut(key: string, entry: CacheEntry): void {
  if (entry.bytes > REFERENCE_CACHE_MAX_BYTES) return; // 单项就超上限：不缓存
  const old = refCache.get(key);
  if (old) {
    refCacheBytes -= old.bytes;
    refCache.delete(key);
  }
  refCache.set(key, entry);
  refCacheBytes += entry.bytes;
  while (refCache.size > REFERENCE_CACHE_MAX_ENTRIES || refCacheBytes > REFERENCE_CACHE_MAX_BYTES) {
    const oldestKey = refCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    refCacheBytes -= refCache.get(oldestKey)!.bytes;
    refCache.delete(oldestKey);
  }
}

/** 仅供测试：清空缓存并返回当前占用。 */
export function __resetReferenceImageCacheForTest(): void {
  refCache.clear();
  inflight.clear();
  refCacheBytes = 0;
}

export function __referenceImageCacheStatsForTest(): { entries: number; bytes: number } {
  return { entries: refCache.size, bytes: refCacheBytes };
}

/**
 * 归一化单张即将上行的参考图。
 *
 * 失败时始终原样返回，避免图片预处理故障改变既有生成/退款语义（失败结果不进缓存）。
 * 每次真正归一化只打印一行尺寸与体积日志，不包含 URL、令牌或图片内容；
 * 命中进程内 LRU 时不再跑 sharp，只打一行 cache-hit 日志。
 */
export async function normalizeReferenceImage<T extends ReferenceImageInput>(
  input: T,
  label = 'reference',
  options: NormalizeReferenceImageOptions = {},
): Promise<T> {
  let key: string;
  try {
    key = cacheKey(input, options);
  } catch {
    // data 不是字符串之类的异常输入：不缓存，走原路径（内部会 catch 并原样返回）
    return (await normalizeReferenceImageUncached(input, label, options)).value;
  }

  const hit = cacheGet(key);
  if (hit) {
    console.info(`[ref-image-normalize] ${label}: cache-hit ${hit.bytes}B ${safeMimeType(hit.mimeType)}`);
    return { ...input, data: hit.data, mimeType: hit.mimeType };
  }

  // 并发去重：同一张图正被另一路归一化时，等它的结果而不是再跑一遍 sharp
  const pending = inflight.get(key);
  if (pending) {
    const shared = await pending;
    if (shared) {
      console.info(`[ref-image-normalize] ${label}: shared-inflight ${shared.bytes}B ${safeMimeType(shared.mimeType)}`);
      return { ...input, data: shared.data, mimeType: shared.mimeType };
    }
    return (await normalizeReferenceImageUncached(input, label, options)).value;
  }

  const task = normalizeReferenceImageUncached(input, label, options).then(outcome => {
    if (!outcome.normalized) return null;
    const entry: CacheEntry = {
      data: outcome.value.data,
      mimeType: outcome.value.mimeType,
      bytes: outcome.value.data.length,
    };
    cachePut(key, entry);
    return entry;
  });
  const guarded = task.catch(() => null);
  inflight.set(key, guarded);
  try {
    const entry = await task;
    return entry ? { ...input, data: entry.data, mimeType: entry.mimeType } : input;
  } finally {
    inflight.delete(key);
  }
}
