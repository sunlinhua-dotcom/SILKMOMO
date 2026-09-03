import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { MODEL_FACE_PUBLIC_SELECT } from '@/lib/model-face-library';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { favorite?: boolean; name?: string } = {};

  if (typeof body.favorite === 'boolean') data.favorite = body.favorite;
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 40);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const result = await prisma.modelFace.updateMany({
    where: { id, userId: auth.userId },
    data,
  });
  if (result.count === 0) return NextResponse.json({ error: '模特脸不存在' }, { status: 404 });

  const face = await prisma.modelFace.findFirstOrThrow({
    where: { id, userId: auth.userId },
    select: MODEL_FACE_PUBLIC_SELECT,
  });
  return NextResponse.json({ face });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;

  const result = await prisma.modelFace.deleteMany({
    where: { id, userId: auth.userId },
  });
  if (result.count === 0) return NextResponse.json({ error: '模特脸不存在' }, { status: 404 });
  return NextResponse.json({ success: true });
}
