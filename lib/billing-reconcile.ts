/**
 * 出图计费孤儿清扫。
 *
 * 为什么存在：出图是「先扣费 → 再生成 → 成功交付/失败退款」。若进程在扣费之后被杀
 * （部署重启、OOM、容器迁移），既没有结果也没有退款，用户的钱就悬空了。
 * 出图 consume 的 `fulfilledAt`（结果已写入 pending / 已推给客户端时写入）为空且超过
 * GENERATION_ORPHAN_AGE_MS（20 分钟，大于路由最长存活 + 余量）就是孤儿，由这里走现有的
 * 幂等退款路径退掉。退款本身是幂等的（先认领消费流水再入账），多实例同时清扫也不会重复退。
 *
 * 只认出图幂等键（`userId:taskId:shotIndex:runId`）。脸库计费键（`<id>:charge`）、AI 助手
 * （无键）都不碰——它们不走 fulfilledAt 语义。
 *
 * 迁移前的历史 consume 由迁移 SQL 回填 fulfilledAt = createdAt，所以不会被当成孤儿。
 *
 * 本文件的纯逻辑（reconcileGenerationBilling）不 import 任何运行时依赖，方便 node:test 直接加载；
 * 真实的数据库依赖只在 createDefaultReconcileDeps 里按需动态加载。
 */
import {
  GENERATION_IN_FLIGHT_WINDOW_MS,
  GENERATION_ORPHAN_AGE_MS,
  isGenerationIdempotencyKey,
} from './generation-idempotency.ts';

export const BILLING_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
export const BILLING_RECONCILE_LIMIT = 50;

export interface ReconcileConsumeRow {
  id: string;
  userId: string;
  type: string;
  /** consume 流水里是负数（扣费）。 */
  amountFen: number;
  projectId: number | null;
  idempotencyKey: string | null;
  fulfilledAt: Date | null;
  createdAt: Date;
}

/** 是否属于「已扣费、未履约、超窗口」的出图孤儿。清扫前对每一行再校验一次（防御性）。 */
export function isOrphanConsume(
  row: ReconcileConsumeRow,
  nowMs: number,
  ageMs: number = GENERATION_ORPHAN_AGE_MS,
): boolean {
  return row.type === 'consume'
    && row.fulfilledAt == null
    && row.amountFen < 0
    && isGenerationIdempotencyKey(row.idempotencyKey)
    && row.createdAt.getTime() < nowMs - ageMs;
}

/** 从出图幂等键解析 taskId / shotIndex（键格式 `userId:taskId:shotIndex:runId`，userId 不含冒号）。 */
export function parseGenerationKey(key: string): { taskId: number; shotIndex: number } | null {
  if (!isGenerationIdempotencyKey(key)) return null;
  const parts = key.split(':');
  return { taskId: Number(parts[1]), shotIndex: Number(parts[2]) };
}

export interface ReconcileDeps {
  now(): number;
  /** 粗筛候选（可以多给，纯逻辑会再按 isOrphanConsume 过滤）。 */
  listCandidates(cutoff: Date, limit: number): Promise<ReconcileConsumeRow[]>;
  /** 该幂等键的结果是否还躺在 pending 里（有 = 其实已交付，只是履约标记没写成）。 */
  hasPending(userId: string, idempotencyKey: string): Promise<boolean>;
  /**
   * 第二道判定：是否已有「同 userId+taskId+shotIndex、success=true、createdAt 落在
   * [consume.createdAt, consume.createdAt + 在途窗口]」的 GenerationRecord。有＝图已成功交付
   * （pending 已被客户端取走删除，或旧容器 / 标记写失败没写 fulfilledAt），只补标记不退款。
   */
  hasSuccessRecord(row: ReconcileConsumeRow): Promise<boolean>;
  markFulfilled(consumeTransactionId: string): Promise<boolean>;
  /** 走幂等退款路径；返回 success。 */
  refund(row: ReconcileConsumeRow): Promise<{ success: boolean }>;
  /** 顺带清理过期 pending；失败不影响退款清扫。 */
  sweepExpiredPending?(): Promise<number>;
  log?(message: string, data?: Record<string, unknown>): void;
}

export interface ReconcileSummary {
  scanned: number;
  refunded: number;
  markedFulfilled: number;
  failed: number;
  expiredPending: number;
}

export async function reconcileGenerationBilling(
  deps: ReconcileDeps,
  options: { limit?: number; ageMs?: number } = {},
): Promise<ReconcileSummary> {
  const limit = options.limit ?? BILLING_RECONCILE_LIMIT;
  const ageMs = options.ageMs ?? GENERATION_ORPHAN_AGE_MS;
  const nowMs = deps.now();
  const cutoff = new Date(nowMs - ageMs);
  const summary: ReconcileSummary = { scanned: 0, refunded: 0, markedFulfilled: 0, failed: 0, expiredPending: 0 };

  const candidates = (await deps.listCandidates(cutoff, limit))
    .filter(row => isOrphanConsume(row, nowMs, ageMs))
    .slice(0, limit);
  summary.scanned = candidates.length;

  for (const row of candidates) {
    const key = row.idempotencyKey as string; // isOrphanConsume 已保证非空
    try {
      if (await deps.hasPending(row.userId, key) || await deps.hasSuccessRecord(row)) {
        if (await deps.markFulfilled(row.id)) summary.markedFulfilled++;
        else summary.failed++;
        continue;
      }
      const refund = await deps.refund(row);
      if (refund.success) summary.refunded++;
      else summary.failed++;
    } catch (error) {
      summary.failed++;
      deps.log?.('orphan_reconcile_item_failed', {
        idempotencyKey: key,
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  }

  if (deps.sweepExpiredPending) {
    try {
      summary.expiredPending = await deps.sweepExpiredPending();
    } catch (error) {
      deps.log?.('pending_sweep_failed', {
        error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  }

  if (summary.refunded > 0 || summary.markedFulfilled > 0 || summary.failed > 0) {
    deps.log?.('orphan_reconcile_done', { ...summary });
  }
  return summary;
}

/** 生产依赖：全部按需动态加载，避免纯逻辑被测试加载时拖进 Prisma。 */
export async function createDefaultReconcileDeps(): Promise<ReconcileDeps> {
  const [{ default: prisma }, billing, pending] = await Promise.all([
    import('./prisma'),
    import('./billing'),
    import('./pending-image'),
  ]);
  return {
    now: () => Date.now(),
    async listCandidates(cutoff, limit) {
      // 用 Prisma 原生过滤（时区安全）；排除脸库计费键（`<id>:charge`）。
      // 多取几倍，由 isOrphanConsume 的严格键格式再筛一遍。
      return prisma.transaction.findMany({
        where: {
          type: 'consume',
          fulfilledAt: null,
          createdAt: { lt: cutoff },
          AND: [
            { idempotencyKey: { not: null } },
            { NOT: { idempotencyKey: { endsWith: ':charge' } } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: limit * 4,
        select: {
          id: true,
          userId: true,
          type: true,
          amountFen: true,
          projectId: true,
          idempotencyKey: true,
          fulfilledAt: true,
          createdAt: true,
        },
      });
    },
    async hasPending(userId, idempotencyKey) {
      return !!(await pending.findPendingImageByIdempotencyKey(userId, idempotencyKey));
    },
    async hasSuccessRecord(row) {
      const parsed = parseGenerationKey(row.idempotencyKey as string);
      if (!parsed) return false;
      // 路由里三个分支 recordGeneration 的 shotIndex 与幂等键一致（产品图=镜次号，组图=参考图/产品组序号），
      // 唯独单张场景图的记录不带 shotIndex（落库为 null），而键里是 0；故 0 同时匹配 null。
      const shotFilter = parsed.shotIndex === 0
        ? { OR: [{ shotIndex: null }, { shotIndex: 0 }] }
        : { shotIndex: parsed.shotIndex };
      const hit = await prisma.generationRecord.findFirst({
        where: {
          userId: row.userId,
          taskId: parsed.taskId,
          success: true,
          createdAt: {
            gte: row.createdAt,
            lte: new Date(row.createdAt.getTime() + GENERATION_IN_FLIGHT_WINDOW_MS),
          },
          ...shotFilter,
        },
        select: { id: true },
      });
      return !!hit;
    },
    markFulfilled: id => billing.markGenerationFulfilled(id),
    async refund(row) {
      const result = await billing.refundBalance(
        row.userId,
        -row.amountFen,
        '出图未履约自动退款',
        row.projectId ?? undefined,
        row.idempotencyKey as string,
        row.id,
      );
      return { success: result.success };
    },
    sweepExpiredPending: () => pending.sweepExpiredPendingImages(),
    log: (message, data) => console.log(`[billing-reconcile] ${message}`, data ? JSON.stringify(data) : ''),
  };
}

/** instrumentation.ts 调用：每 5 分钟清扫一次；异常吞掉只记日志；进程内只起一个定时器。 */
export function startBillingReconciler(): void {
  const globalState = globalThis as typeof globalThis & { __billingReconciler?: ReturnType<typeof setInterval> };
  if (globalState.__billingReconciler) return;
  let running = false;
  const tick = async () => {
    if (running) return; // 上一轮还没跑完（库慢）就跳过，不叠加
    running = true;
    try {
      const deps = await createDefaultReconcileDeps();
      await reconcileGenerationBilling(deps);
    } catch (error) {
      console.error('[billing-reconcile] 清扫失败:', error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, BILLING_RECONCILE_INTERVAL_MS);
  timer.unref?.();
  globalState.__billingReconciler = timer;
  // 启动后 30s 先扫一遍：重启本身就是孤儿的主要来源
  const first = setTimeout(() => { void tick(); }, 30_000);
  first.unref?.();
}
