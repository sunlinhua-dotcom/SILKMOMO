import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listStalePendingImages } from '@/lib/pending-image';
import prisma from '@/lib/prisma';

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { role: true },
  });
  if (user?.role !== 'admin') {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { records, hasMore } = await listStalePendingImages();

  // PendingImage 没有 User 关联，按 userId 批量查一次用户名并拼回（新增 user 字段，旧字段不变）
  const userIds = [...new Set(records.map(r => r.userId))];
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, name: true },
      })
    : [];
  const userMap = new Map(users.map(u => [u.id, { username: u.username, name: u.name }]));

  return NextResponse.json({
    records: records.map(r => ({ ...r, user: userMap.get(r.userId) ?? null })),
    count: records.length,
    hasMore,
    minimumAgeMinutes: 10,
  });
}
