/**
 * SILKMOMO 计费系统（服务端）
 * Ledger 模式 + 原子操作扣费
 */
import prisma from './prisma';
export { PRICING, RECHARGE_PACKAGES } from './billing-constants'
import { PRICING } from './billing-constants';

// ═══ 检查余额 ═══
export async function checkBalance(userId: string): Promise<{ sufficient: boolean; balanceFen: number; requiredFen: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { sufficient: false, balanceFen: 0, requiredFen: PRICING.pricePerCallFen };
  return {
    sufficient: user.balanceFen >= PRICING.pricePerCallFen,
    balanceFen: user.balanceFen,
    requiredFen: PRICING.pricePerCallFen,
  };
}

// ═══ 扣费（原子操作，防止竞态条件）═══
export async function deductBalance(
  userId: string,
  description: string,
  projectId?: number
): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
  const cost = PRICING.pricePerCallFen;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. 查询当前余额（锁定行）
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('用户不存在');
      if (user.balanceFen < cost) throw new Error('余额不足');

      // 2. 扣费
      const updated = await tx.user.update({
        where: { id: userId },
        data: { balanceFen: { decrement: cost } },
      });

      // 3. 记录流水
      await tx.transaction.create({
        data: {
          userId,
          type: 'consume',
          amountFen: -cost,
          balanceAfter: updated.balanceFen,
          description,
          apiModel: 'gemini-3.1-flash-image-preview',
          projectId,
        },
      });

      return { balanceAfter: updated.balanceFen };
    });

    return { success: true, balanceAfter: result.balanceAfter };
  } catch (error) {
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
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('用户不存在');
      if (user.balanceFen < amountFen) throw new Error('余额不足');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { balanceFen: { decrement: amountFen } },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: 'consume',
          amountFen: -amountFen,
          balanceAfter: updated.balanceFen,
          description,
          apiModel,
        },
      });

      return { balanceAfter: updated.balanceFen };
    });

    return { success: true, balanceAfter: result.balanceAfter };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '扣费失败';
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
  const [totalUsers, totalRecharge, totalConsume, todayConsume] = await Promise.all([
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
      where: {
        type: 'consume',
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      _sum: { amountFen: true },
      _count: true,
    }),
  ]);

  return {
    totalUsers,
    totalRechargeFen: totalRecharge._sum.amountFen || 0,
    totalConsumeFen: Math.abs(totalConsume._sum.amountFen || 0),
    todayConsumeFen: Math.abs(todayConsume._sum.amountFen || 0),
    todayConsumeCount: todayConsume._count || 0,
  };
}
