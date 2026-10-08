/**
 * 出图路由的入口护栏：每人并发上限 + 请求体上限。纯逻辑、无依赖，node:test 可直接加载。
 *
 * ── 每人并发 ──
 * 进程内按 userId 计在途 SSE 流（多实例部署时每个实例各自计数，上限是「每实例每人」）。
 * 【单实例假设】这是并发信号量，不是计数窗口：名额随 stream 的 finally 释放，故意不落库、不走 lib/rate-limit.ts 的持久化限流
 * （落库后进程被杀会留下永远不释放的名额）。要做到全局「每人 N 条」需要带租约过期的分布式信号量，目前不在范围内。
 * 一次出图请求从开流起占一个名额，stream 的 finally 里必须释放。
 *
 * 默认上限 3，依据客户端实际行为：
 *   - app/task/[id]/page.tsx 的分块循环是串行 await 的，一个页面同一时刻只有 1 条流；
 *   - 但分块被看门狗 abort 后，服务端那条流要等在途的上游调用跑完（GPT 单张最长约 280s）才会释放，
 *     客户端会立刻开下一块——所以单页面最多同时 2 条（1 条残留 + 1 条新的）；
 *   - 默认 = 客户端最大并发 2 + 1 = 3。可用 GENERATION_MAX_CONCURRENT_PER_USER 覆盖。
 *
 * ── 请求体上限 ──
 * 真实最大合法负载（lookbook 组图 swap 模式）：
 *   场景参考图 20 + 产品图 8 + 模特参考 6 + 背景参考 6 + 配件 6 = 46 张，客户端压缩到 ≤ 800KiB
 *   （lib/image-compressor.ts TARGET_SIZE_KB），base64 后每张 ≤ ~1.07MiB → ≈ 50.3MiB；
 *   再加两张锚点图（服务端 shrinkAnchorForClient 后的 JPEG，按每张 ≤ 3MiB 估）≈ 6MiB，
 *   以及 JSON 骨架与文本字段（< 100KiB）→ 合计 < 57MiB。
 *   上限取 64MiB，给合法的最大组图留 ~12% 余量，同时挡住几百 MB 的恶意体。
 *   覆盖：GENERATION_MAX_BODY_BYTES。
 */

export const DEFAULT_MAX_CONCURRENT_PER_USER = 3;
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMaxConcurrentGenerationsPerUser(env: Record<string, string | undefined> = process.env): number {
  return positiveIntFromEnv(env.GENERATION_MAX_CONCURRENT_PER_USER, DEFAULT_MAX_CONCURRENT_PER_USER);
}

export function getMaxGenerationBodyBytes(env: Record<string, string | undefined> = process.env): number {
  return positiveIntFromEnv(env.GENERATION_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
}

export interface GenerationConcurrencyLimiter {
  /** 名额已满返回 null；否则返回幂等的 release（重复调用无副作用）。 */
  tryAcquire(userId: string): { release: () => void } | null;
  /** 当前是否已达上限（只读，用于在解析大请求体之前先挡一道）。 */
  isFull(userId: string): boolean;
  active(userId: string): number;
}

export function createGenerationConcurrencyLimiter(
  getLimit: () => number = () => getMaxConcurrentGenerationsPerUser(),
): GenerationConcurrencyLimiter {
  const counts = new Map<string, number>();
  return {
    tryAcquire(userId) {
      const current = counts.get(userId) ?? 0;
      if (current >= getLimit()) return null;
      counts.set(userId, current + 1);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          const next = (counts.get(userId) ?? 1) - 1;
          if (next <= 0) counts.delete(userId);
          else counts.set(userId, next);
        },
      };
    },
    isFull: userId => (counts.get(userId) ?? 0) >= getLimit(),
    active: userId => counts.get(userId) ?? 0,
  };
}

/** 进程级单例（挂 globalThis，热重载 / 多 bundle 下仍是同一份计数）。 */
export function getGenerationConcurrencyLimiter(): GenerationConcurrencyLimiter {
  const globalState = globalThis as typeof globalThis & { __generationLimiter?: GenerationConcurrencyLimiter };
  if (!globalState.__generationLimiter) {
    globalState.__generationLimiter = createGenerationConcurrencyLimiter();
  }
  return globalState.__generationLimiter;
}

export const GENERATION_BUSY_MESSAGE = '同时进行的生成任务过多，请等当前任务结束后再试';

export class RequestBodyTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super('请求体过大');
    this.name = 'RequestBodyTooLargeError';
    this.maxBytes = maxBytes;
  }
}

export function requestBodyTooLargeMessage(maxBytes: number): string {
  return `请求体过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB），请减少图片数量或重新压缩后再试`;
}

/**
 * 先看 content-length（超限直接拒绝，不读 body），再流式计数读取（chunked / 谎报长度同样兜住），
 * 最后 JSON.parse。超限抛 RequestBodyTooLargeError，解析失败抛 SyntaxError。
 */
export async function readJsonBodyWithLimit(
  req: { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<unknown> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
  if (!req.body) throw new SyntaxError('empty body');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => { /* 已在拒绝路径，取消失败无所谓 */ });
      throw new RequestBodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged));
}
