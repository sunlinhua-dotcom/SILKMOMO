import type { PrismaClient } from '@prisma/client';

type AttemptPrisma = Pick<PrismaClient, '$transaction'>;
type RefundPrisma = Pick<PrismaClient, 'modelFaceGenerationItem'>;

interface AttemptDependencies {
  prisma: AttemptPrisma;
  startOfDay(): Date;
  hasCapacity(used: number, requested: number): boolean;
  limit: number;
}

interface RefundCandidate {
  id: string;
  jobId: string;
  error: string | null;
  specIndex: number;
}

interface RefundResult {
  success: boolean;
  status: string;
}

interface RefundSweepDependencies {
  prisma: RefundPrisma;
  refund(item: RefundCandidate, reason: string): Promise<RefundResult>;
  syncJobCounts(jobId: string): Promise<unknown>;
}

export function isPrismaUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}

export async function markModelFaceAttemptWithDeps(
  itemId: string,
  userId: string,
  deps: AttemptDependencies,
) {
  return deps.prisma.$transaction(async tx => {
    const item = await tx.modelFaceGenerationItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { attemptedAt: true },
    });
    if (item.attemptedAt) return { success: false, error: '该图片已发起过上游生成' };

    const used = await tx.modelFaceGenerationItem.count({
      where: { job: { userId }, attemptedAt: { gte: deps.startOfDay() } },
    });
    if (!deps.hasCapacity(used, 1)) {
      return { success: false, error: `今日最多生成 ${deps.limit} 张模特脸` };
    }

    const marked = await tx.modelFaceGenerationItem.updateMany({
      where: { id: itemId, status: 'running', attemptedAt: null },
      data: { attemptedAt: new Date() },
    });
    return marked.count === 1
      ? { success: true }
      : { success: false, error: '该图片已被其他 worker 接管' };
  });
}

function refundMessage(reason: string, refunded: boolean) {
  return refunded ? `${reason}（已退款）` : `${reason}（退款处理中，将自动重试）`;
}

/**
 * Sweep explicit pending refunds plus charged items stranded behind a terminal job.
 * The latter covers a database outage where both the refund transaction and the
 * best-effort charged -> refund_pending write failed.
 */
export async function retryPendingModelFaceRefundsWithDeps(
  userId: string | undefined,
  deps: RefundSweepDependencies,
): Promise<number> {
  const items = await deps.prisma.modelFaceGenerationItem.findMany({
    where: {
      OR: [
        { billingStatus: 'refund_pending' },
        { billingStatus: 'charged', job: { status: { in: ['failed', 'completed'] } } },
      ],
      ...(userId ? { job: { userId } } : {}),
    },
    select: { id: true, jobId: true, error: true, specIndex: true },
  });
  const touchedJobs = new Set<string>();
  let refunded = 0;

  for (const item of items) {
    const reason = item.error || '模特脸生成失败';
    const result = await deps.refund(item, reason);
    const didRefund = result.success && result.status === 'refunded';
    await deps.prisma.modelFaceGenerationItem.updateMany({
      where: {
        id: item.id,
        billingStatus: didRefund ? 'refunded' : { in: ['charged', 'refund_pending'] },
      },
      data: {
        status: 'failed',
        billingStatus: didRefund ? 'refunded' : 'refund_pending',
        error: refundMessage(reason, didRefund),
      },
    });
    if (didRefund) refunded += 1;
    touchedJobs.add(item.jobId);
  }

  for (const jobId of touchedJobs) await deps.syncJobCounts(jobId);
  return refunded;
}

export function resetBlockedModelFaceItem(
  prisma: RefundPrisma,
  itemId: string,
  runnerId: string,
  error: string,
) {
  return prisma.modelFaceGenerationItem.updateMany({
    where: { id: itemId, status: 'running', job: { runnerId } },
    data: { status: 'pending', error },
  });
}
