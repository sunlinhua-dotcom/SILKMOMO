import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listModelFaces } from '@/lib/model-face-library';

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const faces = await listModelFaces(auth.userId);
  return NextResponse.json({ faces });
}
