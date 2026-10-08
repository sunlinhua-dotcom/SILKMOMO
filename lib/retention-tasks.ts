/**
 * 把「过期吊销令牌」「过期限流计数」两个清理函数接入每日保留清理（lib/retention.ts 的 registerRetentionTask）。
 *
 * 为什么单独一个文件：这两个 purge 函数本身不认 dry-run（RETENTION_DRY_RUN=1 要求只统计不删除），
 * 所以在包装里分流——dry-run 走只读的 count，正式跑才走 purge。
 * 纯包装逻辑（createExpiredPurgeTask）不 import 任何运行时依赖，方便 node:test 直接加载；
 * 真实的 Prisma 依赖只在任务实际执行时才动态加载，注册本身不触发数据库连接。
 *
 * 调用方：instrumentation.ts，必须在 startRetentionScheduler() 之前调用（首跑在启动 10 分钟后，
 * 但注册顺序放在调度之前最稳，也不依赖定时器的先后）。
 */
import { registerRetentionTask, type RetentionTaskFn } from './retention.ts';

export interface ExpiredPurgeOps {
  /** 删除 expiresAt/resetAt 早于 now 的行，返回删除总数。 */
  purge(now: Date, batchSize: number): Promise<number>;
  /** 只统计同一批「将被删除」的行数，不删除。 */
  count(now: Date): Promise<number>;
}

export function createExpiredPurgeTask(ops: ExpiredPurgeOps): RetentionTaskFn {
  return async ctx => {
    if (ctx.dryRun) return ops.count(ctx.now);
    if (ctx.shouldStop()) return 0;
    await ctx.heartbeat();
    return ops.purge(ctx.now, ctx.batchSize);
  };
}

export const REVOKED_TOKEN_TASK_NAME = 'revokedToken';
export const RATE_LIMIT_COUNTER_TASK_NAME = 'rateLimitCounter';

/** 注册两个任务（同名覆盖，重复调用安全）。Prisma 相关模块在任务执行时才加载。 */
export function registerAuthRetentionTasks(): void {
  registerRetentionTask(
    REVOKED_TOKEN_TASK_NAME,
    createExpiredPurgeTask({
      async purge(now, batchSize) {
        const { purgeExpiredRevokedTokens } = await import('./token-revocation');
        return purgeExpiredRevokedTokens(now, batchSize);
      },
      async count(now) {
        const { countExpiredRevokedTokens } = await import('./token-revocation');
        return countExpiredRevokedTokens(now);
      },
    }),
  );
  registerRetentionTask(
    RATE_LIMIT_COUNTER_TASK_NAME,
    createExpiredPurgeTask({
      async purge(now, batchSize) {
        const { purgeExpiredRateLimitCounters } = await import('./rate-limit-store');
        return purgeExpiredRateLimitCounters(now, batchSize);
      },
      async count(now) {
        const { countExpiredRateLimitCounters } = await import('./rate-limit-store');
        return countExpiredRateLimitCounters(now);
      },
    }),
  );
}
