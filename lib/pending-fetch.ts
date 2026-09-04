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

export async function fetchPendingImageWithRetry(
  pendingId: string,
  options: PendingFetchOptions = {},
): Promise<PendingImageBody | null> {
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

    if (response.status === 404) return null;
    const bodyTimeout = setTimeout(() => controller.abort(), bodyTimeoutMs);
    try {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as { image?: PendingImageBody };
      if (json?.image?.data) return json.image;
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
  return null;
}
