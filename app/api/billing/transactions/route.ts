/**
 * 用户消费记录 API
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getTransactions } from '@/lib/billing';

export async function GET(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const url = new URL(req.url);
  // clamp：NaN / 0 / 负数会让 Prisma 抛 500，超大 pageSize 可拉全表
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));

  const data = await getTransactions(auth.userId, page, pageSize);
  return NextResponse.json(data);
}
