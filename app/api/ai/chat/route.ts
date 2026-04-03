/**
 * AI Chat API — 结构化回复，支持参数联动 + 一键生成
 * 返回格式：{ reply: string, actions?: { bodyType, skinTone, module, triggerGenerate } }
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { deductCustom } from '@/lib/billing';
import { PRICING } from '@/lib/billing-constants';

const API_CONFIG = {
  baseUrl: process.env.GEMINI_BASE_URL || 'https://api.apiyi.com/v1beta',
  model: 'gemini-3.1-flash-lite-preview',
  apiKey: process.env.GEMINI_API_KEY || '',
};

const SYSTEM_PROMPT = `你是 SILKMOMO 电商AI图片生成助手。用户会用中文描述想要的图片效果。

你必须返回一个 JSON 对象，格式如下（不要输出其他内容，只输出 JSON）：
{
  "reply": "你的简短回复（中文，1-2句话确认理解）",
  "actions": {
    "bodyType": "slim|standard|curvy 或 null（不确定时）",
    "skinTone": "light|medium|deep 或 null",
    "module": "product|scene 或 null",
    "prompt": "提取的额外场景/风格要求，或 null",
    "triggerGenerate": true或false（用户明确要求生成时为true）
  }
}

参数说明：
- bodyType: slim=纤细/瘦/修长, standard=标准/普通/正常, curvy=饱满/丰满/胖
- skinTone: light=白/白皙/浅色, medium=中/自然/黄皮, deep=深/黑/小麦色
- module: product=产品图/电商主图, scene=场景图/生活方式
- prompt: 用户提到的场景、风格、背景等额外描述
- triggerGenerate: 用户说了"生成""开始""出图""帮我做"等意图时设为 true

示例：
用户："帮我生成一个白色连衣裙的产品图，纤细模特，白皙皮肤"
返回：{"reply":"好的，为您设置纤细体型、白皙肤色的产品图模式","actions":{"bodyType":"slim","skinTone":"light","module":"product","prompt":"白色连衣裙","triggerGenerate":true}}

用户："什么体型适合展示旗袍？"
返回：{"reply":"旗袍建议使用纤细(slim)体型，能更好展示腰线和版型优势","actions":{"bodyType":"slim","skinTone":null,"module":"product","prompt":null,"triggerGenerate":false}}

IMPORTANT: 只输出 JSON，不要有任何其他文字。`;

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { message, context } = await req.json();
  if (!message) {
    return NextResponse.json({ error: '请输入内容' }, { status: 400 });
  }

  // 扣费
  const deduction = await deductCustom(
    auth.userId,
    PRICING.aiAnalysisPricePerCallFen,
    'AI 智能助手',
    API_CONFIG.model
  );

  if (!deduction.success) {
    return NextResponse.json({
      reply: '余额不足，请先充值再使用 AI 助手。',
      actions: {},
    });
  }

  try {
    const userMsg = context
      ? `当前配置：${context}\n\n用户说：${message}`
      : `用户说：${message}`;

    const res = await fetch(
      `${API_CONFIG.baseUrl}/models/${API_CONFIG.model}:generateContent?key=${API_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            { role: 'user', parts: [{ text: userMsg }] },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 300,
            temperature: 0.3,
          },
        }),
      }
    );

    if (!res.ok) {
      return NextResponse.json({
        reply: '我理解了你的需求，请在下方手动设置参数后生成。',
        actions: {},
      });
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // 尝试解析 JSON
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          reply: parsed.reply || '收到！',
          actions: parsed.actions || {},
          costFen: PRICING.aiAnalysisPricePerCallFen,
        });
      }
    } catch {
      // JSON 解析失败，返回纯文本
    }

    return NextResponse.json({
      reply: rawText.slice(0, 200) || '收到！请继续操作。',
      actions: {},
      costFen: PRICING.aiAnalysisPricePerCallFen,
    });
  } catch {
    return NextResponse.json({
      reply: 'AI 助手暂时繁忙，请直接手动操作。',
      actions: {},
    });
  }
}
