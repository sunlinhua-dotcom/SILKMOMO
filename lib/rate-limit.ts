import { createHash } from 'node:crypto';

// 简单内存级 rate limiter — 不需要 Redis，单进程足够
// 重启进程会清空（这是缺点，但比没有好；超出的请求会被 429 拒绝）
interface Bucket {
  hits: number[];
  windowMs: number;
}

/** 桶数量硬上限：防止攻击者用随机用户名 / 随机 key 把内存撑爆 */
export const MAX_BUCKETS = 10_000;
/** 单桶最多保留的时间戳条数，防止 bumpRateLimit 无上限增长 */
const MAX_HITS_PER_BUCKET = 1_000;

// Map 的插入顺序即 LRU 顺序：每次访问把桶移到末尾，淘汰从头部开始
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
    // 刷新 LRU 位置
    buckets.delete(key);
    buckets.set(key, existing);
    return existing;
  }
  const fresh: Bucket = { hits: [], windowMs };
  buckets.set(key, fresh);
  return fresh;
}

// 淘汰：先按"各桶自己的窗口"清掉过期桶（不能用调用方的窗口做统一 cutoff，
// 否则短窗口调用会误删仍在长窗口内的桶，变相重置其计数）；
// 过期清完仍超过硬上限，就按 LRU 从最久没访问的开始删。
function sweepIfNeeded(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [k, v] of buckets) {
    const last = v.hits[v.hits.length - 1] ?? 0;
    if (v.hits.length === 0 || last < now - v.windowMs) {
      buckets.delete(k);
    }
  }
  if (buckets.size <= MAX_BUCKETS) return;
  // 一次多删一些（降到 90%），摊薄反复触发的全表扫描成本
  const target = Math.floor(MAX_BUCKETS * 0.9);
  for (const k of buckets.keys()) {
    if (buckets.size <= target) break;
    buckets.delete(k);
  }
}

/** 仅测试用：当前桶数量 */
export function __bucketCount(): number {
  return buckets.size;
}

/** 仅测试用：清空全部桶 */
export function __resetAllBuckets(): void {
  buckets.clear();
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
 * 通用按 key 限流（每次调用计 1 次），key 带命名空间避免不同接口互相串桶。
 * 例：rateLimitByKey('ai-chat', userId, 20, 60_000)
 */
export function rateLimitByKey(scope: string, id: string, max: number, windowMs: number): RateLimitResult {
  return rateLimit(`${scope}:${id}`, max, windowMs);
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
  if (bucket.hits.length > MAX_HITS_PER_BUCKET) {
    bucket.hits = bucket.hits.slice(-MAX_HITS_PER_BUCKET);
  }
  sweepIfNeeded(now);
}

/** 清空某个 key 的计数（如登录成功后解除该「用户名+IP」的失败计数） */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

// ═══════════════════════════════════════════════════════════════════
// 持久化限流（多实例共享）
//
// 上面的同步 rateLimit / isRateLimited / bumpRateLimit / resetRateLimit 是进程内内存实现，
// 保留作为 DB 不可用时的回退（以及 app/api/admin/setup 这类仍在用同步 API 的调用点）。
// 下面的 *Async 版本把「计数型」限流落到 PostgreSQL 表 RateLimitCounter：固定窗口，
// 一条原子 INSERT ... ON CONFLICT DO UPDATE ... RETURNING 完成「窗口过期则重置、否则 +1」，多实例共享计数。
//
// 回退：存储不可用（本地 sqlite / 未配库）或执行出错时，自动退回内存实现；
// 出错只告警（按 60 秒节流，不刷屏），不让限流故障变成接口故障。
//
// 与内存版的语义差异：内存版是滑动窗口，持久版是固定窗口（窗口从第一次计数起算，到点整体重置）。
// 不属于这里的：lib/generation-concurrency.ts 的「每人同时最多 N 条生成」是并发信号量，
// 不是计数窗口，故意保持进程内（单实例假设），不走本存储。
// ═══════════════════════════════════════════════════════════════════

/** 固定窗口计数存储。ttlMs = 距窗口结束还剩多少毫秒（用存储侧时钟算，避免多实例时钟漂移）。 */
export interface RateLimitStore {
  /** 计 1 次：窗口已过期则重置为 1，否则 +1；返回计数后的状态 */
  hit(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
  /** 只读：窗口未过期返回当前状态，否则 null */
  peek(key: string): Promise<{ count: number; ttlMs: number } | null>;
  /** 清掉某个 key */
  reset(key: string): Promise<void>;
}

// undefined = 尚未解析；null = 明确无持久存储（走内存）
let activeStore: RateLimitStore | null | undefined;
let storeLoading: Promise<RateLimitStore | null> | null = null;

/** 仅测试用：注入存储（null = 强制内存，undefined = 恢复默认解析） */
export function __setRateLimitStore(store: RateLimitStore | null | undefined): void {
  activeStore = store;
  storeLoading = null;
}

async function resolveStore(): Promise<RateLimitStore | null> {
  if (activeStore !== undefined) return activeStore;
  if (!storeLoading) {
    storeLoading = import('./rate-limit-store.ts')
      .then(m => (m.persistentRateLimitAvailable ? m.prismaRateLimitStore : null))
      .catch(() => null)
      .then(s => {
        if (activeStore === undefined) activeStore = s;
        return activeStore ?? null;
      });
  }
  return storeLoading;
}

/**
 * 存库的 key：`<scope>:<sha256 前 32 位>`。scope 取原 key 第一个冒号前的部分（login / register / ai-chat …），
 * 便于运维按类别排查；用户名、IP 等不以明文落库。
 */
export function storageKey(key: string): string {
  const scope = key.split(':', 1)[0].slice(0, 32) || 'k';
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return `${scope}:${digest}`;
}

const FALLBACK_WARN_INTERVAL_MS = 60_000;
let lastFallbackWarnAt = 0;
let fallbackWarn: (msg: string, err: unknown) => void = (msg, err) => console.warn(msg, err);

/** 仅测试用：替换告警输出，并清掉节流计时 */
export function __setFallbackWarn(fn: ((msg: string, err: unknown) => void) | null): void {
  fallbackWarn = fn ?? ((msg, err) => console.warn(msg, err));
  lastFallbackWarnAt = 0;
}

function warnFallback(err: unknown) {
  const now = Date.now();
  if (now - lastFallbackWarnAt < FALLBACK_WARN_INTERVAL_MS) return;
  lastFallbackWarnAt = now;
  const detail = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
  fallbackWarn('[rate-limit] 持久化限流不可用，已退回进程内内存计数：', detail);
}

/** 把存储状态换算成与内存版一致的结果（count 已包含本次） */
function toResult(count: number, ttlMs: number, max: number): RateLimitResult {
  if (count > max) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(ttlMs / 1000)) };
  }
  return { allowed: true, remaining: max - count, retryAfterSec: 0 };
}

/** 持久化版 rateLimit：每次调用计 1 次，超过 max 拒绝 */
export async function rateLimitAsync(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  const store = await resolveStore();
  if (store) {
    try {
      const { count, ttlMs } = await store.hit(key, windowMs);
      return toResult(count, ttlMs, max);
    } catch (err) {
      warnFallback(err);
    }
  }
  return rateLimit(key, max, windowMs);
}

/** 持久化版 rateLimitByKey：key 带 scope 命名空间 */
export function rateLimitByKeyAsync(scope: string, id: string, max: number, windowMs: number): Promise<RateLimitResult> {
  return rateLimitAsync(`${scope}:${id}`, max, windowMs);
}

/** 持久化版 isRateLimited：只检查不计数（计数 >= max 即拒绝，与内存版一致） */
export async function isRateLimitedAsync(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  const store = await resolveStore();
  if (store) {
    try {
      const row = await store.peek(key);
      if (!row || row.count < max) return { allowed: true, remaining: max - (row?.count ?? 0), retryAfterSec: 0 };
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(row.ttlMs / 1000)) };
    } catch (err) {
      warnFallback(err);
    }
  }
  return isRateLimited(key, max, windowMs);
}

/** 持久化版 bumpRateLimit：记一次失败（配合 isRateLimitedAsync） */
export async function bumpRateLimitAsync(key: string, windowMs: number): Promise<void> {
  const store = await resolveStore();
  if (store) {
    try {
      await store.hit(key, windowMs);
      return;
    } catch (err) {
      warnFallback(err);
    }
  }
  bumpRateLimit(key, windowMs);
}

/** 持久化版 resetRateLimit：同时清内存兜底桶，避免回退期间残留的计数卡住用户 */
export async function resetRateLimitAsync(key: string): Promise<void> {
  resetRateLimit(key);
  const store = await resolveStore();
  if (store) {
    try {
      await store.reset(key);
    } catch (err) {
      warnFallback(err);
    }
  }
}

/**
 * 登录失败锁定的 key：「用户名 + IP」维度。
 * 只锁"这个 IP 对这个账号"的尝试——攻击者在自己的 IP 上对 admin 连错 5 次，
 * 只会锁住他自己，真正的 admin 从别的 IP 登录不受影响。
 * 用户名统一小写并截断 64 位，防止超长字符串占内存。
 */
export function loginLockKey(username: string, ip: string): string {
  return `login:uip:${String(username).toLowerCase().slice(0, 64)}|${ip}`;
}

/**
 * 从 XFF / x-real-ip 里取客户端 IP（纯函数，便于测试）。
 *
 * 信任模型：X-Forwarded-For 形如 "client, proxy1, proxy2"，每一跳反代把"它看到的对端 IP"
 * 追加在右侧。左侧的值由客户端任意伪造，不可信；只有"我们自己的反代追加的那几段"可信。
 * 部署在 Zeabur 反代后：Zeabur 入口追加真实对端 IP 到最右侧，所以默认 trustedHops=1，
 * 取"从右数第 1 段"。如果前面还有一层 CDN（如 Cloudflare → Zeabur），XFF 最右是 CDN 节点，
 * 需把环境变量 TRUSTED_PROXY_HOPS 设为 2（取从右数第 2 段）。
 * XFF 段数不足 hops 时取最左一段（宁可偏严：同一出口共享计数，也不信伪造值）。
 */
export function extractClientIp(
  xff: string | null | undefined,
  realIp: string | null | undefined,
  trustedHops: number = 1,
): string {
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const hops = Number.isInteger(trustedHops) && trustedHops >= 1 ? trustedHops : 1;
      return parts[Math.max(0, parts.length - hops)].slice(0, 64);
    }
  }
  if (realIp) return realIp.trim().slice(0, 64);
  return 'unknown';
}

export function getClientIp(req: Request): string {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10);
  return extractClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'), hops);
}
