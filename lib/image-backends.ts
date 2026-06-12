/**
 * 图像生成双通道 backend
 *
 * 默认走 Gemini 3.1 Flash Image（lifestyle 调性强，多图参考支持稳定）。
 * 通过 IMAGE_BACKEND=openai 切换到 gpt-image-2-all（apiyi 自定义路由名，
 * 面料 micro 质感渲染极佳，但 lifestyle 背景指令偏弱）。
 *
 * 默认两个 backend 共用 GEMINI_API_KEY（apiyi 内部按模型名路由）。
 * 可选：设 OPENAI_IMAGE_API_KEY 给 GPT 图像通道配独立令牌（独立计费/额度）；
 * 此时 GPT 模型默认用 gpt-image-2（该令牌支持的模型），可被 OPENAI_IMAGE_MODEL 覆盖。
 */

export interface ImageInput {
  data: string;     // base64
  mimeType: string;
}

export interface BackendInput {
  prompt: string;
  productImages: ImageInput[];
  modelRefImages?: ImageInput[];
  bgRefImages?: ImageInput[];
  sceneRefImages?: ImageInput[];
  accessoryImages?: ImageInput[];
  anchorImage?: ImageInput;
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
}

export interface BackendResult {
  success: boolean;
  data?: string;     // base64 PNG
  error?: string;
  backend: 'gemini' | 'openai';
  model?: string;    // 实际调用的上游模型名（用于真实计费归因，而非硬编码）
}

export type ImageBackend = 'gemini' | 'openai';

const ENV_BACKEND = (process.env.IMAGE_BACKEND || '').toLowerCase();
export const DEFAULT_BACKEND: ImageBackend =
  ENV_BACKEND === 'openai' || ENV_BACKEND === 'gpt-image' ? 'openai' : 'gemini';

// 后向兼容：旧代码引用 ACTIVE_BACKEND
export const ACTIVE_BACKEND: ImageBackend = DEFAULT_BACKEND;

export function normalizeBackend(input?: string | null): ImageBackend {
  const v = (input || '').toLowerCase();
  if (v === 'openai' || v === 'gpt-image' || v === 'gpt') return 'openai';
  if (v === 'gemini') return 'gemini';
  return DEFAULT_BACKEND;
}

const APIYI_BASE = process.env.GEMINI_BASE_URL || 'https://api.apiyi.com';
const API_KEY = process.env.GEMINI_API_KEY || '';

// GPT 图像通道可配独立令牌（OPENAI_IMAGE_API_KEY）；
// 不配则回退到主 GEMINI_API_KEY（两个引擎共用，保持原行为）。
const OPENAI_API_KEY = process.env.OPENAI_IMAGE_API_KEY || API_KEY;
const HAS_DEDICATED_OPENAI_KEY = !!process.env.OPENAI_IMAGE_API_KEY;

const GEMINI_MODEL = 'gemini-3.1-flash-image-preview';
// 模型默认随 key 走：独立 GPT 令牌支持 gpt-image-2；主令牌走 gpt-image-2-all。
// 两者都可被 OPENAI_IMAGE_MODEL 覆盖。
const OPENAI_MODEL =
  process.env.OPENAI_IMAGE_MODEL || (HAS_DEDICATED_OPENAI_KEY ? 'gpt-image-2' : 'gpt-image-2-all');

const MAX_RETRIES = 1;

// 防止 API key 随错误信息外泄（例如 base URL 配错时，fetch 抛出的
// TypeError 会带上完整含 ?key= 的 URL，并被透传到 SSE error 事件）。
// 两个令牌都要脱敏。
function sanitizeError(msg: string): string {
  let out = msg;
  if (API_KEY) out = out.split(API_KEY).join('***');
  if (OPENAI_API_KEY && OPENAI_API_KEY !== API_KEY) out = out.split(OPENAI_API_KEY).join('***');
  return out;
}

// ═══════════════════════════════════════════════
// 顶层入口：优先用调用方指定的 backend，否则退回 env / 默认
// ═══════════════════════════════════════════════

export async function generateImage(
  input: BackendInput,
  backendOverride?: ImageBackend | string | null
): Promise<BackendResult> {
  const backend = normalizeBackend(backendOverride ?? null);
  const requiredKey = backend === 'openai' ? OPENAI_API_KEY : API_KEY;
  if (!requiredKey) {
    return { success: false, error: 'API Key 未配置', backend };
  }
  return backend === 'openai'
    ? generateWithOpenAI(input)
    : generateWithGemini(input);
}

// ═══════════════════════════════════════════════
// Gemini 通道（保留现有行为）
// ═══════════════════════════════════════════════

async function generateWithGemini(input: BackendInput, retryCount = 0): Promise<BackendResult> {
  const url = `${APIYI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;
  const parts = buildGeminiParts(input);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      cache: 'no-store',
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: { aspectRatio: input.aspectRatio, image_size: '2K' },
        },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络连接失败';
    const isTimeout = /abort|timeout/i.test(msg);
    if (isTimeout && retryCount < MAX_RETRIES) {
      console.log(`[gemini] 超时重试 ${retryCount + 1}/${MAX_RETRIES}`);
      return generateWithGemini(input, retryCount + 1);
    }
    return { success: false, error: `网络连接失败${isTimeout ? '（超时 120s）' : ''}: ${sanitizeError(msg)}`, backend: 'gemini' };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000));
      return generateWithGemini(input, retryCount + 1);
    }
    return { success: false, error: `Gemini API 失败 (${response.status}): ${errorText.slice(0, 300)}`, backend: 'gemini' };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await response.text());
  } catch (err) {
    return { success: false, error: `响应 JSON 解析失败: ${err instanceof Error ? err.message : ''}`, backend: 'gemini' };
  }

  const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates?.length) {
    return { success: false, error: 'Gemini 未返回结果（candidates 为空）', backend: 'gemini' };
  }
  const finishReason = (candidates[0]?.finishReason as string) || '';
  console.log(`[gemini] finishReason=${finishReason}`);

  if (finishReason === 'IMAGE_RECITATION') {
    return { success: false, error: '图片生成被拒绝（IMAGE_RECITATION）— 请更换参考图', backend: 'gemini' };
  }
  if (finishReason === 'SAFETY') {
    return { success: false, error: '图片被安全策略过滤', backend: 'gemini' };
  }

  const content = candidates[0]?.content as Record<string, unknown> | undefined;
  const resultParts = content?.parts as Array<Record<string, unknown>> | undefined;
  for (const part of resultParts || []) {
    const inlineData = (part.inlineData || part.inline_data) as Record<string, string> | undefined;
    if (inlineData?.data) {
      return { success: true, data: inlineData.data, backend: 'gemini', model: GEMINI_MODEL };
    }
  }

  return { success: false, error: `生成结果中未找到图片数据（finishReason: ${finishReason}）`, backend: 'gemini' };
}

function buildGeminiParts(input: BackendInput): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];

  if (input.modelRefImages?.length) {
    parts.push({ text: '\n\nModel Reference Images (match hairstyle, makeup, mood, age):' });
    input.modelRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  parts.push({ text: '\n\nProduct Reference Images (extract garment design, fabric, color):' });
  input.productImages.forEach(img =>
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
  );
  if (input.bgRefImages?.length) {
    parts.push({ text: '\n\nBackground Reference Images (use these tones and atmosphere):' });
    input.bgRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  if (input.sceneRefImages?.length) {
    parts.push({ text: '\n\nScene Reference Images (recreate the spatial structure and lighting):' });
    input.sceneRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  if (input.accessoryImages?.length) {
    parts.push({ text: '\n\nAccessory Reference Images (subtle props):' });
    input.accessoryImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  if (input.anchorImage) {
    parts.push({ text: '\n\nAnchor Reference Image (CRITICAL — use the EXACT same model identity):' });
    parts.push({ inline_data: { mime_type: input.anchorImage.mimeType, data: input.anchorImage.data } });
  }
  return parts;
}

// ═══════════════════════════════════════════════
// OpenAI gpt-image-2-all 通道（多图 edits）
// ═══════════════════════════════════════════════

// gpt-image 系列只接受固定尺寸；把 SILXINE 的 aspectRatio 映射到最接近的
function mapAspectToOpenAISize(aspect: BackendInput['aspectRatio']): string {
  switch (aspect) {
    case '1:1': return '1024x1024';
    case '3:4':
    case '9:16': return '1024x1536';   // 2:3 vertical（最接近的纵向尺寸）
    case '4:3':
    case '16:9': return '1536x1024';   // 3:2 horizontal
    default: return '1024x1024';
  }
}

async function generateWithOpenAI(input: BackendInput, retryCount = 0): Promise<BackendResult> {
  // 收集所有参考图（OpenAI 上限 16 张）
  const refImages: Array<{ img: ImageInput; tag: string }> = [];
  input.productImages.forEach(img => refImages.push({ img, tag: 'product' }));
  (input.modelRefImages || []).forEach(img => refImages.push({ img, tag: 'model' }));
  (input.bgRefImages || []).forEach(img => refImages.push({ img, tag: 'bg' }));
  (input.sceneRefImages || []).forEach(img => refImages.push({ img, tag: 'scene' }));
  (input.accessoryImages || []).forEach(img => refImages.push({ img, tag: 'accessory' }));
  if (input.anchorImage) refImages.push({ img: input.anchorImage, tag: 'anchor' });

  const limited = refImages.slice(0, 16);

  // 在 prompt 里给参考图分组打标，弥补 multipart 不能传图标签的限制
  const taggedPrompt = `${input.prompt}

Reference image roles (in order of upload):
${limited.map((r, i) => `  ${i + 1}. ${r.tag}`).join('\n')}`;

  const formData = new FormData();
  formData.append('model', OPENAI_MODEL);
  formData.append('prompt', taggedPrompt);
  formData.append('size', mapAspectToOpenAISize(input.aspectRatio));
  formData.append('quality', 'high');
  formData.append('n', '1');

  limited.forEach((r, i) => {
    const buffer = Buffer.from(r.img.data, 'base64');
    const blob = new Blob([buffer], { type: r.img.mimeType });
    const ext = r.img.mimeType.split('/')[1] || 'png';
    formData.append('image[]', blob, `${r.tag}-${i}.${ext}`);
  });

  let response: Response;
  try {
    response = await fetch(`${APIYI_BASE}/v1/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: formData,
      signal: AbortSignal.timeout(180_000), // gpt-image 比 Gemini 慢，给更长超时
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络连接失败';
    const isTimeout = /abort|timeout/i.test(msg);
    if (isTimeout && retryCount < MAX_RETRIES) {
      console.log(`[openai] 超时重试 ${retryCount + 1}/${MAX_RETRIES}`);
      return generateWithOpenAI(input, retryCount + 1);
    }
    return { success: false, error: `网络连接失败${isTimeout ? '（超时 180s）' : ''}: ${sanitizeError(msg)}`, backend: 'openai' };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000));
      return generateWithOpenAI(input, retryCount + 1);
    }
    return { success: false, error: `OpenAI API 失败 (${response.status}): ${errorText.slice(0, 300)}`, backend: 'openai' };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await response.text());
  } catch (err) {
    return { success: false, error: `响应 JSON 解析失败: ${err instanceof Error ? err.message : ''}`, backend: 'openai' };
  }

  const items = data?.data as Array<{ b64_json?: string; url?: string }> | undefined;
  const b64 = items?.[0]?.b64_json;
  if (b64) {
    return { success: true, data: b64, backend: 'openai', model: OPENAI_MODEL };
  }
  // 兜底：apiyi 偶尔返回 url 而不是 b64
  const imgUrl = items?.[0]?.url;
  if (imgUrl) {
    try {
      const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(30_000) });
      // 临时 URL 过期/403 时返回的是 HTML 错误页，不校验会把坏数据
      // 当成功图片交付（已扣费、不退款、还可能污染 anchor 参考图）
      if (!imgRes.ok) {
        return { success: false, error: `获取图片 URL 失败 (HTTP ${imgRes.status})`, backend: 'openai' };
      }
      const contentType = imgRes.headers.get('content-type') || '';
      if (contentType && !contentType.startsWith('image/')) {
        return { success: false, error: `图片 URL 返回了非图片内容 (${contentType.slice(0, 50)})`, backend: 'openai' };
      }
      const buf = await imgRes.arrayBuffer();
      if (buf.byteLength === 0) {
        return { success: false, error: '图片 URL 返回空内容', backend: 'openai' };
      }
      const b64Fallback = Buffer.from(buf).toString('base64');
      return { success: true, data: b64Fallback, backend: 'openai', model: OPENAI_MODEL };
    } catch (err) {
      return { success: false, error: `获取图片 URL 失败: ${sanitizeError(err instanceof Error ? err.message : '')}`, backend: 'openai' };
    }
  }

  return { success: false, error: 'OpenAI 未返回 b64_json 或 url', backend: 'openai' };
}
