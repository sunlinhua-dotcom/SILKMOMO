import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { MODEL_FACE_PAGE_SIZE, listModelFaces } from '@/lib/model-face-library';

export async function GET(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get('page') || 1);
  const result = await listModelFaces(auth.userId, page, MODEL_FACE_PAGE_SIZE);
  return NextResponse.json(result);
}
