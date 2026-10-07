/**
 * 失败任务监控 API（管理员专用）
 * GET /api/admin/failures
 *
 * 查询参数:
 *   - days: 最近 N 天（默认 7）
 *   - limit: 单页条数（默认 100，最大 500）
 *   - apiModel: 过滤 backend，如 "gemini-3.1-flash-image-preview" / "gpt-image-2"
 *
 * 返回: summary / topErrors / records（最多 limit 条）；
 *   另有 total（当前筛选下的真实失败总数，records 可能被 limit 截断）与
 *   apiModels（该时间窗内出现过的 apiModel 列表，供前端筛选下拉）。
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

  const [records, totalFailures, totalSuccesses, byErrorPattern, filteredTotal, modelGroups] = await Promise.all([
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
    // 当前筛选下的真实失败总数（records 受 limit 截断，不能用 records.length）
    apiModel
      ? prisma.generationRecord.count({ where: { success: false, createdAt: { gte: since }, apiModel } })
      : Promise.resolve(null),
    // 时间窗内出现过的引擎（成功 + 失败都算），供筛选下拉
    prisma.generationRecord.groupBy({
      by: ['apiModel'],
      where: { createdAt: { gte: since } },
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
    total: filteredTotal ?? totalFailures,
    apiModels: modelGroups
      .map((g: { apiModel: string }) => g.apiModel)
      .filter(Boolean)
      .sort(),
  });
}
