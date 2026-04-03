/**
 * 品牌记忆 API
 * GET: 获取当前用户的默认品牌配置
 * PUT: 更新品牌配置
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDefaultBrandProfile, updateBrandProfile } from '@/lib/brand-memory';

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const profile = await getDefaultBrandProfile(auth.userId);
  return NextResponse.json({ profile });
}

export async function PUT(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await req.json();
  const profile = await getDefaultBrandProfile(auth.userId);

  await updateBrandProfile(auth.userId, profile.id, body);

  const updated = await getDefaultBrandProfile(auth.userId);
  return NextResponse.json({ success: true, profile: updated });
}
