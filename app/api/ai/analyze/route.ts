/**
 * AI 产品图分析 API
 * 用 Flash Lite 分析产品图，返回服装描述
 * 每次调用按 PRICING.aiAnalysisPricePerCallFen 扣费
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { analyzeProductImage, isAiAssistantConfigured } from '@/lib/ai-assistant';
import { deductCustom, refundBalance } from '@/lib/billing';
import { PRICING } from '@/lib/billing-constants';

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { imageBase64, mimeType } = await req.json();
  if (!imageBase64) {
    return NextResponse.json({ error: '缺少图片数据' }, { status: 400 });
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

  const result = await analyzeProductImage(imageBase64, typeof mimeType === 'string' ? mimeType : undefined);

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
