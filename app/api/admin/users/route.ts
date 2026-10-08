/**
 * 管理后台 - 用户列表 + 充值
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { rechargeBalance } from '@/lib/billing';
import { parseAdminRechargeBody } from '@/lib/admin-recharge-core';
import prisma, { isPostgres } from '@/lib/prisma';

// GET: 用户列表
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const url = new URL(req.url);
  const search = (url.searchParams.get('search') || '').trim();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  // pageSize 默认 20，上限 100，防止一次拖太多行
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize'))) || 20));

  // PG 的 contains 默认大小写敏感，会漏搜；SQLite 不支持 mode 参数
  const insensitive = isPostgres ? ({ mode: 'insensitive' } as const) : {};
  const where = search
    ? { OR: [
        { username: { contains: search, ...insensitive } },
        { name: { contains: search, ...insensitive } },
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
  const auth = await requireAdmin();
  if (!auth) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const parsed = parseAdminRechargeBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { userId, amountFen, description, requestId } = parsed.input;
  // 缺省 requestId = 老前端/老脚本：行为同旧版（不幂等），但留告警，方便发现还有谁没升级
  if (parsed.legacy) {
    console.warn('[admin-recharge] 请求未带 requestId，本次充值不具备幂等保护', { userId, amountFen });
  }

  const result = await rechargeBalance(userId, amountFen, description, requestId);

  if (result.conflict) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result);
}
