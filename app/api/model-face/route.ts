/**
 * 模特脸库 API
 * POST /api/model-face  { variation?: string }
 *
 * 生成一张白底身份肖像，供用户在「组图·换装」里挑选固定模特脸。
 * 一次只出一张：客户端要 10 张就串行调 10 次 —— 单次请求短、进度可见，
 * 也天然满足「生图串行」的约束。
 *
 * 不计费：生成流程本来就会免费创建一张派生锚（属于身份一致性的基础设施），
 * 用户自己挑脸只是把那次生成提前并可视化，收费口径保持一致。
 * 代价是可被反复点，故按用户限流。
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { buildDerivedAnchorPortraitPrompt } from '@/lib/api';
import { generateImage } from '@/lib/image-backends';
import { isRateLimited, bumpRateLimit } from '@/lib/rate-limit';

// 一次挑脸最多 10 张，留一倍余量给重挑；窗口 10 分钟
const MAX_FACES_PER_WINDOW = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const rateKey = `model-face:${auth.userId}`;
  const gate = isRateLimited(rateKey, MAX_FACES_PER_WINDOW, RATE_WINDOW_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: `生成模特脸太频繁，请 ${gate.retryAfterSec} 秒后再试` },
      { status: 429 },
    );
  }
  bumpRateLimit(rateKey, RATE_WINDOW_MS);

  const body = await req.json().catch(() => ({}));
  const rawVariation = (body as { variation?: unknown }).variation;
  // 变化提示只用于让 10 张脸互不相同，限长防止被塞任意文本进 prompt
  const variation = typeof rawVariation === 'string' && rawVariation.trim()
    ? rawVariation.trim().slice(0, 120)
    : undefined;

  const result = await generateImage({
    prompt: buildDerivedAnchorPortraitPrompt(undefined, variation),
    productImages: [],
    aspectRatio: '3:4',
  }, 'gemini');

  if (!result.success || !result.data) {
    return NextResponse.json(
      { error: result.error || '模特脸生成失败' },
      { status: 502 },
    );
  }

  return NextResponse.json({ face: { data: result.data, mimeType: 'image/png' } });
}
