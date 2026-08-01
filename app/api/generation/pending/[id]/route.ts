/**
 * 单张待取图 API
 * GET    /api/generation/pending/[id]  取图（普通 HTTP，浏览器自管重试，不经过 SSE 看门狗）
 * DELETE /api/generation/pending/[id]  客户端确认已落 IndexedDB 后删除
 *
 * GET 不做「取了就删」：万一响应中途断了，图就永久丢了。改为客户端落库成功后显式 DELETE，
 * 没删掉的由 TTL 兜底（见 lib/pending-image.ts）。
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readPendingImage, deletePendingImage } from '@/lib/pending-image';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { id } = await context.params;
  const image = await readPendingImage(id, auth.userId);
  if (!image) {
    // 已被取走并删除，或压根不属于这个用户 —— 都按「没有」处理，不泄露存在性
    return NextResponse.json({ error: '图片不存在或已取走' }, { status: 404 });
  }

  return NextResponse.json({ image }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { id } = await context.params;
  const deleted = await deletePendingImage(id, auth.userId);
  return NextResponse.json({ deleted });
}
