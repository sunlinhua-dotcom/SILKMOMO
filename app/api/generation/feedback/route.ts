/**
 * 生成反馈 API
 * POST: 提交反馈（👍👎 + 文字 + 标签）
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { submitFeedback, markDownloaded } from '@/lib/generation-record';

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await req.json();
  const { recordId, action, rating, feedback, feedbackTags } = body;

  if (!recordId || typeof recordId !== 'string') {
    return NextResponse.json({ error: '缺少 recordId' }, { status: 400 });
  }

  try {
    // 标记下载（隐式正面反馈）
    if (action === 'download') {
      await markDownloaded(recordId, auth.userId);
      return NextResponse.json({ success: true });
    }

    // 显式反馈：rating 白名单校验，否则任意值会写库污染质量统计
    if (rating !== undefined) {
      if (![-1, 0, 1].includes(rating)) {
        return NextResponse.json({ error: 'rating 非法' }, { status: 400 });
      }
      const safeTags = Array.isArray(feedbackTags)
        ? feedbackTags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 20)
        : undefined;
      await submitFeedback(recordId, auth.userId, {
        rating: rating as -1 | 0 | 1,
        feedback: typeof feedback === 'string' ? feedback.slice(0, 500) : undefined,
        feedbackTags: safeTags,
      });
      return NextResponse.json({ success: true });
    }
  } catch (e) {
    // 记录不存在或不属于当前用户 → Prisma P2025，应返回 404 而不是 500
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }
    throw e;
  }

  return NextResponse.json({ error: '无效操作' }, { status: 400 });
}
