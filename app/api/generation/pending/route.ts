/**
 * 待取图列表 API
 * GET /api/generation/pending?taskId=N
 *
 * 断网重连后的补拉入口：返回该任务下服务端还留着、客户端尚未取走的图（只给元信息，
 * 不带 base64——否则这个接口本身又变成一次大传输）。客户端据此逐张 GET 详情。
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listPendingImages } from '@/lib/pending-image';

export async function GET(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const searchParams = new URL(req.url).searchParams;
  const taskId = Number(searchParams.get('taskId'));
  // 必须是整数：1.5 这类值能过 isFinite，但查询 Int 列时 Prisma 会抛 500
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ error: 'taskId 非法' }, { status: 400 });
  }

  // 默认只给 result，保证未携带 includeAnchor 的老客户端不会把肖像卡误存成结果图。
  const images = await listPendingImages(auth.userId, taskId, searchParams.get('includeAnchor') === '1');
  return NextResponse.json({ images });
}
