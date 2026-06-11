/**
 * Phase 4C + 4D：AI 智能辅助层
 * 用便宜的 Flash Lite 模型做产品图分析和质量评分
 * 生图仍用 gemini-3.1-flash-image-preview
 */

// Flash Lite — 用于分析、评分等非生图任务（极便宜）
const LITE_CONFIG = {
  baseUrl: 'https://api.apiyi.com/v1beta',
  model: 'gemini-3.1-flash-lite-preview',
  apiKey: process.env.GEMINI_API_KEY || '',
};

// 上游单次调用超时：没有超时的话 undici 默认要挂 ~300s，
// 扣费后挂死期间用户干等、资金被悬置
const LITE_TIMEOUT_MS = 30_000;

/** AI 分析服务是否已配置（调用方可据此在扣费前短路） */
export function isAiAssistantConfigured(): boolean {
  return !!LITE_CONFIG.apiKey;
}

/**
 * Phase 4C：分析产品图，提取服装描述
 * 用便宜的 Flash Lite "看懂" 产品图，生成精确描述词
 * 注入到主生成 prompt 中提升一次成功率
 *
 * 成本：~$0.002/次（约 ¥0.015）
 *
 * ok=false 表示上游失败（而非"分析结果为空"），付费调用方应据此退款
 */
export async function analyzeProductImage(
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<{
  ok: boolean;
  description: string;
  keywords: string[];
  category: string;
}> {
  if (!LITE_CONFIG.apiKey) {
    return { ok: false, description: '', keywords: [], category: 'garment' };
  }

  try {
    const url = `${LITE_CONFIG.baseUrl}/models/${LITE_CONFIG.model}:generateContent?key=${LITE_CONFIG.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(LITE_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `You are a fashion product analyst. Analyze this garment image and output JSON only.

Return format:
{
  "description": "A concise English description of the garment (material, color, cut, neckline, sleeve, length, texture, pattern). Max 50 words.",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "dress|top|blouse|pants|skirt|suit|outerwear|other"
}

Be extremely precise about:
- Fabric type (silk, cotton, linen, wool, chiffon, satin, etc.)
- Color (use specific names: champagne, ivory, burgundy, not just "white" or "red")
- Neckline style (V-neck, round, square, boat, halter, etc.)
- Sleeve type (sleeveless, cap, short, 3/4, long, bell, etc.)
- Length (cropped, waist, hip, knee, midi, maxi, etc.)
- Surface texture (matte, lustrous, sheer, textured, smooth, etc.)
- Any embellishments (embroidery, pleats, ruffles, buttons, etc.)

JSON only, no explanation.`
            },
            {
              inlineData: {
                // 前端压缩产物默认是 WebP，必须按真实 MIME 声明，
                // 否则上游按 jpeg 解码失败 → 静默返回空描述
                mimeType: mimeType || 'image/jpeg',
                data: imageBase64,
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 300,
        }
      }),
    });

    if (!response.ok) {
      console.warn('[AI Lite] 产品分析失败:', response.status);
      return { ok: false, description: '', keywords: [], category: 'garment' };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { ok: false, description: '', keywords: [], category: 'garment' };
    }

    const parsed = JSON.parse(text);
    return {
      ok: true,
      description: parsed.description || '',
      keywords: parsed.keywords || [],
      category: parsed.category || 'garment',
    };
  } catch (error) {
    console.warn('[AI Lite] 产品分析异常:', sanitizeUpstreamError(error));
    return { ok: false, description: '', keywords: [], category: 'garment' };
  }
}

/** 防止 API key 随错误信息（如 URL 解析失败的 TypeError）外泄到日志/客户端 */
function sanitizeUpstreamError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return LITE_CONFIG.apiKey ? msg.split(LITE_CONFIG.apiKey).join('***') : msg;
}

/**
 * Phase 4D：生成质量评分
 * 用 Flash Lite 评估生成结果质量（0-10分）
 * <7分 可触发免费重试
 * 
 * 成本：~$0.003/次（约 ¥0.02）
 */
export async function scoreGeneratedImage(
  generatedImageBase64: string,
  originalProductBase64: string,
  promptUsed: string
): Promise<{
  score: number;
  issues: string[];
  suggestion: string;
}> {
  if (!LITE_CONFIG.apiKey) {
    return { score: 8, issues: [], suggestion: '' };
  }

  try {
    const url = `${LITE_CONFIG.baseUrl}/models/${LITE_CONFIG.model}:generateContent?key=${LITE_CONFIG.apiKey}`;

    const parts: Array<Record<string, unknown>> = [
      {
        text: `You are a quality control inspector for AI-generated fashion product photos.

Score this AI-generated model photo (0-10) by checking:
1. Garment accuracy: Does the garment match the original product? (shape, color, details)
2. No text/watermarks: Any unwanted text, logos, or artifacts?
3. Composition: Is the model well-framed? No cropping issues?
4. Lighting: Is lighting natural and consistent?
5. Face/hands: Are face and hands realistic? No deformities?
6. Background: Clean, professional background?

The prompt used was: "${promptUsed.substring(0, 200)}"

Return JSON only:
{
  "score": 8,
  "issues": ["issue1", "issue2"],
  "suggestion": "Brief improvement suggestion if score < 7"
}

JSON only, no explanation.`
      },
    ];

    // 生成图（只有在合理大小内才传入，否则跳过评分）
    if (generatedImageBase64.length > 5_000_000) {
      console.warn('[AI Lite] 生成图过大，跳过质量评分');
      return { score: 8, issues: [], suggestion: '' };
    }
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: generatedImageBase64,
      }
    });

    // 如果有原图参考则加入对比
    if (originalProductBase64 && originalProductBase64.length < 5_000_000) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: originalProductBase64,
        }
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(LITE_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 200,
        }
      }),
    });

    if (!response.ok) {
      console.warn('[AI Lite] 质量评分失败:', response.status);
      return { score: 8, issues: [], suggestion: '' };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { score: 8, issues: [], suggestion: '' };
    }

    const parsed = JSON.parse(text);
    return {
      score: Math.min(10, Math.max(0, Number(parsed.score) || 8)),
      issues: parsed.issues || [],
      suggestion: parsed.suggestion || '',
    };
  } catch (error) {
    console.warn('[AI Lite] 质量评分异常:', sanitizeUpstreamError(error));
    return { score: 8, issues: [], suggestion: '' };
  }
}
