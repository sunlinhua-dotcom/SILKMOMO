/**
 * AI Chat API — 结构化回复，支持参数联动 + 一键生成
 * 返回格式：{ reply: string, actions?: { bodyType, skinTone, module, triggerGenerate } }
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { deductCustom, refundBalance } from '@/lib/billing';
import { PRICING } from '@/lib/billing-constants';

// 主通道:DeepSeek(OpenAI 兼容协议)。配置 DEEPSEEK_API_KEY 即启用。
const DEEPSEEK_CONFIG = {
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-v4-pro',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
};

// 回退通道:未配置 DeepSeek 时沿用 Gemini Lite(保证零中断切换)
const API_CONFIG = {
  baseUrl: process.env.GEMINI_BASE_URL || 'https://api.apiyi.com/v1beta',
  model: 'gemini-3.1-flash-lite-preview',
  apiKey: process.env.GEMINI_API_KEY || '',
};

const USE_DEEPSEEK = !!DEEPSEEK_CONFIG.apiKey;

const SYSTEM_PROMPT = `你是 SILXINE 电商图片生成的助手。用户会用中文描述想要的图片效果，你必须根据描述提取参数。

只输出一个 JSON 对象，结构如下，每个字段都必须存在（不知道就用 null）：
{
  "reply": "<必填> 中文，1-2 句话确认你理解的设置；不要含任何 JSON 关键字",
  "actions": {
    "bodyType": "slim" | "standard" | "curvy" | null,
    "skinTone": "light" | "medium" | "deep" | null,
    "module":   "product" | "scene" | null,
    "prompt":   "<额外场景/风格描述，没有就 null>",
    "triggerGenerate": true | false
  }
}

参数枚举：
- bodyType: slim=纤细/瘦/修长, standard=标准/普通, curvy=饱满/丰满/微胖
- skinTone: light=白/白皙/浅, medium=中/自然/黄皮, deep=深/黑/小麦
- module:   product=产品图/电商主图/详情图, scene=场景图/生活方式/lookbook
- triggerGenerate: 用户说了"生成/开始/出图/帮我做/生N张"为 true

示例 1
用户："帮我生成丝绸裙的产品图，纤细模特，白皙皮肤"
{"reply":"好的，已切到产品图，纤细体型 + 白皙肤色","actions":{"bodyType":"slim","skinTone":"light","module":"product","prompt":"silk dress","triggerGenerate":true}}

示例 2
用户："改成生活方式场景图，丰满身材"
{"reply":"已切到场景图模式，体型设为饱满","actions":{"bodyType":"curvy","skinTone":null,"module":"scene","prompt":null,"triggerGenerate":false}}

示例 3
用户："什么体型适合展示旗袍？"
{"reply":"旗袍建议用纤细(slim)体型，能更好展示腰线","actions":{"bodyType":"slim","skinTone":null,"module":"product","prompt":null,"triggerGenerate":false}}

IMPORTANT:
- reply 字段绝对不能省，绝对不能为空字符串
- 只输出 JSON 本身，不要 markdown 代码块、不要解释文字`;

export async function POST(req: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { message, context } = await req.json();
  if (!message) {
    return NextResponse.json({ error: '请输入内容' }, { status: 400 });
  }

  // 扣费(按实际使用的模型归因)
  const chatModel = USE_DEEPSEEK ? DEEPSEEK_CONFIG.model : API_CONFIG.model;
  const deduction = await deductCustom(
    auth.userId,
    PRICING.aiAnalysisPricePerCallFen,
    'AI 智能助手',
    chatModel
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

    // 上游挂起时不能无限等：钱已扣，超时走 catch 分支自动退款
    let rawText = '';
    if (USE_DEEPSEEK) {
      // DeepSeek(OpenAI 兼容):messages + response_format json_object
      const res = await fetch(`${DEEPSEEK_CONFIG.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_CONFIG.apiKey}`,
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: DEEPSEEK_CONFIG.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
          response_format: { type: 'json_object' },
          // v4-pro 是推理模型,reasoning tokens 也计入 completion,上限要给足
          max_tokens: 600,
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        await refundBalance(auth.userId, PRICING.aiAnalysisPricePerCallFen, 'AI 助手调用失败退款');
        return NextResponse.json({
          reply: '我理解了你的需求，请在下方手动设置参数后生成。（已自动退款）',
          actions: {},
        });
      }
      const data = await res.json();
      rawText = data?.choices?.[0]?.message?.content || '';
    } else {
      const res = await fetch(
        `${API_CONFIG.baseUrl}/models/${API_CONFIG.model}:generateContent?key=${API_CONFIG.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30_000),
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
        await refundBalance(auth.userId, PRICING.aiAnalysisPricePerCallFen, 'AI 助手调用失败退款');
        return NextResponse.json({
          reply: '我理解了你的需求，请在下方手动设置参数后生成。（已自动退款）',
          actions: {},
        });
      }
      const data = await res.json();
      rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    // 上游 200 但内容为空（如 v4-pro 推理 token 吃满 max_tokens、completion 被截断）：
    // 没有任何可用结果，与 !res.ok 分支一致退款，避免白扣费。
    if (!rawText.trim()) {
      await refundBalance(auth.userId, PRICING.aiAnalysisPricePerCallFen, 'AI 助手空回复退款');
      return NextResponse.json({
        reply: '我理解了你的需求，请在下方手动设置参数后生成。（已自动退款）',
        actions: {},
      });
    }

    // 本地关键词兜底（lite 模型经常不填 enum 字段）
    const kw = (re: RegExp) => re.test(message);
    const localBodyType: 'slim' | 'standard' | 'curvy' | null =
      kw(/纤细|瘦|修长|苗条/) ? 'slim'
      : kw(/标准|普通|正常/) ? 'standard'
      : kw(/饱满|丰满|微胖|曲线/) ? 'curvy'
      : null;
    const localSkinTone: 'light' | 'medium' | 'deep' | null =
      kw(/白皙|白色|浅[色肤]/) ? 'light'
      : kw(/中性|自然|黄皮/) ? 'medium'
      : kw(/深色|黑[色皮]|小麦/) ? 'deep'
      : null;
    const localModule: 'product' | 'scene' | null =
      kw(/产品图|电商|主图|详情图|白底/) ? 'product'
      : kw(/场景|生活方式|lookbook|实拍|环境/) ? 'scene'
      : null;
    const localTrigger = kw(/生成|开始|出图|帮我做|生\s*\d+\s*张/);

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // 模型未填的字段用关键词兜底
        const flatActions = {
          bodyType: parsed.actions?.bodyType ?? parsed.bodyType ?? localBodyType,
          skinTone: parsed.actions?.skinTone ?? parsed.skinTone ?? localSkinTone,
          module: parsed.actions?.module ?? parsed.module ?? localModule,
          prompt: parsed.actions?.prompt ?? parsed.prompt ?? null,
          triggerGenerate: parsed.actions?.triggerGenerate ?? parsed.triggerGenerate ?? localTrigger,
        };

        // reply 缺失时合成一句兜底，让用户至少看到反馈
        let reply: string = parsed.reply;
        if (!reply || typeof reply !== 'string' || !reply.trim()) {
          const parts: string[] = [];
          if (flatActions.module === 'product') parts.push('产品图');
          if (flatActions.module === 'scene') parts.push('场景图');
          if (flatActions.bodyType === 'slim') parts.push('纤细体型');
          if (flatActions.bodyType === 'standard') parts.push('标准体型');
          if (flatActions.bodyType === 'curvy') parts.push('饱满体型');
          if (flatActions.skinTone === 'light') parts.push('白皙肤色');
          if (flatActions.skinTone === 'medium') parts.push('中等肤色');
          if (flatActions.skinTone === 'deep') parts.push('深色肤色');
          reply = parts.length > 0
            ? `已识别：${parts.join('、')}${flatActions.triggerGenerate ? '，准备生成' : ''}`
            : '收到，请上传产品图后开始生成。';
        }

        return NextResponse.json({
          reply,
          actions: flatActions,
          costFen: PRICING.aiAnalysisPricePerCallFen,
        });
      }
    } catch {
      // 有 { } 但 JSON 非法（截断/未加引号的 enum/尾逗号）：结构化提取失败，
      // 与其它失败路径一致退款，不让用户为没解析出参数的调用买单。
      await refundBalance(auth.userId, PRICING.aiAnalysisPricePerCallFen, 'AI 助手解析失败退款');
      return NextResponse.json({
        reply: rawText.slice(0, 200) || '我理解了你的需求，请在下方手动设置参数后生成。（已自动退款）',
        actions: {},
      });
    }

    // 走到这里说明 rawText 非空但没有 { }，即模型回了纯文本答复（如"旗袍建议用纤细体型"）——
    // 这是有价值的回答，照常计费。
    return NextResponse.json({
      reply: rawText.slice(0, 200) || '收到！请继续操作。',
      actions: {},
      costFen: PRICING.aiAnalysisPricePerCallFen,
    });
  } catch {
    await refundBalance(auth.userId, PRICING.aiAnalysisPricePerCallFen, 'AI 助手异常退款');
    return NextResponse.json({
      reply: 'AI 助手暂时繁忙，请直接手动操作。（已自动退款）',
      actions: {},
    });
  }
}
