/**
 * kie.ai GPT-Image-2.5 Flare 出图客户端（异步任务制）。
 *
 * 纯逻辑、不 import 任何项目模块（可被 node:test 直接加载）。流程：
 *   参考图 → 上传换公网 URL → createTask → 轮询 recordInfo → 下载结果图字节。
 *
 * 踩过的坑（来自 KIEIMG skill 的实测，别再踩一遍）：
 *  1. 所有请求必须带浏览器 User-Agent，否则 Cloudflare 回 403 error code 1010。
 *  2. 上传域名不是 api.kie.ai（文档写错了、404），真实地址是 kieai.redpandaai.co/api/file-base64-upload。
 *  3. aspect_ratio 实际必填；GPT-Image-2.5 的 27:16 / 16:27 / 9:8 / 8:9 只有 1K。
 *  4. recordInfo 的 resultJson 是 JSON 字符串，要二次 parse 才拿到 resultUrls。
 *  5. 结果图在临时 CDN（约 3 天失效），必须当场下载成字节，不能存 URL。
 *  6. createTask 是非幂等 POST 且没有 idempotency key：请求字节发出去之后不重试，避免重复建任务重复计费。
 *  7. 结果 CDN 不许带 Authorization（不把 key 泄给第三方域名）。
 */

type EnvLike = Record<string, string | undefined>;

export type OpenAIImageProvider = 'kie' | '302';
export type KieResolution = '1K' | '2K' | '4K';

export const KIE_DEFAULT_BASE_URL = 'https://api.kie.ai';
export const KIE_DEFAULT_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';
export const KIE_DEFAULT_MODEL_I2I = 'gpt-image-2-5-flare-image-to-image';
export const KIE_DEFAULT_MODEL_T2I = 'gpt-image-2-5-flare-text-to-image';
export const KIE_DEFAULT_RESOLUTION: KieResolution = '2K';
export const KIE_DEFAULT_POLL_INTERVAL_MS = 2_500;
/** kie 总预算默认值（上传 + 建任务 + 轮询 + 下载）。调用方会再与服务端单张上限取小。 */
export const KIE_DEFAULT_TIMEOUT_MS = 300_000;
export const KIE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const UPLOAD_CONCURRENCY = 4;
const MAX_CONSECUTIVE_POLL_ERRORS = 6;
const UPLOAD_REQUEST_MS = 60_000;
const CREATE_REQUEST_MS = 30_000;
const POLL_REQUEST_MS = 15_000;
const DOWNLOAD_REQUEST_MS = 60_000;
const RATE_LIMIT_RETRY_DELAY_MS = 3_000;
const PRE_SEND_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

// ───────────────────────── 通道选择与配置 ─────────────────────────

/**
 * GPT 通道的上游提供方：
 *  - OPENAI_IMAGE_PROVIDER 显式写 302 / kie 时照办；
 *  - 没写时：配了 KIE_API_KEY 就用 kie，否则 302（不配 KIE_API_KEY = 与改造前完全一致）。
 */
export function resolveOpenAIProvider(env: EnvLike = process.env): OpenAIImageProvider {
  const explicit = (env.OPENAI_IMAGE_PROVIDER || '').trim().toLowerCase();
  if (explicit === '302' || explicit === '302ai' || explicit === '302.ai') return '302';
  if (explicit === 'kie' || explicit === 'kie.ai' || explicit === 'kieai') return 'kie';
  return (env.KIE_API_KEY || '').trim() ? 'kie' : '302';
}

export interface KieConfig {
  apiKey: string;
  baseUrl: string;
  uploadUrl: string;
  modelI2I: string;
  modelT2I: string;
  resolution: KieResolution;
  pollIntervalMs: number;
}

function httpUrlOr(value: string | undefined, fallback: string): string {
  const v = (value || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : fallback;
}

/** 每次调用时读环境变量（不在模块加载时固化），便于测试与改配置后不必重载模块。 */
export function readKieConfig(env: EnvLike = process.env): KieConfig {
  const res = (env.KIE_IMAGE_RESOLUTION || '').trim().toUpperCase();
  const poll = Number(env.KIE_POLL_INTERVAL_MS);
  return {
    apiKey: (env.KIE_API_KEY || '').trim(),
    baseUrl: httpUrlOr(env.KIE_BASE_URL, KIE_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    uploadUrl: httpUrlOr(env.KIE_UPLOAD_URL, KIE_DEFAULT_UPLOAD_URL),
    modelI2I: (env.KIE_IMAGE_MODEL_I2I || '').trim() || KIE_DEFAULT_MODEL_I2I,
    modelT2I: (env.KIE_IMAGE_MODEL_T2I || '').trim() || KIE_DEFAULT_MODEL_T2I,
    resolution: res === '1K' || res === '2K' || res === '4K' ? res : KIE_DEFAULT_RESOLUTION,
    pollIntervalMs: Number.isFinite(poll) && poll >= 20 ? Math.min(poll, 30_000) : KIE_DEFAULT_POLL_INTERVAL_MS,
  };
}

// ───────────────────────── 比例映射 ─────────────────────────

/** 2K / 4K 都支持的画幅。 */
const KIE_RATIOS_ANY_RES: ReadonlyArray<readonly [string, number]> = [
  ['1:1', 1], ['3:2', 3 / 2], ['2:3', 2 / 3], ['4:3', 4 / 3], ['3:4', 3 / 4],
  ['16:9', 16 / 9], ['9:16', 9 / 16], ['21:9', 21 / 9],
];
/** 只有 1K 的画幅。 */
const KIE_RATIOS_1K_ONLY: ReadonlyArray<readonly [string, number]> = [
  ['27:16', 27 / 16], ['16:27', 16 / 27], ['9:8', 9 / 8], ['8:9', 8 / 9],
];

/**
 * 把项目的画幅（1:1 / 3:4 / 4:3 / 9:16 / 16:9 …）映射到 kie 允许值。
 * 精确命中直接用；否则取对数比例最接近的。resolution 不是 1K 时只在 2K 可用的画幅里选。
 */
export function mapAspectToKie(aspect: string | undefined, resolution: KieResolution): string {
  const raw = (aspect || '').trim();
  if (!raw || raw === 'auto') return 'auto';
  const candidates = resolution === '1K' ? [...KIE_RATIOS_ANY_RES, ...KIE_RATIOS_1K_ONLY] : KIE_RATIOS_ANY_RES;
  const exact = candidates.find(([name]) => name === raw);
  if (exact) return exact[0];
  const m = /^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/.exec(raw);
  if (!m) return 'auto';
  const ratio = Number(m[1]) / Number(m[2]);
  if (!(ratio > 0) || !Number.isFinite(ratio)) return 'auto';
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(Math.log(c[1] / ratio)) < Math.abs(Math.log(best[1] / ratio))) best = c;
  }
  return best[0];
}

// ───────────────────────── 错误 ─────────────────────────

export type KieErrorKind =
  | 'config' | 'timeout' | 'cancelled' | 'network'
  | 'http' | 'task_failed' | 'bad_response' | 'download';

export class KieError extends Error {
  kind: KieErrorKind;
  /** HTTP 状态码，或 kie 信封里的 code（kind === 'http' 时有）。 */
  status?: number;
  /** 上游原文（未脱敏！只能交给 sanitizeError 之后再入日志 / detail）。 */
  raw?: string;
  /** 底层网络错误码（ENOTFOUND 等），用来判断请求字节是否已发出。 */
  causeCode?: string;
  constructor(kind: KieErrorKind, message: string, extra?: { status?: number; raw?: string; causeCode?: string }) {
    super(message);
    this.name = 'KieError';
    this.kind = kind;
    this.status = extra?.status;
    this.raw = extra?.raw;
    this.causeCode = extra?.causeCode;
  }
}

// ───────────────────────── 请求底座 ─────────────────────────

interface Ctx {
  cfg: KieConfig;
  deadlineAt: number;
  signal?: AbortSignal;
}

function isAbortLike(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  return e?.name === 'AbortError' || e?.name === 'TimeoutError' || /abort|timeout/i.test(e?.message || '');
}

function errCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const c = e?.cause?.code ?? e?.code;
  return typeof c === 'string' ? c : '';
}

function throwIfStopped(ctx: Ctx): void {
  if (ctx.signal?.aborted) throw new KieError('cancelled', '请求已取消');
  if (Date.now() >= ctx.deadlineAt) throw new KieError('timeout', 'kie 总时限已到');
}

function classifyFetchError(err: unknown, ctx: Ctx): KieError {
  if (err instanceof KieError) return err;
  if (ctx.signal?.aborted) return new KieError('cancelled', '请求已取消');
  if (Date.now() >= ctx.deadlineAt - 50) return new KieError('timeout', 'kie 总时限已到');
  const msg = err instanceof Error ? err.message : '网络连接失败';
  return new KieError('network', isAbortLike(err) ? 'kie 单次请求超时' : msg, { raw: msg, causeCode: errCode(err) });
}

function sleep(ms: number, ctx: Ctx): Promise<void> {
  const wait = Math.max(0, Math.min(ms, ctx.deadlineAt - Date.now()));
  return new Promise((resolve, reject) => {
    if (ctx.signal?.aborted) return reject(new KieError('cancelled', '请求已取消'));
    const onAbort = () => { clearTimeout(timer); reject(new KieError('cancelled', '请求已取消')); };
    const timer = setTimeout(() => { ctx.signal?.removeEventListener('abort', onAbort); resolve(); }, wait);
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface RawResponse { status: number; text: string; bytes?: Uint8Array; contentType: string }

async function request(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  ctx: Ctx,
  perRequestMs: number,
  binary = false,
): Promise<RawResponse> {
  throwIfStopped(ctx);
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(perRequestMs, ctx.deadlineAt - Date.now())));
  const signal = ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;
  try {
    const res = await fetch(url, { ...init, signal, cache: 'no-store' });
    if (binary) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, text: '', bytes, contentType: res.headers.get('content-type') || '' };
    }
    return { status: res.status, text: await res.text(), contentType: res.headers.get('content-type') || '' };
  } catch (err) {
    throw classifyFetchError(err, ctx);
  }
}

function authHeaders(ctx: Ctx, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.cfg.apiKey}`,
    'User-Agent': KIE_USER_AGENT,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 拆 kie 信封 {code,msg,data}：HTTP 非 2xx 或 code != 200 都抛 kind=http（status 取 code 或 HTTP 状态）。 */
function unwrapEnvelope(res: RawResponse, what: string): Record<string, unknown> {
  const body = parseJson(res.text);
  if (res.status < 200 || res.status >= 300) {
    const code = typeof body?.code === 'number' ? (body.code as number) : res.status;
    throw new KieError('http', `${what} HTTP ${res.status}`, { status: code, raw: res.text.slice(0, 500) });
  }
  if (!body) throw new KieError('bad_response', `${what} 返回非 JSON`, { raw: res.text.slice(0, 300) });
  const code = body.code;
  if (typeof code === 'number' && code !== 200) {
    throw new KieError('http', `${what} code=${code}`, { status: code, raw: String(body.msg ?? '').slice(0, 500) || res.text.slice(0, 500) });
  }
  return body;
}

// ───────────────────────── 上传 / 建任务 / 轮询 / 下载 ─────────────────────────

export interface KieRefImage { data: string; mimeType: string }

function extOf(mimeType: string): string {
  const sub = (mimeType.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  return sub === 'jpg' ? 'jpeg' : sub || 'png';
}

function randomName(ext: string): string {
  return `${globalThis.crypto.randomUUID()}.${ext}`;
}

async function uploadOne(img: KieRefImage, ctx: Ctx): Promise<string> {
  // 文件名一律随机：同名文件在 kie 临时空间可能互相覆盖，会把别的用户的参考图串过来。
  const body = JSON.stringify({
    base64Data: `data:${img.mimeType};base64,${img.data}`,
    uploadPath: 'images/silkmomo',
    fileName: randomName(extOf(img.mimeType)),
  });
  let lastErr: KieError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await request(ctx.cfg.uploadUrl, { method: 'POST', headers: authHeaders(ctx, true), body }, ctx, UPLOAD_REQUEST_MS);
      const json = parseJson(res.text);
      if (res.status >= 500) throw new KieError('http', `上传 HTTP ${res.status}`, { status: res.status, raw: res.text.slice(0, 300) });
      if (res.status < 200 || res.status >= 300 || !json || (json.success !== true && json.code !== 200)) {
        const code = typeof json?.code === 'number' ? (json.code as number) : res.status;
        throw new KieError('http', `上传失败 code=${code}`, { status: code, raw: res.text.slice(0, 300) });
      }
      const url = (json.data as { downloadUrl?: unknown } | undefined)?.downloadUrl;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new KieError('bad_response', '上传响应缺少 downloadUrl', { raw: res.text.slice(0, 200) });
      }
      return url;
    } catch (err) {
      const e = err instanceof KieError ? err : classifyFetchError(err, ctx);
      lastErr = e;
      const transient = e.kind === 'network' || (e.kind === 'http' && (e.status ?? 0) >= 500);
      if (!transient || attempt === 1) break;
      await sleep(1_000, ctx);
    }
  }
  throw lastErr ?? new KieError('network', '上传失败');
}

/** 上传全部参考图，保持顺序；相同内容只传一次；并发 ≤ 4。 */
export async function uploadReferences(refs: readonly KieRefImage[], ctx: Ctx): Promise<string[]> {
  const unique = new Map<string, KieRefImage>();
  refs.forEach(r => { const k = `${r.mimeType}|${r.data}`; if (!unique.has(k)) unique.set(k, r); });
  const keys = [...unique.keys()];
  const urls = new Map<string, string>();
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (!failure) {
      const i = next++;
      if (i >= keys.length) return;
      try { urls.set(keys[i], await uploadOne(unique.get(keys[i]) as KieRefImage, ctx)); } catch (e) { failure = failure ?? e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, keys.length) }, worker));
  if (failure) throw failure;
  return refs.map(r => urls.get(`${r.mimeType}|${r.data}`) as string);
}

async function createTask(model: string, input: Record<string, unknown>, ctx: Ctx): Promise<string> {
  const body = JSON.stringify({ model, input });
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: RawResponse;
    try {
      res = await request(`${ctx.cfg.baseUrl}/api/v1/jobs/createTask`, { method: 'POST', headers: authHeaders(ctx, true), body }, ctx, CREATE_REQUEST_MS);
    } catch (err) {
      // 只有「请求字节还没发出去」（DNS / 连接阶段）才重试；其余可能已建单，绝不重投。
      if (attempt === 0 && err instanceof KieError && err.kind === 'network' && PRE_SEND_ERROR_CODES.has(err.causeCode || '')) {
        await sleep(1_000, ctx);
        continue;
      }
      throw err;
    }
    try {
      const env = unwrapEnvelope(res, '建任务');
      const taskId = (env.data as { taskId?: unknown } | undefined)?.taskId;
      if (typeof taskId !== 'string' || !taskId) throw new KieError('bad_response', '建任务响应缺少 taskId', { raw: res.text.slice(0, 200) });
      return taskId;
    } catch (err) {
      // 429 = 被限流拒收，没有建单，等 3 秒重试一次是安全的。
      if (attempt === 0 && err instanceof KieError && err.kind === 'http' && err.status === 429) {
        await sleep(RATE_LIMIT_RETRY_DELAY_MS, ctx);
        continue;
      }
      throw err;
    }
  }
  throw new KieError('network', '建任务失败');
}

/** resultJson 是 JSON 字符串，要二次 parse；兼容已经是对象的情况。 */
export function parseKieResultUrls(resultJson: unknown): string[] {
  let v: unknown = resultJson;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  const urls = (v as { resultUrls?: unknown } | null)?.resultUrls;
  return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)) : [];
}

async function pollTask(taskId: string, ctx: Ctx): Promise<{ urls: string[]; costTime?: number }> {
  let consecutiveErrors = 0;
  for (;;) {
    throwIfStopped(ctx);
    try {
      const res = await request(
        `${ctx.cfg.baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        { method: 'GET', headers: authHeaders(ctx) }, ctx, POLL_REQUEST_MS,
      );
      const env = unwrapEnvelope(res, '轮询');
      const d = (env.data ?? {}) as Record<string, unknown>;
      const state = String(d.state ?? '').toLowerCase();
      consecutiveErrors = 0;
      if (state === 'success') {
        const urls = parseKieResultUrls(d.resultJson);
        if (!urls.length) throw new KieError('bad_response', '任务成功但 resultJson 里没有图片地址', { raw: String(d.resultJson ?? '').slice(0, 200) });
        return { urls, costTime: typeof d.costTime === 'number' ? d.costTime : undefined };
      }
      if (state === 'fail') {
        throw new KieError('task_failed', 'kie 任务失败', { raw: `[${String(d.failCode ?? '')}] ${String(d.failMsg ?? '')}`.slice(0, 500) });
      }
    } catch (err) {
      const e = err instanceof KieError ? err : classifyFetchError(err, ctx);
      const transient = e.kind === 'network'
        || (e.kind === 'http' && (e.status === 429 || e.status === 422 || (e.status ?? 0) >= 500));
      if (!transient || ++consecutiveErrors > MAX_CONSECUTIVE_POLL_ERRORS) throw e;
    }
    await sleep(ctx.cfg.pollIntervalMs, ctx);
  }
}

function looksLikeImage(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return png || jpg || webp;
}

async function downloadImage(url: string, ctx: Ctx): Promise<string> {
  let lastErr: KieError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 结果 CDN 是第三方域名：只带 UA，不带 Authorization。
      const res = await request(url, { method: 'GET', headers: { 'User-Agent': KIE_USER_AGENT } }, ctx, DOWNLOAD_REQUEST_MS, true);
      if (res.status < 200 || res.status >= 300) {
        throw new KieError('download', `下载结果图 HTTP ${res.status}`, { status: res.status });
      }
      if (!res.bytes || !looksLikeImage(res.bytes)) {
        throw new KieError('download', '结果地址返回了非图片内容');
      }
      return Buffer.from(res.bytes).toString('base64');
    } catch (err) {
      const e = err instanceof KieError ? err : classifyFetchError(err, ctx);
      lastErr = e;
      const transient = e.kind === 'network' || (e.kind === 'download' && (e.status ?? 0) >= 500);
      if (!transient || attempt === 1) break;
      await sleep(1_000, ctx);
    }
  }
  throw lastErr ?? new KieError('download', '下载结果图失败');
}

// ───────────────────────── 入口 ─────────────────────────

export interface KieRunParams {
  config: KieConfig;
  prompt: string;
  /** 项目画幅（1:1 / 3:4 / 4:3 / 9:16 / 16:9），内部映射成 kie 允许值。 */
  aspectRatio: string;
  refs: readonly KieRefImage[];
  /** 总预算（上传 + 建任务 + 轮询 + 下载）。 */
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface KieRunResult {
  data: string; // base64 图片字节
  model: string;
  taskId: string;
  costTimeSec?: number;
}

export async function runKieImageTask(p: KieRunParams): Promise<KieRunResult> {
  const cfg = p.config;
  if (!cfg.apiKey) throw new KieError('config', 'KIE_API_KEY 未配置');
  const ctx: Ctx = { cfg, deadlineAt: Date.now() + p.timeoutMs, signal: p.signal };
  const model = p.refs.length ? cfg.modelI2I : cfg.modelT2I;
  const input: Record<string, unknown> = {
    prompt: p.prompt,
    aspect_ratio: mapAspectToKie(p.aspectRatio, cfg.resolution),
    resolution: cfg.resolution,
  };
  if (p.refs.length) input.input_urls = await uploadReferences(p.refs, ctx);
  const taskId = await createTask(model, input, ctx);
  console.log(`[kie] create ok taskId=${taskId} model=${model} refs=${p.refs.length} ratio=${String(input.aspect_ratio)} res=${cfg.resolution}`);
  const done = await pollTask(taskId, ctx);
  const data = await downloadImage(done.urls[0], ctx);
  console.log(`[kie] done taskId=${taskId} costTime=${done.costTime ?? '?'}s`);
  return { data, model, taskId, costTimeSec: done.costTime };
}
