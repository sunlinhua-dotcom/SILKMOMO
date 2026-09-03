import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getModelFaceJob, startModelFaceJobRunner } from '@/lib/model-face-jobs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const job = await getModelFaceJob(auth.userId, id);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (job.status === 'queued') startModelFaceJobRunner(job.id);
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { balanceFen: true } });
  return NextResponse.json({ job, balanceFen: user?.balanceFen ?? 0 });
}
