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

  const records = await listStalePendingImages();
  return NextResponse.json({ records, count: records.length, minimumAgeMinutes: 10 });
}
