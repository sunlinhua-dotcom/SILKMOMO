/**
 * SILXINE 计费系统（服务端）
 * Ledger 模式 + 原子操作扣费
 */
import prisma from './prisma';
import {
  deductGenerationBalanceInTransaction,
  refundGenerationBalanceInTransaction,
  retryWithBackoff,
  toSafeBillingError,
} from './generation-billing-core';
export { PRICING, RECHARGE_PACKAGES } from './billing-constants'

function assertValidCostFen(costFen: number): number {
  if (!Number.isInteger(costFen) || costFen <= 0) {
    throw new Error('扣费金额非法');
  }
  return costFen;
}

// ═══ 检查余额 ═══
export async function checkBalance(userId: string, costFen: number): Promise<{ sufficient: boolean; balanceFen: number; requiredFen: number }> {
  const cost = assertValidCostFen(costFen);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { sufficient: false, balanceFen: 0, requiredFen: cost };
  return {
    sufficient: user.balanceFen >= cost,
    balanceFen: user.balanceFen,
    requiredFen: cost,
  };
}

// ═══ 扣费（原子操作，防止竞态条件）═══
export async function deductBalance(
  userId: string,
  costFen: number,
  description: string,
  projectId?: number,
  apiModel: string = 'gemini-3.1-flash-image-preview',
  idempotencyKey?: string,
  options: { awaitFulfillment?: boolean } = {},
): Promise<{
  success: boolean;
  balanceAfter: number;
  idempotent?: boolean;
  consumeTransactionId?: string;
  /** 仅幂等命中：既有 consume 的履约时间（空＝未履约）与创建时间。 */
  fulfilledAt?: Date | null;
  createdAt?: Date | null;
  error?: string;
}> {
  try {
    const cost = assertValidCostFen(costFen);
    const result = await prisma.$transaction(tx => deductGenerationBalanceInTransaction(tx, {
      userId,
      costFen: cost,
      description,
      projectId,
      apiModel,
      idempotencyKey,
      awaitFulfillment: options.awaitFulfillment,
    }));

    return {
      success: true,
      balanceAfter: result.balanceAfter,
      idempotent: result.idempotent,
      consumeTransactionId: result.consumeTransactionId,
      fulfilledAt: result.fulfilledAt,
      createdAt: result.createdAt,
    };
  } catch (error) {
    // 两个并发请求都在事务内查不到键时，唯一索引决定胜者；败者事务整体回滚（含扣款），
    // 再读取胜者流水即可安全复用。
    if (idempotencyKey && typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const existing = await prisma.transaction.findUnique({
        where: { idempotencyKey },
        select: { id: true, userId: true, type: true, balanceAfter: true, fulfilledAt: true, createdAt: true },
      });
      if (existing?.userId === userId && existing.type === 'consume') {
        return {
          success: true,
          balanceAfter: existing.balanceAfter,
          idempotent: true,
          consumeTransactionId: existing.id,
          fulfilledAt: existing.fulfilledAt,
          createdAt: existing.createdAt,
        };
      }
    }
    // Prisma / 连接错误原文只进日志，不透传给客户端
    logUnexpectedBillingError('deduct', error, idempotencyKey);
    return { success: false, balanceAfter: 0, error: toSafeBillingError(error) };
  }
}

/** 把非预期的扣费错误（可能含 Prisma 原文、SQL、连接串片段）只写服务端日志。 */
function logUnexpectedBillingError(op: string, error: unknown, idempotencyKey?: string) {
  if (toSafeBillingError(error, '') !== '') return; // 业务内的已知错误（余额不足等）无需告警
  console.error('[billing] 非预期的扣费错误', {
    op,
    idempotencyKey,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** 该出图幂等键是否已有本人的 consume（用于带 runId 的余额预检豁免：重试同一次生成不需要余额）。 */
export async function hasGenerationConsume(userId: string, idempotencyKey: string): Promise<boolean> {
  const row = await prisma.transaction.findUnique({
    where: { idempotencyKey },
    select: { userId: true, type: true },
  });
  return row?.userId === userId && row.type === 'consume';
}

/**
 * 出图结果已「写入 pending」或「已成功推给客户端」后调用：写入 fulfilledAt。
 * 只改仍为空的 consume（updateMany 条件含 fulfilledAt: null），所以重复调用无副作用。
 * 失败只打日志并返回 false——此时孤儿清扫会先查 pending，查到就补标记而不是退款。
 */
export async function markGenerationFulfilled(consumeTransactionId: string | undefined): Promise<boolean> {
  if (!consumeTransactionId) return false;
  const result = await retryWithBackoff(
    () => prisma.transaction.updateMany({
      where: { id: consumeTransactionId, type: 'consume', fulfilledAt: null },
      data: { fulfilledAt: new Date() },
    }),
    { retries: 2, baseDelayMs: 150 },
  );
  if (!result.ok) {
    console.error('[billing] fulfilled_mark_failed', JSON.stringify({
      event: 'fulfilled_mark_failed',
      consumeTransactionId,
      attempts: result.attempts,
      error: result.error instanceof Error ? result.error.message.slice(0, 200) : 'unknown',
    }));
    return false;
  }
  return true;
}

// ═══ 自定义金额扣费（AI 分析等非生图场景）═══
export async function deductCustom(
  userId: string,
  amountFen: number,
  description: string,
  apiModel: string,
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  if (amountFen <= 0) return { success: true, balanceAfter: 0 };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子条件扣费，理由同 deductBalance
      const updated = await tx.user.updateMany({
        where: { id: userId, balanceFen: { gte: amountFen } },
        data: { balanceFen: { decrement: amountFen } },
      });
      if (updated.count === 0) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) throw new Error('用户不存在');
        throw new Error('余额不足');
      }
      const after = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balanceFen: true },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: 'consume',
          amountFen: -amountFen,
          balanceAfter: after.balanceFen,
          description,
          apiModel,
          fulfilledAt: new Date(), // 非出图类消费创建即履约，不进孤儿清扫
        },
      });

      return { balanceAfter: after.balanceFen };
    });

    return { success: true, balanceAfter: result.balanceAfter };
  } catch (error) {
    logUnexpectedBillingError('deductCustom', error);
    return { success: false, balanceAfter: 0, error: toSafeBillingError(error) };
  }
}

// ═══ 退款（生图失败时使用）═══
export async function refundBalance(
  userId: string,
  amountFen: number,
  description: string,
  projectId?: number,
  idempotencyKey?: string,
  consumeTransactionId?: string,
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  if (amountFen <= 0) return { success: true, balanceAfter: 0 };

  // 进程内指数退避重试 3 次（300 / 600 / 1200ms）。退款失败＝用户的钱静默蒸发，
  // 重试后仍失败才放弃；放弃时有幂等键的由孤儿清扫（lib/billing-reconcile.ts）兜底。
  const outcome = await retryWithBackoff(() => prisma.$transaction(tx => refundGenerationBalanceInTransaction(tx, {
    userId,
    amountFen,
    description,
    projectId,
    idempotencyKey,
    consumeTransactionId,
  })));

  if (outcome.ok) return { success: true, balanceAfter: outcome.value.balanceAfter };

  const msg = outcome.error instanceof Error ? outcome.error.message : '退款失败';
  // 一行结构化日志，供人工对账：含幂等键（出图键已内含 userId）与金额，不含描述等其余信息。
  console.error('[billing] refund_failed', JSON.stringify({
    event: 'refund_failed',
    idempotencyKey: idempotencyKey ?? null,
    consumeTransactionId: consumeTransactionId ?? null,
    amountFen,
    projectId: projectId ?? null,
    userId: idempotencyKey ? undefined : userId,
    attempts: outcome.attempts,
    error: msg.slice(0, 200),
  }));
  return { success: false, balanceAfter: 0, error: '退款失败' };
}

// ═══ 充值（管理员操作）═══
export async function rechargeBalance(
  userId: string,
  amountFen: number,
  description: string = '管理员充值'
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { balanceFen: { increment: amountFen } },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: 'recharge',
          amountFen: amountFen,
          balanceAfter: updated.balanceFen,
          description,
        },
      });

      return { balanceAfter: updated.balanceFen };
    });

    return { success: true, balanceAfter: result.balanceAfter };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '充值失败';
    return { success: false, balanceAfter: 0, error: msg };
  }
}

// ═══ 查询消费记录 ═══
export async function getTransactions(
  userId: string,
  page: number = 1,
  pageSize: number = 20
) {
  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.transaction.count({ where: { userId } }),
  ]);

  return {
    transactions,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ═══ 统计（管理后台用）═══
export async function getAdminStats() {
  // "今日"按中国时区（UTC+8）切，避免容器默认 UTC 导致日期偏移 8 小时
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayStart = new Date(
    Math.floor((Date.now() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS
  );

  const [totalUsers, totalRecharge, totalConsume, totalRefund, todayConsume, todayRefund] =
    await Promise.all([
      prisma.user.count(),
      prisma.transaction.aggregate({
        where: { type: 'recharge' },
        _sum: { amountFen: true },
      }),
      prisma.transaction.aggregate({
        where: { type: 'consume' },
        _sum: { amountFen: true },
      }),
      prisma.transaction.aggregate({
        where: { type: 'refund' },
        _sum: { amountFen: true },
      }),
      prisma.transaction.aggregate({
        where: {
          type: 'consume',
          createdAt: { gte: todayStart },
        },
        _sum: { amountFen: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: {
          type: 'refund',
          createdAt: { gte: todayStart },
        },
        _sum: { amountFen: true },
        _count: true,
      }),
    ]);

  // 消费需扣除退款，否则失败生成（扣费+退款两条流水）会让营收虚高
  const totalConsumeFen = Math.max(
    0,
    Math.abs(totalConsume._sum.amountFen || 0) - (totalRefund._sum.amountFen || 0)
  );
  const todayConsumeFen = Math.max(
    0,
    Math.abs(todayConsume._sum.amountFen || 0) - (todayRefund._sum.amountFen || 0)
  );

  return {
    totalUsers,
    totalRechargeFen: totalRecharge._sum.amountFen || 0,
    totalConsumeFen,
    todayConsumeFen,
    todayConsumeCount: Math.max(0, (todayConsume._count || 0) - (todayRefund._count || 0)),
  };
}
