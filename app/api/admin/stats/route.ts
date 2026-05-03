/**
 * 管理后台 - 概览数据
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAdminStats } from '@/lib/billing';
import prisma from '@/lib/prisma';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const stats = await getAdminStats();

  // 最近 10 笔交易
  const recentTransactions = await prisma.transaction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { user: { select: { username: true, name: true } } },
  });

  return NextResponse.json({ stats, recentTransactions });
}
