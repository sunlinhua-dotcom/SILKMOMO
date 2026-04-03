/**
 * AI 产品图分析 API
 * 用 Flash Lite 分析产品图，返回服装描述
 * 每次调用扣费 ¥0.03（3 分）
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { analyzeProductImage } from '@/lib/ai-assistant';
import { deductCustom } from '@/lib/billing';
import { PRICING } from '@/lib/billing-constants';

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { imageBase64 } = await req.json();
  if (!imageBase64) {
    return NextResponse.json({ error: '缺少图片数据' }, { status: 400 });
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

  const result = await analyzeProductImage(imageBase64);
  return NextResponse.json({
    ...result,
    costFen: PRICING.aiAnalysisPricePerCallFen,
  });
}
