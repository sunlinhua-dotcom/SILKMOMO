import type { ModelFaceBillingStatus, Prisma } from '@prisma/client';

export interface ModelFaceBillingTransactionResult {
  success: true;
  status: ModelFaceBillingStatus;
  balanceAfter: number;
}

type BillingTransactionClient = Pick<
  Prisma.TransactionClient,
  'modelFaceGenerationItem' | 'user' | 'transaction'
>;

export async function chargeModelFaceItemInTransaction(
  tx: BillingTransactionClient,
  itemId: string,
  description: string,
  apiModel: string,
): Promise<ModelFaceBillingTransactionResult> {
  const item = await tx.modelFaceGenerationItem.findUniqueOrThrow({
    where: { id: itemId },
    select: {
      billingKey: true,
      billingStatus: true,
      job: { select: { userId: true, costFen: true } },
    },
  });
  if (item.billingStatus === 'charged' || item.billingStatus === 'kept') {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: item.job.userId },
      select: { balanceFen: true },
    });
    return { success: true, status: item.billingStatus, balanceAfter: user.balanceFen };
  }
  if (item.billingStatus !== 'uncharged') throw new Error('该图片计费状态不可扣款');

  const claimed = await tx.modelFaceGenerationItem.updateMany({
    where: { id: itemId, billingStatus: 'uncharged' },
    data: { billingStatus: 'charged' },
  });
  if (claimed.count === 0) throw new Error('该图片已被其他 worker 处理');
  const debited = await tx.user.updateMany({
    where: { id: item.job.userId, balanceFen: { gte: item.job.costFen } },
    data: { balanceFen: { decrement: item.job.costFen } },
  });
  if (debited.count === 0) throw new Error('余额不足');
  const user = await tx.user.findUniqueOrThrow({
    where: { id: item.job.userId },
    select: { balanceFen: true },
  });
  await tx.transaction.create({
    data: {
      userId: item.job.userId,
      type: 'consume',
      amountFen: -item.job.costFen,
      balanceAfter: user.balanceFen,
      description,
      apiModel,
      idempotencyKey: `${item.billingKey}:charge`,
    },
  });
  return { success: true, status: 'charged', balanceAfter: user.balanceFen };
}

export async function refundModelFaceItemInTransaction(
  tx: BillingTransactionClient,
  itemId: string,
  description: string,
): Promise<ModelFaceBillingTransactionResult> {
  const item = await tx.modelFaceGenerationItem.findUniqueOrThrow({
    where: { id: itemId },
    select: {
      billingKey: true,
      billingStatus: true,
      job: { select: { userId: true, costFen: true } },
    },
  });
  if (item.billingStatus === 'refunded') {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: item.job.userId },
      select: { balanceFen: true },
    });
    return { success: true, status: 'refunded', balanceAfter: user.balanceFen };
  }
  if (item.billingStatus === 'uncharged') {
    await tx.modelFaceGenerationItem.update({
      where: { id: itemId },
      data: { billingStatus: 'refunded' },
    });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: item.job.userId },
      select: { balanceFen: true },
    });
    return { success: true, status: 'refunded', balanceAfter: user.balanceFen };
  }
  if (item.billingStatus === 'kept') throw new Error('已完成图片不可退款');

  const claimed = await tx.modelFaceGenerationItem.updateMany({
    where: { id: itemId, billingStatus: { in: ['charged', 'refund_pending'] } },
    data: { billingStatus: 'refunded' },
  });
  if (claimed.count === 0) throw new Error('退款状态已变化');
  const user = await tx.user.update({
    where: { id: item.job.userId },
    data: { balanceFen: { increment: item.job.costFen } },
    select: { balanceFen: true },
  });
  await tx.transaction.create({
    data: {
      userId: item.job.userId,
      type: 'refund',
      amountFen: item.job.costFen,
      balanceAfter: user.balanceFen,
      description,
      idempotencyKey: `${item.billingKey}:refund`,
    },
  });
  return { success: true, status: 'refunded', balanceAfter: user.balanceFen };
}
