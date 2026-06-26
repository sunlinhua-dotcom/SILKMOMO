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

  // 请求体解析失败应返回 400 而非让 handler 抛 500（与 generate/stream 一致）
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体解析失败' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '请求体格式非法' }, { status: 400 });
  }
  // colorPalette 约定为 string[]；非数组值会污染存储（safeParseJSON 取回后类型不符），直接丢弃
  if (body.colorPalette !== undefined && !Array.isArray(body.colorPalette)) {
    delete body.colorPalette;
  }

  const profile = await getDefaultBrandProfile(auth.userId);

  await updateBrandProfile(auth.userId, profile.id, body);

  const updated = await getDefaultBrandProfile(auth.userId);
  return NextResponse.json({ success: true, profile: updated });
}
