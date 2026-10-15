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
 *
 * GPT 通道的上游提供方（lib/kie-image.ts 的 resolveOpenAIProvider）：
 *   配了 KIE_API_KEY 且未显式写 OPENAI_IMAGE_PROVIDER=302 → kie.ai GPT-Image-2.5 Flare（异步任务制）；
 *   否则 → 302.ai（原行为，一字不变）。对外接口（backend 名 'openai'、入参出参）两种提供方完全一致。
 */

import { normalizeGenerationQuality, type GenerationQuality } from './billing-constants';
import { normalizeReferenceImage } from './reference-image-normalizer';
import {
  KIE_DEFAULT_TIMEOUT_MS,
  KieError,
  readKieConfig,
  resolveOpenAIProvider,
  runKieImageTask,
} from './kie-image';

export interface ImageInput {
  data: string;     // base64
  mimeType: string;
  skipNormalization?: boolean; // internal: caller already normalized this exact buffer (used for mask alignment)
}

export interface BackendInput {
  prompt: string;
  productImages: ImageInput[];
  modelRefImages?: ImageInput[];
  bgRefImages?: ImageInput[];
  sceneRefImages?: ImageInput[];
  accessoryImages?: ImageInput[];
  anchorImage?: ImageInput;
  maskImage?: ImageInput; // OpenAI edits mask (PNG alpha: transparent = editable). Gemini ignores it.
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  quality?: GenerationQuality;
  // 组图（换装）模式：把 sceneRefImages 当作可编辑底图，放在参考图队首（GPT edit 的
  // image[] 首图 = 主底图），并在 Gemini parts 里前置，指令要求「保留底图、只换服装+人物」。
  sceneAsEditBase?: boolean;
  promptPurpose?: 'compose' | 'faceswap' | 'derived-anchor';
  timeoutMs?: number;
  allowRetryOn5xx?: boolean;
  /**
   * 调用方取消信号（目前仅 kie 通道遵守：取消后立刻停止轮询）。出图路由故意不传它——
   * 客户端断线后结果仍要落 pending 供重连取走，不能中途取消上游任务。
   */
  signal?: AbortSignal;
}

/**
 * 失败类别（机器可读）。调用方要做分类 / 统计请看这个字段，不要再去匹配 error 文案。
 */
export type BackendErrorKind =
  | 'config'               // 通道未配置
  | 'timeout'              // 等满超时窗口
  | 'network'              // 连接失败 / 读 body 中断
  | 'rate_limit'           // 上游 429
  | 'upstream_unavailable' // 上游 5xx
  | 'upstream_rejected'    // 上游其它 4xx
  | 'upstream_quota'       // 上游账户余额 / 额度不足（302 的 -10004、kie 的 402 等）：运维要去充值，不是用户的问题
  | 'moderation'           // 上游或模型的内容审核 / 安全策略拒绝
  | 'bad_response'         // 响应无法解析 / 缺少图片
  | 'download';            // 兜底按 URL 取图失败

export interface BackendResult {
  success: boolean;
  data?: string;     // base64 PNG
  /**
   * 给用户看的通用中文文案：不含上游原文、不含任何 key / URL。
   * 是否追加「已自动退款」由调用方（route.ts）决定。
   */
  error?: string;
  /** 失败类别，见 BackendErrorKind。 */
  errorKind?: BackendErrorKind;
  /** 上游 HTTP 状态码（仅 HTTP 层失败时有）。 */
  httpStatus?: number;
  /**
   * 经 sanitizeError 脱敏、截断到 300 字的上游原文，仅供服务端日志 / recordGeneration 落库排障。
   * 严禁下发给客户端。
   */
  detail?: string;
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

// GPT 通道的上游提供方，进程内固定（改环境变量要重启 / 重新部署才生效，与其它模块级配置一致）。
const OPENAI_PROVIDER = resolveOpenAIProvider(process.env);
export function getOpenAIProvider(): 'kie' | '302' {
  return OPENAI_PROVIDER;
}
const KIE_API_KEY_ENV = process.env.KIE_API_KEY || '';

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
// 09-04 三组×3 真图对照：C 组 Flash 锚在肤色连续、长相相似、稳定性、质量、速度上全面优于 Pro 锚；
// 脸喉 ΔRGB 中位 6.66，断层评分 1.3，相似度 3.5–4，每样本 84 秒。
// DERIVED_ANCHOR_MODEL 仍可覆盖为 gemini-3-pro-image。
export const DERIVED_ANCHOR_MODEL = process.env.DERIVED_ANCHOR_MODEL || 'gemini-3.1-flash-image-preview';
// 模型默认随 key 走：独立 GPT 令牌支持 gpt-image-2；主令牌走 gpt-image-2-all。
// 两者都可被 OPENAI_IMAGE_MODEL 覆盖。
// kie 提供方下，归因用的模型名是 kie 的 Flare 模型（图生图为默认；纯文生用 resolveApiModel 的 textOnly）。
const KIE_STATIC_CONFIG = readKieConfig(process.env);
const OPENAI_MODEL = OPENAI_PROVIDER === 'kie'
  ? KIE_STATIC_CONFIG.modelI2I
  : process.env.OPENAI_IMAGE_MODEL || (HAS_DEDICATED_OPENAI_KEY ? 'gpt-image-2' : 'gpt-image-2-all');

// 计费归因用：调用方（route.ts）不要再自己硬编码模型名，否则这里一改就对不上账。
// textOnly：本次调用没有任何参考图（脸库候选脸）。kie 的图生图 / 文生图是两个模型 id，归因要如实。
export function resolveApiModel(backend: ImageBackend, opts?: { textOnly?: boolean }): string {
  if (backend === 'openai' && opts?.textOnly && OPENAI_PROVIDER === 'kie') return KIE_STATIC_CONFIG.modelT2I;
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
// 0731 再提到 360s：客户实拍反馈里出现单张 280.7s 正好撞顶被 abort（成功的同批是
// 115.8s），说明 280s 只压住正常区间上限、没留抖动余量；一次成型后单次调用要带
// 场景底图+锚脸+产品图，参考图更多、耗时分布本就右移。单张一块、maxDuration=800，
// 提到 360s 仍有充裕空间。注意：客户端事件看门狗必须同步高于此值。
const OPENAI_TIMEOUT_MS = 360_000;

// 防止 API key 随错误信息外泄（例如 base URL 配错时，fetch 抛出的
// TypeError 会带上完整含 ?key= 的 URL）。
// 两个令牌都要脱敏；另外 URL 里的 ?key= / &key= 一律打码，Bearer 令牌也打码，
// 这样即使上游把 key 回显到错误体里、或 env 里没配的别的 key 也不会进日志。
export function sanitizeError(msg: string): string {
  let out = msg;
  if (API_KEY) out = out.split(API_KEY).join('***');
  if (OPENAI_API_KEY && OPENAI_API_KEY !== API_KEY) out = out.split(OPENAI_API_KEY).join('***');
  if (KIE_API_KEY_ENV) out = out.split(KIE_API_KEY_ENV).join('***');
  return out
    .replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&\s"'<>]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/=-]{8,}/gi, '$1***')
    // 常见令牌形态：sk-… / pk-… / rk-…（OpenAI、302、apiyi 等）、Google AIza…、GitHub gh?_…
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '***')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, '***')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '***')
    // 签名 URL 的 query（S3 / GCS / Azure SAS 等）：保留参数名，值一律打码
    .replace(/([?&](?:X-Amz-[A-Za-z0-9-]+|X-Goog-[A-Za-z0-9-]+|Signature|Expires|AWSAccessKeyId|GoogleAccessId|sig|sv|se|sp|sr|st|skoid|sktid)=)[^&\s"'<>]+/gi, '$1***');
}

// 上游账户余额 / 额度不足：302 回 HTTP 401 + err_code -10004「Insufficient account balance」，kie 回 code 402。
const QUOTA_RE = /-10004|insufficient[_ ](?:account[_ ])?(?:balance|credits?|funds|quota)|(?:balance|credits?)\s+(?:is\s+)?(?:insufficient|not enough|exhausted|too low)|not enough (?:balance|credits?)|out of credits|余额不足|余额已用完|欠费/i;

const QUOTA_USER_MESSAGE = '出图服务暂时不可用，请稍后重试';

/** 余额不足：给用户的文案不提余额、不说鉴权失败；运维在服务端日志里能一眼看到该充值了。 */
function quotaFailure(backend: ImageBackend, status: number | undefined, errorText: string): BackendResult {
  console.error(`[upstream-quota] backend=${backend} provider=${OPENAI_PROVIDER} 上游账户余额不足，出图已失败并退款，请尽快充值`);
  return {
    success: false,
    error: QUOTA_USER_MESSAGE,
    errorKind: 'upstream_quota',
    httpStatus: status,
    detail: sanitizeError(errorText.slice(0, 300)),
    backend,
  };
}

const MODERATION_RE = /moderation|content[_ -]?policy|safety[_ -]?(?:system|violation)|sensitive|审核|违规|敏感/i;

/** 上游非 2xx：只对客户端给通用文案 + 状态码，原文脱敏后放 detail / 日志。 */
function httpFailure(backend: ImageBackend, status: number, errorText: string): BackendResult {
  const detail = sanitizeError(errorText.slice(0, 300));
  let errorKind: BackendErrorKind;
  let error: string;
  if (status === 402 || QUOTA_RE.test(errorText)) {
    return quotaFailure(backend, status, errorText);
  }
  if (status === 429) {
    errorKind = 'rate_limit';
    error = '出图服务繁忙，请求过于频繁（上游 429），请稍后重试';
  } else if (status >= 500) {
    errorKind = 'upstream_unavailable';
    error = `出图服务暂时不可用（上游 ${status}），请稍后重试`;
  } else if (status === 413) {
    errorKind = 'upstream_rejected';
    error = '参考图体积过大（上游 413），请换小一些的图片后重试';
  } else if (MODERATION_RE.test(errorText)) {
    errorKind = 'moderation';
    error = `图片或描述可能触发内容审核（上游 ${status}），请更换参考图后重试`;
  } else {
    errorKind = 'upstream_rejected';
    error = `出图服务拒绝了本次请求（上游 ${status}），请稍后重试`;
  }
  return { success: false, error, errorKind, httpStatus: status, detail, backend };
}

/** fetch 抛错 / 读 body 中断：通用文案，原文只进日志与 detail。 */
function networkFailure(backend: ImageBackend, err: unknown, timeoutSec: number): BackendResult {
  const msg = err instanceof Error ? err.message : '网络连接失败';
  const isTimeout = /abort|timeout/i.test(msg);
  return {
    success: false,
    error: `网络连接失败${isTimeout ? `（超时 ${timeoutSec}s）` : ''}，请稍后重试`,
    errorKind: isTimeout ? 'timeout' : 'network',
    detail: sanitizeError(msg).slice(0, 300),
    backend,
  };
}

function badResponse(backend: ImageBackend, error: string, detail?: string): BackendResult {
  return { success: false, error, errorKind: 'bad_response', detail: detail ? sanitizeError(detail).slice(0, 300) : undefined, backend };
}

type JsonRead =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; kind: 'read' | 'parse'; err: unknown };

/**
 * response.json() 一次读完；用异常类型区分「读 body 时被 abort / 断连」和「内容不是 JSON」。
 * （非 2xx 分支仍用 response.text() 读错误正文，那里需要原文做日志。）
 */
async function readJsonBody(response: Response): Promise<JsonRead> {
  try {
    return { ok: true, data: (await response.json()) as Record<string, unknown> | null };
  } catch (err) {
    const isParse = err instanceof SyntaxError || (err as { name?: string })?.name === 'SyntaxError';
    return { ok: false, kind: isParse ? 'parse' : 'read', err };
  }
}

function upstreamErrorCategory(error: unknown): string {
  const err = error as Error & { cause?: { code?: unknown }; code?: unknown };
  const message = err instanceof Error ? err.message : String(error);
  if (/abort|timeout/i.test(message)) return 'timeout';
  const code = err.cause?.code ?? err.code;
  if (typeof code === 'string' && code) return code;
  return err instanceof Error ? err.name : 'unknown';
}

function logUpstreamError(backend: ImageBackend, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[upstream-error] backend=${backend} category=${upstreamErrorCategory(error)} raw=${sanitizeError(message)}`);
}

// ═══════════════════════════════════════════════
// 顶层入口：优先用调用方指定的 backend，否则退回 env / 默认
// ═══════════════════════════════════════════════

export async function generateImage(
  input: BackendInput,
  backendOverride?: ImageBackend | string | null
): Promise<BackendResult> {
  const backend = normalizeBackend(backendOverride ?? null);
  const requiredKey = backend === 'openai'
    ? (OPENAI_PROVIDER === 'kie' ? readKieConfig(process.env).apiKey : OPENAI_API_KEY)
    : API_KEY;
  if (!requiredKey) {
    return { success: false, error: 'API Key 未配置', errorKind: 'config', backend };
  }
  const normalizedInput = await normalizeBackendReferenceImages(input);
  if (backend === 'openai') {
    return OPENAI_PROVIDER === 'kie' ? generateWithKie(normalizedInput) : generateWithOpenAI(normalizedInput);
  }
  return generateWithGemini(normalizedInput);
}

/** 参考图归一化并发度：sharp 吃 CPU + libuv 线程池，3 路足够把一组图的 4~6 张重复图压到最短。 */
const NORMALIZE_CONCURRENCY = 3;

/** 并发执行 fn，最多 limit 路同时在飞；结果顺序与 items 一致。 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function normalizeBackendReferenceImages(input: BackendInput): Promise<BackendInput> {
  // 把所有待归一化的图摊平成一条任务队列（跨类别共享同一个并发上限），再按原位置装回。
  // 单个任务内部失败会原样返回原图（见 normalizeReferenceImage），所以这里不会 reject。
  type Slot = { list: ImageInput[] | undefined; label: string };
  const slots: Record<'product' | 'model' | 'bg' | 'scene' | 'accessory', Slot> = {
    product: { list: input.productImages, label: 'product' },
    model: { list: input.modelRefImages, label: 'model' },
    bg: { list: input.bgRefImages, label: 'background' },
    scene: { list: input.sceneRefImages, label: input.sceneAsEditBase ? 'scene-base' : 'scene' },
    accessory: { list: input.accessoryImages, label: 'accessory' },
  };
  const jobs: Array<{ slot: keyof typeof slots | 'anchor'; index: number; img: ImageInput; label: string }> = [];
  for (const [slot, { list, label }] of Object.entries(slots) as Array<[keyof typeof slots, Slot]>) {
    (list ?? []).forEach((img, index) => jobs.push({ slot, index, img, label: `${label}[${index}]` }));
  }
  // anchor 一律归一化（沿用旧行为：不看 skipNormalization）
  if (input.anchorImage) {
    jobs.push({ slot: 'anchor', index: 0, img: input.anchorImage, label: 'anchor' });
  }

  const done = await mapWithConcurrency(jobs, NORMALIZE_CONCURRENCY, job =>
    job.slot !== 'anchor' && job.img.skipNormalization ? Promise.resolve(job.img) : normalizeReferenceImage(job.img, job.label));

  const rebuilt: Record<keyof typeof slots, ImageInput[]> = { product: [], model: [], bg: [], scene: [], accessory: [] };
  let anchorImage: ImageInput | undefined;
  jobs.forEach((job, i) => {
    if (job.slot === 'anchor') anchorImage = done[i];
    else rebuilt[job.slot][job.index] = done[i];
  });

  return {
    ...input,
    productImages: rebuilt.product,
    modelRefImages: input.modelRefImages ? rebuilt.model : undefined,
    bgRefImages: input.bgRefImages ? rebuilt.bg : undefined,
    sceneRefImages: input.sceneRefImages ? rebuilt.scene : undefined,
    accessoryImages: input.accessoryImages ? rebuilt.accessory : undefined,
    anchorImage,
    // Mask dimensions must match the first final image buffer exactly; never normalize it here.
    maskImage: input.maskImage,
  };
}

// ═══════════════════════════════════════════════
// Gemini 通道（保留现有行为）
// ═══════════════════════════════════════════════

async function generateWithGemini(input: BackendInput): Promise<BackendResult> {
  const model = input.promptPurpose === 'derived-anchor' ? DERIVED_ANCHOR_MODEL : GEMINI_MODEL;
  // 密钥走请求头 x-goog-api-key，不拼进 URL（URL 会随 fetch 异常、中转站日志外泄）。
  const url = `${APIYI_BASE}/v1beta/models/${model}:generateContent`;
  // 请求体（含全部参考图 base64）只序列化一次，重试直接复用同一个字符串
  const body = JSON.stringify({
    contents: [{ parts: buildGeminiParts(input) }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: { aspectRatio: input.aspectRatio, image_size: '2K' },
    },
  });
  return callGemini(model, url, body, 0);
}

async function callGemini(model: string, url: string, body: string, retryCount: number): Promise<BackendResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      cache: 'no-store',
      body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络连接失败';
    const isTimeout = /abort|timeout/i.test(msg);
    logUpstreamError('gemini', err);
    if (isTimeout && retryCount < MAX_RETRIES) {
      console.log(`[gemini] 超时重试 ${retryCount + 1}/${MAX_RETRIES}`);
      return callGemini(model, url, body, retryCount + 1);
    }
    return networkFailure('gemini', err, GEMINI_TIMEOUT_SEC);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.log(`[upstream-error] backend=gemini category=HTTP_${response.status} raw=${sanitizeError(errorText.slice(0, 300))}`);
    if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000));
      return callGemini(model, url, body, retryCount + 1);
    }
    return httpFailure('gemini', response.status, errorText);
  }

  // 读取响应体：连上后出图慢、读 body 时被同一个超时 signal abort，
  // 旧代码会把它当成「响应 JSON 解析失败」且不重试。这里按真实成因——超时——处理并重试一次。
  const read = await readJsonBody(response);
  if (!read.ok) {
    logUpstreamError('gemini', read.err);
    if (read.kind === 'parse') {
      return badResponse('gemini', '出图服务返回了无法解析的响应，请稍后重试', read.err instanceof Error ? read.err.message : '');
    }
    const msg = read.err instanceof Error ? read.err.message : '读取响应失败';
    if (/abort|timeout/i.test(msg) && retryCount < MAX_RETRIES) {
      console.log(`[gemini] 读取响应超时重试 ${retryCount + 1}/${MAX_RETRIES}`);
      return callGemini(model, url, body, retryCount + 1);
    }
    return networkFailure('gemini', read.err, GEMINI_TIMEOUT_SEC);
  }
  const data = read.data;

  const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates?.length) {
    return badResponse('gemini', 'Gemini 未返回结果（candidates 为空）');
  }
  const rawFinishReason = (candidates[0]?.finishReason as string) || '';
  // finishReason 是上游给的字符串：只接受枚举形态，避免把任意上游文本带进用户文案
  const finishReason = /^[A-Z_]{1,40}$/.test(rawFinishReason) ? rawFinishReason : (rawFinishReason ? 'UNKNOWN' : '');
  console.log(`[gemini] finishReason=${finishReason}`);

  if (finishReason === 'IMAGE_RECITATION') {
    return { success: false, error: '图片生成被拒绝（IMAGE_RECITATION）— 请更换参考图', errorKind: 'moderation', backend: 'gemini' };
  }
  if (finishReason === 'SAFETY') {
    return { success: false, error: '图片被安全策略过滤', errorKind: 'moderation', backend: 'gemini' };
  }

  const content = candidates[0]?.content as Record<string, unknown> | undefined;
  const resultParts = content?.parts as Array<Record<string, unknown>> | undefined;
  for (const part of resultParts || []) {
    const inlineData = (part.inlineData || part.inline_data) as Record<string, string> | undefined;
    if (inlineData?.data) {
      return { success: true, data: inlineData.data, backend: 'gemini', model };
    }
  }

  return badResponse('gemini', `生成结果中未找到图片数据（finishReason: ${finishReason}）`);
}

export function buildGeminiParts(input: BackendInput): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];

  // 组图模式：底图（场景参考图）必须排在最前，作为「要保留并编辑的底图」
  if (input.sceneAsEditBase && input.sceneRefImages?.length) {
    parts.push({ text: '\n\nScene-Base Image (tagged "scene-base" - use ONLY for pose, composition, crop, lighting, scene, expression, makeup, styling language, and photographic language; preserve those exactly, including every accessory worn by the person (headwear, sunglasses, jewelry, bag) and any face occlusion it causes, and the person\'s exact exposure/lighting. Its original clothing is NOT a garment design reference; only swap product garment and person identity):' });
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
  if (input.productImages.length) {
    parts.push({ text: '\n\nProduct Reference Images — the garment: style, cut, silhouette, tailoring, proportions, fabric, color, pattern, seams, closures. Nothing else in these frames applies:' });
    input.productImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  if (input.bgRefImages?.length) {
    parts.push({ text: '\n\nBackground Reference Images (use tones, filter, atmosphere, and lighting only; ignore any clothing or person as product/identity references):' });
    input.bgRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  if (!input.sceneAsEditBase && input.sceneRefImages?.length) {
    parts.push({ text: input.promptPurpose === 'derived-anchor'
      ? '\n\nScene Reference Image (use as the identity source for the same model; match her ethnicity, face shape, facial features, hair color, and hairstyle as directed by the prompt):'
      : '\n\nScene Reference Images (use spatial structure, pose/composition if relevant, lighting, filter, expression, makeup, and photographic language; clothing in these images is NOT a product design reference):' });
    input.sceneRefImages.forEach(img =>
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
    );
  }
  if (input.accessoryImages?.length) {
    parts.push({ text: '\n\nAccessory Reference Images — reproduce these items faithfully:' });
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

/**
 * GPT 通道的纯文生图分支（/v1/images/generations）。
 *
 * 为什么需要：本文件的 openai 通道原本只实现了图生图（/v1/images/edits），而 edits 端点
 * **必须带至少一张输入图**。0802 脸库改用 GPT Image 2 时踩到：候选脸是纯文生图、没有任何
 * 参考图，image[] 为空 → 302 直接返回 403 err_code:-10003「参数错误」。
 * 这也是当初派生锚肖像走 Gemini 而不走 GPT 的原因 —— 没人从 GPT 通道做过文生图。
 */
async function generateWithOpenAIText(input: BackendInput, retryCount = 0): Promise<BackendResult> {
  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        prompt: input.prompt,
        size: mapAspectToOpenAISize(input.aspectRatio),
        quality: normalizeGenerationQuality(input.quality),
        n: 1,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? OPENAI_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络连接失败';
    const isTimeout = /abort|timeout/i.test(msg);
    logUpstreamError('openai', err);
    // 与 edits 分支同口径：超时不重试（已等满整个窗口），仅瞬时网络错误重试一次
    if (!isTimeout && retryCount < MAX_RETRIES) {
      return generateWithOpenAIText(input, retryCount + 1);
    }
    const timeoutSec = Math.round((input.timeoutMs ?? OPENAI_TIMEOUT_MS) / 1000);
    return networkFailure('openai', err, timeoutSec);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.log(`[upstream-error] backend=openai category=HTTP_${response.status} raw=${sanitizeError(errorText.slice(0, 300))}`);
    if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000));
      return generateWithOpenAIText(input, retryCount + 1);
    }
    return httpFailure('openai', response.status, errorText);
  }

  const read = await readJsonBody(response);
  if (!read.ok) {
    logUpstreamError('openai', read.err);
    if (read.kind === 'parse') {
      return badResponse('openai', '出图服务返回了无法解析的响应，请稍后重试', read.err instanceof Error ? read.err.message : '');
    }
    const timeoutSec = Math.round((input.timeoutMs ?? OPENAI_TIMEOUT_MS) / 1000);
    return networkFailure('openai', read.err, timeoutSec);
  }
  const data = read.data;

  const items = data?.data as Array<{ b64_json?: string; url?: string }> | undefined;
  const b64 = items?.[0]?.b64_json;
  if (b64) return { success: true, data: b64, backend: 'openai', model: OPENAI_MODEL };

  // 兜底：部分中转返回 url 而不是 b64
  const imgUrl = items?.[0]?.url;
  if (imgUrl) {
    try {
      const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(60_000) });
      if (!imgRes.ok) {
        return { success: false, error: `获取图片 URL 失败 (HTTP ${imgRes.status})`, errorKind: 'download', httpStatus: imgRes.status, backend: 'openai' };
      }
      const contentType = imgRes.headers.get('content-type') || '';
      if (contentType && !contentType.startsWith('image/')) {
        console.log(`[upstream-error] backend=openai category=NON_IMAGE_URL content-type=${sanitizeError(contentType.slice(0, 50))}`);
        return { success: false, error: '图片 URL 返回了非图片内容，请稍后重试', errorKind: 'download', backend: 'openai' };
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { success: true, data: buf.toString('base64'), backend: 'openai', model: OPENAI_MODEL };
    } catch (err) {
      logUpstreamError('openai', err);
      return { success: false, error: '下载图片失败，请稍后重试', errorKind: 'download', detail: sanitizeError(err instanceof Error ? err.message : '').slice(0, 300), backend: 'openai' };
    }
  }

  return badResponse('openai', 'OpenAI 未返回图片数据');
}

type TaggedRef = { img: ImageInput; tag: string };

/** 收集送给 GPT 通道的参考图（顺序即 image[] / input_urls 顺序，上限 16 张）。302 与 kie 共用。 */
function collectReferenceImages(input: BackendInput): TaggedRef[] {
  const refImages: TaggedRef[] = [];
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
  return refImages.slice(0, 16);
}

/** 在 prompt 里给参考图分组打标，弥补 multipart / input_urls 不能传图标签的限制。 */
function buildTaggedReferencePrompt(input: BackendInput, limited: TaggedRef[]): string {
  const roleText = (tag: string, purpose: BackendInput['promptPurpose'] = 'compose') => {
    switch (tag) {
      case 'product':
        return 'product — the garment: style, cut, silhouette, tailoring, proportions, fabric, color, pattern, seams, closures. Nothing else in these frames applies.';
      case 'anchor':
        return purpose === 'faceswap'
          ? 'anchor — facial structure only. Not a source of skin tone, hair, body, lighting or styling.'
          : 'anchor — the ONLY identity reference for the same fictional model in this set.';
      case 'scene-base':
        return purpose === 'faceswap'
          ? 'scene-base — the photograph being edited. Only the masked face area changes; every other pixel is final.'
          : 'scene-base (pose/composition/crop/lighting/scene/expression/makeup/photographic language ONLY; preserve those exactly, including every accessory worn by the person (headwear, sunglasses, jewelry, bag) and any face occlusion it causes, and the person\'s exact exposure/lighting; original clothing is not a garment design reference)';
      case 'model':
        return 'model (hairstyle/makeup/mood/age feeling/expression style only; not garment or identity reference unless explicitly anchored)';
      case 'bg':
        return 'background (tones/filter/atmosphere/lighting only; ignore clothing/person)';
      case 'scene':
        return 'scene (spatial structure, lighting, filter, pose/composition, expression/makeup, photographic language; clothing is not product design)';
      case 'accessory':
        return 'accessory — reproduce this item faithfully where accessories sit in the scene-base.';
      default:
        return tag;
    }
  };
  return `${input.prompt}

Reference image roles (in order of upload):
${limited.map((r, i) => `  ${i + 1}. ${roleText(r.tag, input.promptPurpose)}`).join('\n')}`;
}

async function generateWithOpenAI(input: BackendInput, retryCount = 0): Promise<BackendResult> {
  const limited = collectReferenceImages(input);

  // 没有任何参考图 = 纯文生图。edits 端点要求至少一张输入图，走这里会被上游判参数错误
  // （0802 脸库实测 403 err_code:-10003），必须改走 generations。
  if (limited.length === 0) {
    return generateWithOpenAIText(input, retryCount);
  }

  const taggedPrompt = buildTaggedReferencePrompt(input, limited);

  // 参考图 base64 → Blob 只做一次：重试（网络抖动 / 503 / 429）复用同一批 Blob，
  // 不再为每次重试重新 Buffer.from + new Blob 拷贝几十 MB 的数据。
  // FormData 本身很轻（只挂 Blob 引用），每次尝试重新装配，避免依赖 FormData 是否可被多次读取。
  const imageParts = limited.map((r, i) => {
    const buffer = Buffer.from(r.img.data, 'base64');
    const ext = r.img.mimeType.split('/')[1] || 'png';
    return { blob: new Blob([buffer], { type: r.img.mimeType }), filename: `${r.tag}-${i}.${ext}` };
  });
  const maskPart = input.maskImage
    ? { blob: new Blob([Buffer.from(input.maskImage.data, 'base64')], { type: input.maskImage.mimeType || 'image/png' }), filename: 'face-mask.png' }
    : undefined;

  return postOpenAIEdits(input, taggedPrompt, imageParts, maskPart, retryCount);
}

interface OpenAIFilePart { blob: Blob; filename: string }

async function postOpenAIEdits(
  input: BackendInput,
  taggedPrompt: string,
  imageParts: OpenAIFilePart[],
  maskPart: OpenAIFilePart | undefined,
  retryCount: number,
): Promise<BackendResult> {
  const formData = new FormData();
  formData.append('model', OPENAI_MODEL);
  formData.append('prompt', taggedPrompt);
  formData.append('size', mapAspectToOpenAISize(input.aspectRatio));
  formData.append('quality', normalizeGenerationQuality(input.quality));
  formData.append('n', '1');
  imageParts.forEach(part => formData.append('image[]', part.blob, part.filename));
  if (maskPart) formData.append('mask', maskPart.blob, maskPart.filename);

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE}/v1/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: formData,
      signal: AbortSignal.timeout(input.timeoutMs ?? OPENAI_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络连接失败';
    const isTimeout = /abort|timeout/i.test(msg);
    logUpstreamError('openai', err);
    // 超时不重试：已经等满一整个超时窗口，上游多半是拥塞/令牌偏慢，
    // 再等一轮只会把用户的等待时间翻倍且大概率还是失败（让用户用「重试」按钮自行再试）。
    // 仅对非超时的网络错误（如连接重置/拒绝，通常是瞬时抖动）重试一次。
    if (!isTimeout && retryCount < MAX_RETRIES) {
      console.log(`[openai] 网络错误重试 ${retryCount + 1}/${MAX_RETRIES}`);
      return postOpenAIEdits(input, taggedPrompt, imageParts, maskPart, retryCount + 1);
    }
    const timeoutSec = Math.round((input.timeoutMs ?? OPENAI_TIMEOUT_MS) / 1000);
    return networkFailure('openai', err, timeoutSec);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.log(`[upstream-error] backend=openai category=HTTP_${response.status} raw=${sanitizeError(errorText.slice(0, 300))}`);
    if ((response.status === 503 || response.status === 429)
      && input.allowRetryOn5xx !== false
      && retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 3000));
      return postOpenAIEdits(input, taggedPrompt, imageParts, maskPart, retryCount + 1);
    }
    return httpFailure('openai', response.status, errorText);
  }

  // 读取响应体：读 body 时被超时 abort 不应误报成「JSON 解析失败」。
  // GPT 通道超时不自动重试（理由同 fetch catch），如实报超时即可。
  const read = await readJsonBody(response);
  if (!read.ok) {
    logUpstreamError('openai', read.err);
    if (read.kind === 'parse') {
      return badResponse('openai', '出图服务返回了无法解析的响应，请稍后重试', read.err instanceof Error ? read.err.message : '');
    }
    const timeoutSec = Math.round((input.timeoutMs ?? OPENAI_TIMEOUT_MS) / 1000);
    return networkFailure('openai', read.err, timeoutSec);
  }
  const data = read.data;

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
        return { success: false, error: `获取图片 URL 失败 (HTTP ${imgRes.status})`, errorKind: 'download', httpStatus: imgRes.status, backend: 'openai' };
      }
      const contentType = imgRes.headers.get('content-type') || '';
      if (contentType && !contentType.startsWith('image/')) {
        console.log(`[upstream-error] backend=openai category=NON_IMAGE_URL content-type=${sanitizeError(contentType.slice(0, 50))}`);
        return { success: false, error: '图片 URL 返回了非图片内容，请稍后重试', errorKind: 'download', backend: 'openai' };
      }
      const buf = await imgRes.arrayBuffer();
      if (buf.byteLength === 0) {
        return { success: false, error: '图片 URL 返回空内容', errorKind: 'download', backend: 'openai' };
      }
      const b64Fallback = Buffer.from(buf).toString('base64');
      return { success: true, data: b64Fallback, backend: 'openai', model: OPENAI_MODEL };
    } catch (err) {
      logUpstreamError('openai', err);
      return { success: false, error: '获取图片 URL 失败，请稍后重试', errorKind: 'download', detail: sanitizeError(err instanceof Error ? err.message : '').slice(0, 300), backend: 'openai' };
    }
  }

  return badResponse('openai', 'OpenAI 未返回 b64_json 或 url');
}

// ═══════════════════════════════════════════════
// kie.ai GPT-Image-2.5 Flare 通道（异步任务制，替代 302 的 gpt-image-2）
// ═══════════════════════════════════════════════

/** KieError → 现有错误分类（errorKind / httpStatus / detail）。原文只进脱敏后的 detail，不下发给用户。 */
function kieFailure(err: unknown, timeoutSec: number): BackendResult {
  if (!(err instanceof KieError)) return networkFailure('openai', err, timeoutSec);
  const raw = err.raw ?? err.message;
  const detail = sanitizeError(raw).slice(0, 300);
  switch (err.kind) {
    case 'config':
      return { success: false, error: 'API Key 未配置', errorKind: 'config', backend: 'openai' };
    case 'timeout':
      return { success: false, error: `网络连接失败（超时 ${timeoutSec}s），请稍后重试`, errorKind: 'timeout', detail, backend: 'openai' };
    case 'cancelled':
      return { success: false, error: '出图请求已取消', errorKind: 'network', detail: 'cancelled', backend: 'openai' };
    case 'network':
      return { success: false, error: '网络连接失败，请稍后重试', errorKind: 'network', detail, backend: 'openai' };
    case 'http':
      // 余额不足（402 / 余额字样）在 httpFailure 里统一识别
      return httpFailure('openai', err.status ?? 502, raw);
    case 'task_failed':
      if (QUOTA_RE.test(raw)) return quotaFailure('openai', undefined, raw);
      if (MODERATION_RE.test(raw)) {
        return { success: false, error: '图片或描述可能触发内容审核，请更换参考图后重试', errorKind: 'moderation', detail, backend: 'openai' };
      }
      return { success: false, error: '出图服务生成失败，请稍后重试', errorKind: 'upstream_rejected', detail, backend: 'openai' };
    case 'download':
      return { success: false, error: '下载图片失败，请稍后重试', errorKind: 'download', httpStatus: err.status, detail, backend: 'openai' };
    default:
      return badResponse('openai', '出图服务返回了无法解析的响应，请稍后重试', raw);
  }
}

async function generateWithKie(input: BackendInput): Promise<BackendResult> {
  const config = readKieConfig(process.env);
  const limited = collectReferenceImages(input);
  // 总预算 = 调用方给的（脸库 330s）或 kie 默认（300s），且绝不超过 GPT 通道服务端单张上限——
  // 客户端事件看门狗（400s）是按这个上限定的，kie 轮询不能把它顶穿。
  const budgetMs = Math.min(input.timeoutMs ?? KIE_DEFAULT_TIMEOUT_MS, OPENAI_TIMEOUT_MS);
  try {
    const run = await runKieImageTask({
      config,
      // 有参考图：沿用 302 edits 同款「参考图角色」标注；纯文生图：原样 prompt
      prompt: limited.length ? buildTaggedReferencePrompt(input, limited) : input.prompt,
      aspectRatio: input.aspectRatio,
      refs: limited.map(r => ({ data: r.img.data, mimeType: r.img.mimeType })),
      timeoutMs: budgetMs,
      signal: input.signal,
    });
    return { success: true, data: run.data, backend: 'openai', model: run.model };
  } catch (err) {
    logUpstreamError('openai', err);
    return kieFailure(err, Math.round(budgetMs / 1000));
  }
}
