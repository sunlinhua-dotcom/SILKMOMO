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
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('pageSize') || '20');

  const data = await getTransactions(auth.userId, page, pageSize);
  return NextResponse.json(data);
}
