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

  if (!recordId) {
    return NextResponse.json({ error: '缺少 recordId' }, { status: 400 });
  }

  // 标记下载（隐式正面反馈）
  if (action === 'download') {
    await markDownloaded(recordId, auth.userId);
    return NextResponse.json({ success: true });
  }

  // 显式反馈
  if (rating !== undefined) {
    await submitFeedback(recordId, auth.userId, {
      rating,
      feedback,
      feedbackTags,
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: '无效操作' }, { status: 400 });
}
