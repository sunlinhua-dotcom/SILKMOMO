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

/**
 * 场景图·组图：分析一组 lookbook 参考图，识别其中的主品（可替换的主服装）与附件。
 * 用于在换装 UI 上按识别出的品类渲染动态上传槽位。
 * 一次多图调用（品类是全组共性，最多抽样前若干张即可），不按张计费。
 *
 * ok=false 表示上游失败；调用方据此退款。
 */
export type GarmentCategory = 'dress' | 'top' | 'pants' | 'skirt' | 'suit' | 'outerwear' | 'jumpsuit' | 'other';
export type AccessoryType = 'bag' | 'jewelry' | 'necklace' | 'belt' | 'scarf' | 'hat' | 'shoes' | 'other';

export async function analyzeLookbookGroup(
  images: Array<{ data: string; mimeType: string }>,
): Promise<{
  ok: boolean;
  primaryCategories: Array<{ category: GarmentCategory; description: string; confidence?: number }>;
  accessories: Array<{ type: AccessoryType; description: string }>;
}> {
  if (!LITE_CONFIG.apiKey || images.length === 0) {
    return { ok: false, primaryCategories: [], accessories: [] };
  }

  // 品类是全组共性，抽样前 4 张足够推断槽位，避免多图 payload 过大 / 上游不稳
  const sampled = images.slice(0, 4);

  try {
    const url = `${LITE_CONFIG.baseUrl}/models/${LITE_CONFIG.model}:generateContent?key=${LITE_CONFIG.apiKey}`;

    const parts: Array<Record<string, unknown>> = [
      {
        text: `You are a fashion e-commerce analyst. Look at this SET of lookbook photos (they show the same outfit/products worn by a model across shots). Identify the REPLACEABLE items. Output JSON only.

Split items into two groups:
- primaryCategories: the MAIN worn garments that a seller would swap in — each one of: dress | top | pants | skirt | suit | outerwear | jumpsuit | other. Usually 1 (sometimes 2, e.g. a top + pants set). List the DISTINCT main garments visible across the set, most prominent first.
- accessories: everything else worn/carried — bag | jewelry | necklace | belt | scarf | hat | shoes | other.

Return format:
{
  "primaryCategories": [ { "category": "dress", "description": "short English description (fabric, color, silhouette)", "confidence": 0.9 } ],
  "accessories": [ { "type": "bag", "description": "short English description" } ]
}

JSON only, no explanation.`,
      },
    ];
    sampled.forEach(img => {
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.data } });
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(LITE_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 500,
        },
      }),
    });

    if (!response.ok) {
      console.warn('[AI Lite] 组图分析失败:', response.status);
      return { ok: false, primaryCategories: [], accessories: [] };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { ok: false, primaryCategories: [], accessories: [] };
    }

    const parsed = JSON.parse(text);
    const primaryCategories = Array.isArray(parsed.primaryCategories)
      ? parsed.primaryCategories
          .filter((c: unknown): c is { category: string; description?: string; confidence?: number } =>
            !!c && typeof (c as { category?: unknown }).category === 'string')
          .map((c: { category: string; description?: string; confidence?: number }) => ({
            category: (c.category as GarmentCategory),
            description: c.description || '',
            confidence: typeof c.confidence === 'number' ? c.confidence : undefined,
          }))
      : [];
    const accessories = Array.isArray(parsed.accessories)
      ? parsed.accessories
          .filter((a: unknown): a is { type: string; description?: string } =>
            !!a && typeof (a as { type?: unknown }).type === 'string')
          .map((a: { type: string; description?: string }) => ({
            type: (a.type as AccessoryType),
            description: a.description || '',
          }))
      : [];
    return { ok: true, primaryCategories, accessories };
  } catch (error) {
    console.warn('[AI Lite] 组图分析异常:', sanitizeUpstreamError(error));
    return { ok: false, primaryCategories: [], accessories: [] };
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
