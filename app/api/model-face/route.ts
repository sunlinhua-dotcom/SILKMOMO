/**
 * 御用 AI 模特脸后台任务入口。
 * POST 只持久化任务并立即返回 jobId；实际生图由服务端逐张串行执行。
 * GET 用于刷新页面后找回活动任务，或找回因进程重启而可继续的任务。
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  DAILY_MODEL_FACE_LIMIT,
  MODEL_FACE_BATCH_SIZE,
  MODEL_FACE_PRICE_FEN,
  ModelFaceJobError,
  createModelFaceJob,
  getReconnectableModelFaceJob,
  resumeModelFaceJob,
  startModelFaceJobRunner,
} from '@/lib/model-face-jobs';

function jobErrorResponse(error: unknown) {
  if (error instanceof ModelFaceJobError) {
    return NextResponse.json(
      { error: error.message, jobId: error.jobId },
      { status: error.statusCode },
    );
  }
  console.error('[model-face] task API failed:', error);
  return NextResponse.json({ error: '模特脸任务创建失败' }, { status: 500 });
}

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const job = await getReconnectableModelFaceJob(auth.userId);
  if (job?.status === 'queued') startModelFaceJobRunner(job.id);
  return NextResponse.json({
    job,
    priceFen: MODEL_FACE_PRICE_FEN,
    batchSize: MODEL_FACE_BATCH_SIZE,
    dailyLimit: DAILY_MODEL_FACE_LIMIT,
  });
}

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { count?: unknown; resumeJobId?: unknown };

  try {
    const job = typeof body.resumeJobId === 'string'
      ? await resumeModelFaceJob(auth.userId, body.resumeJobId)
      : await createModelFaceJob(auth.userId, Number(body.count));
    if (!job) throw new ModelFaceJobError('任务不存在', 404);
    startModelFaceJobRunner(job.id);
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
