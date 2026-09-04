/**
 * SILXINE 计费系统（服务端）
 * Ledger 模式 + 原子操作扣费
 */
import prisma from './prisma';
import {
  deductGenerationBalanceInTransaction,
  refundGenerationBalanceInTransaction,
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
): Promise<{
  success: boolean;
  balanceAfter: number;
  idempotent?: boolean;
  consumeTransactionId?: string;
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
    }));

    return {
      success: true,
      balanceAfter: result.balanceAfter,
      idempotent: result.idempotent,
      consumeTransactionId: result.consumeTransactionId,
    };
  } catch (error) {
    // 两个并发请求都在事务内查不到键时，唯一索引决定胜者；败者事务整体回滚（含扣款），
    // 再读取胜者流水即可安全复用。
    if (idempotencyKey && typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const existing = await prisma.transaction.findUnique({
        where: { idempotencyKey },
        select: { id: true, userId: true, type: true, balanceAfter: true },
      });
      if (existing?.userId === userId && existing.type === 'consume') {
        return {
          success: true,
          balanceAfter: existing.balanceAfter,
          idempotent: true,
          consumeTransactionId: existing.id,
        };
      }
    }
    const msg = error instanceof Error ? error.message : '扣费失败';
    return { success: false, balanceAfter: 0, error: msg };
  }
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
        },
      });

      return { balanceAfter: after.balanceFen };
    });

    return { success: true, balanceAfter: result.balanceAfter };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '扣费失败';
    return { success: false, balanceAfter: 0, error: msg };
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

  try {
    const result = await prisma.$transaction(tx => refundGenerationBalanceInTransaction(tx, {
      userId,
      amountFen,
      description,
      projectId,
      idempotencyKey,
      consumeTransactionId,
    }));

    return { success: true, balanceAfter: result.balanceAfter };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '退款失败';
    // 退款失败意味着用户的钱静默蒸发，必须留下可对账的痕迹
    console.error('[billing] 退款失败（需人工对账）', {
      userId,
      amountFen,
      description,
      projectId,
      error: msg,
    });
    return { success: false, balanceAfter: 0, error: msg };
  }
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
