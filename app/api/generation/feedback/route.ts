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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体解析失败' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '请求体格式非法' }, { status: 400 });
  }
  const { recordId, action, rating, feedback, feedbackTags } = body as Record<string, unknown>;

  if (!recordId || typeof recordId !== 'string' || recordId.length > 64) {
    return NextResponse.json({ error: '缺少 recordId' }, { status: 400 });
  }
  if (action !== undefined && action !== 'download') {
    return NextResponse.json({ error: 'action 非法' }, { status: 400 });
  }
  if (feedback !== undefined && feedback !== null && typeof feedback !== 'string') {
    return NextResponse.json({ error: 'feedback 必须是字符串' }, { status: 400 });
  }
  if (
    feedbackTags !== undefined && feedbackTags !== null &&
    (!Array.isArray(feedbackTags) || feedbackTags.length > 20 ||
      feedbackTags.some(t => typeof t !== 'string' || t.length > 50))
  ) {
    return NextResponse.json({ error: 'feedbackTags 非法' }, { status: 400 });
  }

  try {
    // 标记下载（隐式正面反馈）
    if (action === 'download') {
      await markDownloaded(recordId, auth.userId);
      return NextResponse.json({ success: true });
    }

    // 显式反馈：rating 白名单校验，否则任意值会写库污染质量统计
    if (rating !== undefined) {
      if (rating !== -1 && rating !== 0 && rating !== 1) {
        return NextResponse.json({ error: 'rating 非法' }, { status: 400 });
      }
      await submitFeedback(recordId, auth.userId, {
        rating,
        feedback: typeof feedback === 'string' ? feedback.slice(0, 500) : undefined,
        feedbackTags: Array.isArray(feedbackTags) ? (feedbackTags as string[]) : undefined,
      });
      return NextResponse.json({ success: true });
    }
  } catch (e) {
    // 记录不存在或不属于当前用户 → Prisma P2025，应返回 404 而不是 500
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }
    // 内部异常只进日志，不透传给客户端
    console.error('提交反馈失败:', e);
    return NextResponse.json({ error: '提交失败，请稍后重试' }, { status: 500 });
  }

  return NextResponse.json({ error: '无效操作' }, { status: 400 });
}
