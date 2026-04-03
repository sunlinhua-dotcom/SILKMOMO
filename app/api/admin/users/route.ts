/**
 * 管理后台 - 用户列表 + 充值
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rechargeBalance } from '@/lib/billing';
import prisma from '@/lib/prisma';

// GET: 用户列表
export async function GET(req: Request) {
  const auth = await getCurrentUser();
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const url = new URL(req.url);
  const search = url.searchParams.get('search') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 20;

  const where = search
    ? { OR: [
        { username: { contains: search } },
        { name: { contains: search } },
      ]}
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        balanceFen: true,
        createdAt: true,
        _count: { select: { transactions: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({ users, total, page, pageSize });
}

// POST: 给用户充值
export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const { userId, amountFen, description } = await req.json();

  if (!userId || !amountFen || amountFen < 15000 || amountFen % 7500 !== 0) {
    return NextResponse.json({ error: '最低充值 ¥150，且必须是 ¥75 的倍数' }, { status: 400 });
  }

  const result = await rechargeBalance(
    userId,
    amountFen,
    description || `管理员充值 ¥${(amountFen / 100).toFixed(2)}`
  );

  return NextResponse.json(result);
}
