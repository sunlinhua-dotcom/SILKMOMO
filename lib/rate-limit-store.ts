/**
 * 限流计数的持久化存储（PostgreSQL 表 RateLimitCounter，固定窗口，多实例共享）。
 * 接口形状见 rate-limit.ts 的 RateLimitStore；本文件只在 DB 可用时才被 rate-limit.ts 动态加载。
 *
 * 全部时间用「数据库时钟」（now() AT TIME ZONE 'UTC'）：多实例之间不依赖各机器时钟一致，
 * 也绕开 TIMESTAMP(3)（无时区）列与 JS Date 参数的时区换算问题。
 */
import prisma, { isPostgres } from './prisma';
import { storageKey, type RateLimitStore } from './rate-limit.ts';

interface CounterRow {
  count: number;
  ttlMs: number;
}

export const prismaRateLimitStore: RateLimitStore = {
  async hit(key, windowMs) {
    const k = storageKey(key);
    const rows = await prisma.$queryRaw<CounterRow[]>`
      INSERT INTO "RateLimitCounter" AS c ("key", "count", "resetAt")
      VALUES (${k}, 1, (now() AT TIME ZONE 'UTC') + (${windowMs}::float8 * interval '1 millisecond'))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN c."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1 ELSE c."count" + 1 END,
        "resetAt" = CASE WHEN c."resetAt" <= (now() AT TIME ZONE 'UTC')
                         THEN (now() AT TIME ZONE 'UTC') + (${windowMs}::float8 * interval '1 millisecond')
                         ELSE c."resetAt" END
      RETURNING c."count" AS "count",
                FLOOR(EXTRACT(EPOCH FROM (c."resetAt" - (now() AT TIME ZONE 'UTC'))) * 1000)::float8 AS "ttlMs"`;
    const row = rows[0];
    return { count: Number(row.count), ttlMs: Number(row.ttlMs) };
  },

  async peek(key) {
    const k = storageKey(key);
    const rows = await prisma.$queryRaw<CounterRow[]>`
      SELECT "count" AS "count",
             FLOOR(EXTRACT(EPOCH FROM ("resetAt" - (now() AT TIME ZONE 'UTC'))) * 1000)::float8 AS "ttlMs"
      FROM "RateLimitCounter"
      WHERE "key" = ${k} AND "resetAt" > (now() AT TIME ZONE 'UTC')`;
    if (rows.length === 0) return null;
    return { count: Number(rows[0].count), ttlMs: Number(rows[0].ttlMs) };
  },

  async reset(key) {
    await prisma.rateLimitCounter.deleteMany({ where: { key: storageKey(key) } });
  },
};

/** 当前环境是否能用持久化限流：仅 PostgreSQL（本地 sqlite 开发走内存） */
export const persistentRateLimitAvailable = isPostgres;

/**
 * 清理过期的限流计数（resetAt < now），分批删除，返回删除总数。
 * 注意：未接线——instrumentation.ts 的定时任务由主会话统一接入。
 */
export async function purgeExpiredRateLimitCounters(
  now: Date = new Date(),
  batchSize: number = 500,
  maxBatches: number = 1000,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const rows = await prisma.rateLimitCounter.findMany({
      where: { resetAt: { lt: now } },
      select: { key: true },
      take: batchSize,
    });
    if (rows.length === 0) break;
    const res = await prisma.rateLimitCounter.deleteMany({ where: { key: { in: rows.map(r => r.key) } } });
    total += res.count;
    if (rows.length < batchSize) break;
  }
  return total;
}
