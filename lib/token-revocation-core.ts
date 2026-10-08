/**
 * 令牌吊销的纯逻辑（无 prisma / next 依赖，node:test 可直接加载）。
 *
 * 登出时把 JWT 的 jti 写进 RevokedToken 表；校验处按主键查询是否被吊销，并带进程内小缓存：
 *   - 已吊销：缓存到令牌自然过期（吊销是单向的，不会再变回有效）；
 *   - 未吊销：最多缓存 30 秒（这就是多实例下「别的实例上登出」的最长传播延迟；本实例登出会直接写缓存，立即生效）；
 *   - 不带 jti 的老 token（上线前签发）直接视为未吊销，不查库，继续有效到自然过期。
 *
 * ── 取舍：查库失败时 fail-open ──
 * 数据库抖动不能把全站用户踢下线（鉴权在每个请求上，fail-closed 等于数据库一抖全站 401）。
 * 代价：库不可用的那段时间里，已登出的令牌可能被放行。缓解：失败结果只缓存 FAIL_OPEN_TTL_MS（5 秒）
 * 避免每个请求都去撞坏掉的库，恢复后下一次查询立即回到正常；失败会打 console.error（按间隔节流，不刷屏）。
 */

/** 未吊销结果的缓存时长（也是多实例下登出传播的最长延迟） */
export const NOT_REVOKED_TTL_MS = 30_000;
/** 查库失败（fail-open）结果的缓存时长，避免对坏掉的库逐请求重试 */
export const FAIL_OPEN_TTL_MS = 5_000;
/** 缓存条目硬上限，防止随机 jti 把内存撑爆 */
export const MAX_CACHE_ENTRIES = 10_000;
/** 失败日志节流间隔 */
const ERROR_LOG_INTERVAL_MS = 60_000;
/** 清理函数默认每批删除行数 */
export const PURGE_BATCH_SIZE = 500;

export interface RevocationStore {
  /** 按主键查询该 jti 是否在吊销表里 */
  isRevoked(jti: string): Promise<boolean>;
  /** 幂等写入：同一个 jti 重复调用不报错 */
  revoke(jti: string, userId: string, expiresAt: Date): Promise<void>;
  /** 删除一批 expiresAt < before 的行，返回实际删除数 */
  purgeBatch(before: Date, limit: number): Promise<number>;
}

interface CacheEntry {
  revoked: boolean;
  /** 条目有效期截止（毫秒时间戳） */
  until: number;
}

export interface RevocationChecker {
  /**
   * 该令牌是否已被吊销。
   * @param jti JWT 的 jti；缺失（老 token）返回 false
   * @param expSec JWT 的 exp（秒）；用来决定「已吊销」结果缓存多久
   */
  isRevoked(jti: string | undefined | null, expSec?: number): Promise<boolean>;
  /** 吊销一个令牌：先写缓存（本实例立即生效），再写库；写库失败会抛出，但缓存已生效 */
  revoke(jti: string, userId: string, expSec: number): Promise<void>;
  /** 清空缓存（测试用） */
  clearCache(): void;
  /** 当前缓存条目数（测试用） */
  cacheSize(): number;
}

export interface RevocationCheckerOptions {
  notRevokedTtlMs?: number;
  failOpenTtlMs?: number;
  maxEntries?: number;
  /** 可注入时钟（毫秒），默认 Date.now */
  now?: () => number;
  /** 可注入日志（默认 console.error），便于测试 */
  logError?: (msg: string, err: unknown) => void;
}

export function createRevocationChecker(
  store: RevocationStore,
  options: RevocationCheckerOptions = {},
): RevocationChecker {
  const notRevokedTtl = options.notRevokedTtlMs ?? NOT_REVOKED_TTL_MS;
  const failOpenTtl = options.failOpenTtlMs ?? FAIL_OPEN_TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_CACHE_ENTRIES;
  const now = options.now ?? Date.now;
  const logError = options.logError ?? ((msg: string, err: unknown) => console.error(msg, err));

  // Map 的插入顺序即写入顺序：超限时先清过期，再从头部删最老的
  const cache = new Map<string, CacheEntry>();
  let lastErrorLogAt = 0;

  function put(jti: string, entry: CacheEntry) {
    cache.delete(jti);
    cache.set(jti, entry);
    if (cache.size <= maxEntries) return;
    const t = now();
    for (const [k, v] of cache) {
      if (v.until <= t) cache.delete(k);
    }
    if (cache.size <= maxEntries) return;
    const target = Math.floor(maxEntries * 0.9);
    for (const k of cache.keys()) {
      if (cache.size <= target) break;
      cache.delete(k);
    }
  }

  /** 已吊销结果的缓存截止：到令牌自然过期；exp 缺失时给 7 天（与 JWT 有效期一致） */
  function revokedUntil(expSec: number | undefined, t: number): number {
    if (typeof expSec === 'number' && Number.isFinite(expSec)) return Math.max(expSec * 1000, t + notRevokedTtl);
    return t + 7 * 24 * 3600 * 1000;
  }

  return {
    async isRevoked(jti, expSec) {
      if (!jti) return false; // 老 token：没有 jti，无从吊销，继续有效到自然过期
      const t = now();
      const hit = cache.get(jti);
      if (hit && hit.until > t) return hit.revoked;

      try {
        const revoked = await store.isRevoked(jti);
        put(jti, revoked
          ? { revoked: true, until: revokedUntil(expSec, t) }
          : { revoked: false, until: t + notRevokedTtl });
        return revoked;
      } catch (err) {
        // fail-open：见文件头的取舍说明
        if (t - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
          lastErrorLogAt = t;
          logError('[auth] 令牌吊销表查询失败，按未吊销放行（fail-open）：', err);
        }
        put(jti, { revoked: false, until: t + failOpenTtl });
        return false;
      }
    },

    async revoke(jti, userId, expSec) {
      const t = now();
      // 先写本实例缓存：即使随后写库失败，这个实例上这枚令牌也立刻失效
      put(jti, { revoked: true, until: revokedUntil(expSec, t) });
      await store.revoke(jti, userId, new Date(expSec * 1000));
    },

    clearCache() {
      cache.clear();
    },

    cacheSize() {
      return cache.size;
    },
  };
}

/**
 * 分批清理过期的吊销记录（expiresAt < now）。返回总删除行数。
 * 一批一批删，避免长事务 / 大锁；任一批失败直接抛出，已删除的不回滚。
 */
export async function purgeExpiredFromStore(
  store: RevocationStore,
  now: Date = new Date(),
  batchSize: number = PURGE_BATCH_SIZE,
  maxBatches: number = 1000,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = await store.purgeBatch(now, batchSize);
    total += n;
    if (n < batchSize) break;
  }
  return total;
}
