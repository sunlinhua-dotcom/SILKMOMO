import type { Project, ImageItem } from '@/lib/db';

// ═══ SSE 事件类型 ═══
export type GenerationPhase = 'idle' | 'analyzing' | 'generating' | 'done' | 'error' | 'cancelled';
export interface GenerationError { shotIndex: number; message: string; fatal: boolean; }

/** 开流前就被服务端拒绝（HTTP 4xx/5xx）：携带状态码，方便区分 429 / 413 并给出友好文案。 */
export class GenerationHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GenerationHttpError';
    this.status = status;
  }
}

/** 服务端幂等命中时推的三种非致命说明，只当「该镜次的提示」展示，不算失败。 */
export const IDEMPOTENT_NOTICE_PATTERN = /已生成并交付过|上一次请求仍在生成中|上一次请求未完成/;

export function formatYuan(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

/** 把耗时秒数说成人话：不足一分钟说「约 N 秒」，其余向上取整到半分钟。 */
export function formatEtaText(seconds: number): string {
  if (seconds < 60) return `约 ${Math.max(10, Math.round(seconds / 5) * 5)} 秒`;
  const halfMinutes = Math.ceil(seconds / 30) / 2;
  return `约 ${Number.isInteger(halfMinutes) ? halfMinutes : halfMinutes.toFixed(1)} 分钟`;
}
export interface ProductGroupPayload {
  images: Array<{ data: string; mimeType: string }>;
  label?: string;
  categories?: string[];
}

export type ModelIdentityMode = 'fresh' | 'follow_scene';

// 备份-图片严格配对：两侧都 defined 且 shotIndex 相等，或两侧都 undefined（场景图）；
// 任一侧 undefined 而另一侧 defined → 不匹配（避免通配匹配到错误备份）。
export function backupMatchesImage(b: ImageItem, imgShotIndex: number | undefined): boolean {
  if (b.shotIndex === undefined && imgShotIndex === undefined) return true;
  if (b.shotIndex === undefined || imgShotIndex === undefined) return false;
  return b.shotIndex === imgShotIndex;
}

export function getSceneGroupMode(project: Project | null | undefined): 'swap' | 'products' {
  return project?.sceneGroupMode === 'products' ? 'products' : 'swap';
}

export function getModelIdentityMode(project: Project | null | undefined): ModelIdentityMode {
  return project?.modelIdentityMode === 'follow_scene' ? 'follow_scene' : 'fresh';
}

export function sortImagesByPrimaryKey(images: ImageItem[]): ImageItem[] {
  return [...images].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export function isConnectionLayerError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const raw = `${error.name} ${error.message}`;
  return error.name === 'TypeError'
    || error.name === 'AbortError'
    || /network|failed to fetch|fetch failed|load failed|networkerror|internet connection|connection/i.test(raw);
}

export function buildGenerationContinuationText(remainingCount: number): string {
  return remainingCount > 0
    ? `点下方“生成剩余 ${remainingCount} 张”继续。`
    : '请稍后重试。';
}

export function buildFriendlyConnectionErrorMessage(successCount: number, remainingCount: number): string {
  const savedText = successCount > 0 ? '已生成的图片已保存，' : '';
  return `连接中断：${savedText}未完成的部分不会白扣费（失败自动退款）。${buildGenerationContinuationText(remainingCount)}`;
}

export function buildFriendlyUnexpectedErrorMessage(successCount: number, remainingCount: number): string {
  const savedText = successCount > 0 ? '已生成的图片已保存，' : '';
  return `生成中断：${savedText}未完成的部分不会白扣费（失败自动退款）。${buildGenerationContinuationText(remainingCount)}`;
}

export function getKnownUserFacingErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error instanceof GenerationHttpError) return error.message;
  return /登录已过期|请重新登录|服务响应异常/.test(error.message) ? error.message : null;
}

export function getDisplayErrorMessage(message: string, successCount: number, remainingCount: number): string {
  return /TypeError|AbortError|Failed to fetch|fetch failed|Load failed|NetworkError|network|connection/i.test(message)
    ? buildFriendlyConnectionErrorMessage(successCount, remainingCount)
    : message;
}

export function buildProductGroupsFromImages(images: ImageItem[]): ProductGroupPayload[] {
  const grouped = new Map<number, ImageItem[]>();
  for (const img of images) {
    const groupIndex = typeof img.groupIndex === 'number' && img.groupIndex > 0 ? img.groupIndex : 1;
    grouped.set(groupIndex, [...(grouped.get(groupIndex) || []), img]);
  }
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, groupImages]) => {
      const label = groupImages.find(img => typeof img.prompt === 'string' && img.prompt.trim())?.prompt?.trim();
      return {
        label,
        images: groupImages.map(img => ({ data: img.data, mimeType: img.mimeType })),
      };
    });
}

export function parseSelectedShots(raw: string | undefined, fallback = [1, 2, 3, 4, 9]): number[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(n => Number.isInteger(n)) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
