import crypto from 'node:crypto';
import prisma from '@/lib/prisma';
import { checkBalance, deductBalance, refundBalance } from '@/lib/billing';
import { getGenerationCostFen } from '@/lib/billing-constants';
import { MODEL_FACE_SPECS, buildModelFacePortraitPrompt } from '@/lib/api';
import { generateImage, resolveApiModel } from '@/lib/image-backends';
import { storeModelFace } from '@/lib/model-face-library';
import { generateChargedModelFace } from '@/lib/model-face-job-runner';

export const MODEL_FACE_BATCH_SIZE = 3;
export const DAILY_MODEL_FACE_LIMIT = 200;
export const MODEL_FACE_PRICE_FEN = getGenerationCostFen('openai', 'medium');
const MODEL_FACE_UPSTREAM_TIMEOUT_MS = 330_000;
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

export function startOfShanghaiDay(now = new Date()): Date {
  const offsetMs = 8 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  return new Date(Math.floor((now.getTime() + offsetMs) / dayMs) * dayMs - offsetMs);
}

let recoveryPromise: Promise<number> | null = null;

/** 当前进程首次接管时，把上个进程遗留的 running 任务改为可继续的失败态。 */
export function recoverInterruptedModelFaceJobs(): Promise<number> {
  if (!recoveryPromise) {
    recoveryPromise = prisma.$transaction(async (tx) => {
      const interrupted = await tx.modelFaceGenerationJob.findMany({
        where: { status: 'running', runnerId: { not: PROCESS_RUNNER_ID } },
        select: { id: true },
      });
      if (interrupted.length === 0) return 0;
      const ids = interrupted.map(job => job.id);
      await tx.modelFaceGenerationItem.updateMany({
        where: { jobId: { in: ids }, status: 'running' },
        data: { status: 'pending', error: '服务进程已重启，可继续生成' },
      });
      await tx.modelFaceGenerationJob.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'failed',
          activeKey: null,
          runnerId: null,
          error: '服务进程已重启，可继续生成',
          finishedAt: new Date(),
        },
      });
      return ids.length;
    });
  }
  return recoveryPromise;
}

const jobInclude = {
  items: { orderBy: { position: 'asc' as const } },
} as const;

export async function createModelFaceJob(userId: string, count: number) {
  await recoverInterruptedModelFaceJobs();
  if (count !== MODEL_FACE_BATCH_SIZE) {
    throw new ModelFaceJobError(`每次只能生成 ${MODEL_FACE_BATCH_SIZE} 张`, 400);
  }

  const active = await prisma.modelFaceGenerationJob.findFirst({
    where: { userId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  });
  if (active) throw new ModelFaceJobError('已有模特脸任务正在进行', 409, active.id);

  const totalCostFen = MODEL_FACE_PRICE_FEN * count;
  const balance = await checkBalance(userId, totalCostFen);
  if (!balance.sufficient) {
    throw new ModelFaceJobError(
      `余额不足，需要 ¥${(totalCostFen / 100).toFixed(2)}，当前 ¥${(balance.balanceFen / 100).toFixed(2)}`,
      402,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const usedToday = await tx.modelFaceGenerationItem.count({
        where: { job: { userId }, createdAt: { gte: startOfShanghaiDay() } },
      });
      if (usedToday + count > DAILY_MODEL_FACE_LIMIT) {
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
  return prisma.modelFaceGenerationJob.findFirst({
    where: { id: jobId, userId },
    include: jobInclude,
  });
}

export async function getReconnectableModelFaceJob(userId: string) {
  await recoverInterruptedModelFaceJobs();
  const active = await prisma.modelFaceGenerationJob.findFirst({
    where: { userId, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
    include: jobInclude,
  });
  if (active) return active;
  return prisma.modelFaceGenerationJob.findFirst({
    where: { userId, status: 'failed', items: { some: { status: 'pending' } } },
    orderBy: { createdAt: 'desc' },
    include: jobInclude,
  });
}

export async function resumeModelFaceJob(userId: string, jobId: string) {
  await recoverInterruptedModelFaceJobs();
  const job = await getModelFaceJob(userId, jobId);
  if (!job) throw new ModelFaceJobError('任务不存在', 404);
  if (job.status === 'queued' || job.status === 'running') return job;
  const remaining = job.items.filter(item => item.status === 'pending' || item.status === 'running').length;
  if (remaining === 0) throw new ModelFaceJobError('任务没有可继续的图片', 409);

  const balance = await checkBalance(userId, remaining * job.costFen);
  if (!balance.sufficient) throw new ModelFaceJobError('余额不足，无法继续生成', 402);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.modelFaceGenerationItem.updateMany({
        where: { jobId, status: 'running' },
        data: { status: 'pending' },
      });
      await tx.modelFaceGenerationJob.update({
        where: { id: jobId },
        data: {
          status: 'queued',
          activeKey: userId,
          runnerId: null,
          error: null,
          finishedAt: null,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      throw new ModelFaceJobError('已有模特脸任务正在进行', 409);
    }
    throw error;
  }
  return getModelFaceJob(userId, jobId);
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

async function runModelFaceJob(jobId: string): Promise<void> {
  const claim = await prisma.modelFaceGenerationJob.updateMany({
    where: { id: jobId, status: 'queued' },
    data: { status: 'running', runnerId: PROCESS_RUNNER_ID, error: null },
  });
  if (claim.count === 0) return;

  try {
    const job = await prisma.modelFaceGenerationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: jobInclude,
    });
    const items = job.items.filter(item => item.status === 'pending');

    // Deliberately sequential: one awaited item at a time per account/job.
    for (const item of items) {
      await prisma.modelFaceGenerationItem.update({
        where: { id: item.id },
        data: { status: 'running', error: null },
      });

      const charged = await generateChargedModelFace({
        userId: job.userId,
        specIndex: item.specIndex,
        costFen: job.costFen,
      }, {
        deduct: async input => deductBalance(
          input.userId,
          input.costFen,
          `御用 AI 模特脸 · ${RECIPE_LABELS[input.specIndex]}`,
          undefined,
          resolveApiModel('openai'),
        ),
        generate: async input => {
          const generated = await generateImage({
            prompt: buildModelFacePortraitPrompt(MODEL_FACE_SPECS[input.specIndex]),
            productImages: [],
            aspectRatio: '3:4',
            quality: 'medium',
            timeoutMs: MODEL_FACE_UPSTREAM_TIMEOUT_MS,
          }, 'openai');
          return { ...generated, mimeType: 'image/png' };
        },
        store: input => prisma.$transaction(async tx => {
          const face = await storeModelFace({
            userId: input.userId,
            image: input.data,
            mimeType: input.mimeType,
            specIndex: input.specIndex,
            recipeLabel: RECIPE_LABELS[input.specIndex],
          }, tx);
          await tx.modelFaceGenerationItem.update({
            where: { id: item.id },
            data: { status: 'succeeded', faceId: face.id, error: null },
          });
          await tx.modelFaceGenerationJob.update({
            where: { id: jobId },
            data: { completedCount: { increment: 1 } },
          });
          return face;
        }),
        refund: input => refundBalance(
          input.userId,
          input.costFen,
          `御用 AI 模特脸失败退款 · ${RECIPE_LABELS[input.specIndex]} · ${input.reason}`,
        ),
      });

      if (charged.status === 'blocked') {
        await prisma.$transaction([
          prisma.modelFaceGenerationItem.update({
            where: { id: item.id },
            data: { status: 'pending', error: charged.error },
          }),
          prisma.modelFaceGenerationJob.update({
            where: { id: jobId },
            data: {
              status: 'failed', activeKey: null, runnerId: null,
              error: charged.error, finishedAt: new Date(),
            },
          }),
        ]);
        return;
      }

      if (charged.status === 'succeeded') {
        // 图片、item 成功态和 completedCount 已在 store 依赖里同事务提交。
      } else {
        const error = charged.refunded ? charged.error : `${charged.error}（退款失败，需人工对账）`;
        await prisma.$transaction([
          prisma.modelFaceGenerationItem.update({
            where: { id: item.id },
            data: { status: 'failed', error },
          }),
          prisma.modelFaceGenerationJob.update({
            where: { id: jobId },
            data: { failedCount: { increment: 1 }, error },
          }),
        ]);
      }
    }

    const finished = await prisma.modelFaceGenerationJob.findUniqueOrThrow({ where: { id: jobId } });
    await prisma.modelFaceGenerationJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        activeKey: null,
        runnerId: null,
        error: finished.failedCount > 0 ? `${finished.failedCount} 张失败，均已自动退款` : null,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '后台任务异常';
    await prisma.$transaction([
      prisma.modelFaceGenerationItem.updateMany({
        where: { jobId, status: 'running' },
        data: { status: 'pending', error: message },
      }),
      prisma.modelFaceGenerationJob.update({
        where: { id: jobId },
        data: {
          status: 'failed', activeKey: null, runnerId: null,
          error: `${message}，可继续生成`, finishedAt: new Date(),
        },
      }),
    ]);
  }
}
