export interface PendingImageBody {
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

interface FetchResponseLike {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

interface PendingFetchOptions {
  attempts?: number;
  handshakeTimeoutMs?: number;
  bodyTimeoutMs?: number;
  retryDelayMs?: (attempt: number) => number;
  fetchImpl?: (url: string, init: { cache: 'no-store'; signal: AbortSignal }) => Promise<FetchResponseLike>;
  onAttemptError?: (error: unknown, attempt: number, attempts: number) => void;
}

/**
 * 取图的三种结果。区分 `gone` 与 `failed` 是为了让调用方知道「没取到」是哪一种：
 * - `gone`：服务端回 404，图已被别的路径取走并删除（SSE 正常交付的 `releasePendingImage`、另一轮补拉、TTL 清理）。
 *   这不是故障，不该重试，更不该计入失败。
 * - `failed`：重试用尽仍然没拿到（网络 / 5xx / 响应体残缺）。图多半还在服务端，才需要上报。
 */
export type PendingFetchOutcome =
  | { status: 'ok'; image: PendingImageBody }
  | { status: 'gone' }
  | { status: 'failed' };

export async function fetchPendingImageWithRetry(
  pendingId: string,
  options: PendingFetchOptions = {},
): Promise<PendingImageBody | null> {
  const outcome = await fetchPendingImageOutcome(pendingId, options);
  return outcome.status === 'ok' ? outcome.image : null;
}

export async function fetchPendingImageOutcome(
  pendingId: string,
  options: PendingFetchOptions = {},
): Promise<PendingFetchOutcome> {
  const attempts = options.attempts ?? 3;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 120_000;
  const retryDelayMs = options.retryDelayMs ?? (attempt => 1_000 * attempt);
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), handshakeTimeoutMs);
    let response: FetchResponseLike;
    try {
      response = await fetchImpl(`/api/generation/pending/${pendingId}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      options.onAttemptError?.(error, attempt, attempts);
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs(attempt)));
      }
      continue;
    } finally {
      // 10 秒只保护服务器开始响应前的握手。
      clearTimeout(timeout);
    }

    if (response.status === 404) return { status: 'gone' };
    const bodyTimeout = setTimeout(() => controller.abort(), bodyTimeoutMs);
    try {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as { image?: PendingImageBody };
      if (json?.image?.data) return { status: 'ok', image: json.image };
      throw new Error('响应缺少图片数据');
    } catch (error) {
      options.onAttemptError?.(error, attempt, attempts);
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs(attempt)));
      }
    } finally {
      // body 可以比握手慢很多，但半开连接不能无限占住 SSE 恢复循环。
      clearTimeout(bodyTimeout);
    }
  }
  return { status: 'failed' };
}
