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

  const taskId = Number(new URL(req.url).searchParams.get('taskId'));
  // 必须是整数：1.5 这类值能过 isFinite，但查询 Int 列时 Prisma 会抛 500
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ error: 'taskId 非法' }, { status: 400 });
  }

  const images = await listPendingImages(auth.userId, taskId);
  return NextResponse.json({ images });
}
