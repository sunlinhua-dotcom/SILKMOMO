// 简单内存级 rate limiter — 不需要 Redis，单进程足够
// 重启进程会清空（这是缺点，但比没有好；超出的请求会被 429 拒绝）
interface Bucket {
  hits: number[];
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

function getBucket(key: string, windowMs: number): Bucket {
  const existing = buckets.get(key);
  if (existing) {
    existing.windowMs = windowMs;
    return existing;
  }
  const fresh: Bucket = { hits: [], windowMs };
  buckets.set(key, fresh);
  return fresh;
}

// 阶段性清理：bucket 太多时按"各桶自己的窗口"淘汰过期桶。
// 不能用调用方的窗口做统一 cutoff —— 短窗口调用会误删仍在长窗口内的桶，变相重置其计数。
function sweepIfNeeded(now: number) {
  if (buckets.size <= 5000) return;
  for (const [k, v] of buckets) {
    const last = v.hits[v.hits.length - 1] ?? 0;
    if (v.hits.length === 0 || last < now - v.windowMs) {
      buckets.delete(k);
    }
  }
}

/**
 * 滑动窗口计数器（每次调用计 1 次）
 * @param key 标识符（IP、userId、IP+route 组合）
 * @param max 窗口内最大请求数
 * @param windowMs 窗口长度（毫秒）
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = getBucket(key, windowMs);

  // 清掉窗口外的旧请求
  bucket.hits = bucket.hits.filter(t => t > cutoff);

  if (bucket.hits.length >= max) {
    const oldestInWindow = bucket.hits[0];
    const retryAfterSec = Math.ceil((oldestInWindow + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  bucket.hits.push(now);
  sweepIfNeeded(now);

  return { allowed: true, remaining: max - bucket.hits.length, retryAfterSec: 0 };
}

/**
 * 只检查不计数（用于"失败才计数"的场景，如登录按用户名限流）。
 */
export function isRateLimited(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = getBucket(key, windowMs);
  bucket.hits = bucket.hits.filter(t => t > cutoff);

  if (bucket.hits.length >= max) {
    const oldestInWindow = bucket.hits[0];
    const retryAfterSec = Math.ceil((oldestInWindow + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  return { allowed: true, remaining: max - bucket.hits.length, retryAfterSec: 0 };
}

/** 记一次失败（配合 isRateLimited 使用） */
export function bumpRateLimit(key: string, windowMs: number): void {
  const now = Date.now();
  const bucket = getBucket(key, windowMs);
  bucket.hits = bucket.hits.filter(t => t > now - windowMs);
  bucket.hits.push(now);
  sweepIfNeeded(now);
}

/** 清空某个 key 的计数（如登录成功后解除该用户名的失败计数） */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * 从 NextRequest 提取客户端 IP，做一个 best-effort。
 * 注意：X-Forwarded-For 的"第一段"由客户端任意伪造；
 * 反代（Zeabur / nginx 等）追加的真实对端 IP 在"最后一段"，因此取最后一段。
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}
