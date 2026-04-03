/**
 * AI 质量分析 API（管理员专用）
 * GET: 获取生成质量统计数据
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getQualityAnalytics } from '@/lib/generation-record';
import prisma from '@/lib/prisma';

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 验证管理员权限
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { role: true },
  });

  if (user?.role !== 'admin') {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const analytics = await getQualityAnalytics();
  return NextResponse.json({ analytics });
}
