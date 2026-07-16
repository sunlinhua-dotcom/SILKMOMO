/**
 * 图像生成双通道 backend
 *
 * 默认走 Gemini 3.1 Flash Image（lifestyle 调性强，多图参考支持稳定）。
 * 通过 IMAGE_BACKEND=openai 切换到 GPT 图像通道（302.AI /v1/images/edits，
 * 面料 micro 质感渲染极佳，但 lifestyle 背景指令偏弱）。
 *
 * Gemini 默认走 GEMINI_BASE_URL / GEMINI_API_KEY。
 * GPT 图像通道默认走 302.AI 官转，可用 OPENAI_IMAGE_API_KEY 配独立令牌；
 * 模型默认用 gpt-image-2（独立令牌）或 gpt-image-2-all（兼容旧共享令牌），可被 OPENAI_IMAGE_MODEL 覆盖。
 */

import { normalizeGenerationQuality, type GenerationQuality } from './billing-constants';

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
  quality?: GenerationQuality;
  // 组图（换装）模式：把 sceneRefImages 当作可编辑底图，放在参考图队首（GPT edit 的
  // image[] 首图 = 主底图），并在 Gemini parts 里前置，指令要求「保留底图、只换服装+人物」。
  sceneAsEditBase?: boolean;
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

// GPT 图像通道 base 跟着 key 走：配了独立令牌（OPENAI_IMAGE_API_KEY，即 302.AI 的 key）
// 默认打 302.AI 官转；没配独立令牌则回退 apiyi 共享通道，避免拿 apiyi key 打 302 全 401。
// OPENAI_IMAGE_BASE_URL 可显式覆盖。Gemini 继续走 GEMINI_BASE_URL，不受影响。
const OPENAI_BASE =
  process.env.OPENAI_IMAGE_BASE_URL ||
  (HAS_DEDICATED_OPENAI_KEY ? 'https://api.302.ai' : APIYI_BASE);

const GEMINI_MODEL = 'gemini-3.1-flash-image-preview';
// 模型默认随 key 走：独立 GPT 令牌支持 gpt-image-2；主令牌走 gpt-image-2-all。
// 两者都可被 OPENAI_IMAGE_MODEL 覆盖。
const OPENAI_MODEL =
  process.env.OPENAI_IMAGE_MODEL || (HAS_DEDICATED_OPENAI_KEY ? 'gpt-image-2' : 'gpt-image-2-all');

// 计费归因用：调用方（route.ts）不要再自己硬编码模型名，否则这里一改就对不上账。
export function resolveApiModel(backend: ImageBackend): string {
  return backend === 'openai' ? OPENAI_MODEL : GEMINI_MODEL;
}

const MAX_RETRIES = 1;

// Gemini 上游正常 ~20-35s/张。
const GEMINI_TIMEOUT_MS = 120_000;
const GEMINI_TIMEOUT_SEC = Math.round(GEMINI_TIMEOUT_MS / 1000);
// GPT(gpt-image) 上游慢且抖动大：150-235s/张属正常速度（见 docs/BUGS.md）。
// 旧值 180s 卡在「正常区间」中段，令牌偏慢或上游拥塞时正常调用也会被中途 abort →
// 报「超时已退款」，且超时还会自动重试再等一轮，用户实际要等 ~360s 才看到失败。
// 提到 280s（覆盖正常上限 + 余量），并停止对「超时」的自动重试（见下方 catch）。
const OPENAI_TIMEOUT_MS = 280_000;
const OPENAI_TIMEOUT_SEC = Math.round(OPENAI_TIMEOUT_MS / 1000);

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
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
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
    return { success: false, error: `网络连接失败${isTimeout ? `（超时 ${GEMINI_TIMEOUT_SEC}s）` : ''}: ${sanitizeError(msg)}`, backend: 'gemini' };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000));
      return generateWithGemini(input, retryCount + 1);
    }
    return { success: false, error: `Gemini API 失败 (${response.status}): ${errorText.slice(0, 300)}`, backend: 'gemini' };
  }

  // 读取响应体单独 try：连上后出图慢、读 body 时被同一个超时 signal abort，
  // 旧代码会把它当成「响应 JSON 解析失败」且不重试。这里按真实成因——超时——处理并重试一次。
  let rawText: string;
  try {
    rawText = await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '读取响应失败';
    const isTimeout = /abort|timeout/i.test(msg);
    if (isTimeout && retryCount < MAX_RETRIES) {
      console.log(`[gemini] 读取响应超时重试 ${retryCount + 1}/${MAX_RETRIES}`);
      return generateWithGemini(input, retryCount + 1);
    }
    return { success: false, error: `网络连接失败${isTimeout ? `（超时 ${GEMINI_TIMEOUT_SEC}s）` : ''}: ${sanitizeError(msg)}`, backend: 'gemini' };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    return { success: false, error: `响应 JSON 解析失败: ${sanitizeError(err instanceof Error ? err.message : '')}`, backend: 'gemini' };
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

  // 组图模式：底图（场景参考图）必须排在最前，作为「要保留并编辑的底图」
  if (input.sceneAsEditBase && input.sceneRefImages?.length) {
    parts.push({ text: '\n\nScene-Base Image (tagged "scene-base" - use ONLY for pose, composition, crop, lighting, scene, expression, makeup, styling language, and photographic language; preserve those exactly. Its original clothing is NOT a garment design reference; only swap product garment and person identity):' });
    input.sceneRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
    if (input.anchorImage) {
      parts.push({ text: '\n\nAnchor Reference Image (the ONLY identity reference for the same fictional model in this set):' });
      parts.push({ inline_data: { mime_type: input.anchorImage.mimeType, data: input.anchorImage.data } });
    }
  }

  if (input.modelRefImages?.length) {
    parts.push({ text: '\n\nModel Reference Images (style reference for hairstyle, makeup, mood, age feeling, and expression; not a garment reference and not an identity reference unless explicitly anchored):' });
    input.modelRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  parts.push({ text: '\n\nProduct Reference Images (garment reference ONLY - extract style, cut, silhouette, tailoring, proportions, fabric, color, pattern, seams, closures, and construction; ignore any person/face/pose/identity):' });
  input.productImages.forEach(img =>
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
  );
  if (input.bgRefImages?.length) {
    parts.push({ text: '\n\nBackground Reference Images (use tones, filter, atmosphere, and lighting only; ignore any clothing or person as product/identity references):' });
    input.bgRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  if (!input.sceneAsEditBase && input.sceneRefImages?.length) {
    parts.push({ text: '\n\nScene Reference Images (use spatial structure, pose/composition if relevant, lighting, filter, expression, makeup, and photographic language; clothing in these images is NOT a product design reference):' });
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
  if (!input.sceneAsEditBase && input.anchorImage) {
    parts.push({ text: '\n\nAnchor Reference Image (CRITICAL - use the EXACT same fictional model identity for this set):' });
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
  if (input.sceneAsEditBase) {
    // 组图（换装）模式：底图排在最前——/v1/images/edits 的 image[] 首图作为主编辑底图，
    // anchor 紧跟第二位，优先锁新模特身份；不传 model/bg 参考图避免干扰底图。
    (input.sceneRefImages || []).forEach(img => refImages.push({ img, tag: 'scene-base' }));
    if (input.anchorImage) refImages.push({ img: input.anchorImage, tag: 'anchor' });
    input.productImages.forEach(img => refImages.push({ img, tag: 'product' }));
    (input.accessoryImages || []).forEach(img => refImages.push({ img, tag: 'accessory' }));
  } else {
    input.productImages.forEach(img => refImages.push({ img, tag: 'product' }));
    (input.modelRefImages || []).forEach(img => refImages.push({ img, tag: 'model' }));
    (input.bgRefImages || []).forEach(img => refImages.push({ img, tag: 'bg' }));
    (input.sceneRefImages || []).forEach(img => refImages.push({ img, tag: 'scene' }));
    (input.accessoryImages || []).forEach(img => refImages.push({ img, tag: 'accessory' }));
    if (input.anchorImage) refImages.push({ img: input.anchorImage, tag: 'anchor' });
  }

  const limited = refImages.slice(0, 16);

  // 在 prompt 里给参考图分组打标，弥补 multipart 不能传图标签的限制
  const roleText = (tag: string) => {
    switch (tag) {
      case 'product':
        return 'product (garment reference ONLY: style, cut, silhouette, tailoring, proportions, fabric, color, pattern, seams, closures; ignore person/face/pose/identity)';
      case 'anchor':
        return 'anchor (the ONLY identity reference for the same fictional model in this set)';
      case 'scene-base':
        return 'scene-base (pose/composition/crop/lighting/scene/expression/makeup/photographic language ONLY; original clothing is not a garment design reference)';
      case 'model':
        return 'model (hairstyle/makeup/mood/age feeling/expression style only; not garment or identity reference unless explicitly anchored)';
      case 'bg':
        return 'background (tones/filter/atmosphere/lighting only; ignore clothing/person)';
      case 'scene':
        return 'scene (spatial structure, lighting, filter, pose/composition, expression/makeup, photographic language; clothing is not product design)';
      default:
        return tag;
    }
  };
  const taggedPrompt = `${input.prompt}

Reference image roles (in order of upload):
${limited.map((r, i) => `  ${i + 1}. ${roleText(r.tag)}`).join('\n')}`;

  const formData = new FormData();
  formData.append('model', OPENAI_MODEL);
  formData.append('prompt', taggedPrompt);
  formData.append('size', mapAspectToOpenAISize(input.aspectRatio));
  formData.append('quality', normalizeGenerationQuality(input.quality));
  formData.append('n', '1');

  limited.forEach((r, i) => {
    const buffer = Buffer.from(r.img.data, 'base64');
    const blob = new Blob([buffer], { type: r.img.mimeType });
    const ext = r.img.mimeType.split('/')[1] || 'png';
    formData.append('image[]', blob, `${r.tag}-${i}.${ext}`);
  });

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE}/v1/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: formData,
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS), // gpt-image 比 Gemini 慢得多，给足超时
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络连接失败';
    const isTimeout = /abort|timeout/i.test(msg);
    // 超时不重试：已经等满一整个超时窗口，上游多半是拥塞/令牌偏慢，
    // 再等一轮只会把用户的等待时间翻倍且大概率还是失败（让用户用「重试」按钮自行再试）。
    // 仅对非超时的网络错误（如连接重置/拒绝，通常是瞬时抖动）重试一次。
    if (!isTimeout && retryCount < MAX_RETRIES) {
      console.log(`[openai] 网络错误重试 ${retryCount + 1}/${MAX_RETRIES}`);
      return generateWithOpenAI(input, retryCount + 1);
    }
    return { success: false, error: `网络连接失败${isTimeout ? `（超时 ${OPENAI_TIMEOUT_SEC}s）` : ''}: ${sanitizeError(msg)}`, backend: 'openai' };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000));
      return generateWithOpenAI(input, retryCount + 1);
    }
    return { success: false, error: `OpenAI API 失败 (${response.status}): ${errorText.slice(0, 300)}`, backend: 'openai' };
  }

  // 读取响应体单独 try：读 body 时被超时 abort 不应误报成「JSON 解析失败」。
  // GPT 通道超时不自动重试（理由同 fetch catch），如实报超时即可。
  let rawText: string;
  try {
    rawText = await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '读取响应失败';
    const isTimeout = /abort|timeout/i.test(msg);
    return { success: false, error: `网络连接失败${isTimeout ? `（超时 ${OPENAI_TIMEOUT_SEC}s）` : ''}: ${sanitizeError(msg)}`, backend: 'openai' };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    return { success: false, error: `响应 JSON 解析失败: ${sanitizeError(err instanceof Error ? err.message : '')}`, backend: 'openai' };
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
