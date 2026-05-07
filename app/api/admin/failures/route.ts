/**
 * 失败任务监控 API（管理员专用）
 * GET /api/admin/failures
 *
 * 查询参数:
 *   - days: 最近 N 天（默认 7）
 *   - limit: 单页条数（默认 100，最大 500）
 *   - apiModel: 过滤 backend，如 "gemini-3.1-flash-image-preview" / "gpt-image-2-all"
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { role: true },
  });
  if (user?.role !== 'admin') {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 7)));
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const apiModel = url.searchParams.get('apiModel') || undefined;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [records, totalFailures, totalSuccesses, byErrorPattern] = await Promise.all([
    prisma.generationRecord.findMany({
      where: {
        success: false,
        createdAt: { gte: since },
        ...(apiModel ? { apiModel } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        taskId: true,
        module: true,
        shotIndex: true,
        modelId: true,
        bodyType: true,
        skinTone: true,
        apiModel: true,
        apiLatencyMs: true,
        errorMessage: true,
        createdAt: true,
        user: { select: { username: true, name: true } },
      },
    }),
    prisma.generationRecord.count({
      where: { success: false, createdAt: { gte: since } },
    }),
    prisma.generationRecord.count({
      where: { success: true, createdAt: { gte: since } },
    }),
    prisma.generationRecord.groupBy({
      by: ['errorMessage'],
      where: { success: false, createdAt: { gte: since } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    }),
  ]);

  const totalAttempts = totalFailures + totalSuccesses;
  const failureRate = totalAttempts > 0 ? Math.round((totalFailures / totalAttempts) * 100) : 0;

  return NextResponse.json({
    summary: {
      days,
      totalAttempts,
      totalFailures,
      totalSuccesses,
      failureRate,
    },
    topErrors: byErrorPattern.map((p: { errorMessage: string | null; _count: { id: number } }) => ({
      message: p.errorMessage ?? '(无错误信息)',
      count: p._count.id,
    })),
    records,
  });
}
