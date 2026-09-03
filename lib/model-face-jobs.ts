import crypto from 'node:crypto';
import prisma from '@/lib/prisma';
import { checkBalance } from '@/lib/billing';
import { getGenerationCostFen } from '@/lib/billing-constants';
import { MODEL_FACE_SPECS, buildModelFacePortraitPrompt } from '@/lib/api';
import { generateImage, resolveApiModel } from '@/lib/image-backends';
import { storeModelFace } from '@/lib/model-face-library';
import { chargeModelFaceItem, refundModelFaceItem } from '@/lib/model-face-billing';
import {
  buildModelFaceJobError,
  createModelFaceLeaseHeartbeat,
  generateChargedModelFace,
  reconcileInterruptedModelFaceItem,
} from '@/lib/model-face-job-runner';
import {
  DAILY_MODEL_FACE_LIMIT,
  hasModelFaceAttemptCapacity,
  startOfShanghaiDay,
} from '@/lib/model-face-job-policy';

export { DAILY_MODEL_FACE_LIMIT, startOfShanghaiDay } from '@/lib/model-face-job-policy';

export const MODEL_FACE_BATCH_SIZE = 3;
export const MODEL_FACE_PRICE_FEN = getGenerationCostFen('openai', 'medium');
const MODEL_FACE_UPSTREAM_TIMEOUT_MS = 330_000;
const MODEL_FACE_LEASE_MS = 45_000;
const MODEL_FACE_HEARTBEAT_MS = 15_000;
const MODEL_FACE_SUPERVISOR_MS = 30_000;
const PROCESS_RUNNER_ID = crypto.randomUUID();

const RECIPE_LABELS = [
  '亚欧混血 · 圆脸',
  '亚欧混血 · 长椭圆脸',
  '亚欧混血 · 心形脸',
  '欧美 · 方脸',
  '欧美 · 长窄脸',
  '欧美 · 圆脸',
  '欧美 · 菱形脸',
  '欧美 · 心形脸',
  '欧美 · 椭圆脸',
  '欧美 · 短方脸',
] as const;

export class ModelFaceJobError extends Error {
  constructor(message: string, public statusCode: number, public jobId?: string) {
    super(message);
  }
}

class ModelFaceLeaseLostError extends Error {
  constructor() {
    super('模特脸任务租约已被其他 worker 接管');
  }
}

const jobInclude = {
  items: { orderBy: { position: 'asc' as const } },
} as const;

function leaseDeadline(now = new Date()) {
  return new Date(now.getTime() + MODEL_FACE_LEASE_MS);
}

async function attemptedToday(userId: string) {
  return prisma.modelFaceGenerationItem.count({
    where: { job: { userId }, attemptedAt: { gte: startOfShanghaiDay() } },
  });
}

async function assertDailyCapacity(userId: string, count: number) {
  if (!hasModelFaceAttemptCapacity(await attemptedToday(userId), count)) {
    throw new ModelFaceJobError(`今日最多生成 ${DAILY_MODEL_FACE_LIMIT} 张模特脸`, 429);
  }
}

async function markModelFaceAttempt(itemId: string, userId: string) {
  return prisma.$transaction(async tx => {
    const item = await tx.modelFaceGenerationItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { attemptedAt: true },
    });
    if (item.attemptedAt) return { success: false, error: '该图片已发起过上游生成' };
    const used = await tx.modelFaceGenerationItem.count({
      where: { job: { userId }, attemptedAt: { gte: startOfShanghaiDay() } },
    });
    if (!hasModelFaceAttemptCapacity(used, 1)) {
      return { success: false, error: `今日最多生成 ${DAILY_MODEL_FACE_LIMIT} 张模特脸` };
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

async function syncJobCounts(jobId: string) {
  const [completedCount, failedCount, pendingRefunds] = await Promise.all([
    prisma.modelFaceGenerationItem.count({ where: { jobId, status: 'succeeded' } }),
    prisma.modelFaceGenerationItem.count({ where: { jobId, status: 'failed' } }),
    prisma.modelFaceGenerationItem.count({ where: { jobId, billingStatus: 'refund_pending' } }),
  ]);
  const error = buildModelFaceJobError(failedCount, pendingRefunds);
  await prisma.modelFaceGenerationJob.updateMany({
    where: { id: jobId },
    data: { completedCount, failedCount, error },
  });
  return { completedCount, failedCount, pendingRefunds, error };
}

export async function retryPendingModelFaceRefunds(userId?: string): Promise<number> {
  const items = await prisma.modelFaceGenerationItem.findMany({
    where: {
      billingStatus: 'refund_pending',
      ...(userId ? { job: { userId } } : {}),
    },
    select: { id: true, jobId: true, error: true, specIndex: true },
  });
  const touchedJobs = new Set<string>();
  let refunded = 0;
  for (const item of items) {
    const reason = item.error || '模特脸生成失败';
    const result = await refundModelFaceItem(
      item.id,
      `御用 AI 模特脸失败退款 · ${RECIPE_LABELS[item.specIndex]} · ${reason}`,
    );
    await prisma.modelFaceGenerationItem.updateMany({
      where: { id: item.id, billingStatus: result.success ? 'refunded' : 'refund_pending' },
      data: { status: 'failed', error: refundMessage(reason, result.success) },
    });
    if (result.success) refunded += 1;
    touchedJobs.add(item.jobId);
  }
  for (const jobId of touchedJobs) await syncJobCounts(jobId);
  return refunded;
}

const localRunners = new Set<string>();

export function startModelFaceJobRunner(jobId: string): void {
  if (localRunners.has(jobId)) return;
  localRunners.add(jobId);
  setTimeout(() => {
    void runModelFaceJob(jobId).catch(error => {
      console.error('[model-face-job] runner failed:', error);
    }).finally(() => localRunners.delete(jobId));
  }, 0);
}

/** Start queued jobs and take over only running jobs whose lease has expired. */
export async function recoverInterruptedModelFaceJobs(userId?: string): Promise<number> {
  await retryPendingModelFaceRefunds(userId);
  const now = new Date();
  const jobs = await prisma.modelFaceGenerationJob.findMany({
    where: {
      ...(userId ? { userId } : {}),
      OR: [
        { status: 'queued' },
        { status: 'running', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      ],
    },
    select: { id: true },
  });
  for (const job of jobs) startModelFaceJobRunner(job.id);
  return jobs.length;
}

export function startModelFaceJobSupervisor(): void {
  const globalState = globalThis as typeof globalThis & { __modelFaceSupervisor?: ReturnType<typeof setInterval> };
  if (globalState.__modelFaceSupervisor) return;
  void recoverInterruptedModelFaceJobs().catch(error => {
    console.error('[model-face-job] startup recovery failed:', error);
  });
  const timer = setInterval(() => {
    void recoverInterruptedModelFaceJobs().catch(error => {
      console.error('[model-face-job] supervisor recovery failed:', error);
    });
  }, MODEL_FACE_SUPERVISOR_MS);
  timer.unref?.();
  globalState.__modelFaceSupervisor = timer;
}

export async function createModelFaceJob(userId: string, count: number) {
  await recoverInterruptedModelFaceJobs(userId);
  if (count !== MODEL_FACE_BATCH_SIZE) {
    throw new ModelFaceJobError(`每次只能生成 ${MODEL_FACE_BATCH_SIZE} 张`, 400);
  }

  const active = await prisma.modelFaceGenerationJob.findFirst({
    where: { userId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  });
  if (active) throw new ModelFaceJobError('已有模特脸任务正在进行', 409, active.id);
  await assertDailyCapacity(userId, count);

  const totalCostFen = MODEL_FACE_PRICE_FEN * count;
  const balance = await checkBalance(userId, totalCostFen);
  if (!balance.sufficient) {
    throw new ModelFaceJobError(
      `余额不足，需要 ¥${(totalCostFen / 100).toFixed(2)}，当前 ¥${(balance.balanceFen / 100).toFixed(2)}`,
      402,
    );
  }

  try {
    return await prisma.$transaction(async tx => {
      const usedToday = await tx.modelFaceGenerationItem.count({
        where: { job: { userId }, attemptedAt: { gte: startOfShanghaiDay() } },
      });
      if (!hasModelFaceAttemptCapacity(usedToday, count)) {
        throw new ModelFaceJobError(`今日最多生成 ${DAILY_MODEL_FACE_LIMIT} 张模特脸`, 429);
      }
      const requestedBefore = await tx.modelFaceGenerationItem.count({ where: { job: { userId } } });
      const startSpecIndex = requestedBefore % MODEL_FACE_SPECS.length;
      return tx.modelFaceGenerationJob.create({
        data: {
          userId,
          activeKey: userId,
          requestedCount: count,
          startSpecIndex,
          costFen: MODEL_FACE_PRICE_FEN,
          items: {
            create: Array.from({ length: count }, (_, position) => ({
              position,
              specIndex: (startSpecIndex + position) % MODEL_FACE_SPECS.length,
            })),
          },
        },
        include: jobInclude,
      });
    });
  } catch (error) {
    if (error instanceof ModelFaceJobError) throw error;
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      const existing = await prisma.modelFaceGenerationJob.findFirst({
        where: { userId, status: { in: ['queued', 'running'] } },
        select: { id: true },
      });
      throw new ModelFaceJobError('已有模特脸任务正在进行', 409, existing?.id);
    }
    throw error;
  }
}

export async function getModelFaceJob(userId: string, jobId: string) {
  await recoverInterruptedModelFaceJobs(userId);
  return prisma.modelFaceGenerationJob.findFirst({
    where: { id: jobId, userId },
    include: jobInclude,
  });
}

export async function getReconnectableModelFaceJob(userId: string) {
  await recoverInterruptedModelFaceJobs(userId);
  const active = await prisma.modelFaceGenerationJob.findFirst({
    where: { userId, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
    include: jobInclude,
  });
  if (active) return active;
  return prisma.modelFaceGenerationJob.findFirst({
    where: { userId, status: 'failed', items: { some: { status: { in: ['pending', 'running'] } } } },
    orderBy: { createdAt: 'desc' },
    include: jobInclude,
  });
}

export async function resumeModelFaceJob(userId: string, jobId: string) {
  await recoverInterruptedModelFaceJobs(userId);
  const job = await prisma.modelFaceGenerationJob.findFirst({
    where: { id: jobId, userId },
    include: jobInclude,
  });
  if (!job) throw new ModelFaceJobError('任务不存在', 404);
  if (job.status === 'queued' || job.status === 'running') return job;
  const remainingItems = job.items.filter(item => item.status === 'pending' || item.status === 'running');
  if (remainingItems.length === 0) throw new ModelFaceJobError('任务没有可继续的图片', 409);

  const newAttempts = remainingItems.filter(item => !item.attemptedAt).length;
  await assertDailyCapacity(userId, newAttempts);
  const uncharged = remainingItems.filter(item => item.billingStatus === 'uncharged').length;
  if (uncharged > 0) {
    const balance = await checkBalance(userId, uncharged * job.costFen);
    if (!balance.sufficient) throw new ModelFaceJobError('余额不足，无法继续生成', 402);
  }

  try {
    await prisma.modelFaceGenerationJob.update({
      where: { id: jobId },
      data: {
        status: 'queued',
        activeKey: userId,
        runnerId: null,
        leaseUntil: null,
        error: null,
        finishedAt: null,
      },
    });
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      throw new ModelFaceJobError('已有模特脸任务正在进行', 409);
    }
    throw error;
  }
  return prisma.modelFaceGenerationJob.findUnique({ where: { id: jobId }, include: jobInclude });
}

async function renewLease(jobId: string) {
  const result = await prisma.modelFaceGenerationJob.updateMany({
    where: { id: jobId, status: 'running', runnerId: PROCESS_RUNNER_ID },
    data: { leaseUntil: leaseDeadline() },
  });
  return result.count === 1;
}

async function reconcileClaimedJob(jobId: string) {
  const items = await prisma.modelFaceGenerationItem.findMany({
    where: { jobId, status: 'running' },
    orderBy: { position: 'asc' },
  });
  for (const item of items) {
    const result = await reconcileInterruptedModelFaceItem(item, {
      refund: () => refundModelFaceItem(
        item.id,
        `御用 AI 模特脸中断退款 · ${RECIPE_LABELS[item.specIndex]}`,
      ),
    });
    const pendingRefund = result.billingStatus === 'refund_pending';
    await prisma.modelFaceGenerationItem.updateMany({
      where: { id: item.id },
      data: {
        status: result.itemStatus,
        billingStatus: result.billingStatus,
        error: result.itemStatus === 'pending'
          ? '服务进程已恢复，继续生成且不会重复扣款'
          : refundMessage('服务进程在上游尝试后中断', !pendingRefund),
      },
    });
  }
  await syncJobCounts(jobId);
}

async function runModelFaceJob(jobId: string): Promise<void> {
  const now = new Date();
  const claim = await prisma.modelFaceGenerationJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: 'queued' },
        { status: 'running', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      ],
    },
    data: {
      status: 'running',
      runnerId: PROCESS_RUNNER_ID,
      leaseUntil: leaseDeadline(now),
      error: null,
      finishedAt: null,
    },
  });
  if (claim.count === 0) return;

  const heartbeat = createModelFaceLeaseHeartbeat({
    intervalMs: MODEL_FACE_HEARTBEAT_MS,
    renew: () => renewLease(jobId),
  });

  try {
    await retryPendingModelFaceRefunds();
    if (!await renewLease(jobId)) throw new ModelFaceLeaseLostError();
    await reconcileClaimedJob(jobId);
    const job = await prisma.modelFaceGenerationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: jobInclude,
    });
    const items = job.items.filter(item => item.status === 'pending');

    // Deliberately sequential: one awaited item at a time per account/job.
    for (const item of items) {
      if (heartbeat.leaseLost() || !await renewLease(jobId)) throw new ModelFaceLeaseLostError();
      const started = await prisma.modelFaceGenerationItem.updateMany({
        where: { id: item.id, status: 'pending' },
        data: { status: 'running', error: null },
      });
      if (started.count === 0) continue;

      const charged = await generateChargedModelFace({
        userId: job.userId,
        specIndex: item.specIndex,
        costFen: job.costFen,
        billingStatus: item.billingStatus,
      }, {
        deduct: () => chargeModelFaceItem(
          item.id,
          `御用 AI 模特脸 · ${RECIPE_LABELS[item.specIndex]}`,
          resolveApiModel('openai'),
        ),
        markAttempt: () => markModelFaceAttempt(item.id, job.userId),
        generate: async () => {
          const generated = await generateImage({
            prompt: buildModelFacePortraitPrompt(MODEL_FACE_SPECS[item.specIndex]),
            productImages: [],
            aspectRatio: '3:4',
            quality: 'medium',
            timeoutMs: MODEL_FACE_UPSTREAM_TIMEOUT_MS,
          }, 'openai');
          return { ...generated, mimeType: 'image/png' };
        },
        store: input => prisma.$transaction(async tx => {
          const owned = await tx.modelFaceGenerationJob.updateMany({
            where: { id: jobId, status: 'running', runnerId: PROCESS_RUNNER_ID },
            data: { leaseUntil: leaseDeadline() },
          });
          if (owned.count === 0) throw new ModelFaceLeaseLostError();
          const face = await storeModelFace({
            userId: input.userId,
            image: input.data,
            mimeType: input.mimeType,
            specIndex: input.specIndex,
            recipeLabel: RECIPE_LABELS[input.specIndex],
          }, tx);
          const stored = await tx.modelFaceGenerationItem.updateMany({
            where: { id: item.id, status: 'running', billingStatus: 'charged' },
            data: { status: 'succeeded', billingStatus: 'kept', faceId: face.id, error: null },
          });
          if (stored.count === 0) throw new ModelFaceLeaseLostError();
          return face;
        }),
        refund: input => refundModelFaceItem(
          item.id,
          `御用 AI 模特脸失败退款 · ${RECIPE_LABELS[item.specIndex]} · ${input.reason}`,
        ),
      });

      if (charged.status === 'blocked') {
        await prisma.modelFaceGenerationItem.updateMany({
          where: { id: item.id, status: 'running' },
          data: { status: 'pending', error: charged.error },
        });
        await prisma.modelFaceGenerationJob.updateMany({
          where: { id: jobId, runnerId: PROCESS_RUNNER_ID },
          data: {
            status: 'failed', activeKey: null, runnerId: null, leaseUntil: null,
            error: charged.error, finishedAt: new Date(),
          },
        });
        return;
      }

      if (charged.status === 'failed') {
        await prisma.modelFaceGenerationItem.updateMany({
          where: { id: item.id },
          data: {
            status: 'failed',
            error: refundMessage(charged.error, charged.refundStatus === 'refunded'),
          },
        });
      }
      await syncJobCounts(jobId);
    }

    await retryPendingModelFaceRefunds(job.userId);
    const summary = await syncJobCounts(jobId);
    await prisma.modelFaceGenerationJob.updateMany({
      where: { id: jobId, status: 'running', runnerId: PROCESS_RUNNER_ID },
      data: {
        status: 'completed',
        activeKey: null,
        runnerId: null,
        leaseUntil: null,
        error: summary.error,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    if (error instanceof ModelFaceLeaseLostError) return;
    const message = error instanceof Error ? error.message : '后台任务异常';
    await prisma.modelFaceGenerationJob.updateMany({
      where: { id: jobId, runnerId: PROCESS_RUNNER_ID },
      data: {
        status: 'failed', activeKey: null, runnerId: null, leaseUntil: null,
        error: `${message}，可继续生成`, finishedAt: new Date(),
      },
    });
  } finally {
    heartbeat.stop();
  }
}
