/**
 * 任务生成记录查询 API
 * GET /api/generation/by-task/[taskId]
 *
 * 返回当前登录用户在该任务下的所有生成尝试，按时间倒序。
 * 仅返回自己的记录（按 userId scope）。
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(
  _req: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { taskId: taskIdStr } = await context.params;
  const taskId = Number(taskIdStr);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: 'taskId 非法' }, { status: 400 });
  }

  const records = await prisma.generationRecord.findMany({
    where: { userId: auth.userId, taskId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      module: true,
      shotIndex: true,
      apiModel: true,
      success: true,
      apiLatencyMs: true,
      errorMessage: true,
      createdAt: true,
    },
    take: 50,
  });

  return NextResponse.json({ records });
}
