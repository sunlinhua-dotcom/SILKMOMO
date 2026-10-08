/**
 * AI 产品图分析 API
 * 用 Flash Lite 分析产品图，返回服装描述
 * 每次调用按 PRICING.aiAnalysisPricePerCallFen 扣费
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { analyzeProductImage, analyzeLookbookGroup, isAiAssistantConfigured } from '@/lib/ai-assistant';
import { deductCustom, refundBalance } from '@/lib/billing';
import { PRICING } from '@/lib/billing-constants';
import { rateLimitByKeyAsync } from '@/lib/rate-limit';

// 组图分析入参上限（前端可能上传很多张 lookbook，只需抽样若干张即可判品类；这里限体积/张数防滥用）
const MAX_GROUP_IMAGES = 8;
const MAX_IMAGE_BASE64_LENGTH = 11_000_000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ANALYZE_RATE_MAX = 10; // 每用户每分钟
const ANALYZE_RATE_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { imageBase64, mimeType, images } = body as {
    imageBase64?: string;
    mimeType?: string;
    images?: Array<{ data?: string; mimeType?: string }>;
  };

  const isGroup = Array.isArray(images) && images.length > 0;
  if (!isGroup && !imageBase64) {
    return NextResponse.json({ error: '缺少图片数据' }, { status: 400 });
  }

  // ── 入参校验（先于限频与扣费）：类型 / 体积 / mimeType 白名单 ──
  if (!isGroup) {
    if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return NextResponse.json({ error: '图片数据非法或过大' }, { status: 400 });
    }
    if (mimeType !== undefined && (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(mimeType))) {
      return NextResponse.json({ error: '仅支持 JPEG / PNG / WebP 图片' }, { status: 400 });
    }
  } else if (
    images!.some(im => im && im.mimeType !== undefined && (typeof im.mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(im.mimeType)))
  ) {
    return NextResponse.json({ error: '仅支持 JPEG / PNG / WebP 图片' }, { status: 400 });
  }

  // 按用户限频
  const rate = await rateLimitByKeyAsync('ai-analyze', auth.userId, ANALYZE_RATE_MAX, ANALYZE_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `请求太频繁了，请 ${rate.retryAfterSec} 秒后再试` },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  // ── 组图（多图）分析：识别主品/附件品类 ──
  if (isGroup) {
    const clean = images!
      .filter(im => im && typeof im.data === 'string' && im.data)
      .slice(0, MAX_GROUP_IMAGES)
      .map(im => ({ data: im.data as string, mimeType: typeof im.mimeType === 'string' ? im.mimeType : 'image/jpeg' }));
    if (clean.length === 0 || clean.some(im => im.data.length > MAX_IMAGE_BASE64_LENGTH)) {
      return NextResponse.json({ error: '图片数据非法' }, { status: 400 });
    }

    if (!isAiAssistantConfigured()) {
      return NextResponse.json({ primaryCategories: [], accessories: [], garmentsWornByPerson: false, billingSkipped: true });
    }

    const deduction = await deductCustom(
      auth.userId,
      PRICING.aiAnalysisPricePerCallFen,
      'AI 组图分析',
      'gemini-3.1-flash-lite-preview'
    );
    if (!deduction.success) {
      return NextResponse.json({ primaryCategories: [], accessories: [], garmentsWornByPerson: false, billingSkipped: true });
    }

    const groupResult = await analyzeLookbookGroup(clean);
    if (!groupResult.ok) {
      await refundBalance(auth.userId, PRICING.aiAnalysisPricePerCallFen, 'AI 组图分析失败退款');
      return NextResponse.json({ primaryCategories: [], accessories: [], garmentsWornByPerson: false, billingSkipped: true });
    }
    return NextResponse.json({
      primaryCategories: groupResult.primaryCategories,
      accessories: groupResult.accessories,
      garmentsWornByPerson: groupResult.garmentsWornByPerson,
      costFen: PRICING.aiAnalysisPricePerCallFen,
    });
  }

  // 服务未配置时直接返回空结果，不能先扣费
  if (!isAiAssistantConfigured()) {
    return NextResponse.json({
      description: '',
      keywords: [],
      category: 'garment',
      billingSkipped: true,
    });
  }

  // 扣费（AI 分析）
  const deduction = await deductCustom(
    auth.userId,
    PRICING.aiAnalysisPricePerCallFen,
    'AI 产品分析',
    'gemini-3.1-flash-lite-preview'
  );

  if (!deduction.success) {
    // 余额不足时，仍然返回空分析（不阻塞生成流程）
    return NextResponse.json({
      description: '',
      keywords: [],
      category: 'garment',
      billingSkipped: true,
    });
  }

  const result = await analyzeProductImage(imageBase64!, typeof mimeType === 'string' ? mimeType : undefined);

  // 上游失败（≠ 分析结果为空）时退款，不能让用户为失败的调用买单
  if (!result.ok) {
    await refundBalance(auth.userId, PRICING.aiAnalysisPricePerCallFen, 'AI 产品分析失败退款');
    return NextResponse.json({
      description: '',
      keywords: [],
      category: 'garment',
      billingSkipped: true,
    });
  }

  return NextResponse.json({
    ...result,
    costFen: PRICING.aiAnalysisPricePerCallFen,
  });
}
