// 简单内存级 rate limiter — 不需要 Redis，单进程足够
// 重启进程会清空（这是缺点，但比没有好；超出的请求会被 429 拒绝）
const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * 滑动窗口计数器
 * @param key 标识符（IP、userId、IP+route 组合）
 * @param max 窗口内最大请求数
 * @param windowMs 窗口长度（毫秒）
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  const arr = buckets.get(key) ?? [];
  // 清掉窗口外的旧请求
  const recent = arr.filter(t => t > cutoff);

  if (recent.length >= max) {
    const oldestInWindow = recent[0];
    const retryAfterSec = Math.ceil((oldestInWindow + windowMs - now) / 1000);
    buckets.set(key, recent);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  recent.push(now);
  buckets.set(key, recent);

  // 阶段性清理：bucket 太多时保守清掉空 bucket，避免内存无限增长
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || (v[v.length - 1] ?? 0) < cutoff) {
        buckets.delete(k);
      }
    }
  }

  return { allowed: true, remaining: max - recent.length, retryAfterSec: 0 };
}

/**
 * 从 NextRequest 提取客户端 IP，做一个 best-effort
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}
