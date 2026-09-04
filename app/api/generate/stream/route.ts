/**
 * POST /api/generate/stream
 * SSE 流式生图接口 — 解决 Server Action 超时卡死问题
 *
 * 事件类型：
 *   status  — 阶段状态（analyzing / generating）
 *   result  — 单张图生成成功（含 base64 data）
 *   error   — 单张图生成失败（含错误信息）
 *   done    — 全部完成
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { checkBalance, deductBalance, refundBalance } from '@/lib/billing';
import {
  getGenerationCostFen,
  getGenerationQualityLabel,
  normalizeGenerationQuality,
  type GenerationQuality,
} from '@/lib/billing-constants';
import {
  MODEL_FACE_SPECS,
  buildDerivedAnchorPortraitPrompt,
  buildModelFacePortraitPrompt,
  buildProductShotPrompt,
  buildSceneGroupPrompt,
  buildSceneShotPrompt,
} from '@/lib/api';
import { autoSaveBrandPreference } from '@/lib/brand-memory';
import { generateImage as generateBackendImage, normalizeBackend, resolveApiModel } from '@/lib/image-backends';
import { recordGeneration } from '@/lib/generation-record';
import { MODELS, BODY_TYPES, SKIN_TONES, PRODUCT_SHOTS, PRODUCT_OUTPUT_SIZES, SCENE_OUTPUT_SIZES, sizeToAspectRatio } from '@/lib/models';
import { normalizeGeneratedImage, shrinkAnchorForClient } from '@/lib/postprocess';
import { findPendingImageByIdempotencyKey, storePendingImage } from '@/lib/pending-image';
import { preparePendingDelivery } from '@/lib/pending-delivery-core';
import { createSseBackpressureObserver } from '@/lib/sse-backpressure';
import { getRandomFavoriteModelFace } from '@/lib/model-face-library';

const VALID_SHOT_INDEXES = new Set(PRODUCT_SHOTS.map(s => s.index));

// ═══ Route Segment Config ═══
// 禁止 Next.js 对此 route 的 fetch 做缓存/patch 干扰
export const fetchCache = 'force-no-store';
// GPT(gpt-image) 单张正常 150-235s（见 lib/image-backends OPENAI_TIMEOUT_MS=280s），
// 加上生成前的服装分析，单张就可能逼近 5 分钟；300s 会把正常的 GPT 单张/双张批次拦腰截断。
// 放宽到 800s 覆盖「分析 + 1-2 张 GPT」这一 GPT 的典型用法；更大批量仍建议用 Gemini。
// （Zeabur 自托管 next start 不强制 maxDuration，此处主要表意 + 兼容会强制的平台。）
export const maxDuration = 800;

// ═══════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════

interface ImageInput {
  data: string;
  mimeType: string;
}

interface GenerateStreamRequest {
  taskId: number;
  moduleType: 'product' | 'scene';
  productImages?: ImageInput[];
  productGroups?: Array<{ images?: ImageInput[]; label?: string; categories?: string[] }>;
  modelRefImages?: ImageInput[];
  bgRefImages?: ImageInput[];
  sceneRefImages?: ImageInput[];
  accessoryImages?: ImageInput[];
  modelId?: string;
  bodyType?: string;
  skinTone?: string;
  selectedShotIndexes?: number[];
  outputSize?: string;
  sceneOutputSize?: string;
  customWidth?: number;  // outputSize/sceneOutputSize 为 'custom' 时的实际宽高
  customHeight?: number;
  sceneHasModel?: boolean;
  sceneGroup?: boolean;               // 场景图·组图（换装）模式：N 张 lookbook → N 张换装图
  sceneGroupMode?: 'swap' | 'products'; // swap=N景1品；products=1景N品
  modelIdentityMode?: string;         // fresh=全新模特；follow_scene=贴近场景模特
  sceneGroupTargetIndexes?: number[]; // 组图只生成指定参考图序号（1-based；用于单张重做/补齐），不传=全部
  sceneGroupAnchor?: ImageInput;      // 重做/补齐时带上已有一张结果图作「新模特身份锚」，保证与全组同一新人
  sceneGroupGarmentCategories?: string[]; // 用户上传替换的主品品类（top/pants/dress…），点明换哪几件
  customPrompt?: string; // 用户文字描述的额外要求（如"模特表情更柔和"）
  // 服装分析结果由客户端在后续分块里带回来：swap 模式下每块都会重跑一次同一张产品图的
  // 分析（6 张图＝6 次上游调用，纯浪费时间和钱）。首块分析完通过 garment 事件下发，
  // 之后原样回传即可复用。
  engine?: 'gemini' | 'openai' | string; // 生图引擎：gemini / openai (gpt-image-2-all)
  quality?: GenerationQuality | string; // GPT 图像质量：low / medium / high（Gemini 忽略）
  // 客户端分块生成时,把首块「有模特」镜次的产出回传作为锚点,
  // 让后续分块的镜次仍复用同一个模特身份(跨请求保持模特一致性)。
  anchorImage?: ImageInput;
  garmentDescription?: string;
  anchorIsUserChosen?: boolean; // true=用户在脸库里挑的脸（新任务），false/缺省=单张重做回传的锚
  runId?: string; // 一次用户点击生成一个；同次自动补齐沿用，作为逐镜次扣费幂等域
}

// ═══ 入参防线：参考图数量 / 单图体积 / MIME 白名单 ═══
// 没有这些上限的话，已登录用户可以 POST 几百 MB JSON 整体进内存再放大转发上游
const MAX_IMAGE_BASE64_LENGTH = 11_000_000; // ≈ 8MB 二进制（前端压缩目标 800KB，留足余量）
const ALLOWED_IMAGE_MIME = /^image\/(jpeg|jpg|png|webp|gif|avif)$/i;
const IMAGE_SLOT_LIMITS: Array<{ key: 'productImages' | 'modelRefImages' | 'bgRefImages' | 'sceneRefImages' | 'accessoryImages'; label: string; max: number }> = [
  { key: 'productImages', label: '产品图', max: 8 },
  { key: 'modelRefImages', label: '模特参考图', max: 6 },
  { key: 'bgRefImages', label: '背景参考图', max: 6 },
  { key: 'sceneRefImages', label: '场景参考图', max: 20 },  // 组图 lookbook 上限（张数多会分批续跑）
  { key: 'accessoryImages', label: '配件参考图', max: 6 },
];

function validateImageInputs(body: GenerateStreamRequest): string | null {
  for (const { key, label, max } of IMAGE_SLOT_LIMITS) {
    const arr = body[key];
    if (arr === undefined || arr === null) continue;
    if (!Array.isArray(arr)) return `${label}格式非法`;
    if (arr.length > max) return `${label}最多 ${max} 张`;
    for (const img of arr) {
      if (!img || typeof img.data !== 'string' || !img.data) return `${label}数据非法`;
      if (img.data.length > MAX_IMAGE_BASE64_LENGTH) return `${label}单张超过大小上限`;
      if (typeof img.mimeType !== 'string' || !ALLOWED_IMAGE_MIME.test(img.mimeType)) {
        return `${label}类型不支持`;
      }
    }
  }
  return null;
}

interface CleanProductGroup {
  images: ImageInput[];
  label?: string;
  categories?: string[];
}

function validateAndCleanProductGroups(input: unknown): { groups: CleanProductGroup[]; error?: string } {
  if (!Array.isArray(input)) return { groups: [], error: '同景换品模式需要提供产品组' };
  if (input.length < 1 || input.length > 8) return { groups: [], error: '同景换品模式产品组需为 1-8 组' };

  const groups: CleanProductGroup[] = [];
  for (let groupIndex = 0; groupIndex < input.length; groupIndex++) {
    const raw = input[groupIndex] as { images?: unknown; label?: unknown; categories?: unknown };
    if (!raw || !Array.isArray(raw.images)) {
      return { groups: [], error: `产品组 ${groupIndex + 1} 格式非法` };
    }
    if (raw.images.length < 1 || raw.images.length > 4) {
      return { groups: [], error: `产品组 ${groupIndex + 1} 需上传 1-4 张产品图` };
    }

    const images: ImageInput[] = [];
    for (const img of raw.images as ImageInput[]) {
      if (!img || typeof img.data !== 'string' || !img.data) {
        return { groups: [], error: `产品组 ${groupIndex + 1} 图片数据非法` };
      }
      if (img.data.length > MAX_IMAGE_BASE64_LENGTH) {
        return { groups: [], error: `产品组 ${groupIndex + 1} 单张超过大小上限` };
      }
      if (typeof img.mimeType !== 'string' || !ALLOWED_IMAGE_MIME.test(img.mimeType)) {
        return { groups: [], error: `产品组 ${groupIndex + 1} 图片类型不支持` };
      }
      images.push({ data: img.data, mimeType: img.mimeType });
    }

    const label = typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim().slice(0, 40)
      : undefined;
    const categories = Array.isArray(raw.categories)
      ? raw.categories.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.trim().slice(0, 30)).slice(0, 6)
      : undefined;
    groups.push({ images, label, categories });
  }

  return { groups };
}

function validateOptionalAnchor(anchor: ImageInput | undefined, label: string): string | null {
  if (anchor === undefined) return null;
  if (!anchor || typeof anchor.data !== 'string' || !anchor.data
    || anchor.data.length > MAX_IMAGE_BASE64_LENGTH
    || typeof anchor.mimeType !== 'string' || !ALLOWED_IMAGE_MIME.test(anchor.mimeType)) {
    return `${label}数据非法`;
  }
  return null;
}

// ═══════════════════════════════════════
// SSE 辅助函数
// ═══════════════════════════════════════

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

type StreamPush = (type: string, data: unknown) => void;

function startPhaseBeat(push: StreamPush, phase: string, meta: Record<string, unknown>): () => void {
  const t0 = Date.now();
  const timer = setInterval(() => {
    push('status', {
      ...meta,
      phase: 'generating',
      heartbeat: true,
      message: `${phase}（已耗时 ${Math.round((Date.now() - t0) / 1000)}s）`,
    });
  }, 20_000);
  return () => clearInterval(timer);
}

async function withPhaseBeat<T>(
  push: StreamPush,
  phase: string,
  meta: Record<string, unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  const stop = startPhaseBeat(push, phase, meta);
  try {
    return await operation();
  } finally {
    stop();
  }
}

/**
 * 交付一张已生成的图。
 *
 * 优先走「交接缓冲」：落库拿到 id，SSE 上只推几十字节的 id，客户端再用普通 HTTP GET 取图。
 * 这样 SSE 上不再有 4~5MB 的单条 data: 行 —— 那正是 0731 客户「生成失败」的根因
 * （下载期间客户端解析不出完整事件，看门狗误判服务端卡死并掐断，图在下行路上丢掉）。
 *
 * fail-open：落库失败就退回原来的直推。宁可冒一次大行的风险，也不能让一张已经扣过费的图
 * 因为交接缓冲不可用而丢掉。
 */
async function deliverResult(
  push: StreamPush,
  userId: string,
  taskId: number,
  payload: {
    shotIndex: number;
    data: string;
    width: number;
    height: number;
    current: number;
    total: number;
    idempotencyKey?: string;
  },
): Promise<void> {
  const prepared = await preparePendingDelivery(storePendingImage, {
    kind: 'result',
    userId,
    taskId,
    shotIndex: payload.shotIndex,
    data: payload.data,
    mimeType: 'image/png',
    width: payload.width,
    height: payload.height,
    idempotencyKey: payload.idempotencyKey,
  });

  push('result', {
    shotIndex: payload.shotIndex,
    ...prepared.payload,
    width: payload.width,
    height: payload.height,
    current: payload.current,
    total: payload.total,
  });
}

async function deliverAnchor(
  push: StreamPush,
  userId: string,
  taskId: number,
  data: string,
  mimeType: string,
): Promise<void> {
  const prepared = await preparePendingDelivery(storePendingImage, {
    kind: 'anchor',
    userId,
    taskId,
    shotIndex: 0,
    data,
    mimeType,
    width: 0,
    height: 0,
  });
  push('anchor', prepared.payload);
}

const PAID_DELIVERY_RECOVERY_ERROR = '该镜次已付费，请刷新取回';

function generationIdempotencyKey(
  userId: string,
  taskId: number,
  shotIndex: number,
  runId: string | undefined,
): string | undefined {
  return runId ? `${userId}:${taskId}:${shotIndex}:${runId}` : undefined;
}

async function redeliverIdempotentResult(
  push: StreamPush,
  userId: string,
  idempotencyKey: string,
  meta: { shotIndex: number; current: number; total: number },
): Promise<boolean> {
  const pending = await findPendingImageByIdempotencyKey(userId, idempotencyKey);
  if (!pending) {
    push('error', { ...meta, message: PAID_DELIVERY_RECOVERY_ERROR, fatal: true });
    return false;
  }
  push('result', {
    ...meta,
    pendingId: pending.id,
    width: pending.width,
    height: pending.height,
  });
  return true;
}

// 旧版内联实现 callGeminiApi / buildParts 已删除。
// 实际生图调用全部走 lib/image-backends.ts 的 generateBackendImage（双 backend：gemini / openai）。

// ═══════════════════════════════════════
// POST 处理
// ═══════════════════════════════════════

export async function POST(req: NextRequest) {
  // 鉴权
  const auth = await getCurrentUser();
  if (!auth) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  let body: GenerateStreamRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: '请求体解析失败' }), { status: 400 });
  }

  const {
    taskId,
    moduleType,
    productImages: rawProductImages,
    productGroups: rawProductGroups,
    modelRefImages,
    bgRefImages,
    sceneRefImages,
    accessoryImages,
    modelId,
    bodyType,
    skinTone,
    selectedShotIndexes,
    outputSize,
    sceneOutputSize,
    customWidth,
    customHeight,
    sceneHasModel,
    sceneGroup,
    sceneGroupMode: rawSceneGroupMode,
    modelIdentityMode: rawModelIdentityMode,
    sceneGroupTargetIndexes,
    sceneGroupAnchor,
    sceneGroupGarmentCategories,
    garmentDescription: clientGarmentDescription,
    anchorIsUserChosen,
    runId: rawRunId,
    customPrompt,
    engine: rawEngine,
    quality: rawQuality,
    anchorImage: clientAnchorImage,
  } = body;

  const engine = normalizeBackend(rawEngine);
  const quality = normalizeGenerationQuality(rawQuality);
  const costFen = getGenerationCostFen(engine, quality);
  const qualityLabel = engine === 'openai' ? getGenerationQualityLabel(quality) : null;
  const chargeDescription = (label: string) => qualityLabel ? `${label}(${qualityLabel})` : label;
  const requestedApiModel = resolveApiModel(engine);
  const sceneGroupMode: 'swap' | 'products' = rawSceneGroupMode === 'products' ? 'products' : 'swap';
  const modelIdentityMode: 'fresh' | 'follow_scene' = rawModelIdentityMode === 'follow_scene' ? 'follow_scene' : 'fresh';
  const productImages = Array.isArray(rawProductImages) ? rawProductImages : [];
  const runId = typeof rawRunId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(rawRunId)
    ? rawRunId
    : undefined;
  if (rawRunId !== undefined && !runId) {
    return new Response(JSON.stringify({ error: 'runId 非法' }), { status: 400 });
  }

  // 截断防止滥用（DoS / token 浪费）
  const safeCustomPrompt = typeof customPrompt === 'string' && customPrompt.trim()
    ? customPrompt.trim().slice(0, 500)
    : undefined;

  const isSceneGroupProductsMode = moduleType === 'scene' && !!sceneGroup && sceneGroupMode === 'products';
  if (!isSceneGroupProductsMode && productImages.length === 0) {
    return new Response(JSON.stringify({ error: '产品图不能为空' }), { status: 400 });
  }

  const imageError = validateImageInputs(body);
  if (imageError) {
    return new Response(JSON.stringify({ error: imageError }), { status: 400 });
  }

  // 客户端锚点图(上一分块的产出)也要过同样的入参防线,避免超大/非法数据进内存
  const clientAnchorError = validateOptionalAnchor(clientAnchorImage, '锚点图');
  if (clientAnchorError) {
    return new Response(JSON.stringify({ error: clientAnchorError }), { status: 400 });
  }
  // 客户端回传的服装分析：限长防止被塞超长文本进 prompt
  const reusableGarmentDescription = typeof clientGarmentDescription === 'string'
    && clientGarmentDescription.trim()
    ? clientGarmentDescription.trim().slice(0, 2000)
    : '';
  const sceneGroupAnchorError = validateOptionalAnchor(sceneGroupAnchor, '组图锚点图');
  if (sceneGroupAnchorError) {
    return new Response(JSON.stringify({ error: sceneGroupAnchorError }), { status: 400 });
  }

  let cleanProductGroups: CleanProductGroup[] = [];
  if (isSceneGroupProductsMode) {
    if (!sceneRefImages || sceneRefImages.length !== 1) {
      return new Response(JSON.stringify({ error: '同景换品模式需要且只能上传 1 张场景参考图' }), { status: 400 });
    }
    const productGroupResult = validateAndCleanProductGroups(rawProductGroups);
    if (productGroupResult.error) {
      return new Response(JSON.stringify({ error: productGroupResult.error }), { status: 400 });
    }
    cleanProductGroups = productGroupResult.groups;
  }

  // 自定义尺寸：从请求里的实际宽高换算比例。
  // 'custom' 在 PRODUCT/SCENE_OUTPUT_SIZES 里硬编码为 3:4 占位，
  // 不换算的话用户选的横版/方版自定义尺寸会永远按 3:4 竖图生成。
  const customAspectRatio =
    typeof customWidth === 'number' && typeof customHeight === 'number' && customWidth > 0 && customHeight > 0
      ? sizeToAspectRatio(customWidth, customHeight)
      : undefined;

  // 选了「自定义尺寸」却没给合法宽高：旧逻辑会静默回退到占位 3:4，
  // 用户选的横版/方版自定义尺寸被当竖图生成且无任何报错。直接拦下。
  const wantsCustom =
    (moduleType === 'product' && outputSize === 'custom') ||
    (moduleType === 'scene' && sceneOutputSize === 'custom');
  if (wantsCustom && !customAspectRatio) {
    return new Response(JSON.stringify({ error: '自定义尺寸的宽高非法（需为大于 0 的数值）' }), { status: 400 });
  }

  if (moduleType === 'product' && selectedShotIndexes) {
    const valid = Array.isArray(selectedShotIndexes)
      && selectedShotIndexes.length > 0
      && selectedShotIndexes.every(i => Number.isInteger(i) && VALID_SHOT_INDEXES.has(i));
    if (!valid) {
      return new Response(JSON.stringify({ error: '镜次参数非法' }), { status: 400 });
    }
  }

  // ═══ SSE 流式响应 ═══
  // 客户端断开检测：req.signal 在请求被中断时触发 aborted
  // 配合 enqueue 抛错检测构成双重保险
  const stream = new ReadableStream({
    async start(controller) {
      // 用 closure 状态记录客户端是否已断开；循环每轮检查
      let clientClosed = false;
      const onAbort = () => { clientClosed = true; };
      req.signal.addEventListener('abort', onAbort);
      const observeBackpressure = createSseBackpressureObserver({
        thresholdMs: 30_000,
        log: data => console.warn('[sse-backpressure]', { taskId, ...data }),
      });

      const push = (type: string, data: unknown) => {
        if (clientClosed) return;
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(type, data)));
          observeBackpressure(controller.desiredSize);
        } catch {
          // controller 已关闭 / 客户端已断开
          clientClosed = true;
        }
      };

      // 心跳：每 25 秒发一次空注释，防止 nginx/CDN/中间代理超时关闭长连接
      // 同时是 enqueue 抛错的探测器
      const heartbeat = setInterval(() => {
        if (clientClosed) return;
        try {
          controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
          observeBackpressure(controller.desiredSize);
        } catch {
          clientClosed = true;
        }
      }, 25_000);
      const backpressureMonitor = setInterval(() => {
        if (!clientClosed) observeBackpressure(controller.desiredSize);
      }, 5_000);

      const startTime = Date.now();
      let successCount = 0;
      let failedCount = 0;

      try {
        // 解析配置
        const modelConfig = modelId ? MODELS.find(m => m.id === modelId) : undefined;
        const bodyTypeConfig = BODY_TYPES.find(b => b.id === (bodyType || 'standard'));
        const skinToneConfig = SKIN_TONES.find(s => s.id === (skinTone || 'light'));

        // ─── 产品图模块 ───
        if (moduleType === 'product') {
          const indexes = selectedShotIndexes ?? [1, 2, 3, 4, 9];
          const shotConfigs = PRODUCT_SHOTS.filter(s => indexes.includes(s.index));
          const total = shotConfigs.length;
          const outputSizeConfig = PRODUCT_OUTPUT_SIZES.find(s => s.id === outputSize) ?? PRODUCT_OUTPUT_SIZES[0];
          const aspectRatio = outputSize === 'custom' && customAspectRatio
            ? customAspectRatio
            : outputSizeConfig.aspectRatio;
          const declaredWidth = outputSize === 'custom' ? customWidth : outputSizeConfig.width;
          const declaredHeight = outputSize === 'custom' ? customHeight : outputSizeConfig.height;

          const preflightBalance = runId ? null : await checkBalance(auth.userId, costFen);
          if (preflightBalance && !preflightBalance.sufficient) {
            const errMsg = `余额不足（当前 ¥${(preflightBalance.balanceFen / 100).toFixed(2)}），已停止生成`;
            const firstShot = shotConfigs[0];
            push('error', {
              shotIndex: firstShot?.index ?? 0,
              current: 1,
              total,
              message: errMsg,
              fatal: true,
            });
            recordGeneration({
              userId: auth.userId, taskId, module: 'product', shotIndex: firstShot?.index ?? 0,
              promptText: '(skipped: balance insufficient)',
              modelId, bodyType, skinTone, aspectRatio,
              apiModel: requestedApiModel,
              success: false, apiLatencyMs: 0, errorMessage: errMsg,
            }).catch(err => console.error('[recordGeneration]', err));
            push('done', { successCount: 0, failedCount: total, totalSeconds: Math.round((Date.now() - startTime) / 1000) });
            controller.close();
            return;
          }

          // AI 服装分析（可选，失败不阻塞）
          let garmentDescription: string | undefined;
          push('status', { phase: 'analyzing', message: '正在分析服装特征...' });
          try {
            const { analyzeProductImage } = await import('@/lib/ai-assistant');
            const analysis = await withPhaseBeat(
              push,
              '正在分析服装特征',
              {},
              () => analyzeProductImage(productImages[0].data, productImages[0].mimeType),
            );
            if (analysis.description) {
              garmentDescription = analysis.description;
            }
          } catch {
            // 分析失败，沿用默认 prompt
          }

          // 首图锚定。客户端分块生成时会把首块的模特图作为 anchorImage 回传,
          // 这里用它做种子,后续分块的有模特镜次就沿用同一个模特身份(跨请求一致)。
          let anchorImage: ImageInput | undefined = clientAnchorImage;

          for (let i = 0; i < shotConfigs.length; i++) {
            // 客户端断开检测：用户关闭页面 / 切走，立刻停止后续 API 调用
            // 否则服务端会继续把所有镜次跑完，浪费 API 配额 + 上游 token
            if (clientClosed) {
              console.log(`[stream] 客户端已断开，提前终止生成（已完成 ${i}/${shotConfigs.length}）`);
              break;
            }

            const shot = shotConfigs[i];
            push('status', {
              phase: 'generating',
              current: i + 1,
              total,
              shotIndex: shot.index,
              message: `正在生成第 ${i + 1} 张（镜次 #${shot.index}）...`,
            });

            // 余额检查 + 扣费
            const chargeLabel = chargeDescription(`生成镜次 #${shot.index}`);
            const balance = runId ? null : await checkBalance(auth.userId, costFen);
            if (balance && !balance.sufficient) {
              const errMsg = `余额不足（当前 ¥${(balance.balanceFen / 100).toFixed(2)}），已停止生成`;
              push('error', {
                shotIndex: shot.index,
                current: i + 1,
                total,
                message: errMsg,
                fatal: true,
              });
              // 失败也要记录（admin 失败监控页才能完整反映用户侧失败）
              recordGeneration({
                userId: auth.userId, taskId, module: 'product', shotIndex: shot.index,
                promptText: '(skipped: balance insufficient)',
                modelId, bodyType, skinTone, aspectRatio,
                apiModel: requestedApiModel,
                success: false, apiLatencyMs: 0, errorMessage: errMsg,
              }).catch(err => console.error('[recordGeneration]', err));
              failedCount += total - i;
              break;
            }

            const idempotencyKey = generationIdempotencyKey(auth.userId, taskId, shot.index, runId);
            const deduction = await deductBalance(
              auth.userId,
              costFen,
              chargeLabel,
              taskId,
              requestedApiModel,
              idempotencyKey,
            );
            if (!deduction.success) {
              const errMsg = `扣费失败: ${deduction.error || '未知错误'}`;
              push('error', {
                shotIndex: shot.index,
                current: i + 1,
                total,
                message: errMsg,
                fatal: true,
              });
              recordGeneration({
                userId: auth.userId, taskId, module: 'product', shotIndex: shot.index,
                promptText: '(skipped: deduction failed)',
                modelId, bodyType, skinTone, aspectRatio,
                apiModel: requestedApiModel,
                success: false, apiLatencyMs: 0, errorMessage: errMsg,
              }).catch(err => console.error('[recordGeneration]', err));
              failedCount += total - i;
              break;
            }
            if (deduction.idempotent && idempotencyKey) {
              const reused = await redeliverIdempotentResult(push, auth.userId, idempotencyKey, {
                shotIndex: shot.index,
                current: i + 1,
                total,
              });
              if (!reused) {
                failedCount += total - i;
                break;
              }
              successCount++;
              continue;
            }

            // —— 从这里起，钱已扣；任何失败 / 异常 / 客户端断开都必须退款 ——
            // 用本地 try/catch 兜住 buildProductShotPrompt + generateBackendImage 的未捕获异常。
            let result: Awaited<ReturnType<typeof generateBackendImage>> | null = null;
            let resultWidth = 0;
            let resultHeight = 0;
            let shotLatency = 0;
            let prompt = '';
            try {
              prompt = buildProductShotPrompt({
                shot,
                productImages,
                modelConfig,
                bodyTypeConfig,
                skinToneConfig,
                modelRefImages,
                bgRefImages,
                accessoryImages,
                garmentDescription,
                customPrompt: safeCustomPrompt,
              });
              const shotStart = Date.now();
              result = await withPhaseBeat(
                push,
                `正在生成镜次 #${shot.index}`,
                { current: i + 1, total, shotIndex: shot.index },
                () => generateBackendImage({
                  prompt,
                  productImages,
                  modelRefImages,
                  bgRefImages,
                  accessoryImages,
                  // 无模特镜次（如面料特写）不能附 anchor：
                  // anchor 的指令是"使用完全相同的模特"，与 "Do NOT include any human figure" 直接打架
                  anchorImage: shot.hasModel ? anchorImage : undefined,
                  aspectRatio: aspectRatio as '1:1' | '3:4' | '4:3' | '9:16' | '16:9',
                  ...(engine === 'openai' ? { quality } : {}),
                }, engine),
              );
              shotLatency = Date.now() - shotStart;
              if (result.success && result.data) {
                const normalized = await normalizeGeneratedImage(result.data, declaredWidth, declaredHeight);
                result = { ...result, data: normalized.b64 };
                resultWidth = normalized.width;
                resultHeight = normalized.height;
              }
            } catch (innerErr) {
              const msg = innerErr instanceof Error ? innerErr.message : '生成异常';
              await refundBalance(auth.userId, costFen, `${chargeLabel} 异常退款`, taskId);
              recordGeneration({
                userId: auth.userId, taskId, module: 'product', shotIndex: shot.index,
                promptText: prompt || '(throw before prompt built)',
                modelId, bodyType, skinTone, aspectRatio,
                apiModel: requestedApiModel,
                success: false, apiLatencyMs: 0, errorMessage: msg,
              }).catch(err => console.error('[recordGeneration]', err));
              push('error', {
                shotIndex: shot.index, current: i + 1, total,
                message: `${msg}（已自动退款）`, fatal: false,
              });
              failedCount++;
              if (i === 0) {
                push('done', { successCount: 0, failedCount: total, totalSeconds: Math.round((Date.now() - startTime) / 1000), abortedEarly: true });
                controller.close();
                return;
              }
              continue;
            }
            // 用后端返回的真实模型名归因（独立令牌时 GPT 可能是 gpt-image-2 而非 gpt-image-2-all）
            const resultApiModel = result.model || resolveApiModel(result.backend);

            // 持久化生成记录到 Postgres（无论成败）—— 只记一条，反映最终交付结果。
            // 出图成功但客户端已断开属于「没交付」，记为失败（disconnect），否则同一镜次会
            // 既记一条 success 又记一条 disconnect 失败，污染成功率统计。
            const deliveredButDisconnected = result.success && !!result.data && clientClosed;
            recordGeneration({
              userId: auth.userId,
              taskId,
              module: 'product',
              shotIndex: shot.index,
              promptText: prompt,
              modelId,
              bodyType,
              skinTone,
              aspectRatio,
              apiModel: resultApiModel,
              success: result.success && !deliveredButDisconnected,
              apiLatencyMs: shotLatency,
              errorMessage: deliveredButDisconnected
                ? 'client disconnected before delivery'
                : (result.success ? undefined : result.error),
            }).catch(err => console.error('[recordGeneration] 失败:', err));

            if (result.success && result.data) {
              // 关键：生成成功但客户端已断开 → push 会被吞，IndexedDB 也写不进去 → 用户付了钱拿不到图。
              // 主动退款（记录已在上面记为 disconnect 失败，这里不再重复记）。
              if (clientClosed) {
                await refundBalance(auth.userId, costFen, `${chargeLabel} 客户端断开退款`, taskId);
                failedCount++;
                break;
              }
              // 锚定首张"有模特"的成功图（无模特的面料特写不能当模特身份锚点）
              if (!anchorImage && shot.hasModel) {
                anchorImage = { data: result.data, mimeType: 'image/png' };
              }
              await deliverResult(push, auth.userId, taskId, {
                shotIndex: shot.index,
                data: result.data,
                width: resultWidth,
                height: resultHeight,
                current: i + 1,
                total,
                idempotencyKey,
              });
              // 上面的闸门只挡住"推流前就已知的断开"。若断连是由 push 内 enqueue 抛错
              // 才暴露的（心跳 25s 一次，req.signal 未必先到），这里是唯一的感知时机——
              // 漏掉就会扣了钱、图没送到、还不退款。successCount 也必须等复查通过再加。
              if (clientClosed) {
                await refundBalance(auth.userId, costFen, `${chargeLabel} 投递失败退款`, taskId);
                failedCount++;
                break;
              }
              successCount++;
            } else {
              failedCount++;
              await refundBalance(
                auth.userId,
                costFen,
                `${chargeLabel} 失败退款`,
                taskId,
              );
              push('error', {
                shotIndex: shot.index,
                current: i + 1,
                total,
                message: `${result.error ?? '生成失败（未知原因）'}（已自动退款）`,
                fatal: false,
              });
              // 首张就失败，终止整个批次
              if (i === 0) {
                push('done', {
                  successCount: 0,
                  failedCount: total,
                  totalSeconds: Math.round((Date.now() - startTime) / 1000),
                  abortedEarly: true,
                });
                controller.close();
                return;
              }
            }
          }

        // ─── 场景图模块 ───
        } else {
          if (!sceneRefImages || sceneRefImages.length === 0) {
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: '场景图模块需要上传场景参考图',
              fatal: true,
            });
            push('done', { successCount: 0, failedCount: 1, totalSeconds: 0 });
            controller.close();
            return;
          }

          const outputSizeConfig = SCENE_OUTPUT_SIZES.find(s => s.id === sceneOutputSize) ?? SCENE_OUTPUT_SIZES[0];
          const aspectRatio = sceneOutputSize === 'custom' && customAspectRatio
            ? customAspectRatio
            : outputSizeConfig.aspectRatio;
          const declaredWidth = sceneOutputSize === 'custom' ? customWidth : outputSizeConfig.width;
          const declaredHeight = sceneOutputSize === 'custom' ? customHeight : outputSizeConfig.height;

          if (sceneGroup) {
            // ═══════════════════════════════════════════════════════════
            // 场景图·组图（换装）模式：N 张 lookbook 参考图 → N 张换装图
            // 每张：冻结该张场景+姿势，只换服装（用户主品）+ 换全新匿名模特。
            // 走 GPT edit（sceneAsEditBase）保留底图；逐张原子扣费/失败退款，
            // 每张独立（某张失败不整批中止）。shotIndex = 1-based 参考图序号。
            // ═══════════════════════════════════════════════════════════
            const sourceCount = sceneGroupMode === 'products' ? cleanProductGroups.length : sceneRefImages.length;
            // 目标序号（1-based）：swap=参考图序号；products=产品组序号。默认全部；单张重做/补齐时只跑指定序号
            const rawTargets = Array.isArray(sceneGroupTargetIndexes) && sceneGroupTargetIndexes.length > 0
              ? sceneGroupTargetIndexes
              : Array.from({ length: sourceCount }, (_, i) => i + 1);
            const targetIndexes = rawTargets.filter(t => Number.isInteger(t) && t >= 1 && t <= sourceCount);
            if (targetIndexes.length === 0) {
              push('error', { shotIndex: 0, current: 1, total: 1, message: sceneGroupMode === 'products' ? '产品组序号非法' : '组图参考图序号非法', fatal: true });
              push('done', { successCount: 0, failedCount: 1, totalSeconds: Math.round((Date.now() - startTime) / 1000) });
              controller.close();
              return;
            }
            const total = targetIndexes.length;

            const preflightBalance = runId ? null : await checkBalance(auth.userId, costFen);
            if (preflightBalance && !preflightBalance.sufficient) {
              const errMsg = `余额不足（当前 ¥${(preflightBalance.balanceFen / 100).toFixed(2)}），已停止生成`;
              const firstTarget = targetIndexes[0] ?? 0;
              push('error', { shotIndex: firstTarget, current: 1, total, message: errMsg, fatal: true });
              recordGeneration({
                userId: auth.userId, taskId, module: 'scene', shotIndex: firstTarget,
                promptText: '(skipped: balance insufficient)',
                modelId, bodyType, skinTone, aspectRatio,
                apiModel: requestedApiModel,
                success: false, apiLatencyMs: 0, errorMessage: errMsg,
              }).catch(err => console.error('[recordGeneration]', err));
              push('done', { successCount: 0, failedCount: total, totalSeconds: Math.round((Date.now() - startTime) / 1000) });
              controller.close();
              return;
            }

            const hasReplacementAccessory = !!(accessoryImages && accessoryImages.length > 0);
            // 一次成型：衣服参考 + 锚脸参考 + 场景底图一次出图。
            // 旧的 Pass2（face-swap-v2 + 本地椭圆合成 / GPT 小蒙版重画）已整体下线：
            // 局部合成必然在脸颊留接缝，七个批次补丁都没能根治；实测单遍带锚脸即可
            // 稳住身份，且脸与颈部肤色连续（离线量化 7.05，原图基准 6.06）。
            const shouldUseSceneGroupAnchor = modelIdentityMode === 'fresh' || modelIdentityMode === 'follow_scene';
            // 新模特身份锚：fresh 锁完整新人身份；follow_scene 锁派生脸部身份（肤色/发型/体型仍随场景底图）。
            // 重做/补齐时客户端会带上已有一张结果图作锚，使补的图与首批同一新人；
            // 首批全量生成时无锚，先创建一张不计费肖像卡；失败则回退为本批首张成功图充当。
            const requestHasSceneGroupAnchor = shouldUseSceneGroupAnchor && !!(
              sceneGroupAnchor && typeof sceneGroupAnchor.data === 'string'
              && sceneGroupAnchor.data && sceneGroupAnchor.data.length <= MAX_IMAGE_BASE64_LENGTH
            );
            let anchorImage: ImageInput | undefined =
              requestHasSceneGroupAnchor && sceneGroupAnchor
                ? { data: sceneGroupAnchor.data, mimeType: sceneGroupAnchor.mimeType || 'image/png' }
                : undefined;

            // fresh 新任务未显式选脸时，优先复用账号的御用脸。只在 fresh 分支读取脸库，
            // follow_scene 仍严格走场景派生锚，不会消费用户收藏的完整身份。
            if (modelIdentityMode === 'fresh' && !anchorImage && !clientClosed) {
              const favorite = await getRandomFavoriteModelFace(auth.userId);
              if (favorite) {
                anchorImage = { data: favorite.image, mimeType: favorite.mimeType };
                const anchorForClient = await shrinkAnchorForClient(favorite.image, favorite.mimeType);
                await deliverAnchor(push, auth.userId, taskId, anchorForClient.data, anchorForClient.mimeType);
              }
            }

            // swap 模式的产品图整批共用一份服装分析；products 模式每组在循环内单独分析。
            let sharedGarmentDescription: string | undefined;
            if (sceneGroupMode === 'swap' && reusableGarmentDescription) {
              // 客户端带回了首块的分析结果，直接复用，省掉一次上游视觉调用
              sharedGarmentDescription = reusableGarmentDescription;
              console.log('[sceneGroup] 复用客户端回传的服装分析，跳过本块分析');
            } else if (sceneGroupMode === 'swap') {
              push('status', { phase: 'analyzing', message: '正在分析服装特征...' });
              try {
                const { analyzeProductImage } = await import('@/lib/ai-assistant');
                // 必须带心跳：视觉分析是上游调用，慢起来会几十秒无事件，
                // 客户端事件看门狗只认 `data:` 行，注释行喂不到它（批次H 已踩过一次）。
                const analysis = await withPhaseBeat(
                  push,
                  '正在分析服装特征',
                  {},
                  // 把其余产品图一并送进这次分析：不增加上游调用，顺带判断混款
                  () => analyzeProductImage(
                    productImages[0].data,
                    productImages[0].mimeType,
                    productImages.slice(1).map(img => ({ data: img.data, mimeType: img.mimeType })),
                  ),
                );
                if (analysis.mixed) {
                  // 卖家把两件不同单品混在一次上传里，出图必然串味 —— 以前完全没有提示
                  console.log(`[sceneGroup] 检测到混款上传: ${analysis.mixedReason}`);
                  push('warning', { kind: 'mixed-garment', message: analysis.mixedReason });
                }
                if (analysis.description) {
                  sharedGarmentDescription = analysis.description;
                  // 下发给客户端，后续分块原样回传即可复用，不必每块重跑
                  push('garment', { description: analysis.description });
                }
                else console.log('[sceneGroup] 服装分析未返回描述，本轮 prompt 缺 garmentDescription（出图对衣服的还原会变差）');
              } catch (err) {
                // 不能静默：分析挂掉时 prompt 会少一整段服装描述，出图保真度下降而前端无感
                console.log('[sceneGroup] 服装分析异常，本轮 prompt 缺 garmentDescription:', err instanceof Error ? err.message : err);
              }
            }

            const sceneSkinToneCache = new Map<string, string | null>();
            const getSceneSkinTone = async (image: ImageInput | undefined): Promise<string | undefined> => {
              if (modelIdentityMode !== 'follow_scene' || !image || clientClosed) return undefined;
              const cacheKey = `${image.mimeType}:${image.data.length}:${image.data.slice(0, 96)}`;
              if (sceneSkinToneCache.has(cacheKey)) {
                return sceneSkinToneCache.get(cacheKey) ?? undefined;
              }

              try {
                const { analyzeFaceRegionAndSkin } = await import('@/lib/ai-assistant');
                const skinAnalysis = await analyzeFaceRegionAndSkin(image.data, image.mimeType);
                const skinTone = skinAnalysis?.skinTone || undefined;
                sceneSkinToneCache.set(cacheKey, skinTone ?? null);
                return skinTone;
              } catch {
                sceneSkinToneCache.set(cacheKey, null);
                return undefined;
              }
            };

            let derivedAnchorSkinTone: string | undefined;
            if (modelIdentityMode === 'follow_scene' && sceneRefImages[0] && !clientClosed && !anchorImage) {
              push('status', { phase: 'analyzing', message: '正在分析场景模特肤色...' });
              derivedAnchorSkinTone = await withPhaseBeat(
                push,
                '正在分析场景肤色',
                {},
                () => getSceneSkinTone(sceneRefImages[0]),
              );
            }

            if (shouldUseSceneGroupAnchor && !anchorImage && !clientClosed) {
              push('status', { phase: 'analyzing', message: '正在创建新模特身份锚...' });
              try {
                // 肖像卡是组图身份稳定性的基础设施调用，不向用户扣费；放在逐张扣费循环之前。
                // 没有御用脸时从同一份 3 亚欧混血 + 7 欧美配方随机取一项；族裔与脸型
                // 都由 buildModelFacePortraitPrompt 明写，不再交给底模自行猜测。
                let anchorPrompt: string;
                if (modelIdentityMode === 'follow_scene') {
                  anchorPrompt = buildDerivedAnchorPortraitPrompt(derivedAnchorSkinTone);
                } else {
                  const specIndex = Math.floor(Math.random() * MODEL_FACE_SPECS.length);
                  anchorPrompt = buildModelFacePortraitPrompt(MODEL_FACE_SPECS[specIndex]);
                }
                // 同样必须带心跳：Gemini 单次最长 120s，超时还会重试一次（≈243s），
                // 这整段此前只有一条起始 status，是全链路最大的一个「无事件真空窗」。
                const anchorResult = await withPhaseBeat(
                  push,
                  '正在创建新模特身份锚',
                  {},
                  () => generateBackendImage({
                    prompt: anchorPrompt,
                    productImages: [],
                    aspectRatio: '3:4',
                  }, 'gemini'),
                );
                if (anchorResult.success && anchorResult.data) {
                  anchorImage = { data: anchorResult.data, mimeType: 'image/png' };
                  // 推给客户端的那份先压小：客户端每张请求都要回传它，而服务端收到时
                  // 本来就会归一化成同样的 1434x1920 JPEG。原样推＝白下载一条 2.9MB 的
                  // 大 data: 行（0731 实测），客户端落地后还得再压一次。
                  const anchorForClient = await shrinkAnchorForClient(anchorResult.data, anchorImage.mimeType);
                  await deliverAnchor(push, auth.userId, taskId, anchorForClient.data, anchorForClient.mimeType);
                } else {
                  console.log('[sceneGroup] 肖像卡生成失败，回退首张成功图作锚:', anchorResult.error);
                }
              } catch (anchorErr) {
                console.log('[sceneGroup] 肖像卡生成异常，回退首张成功图作锚:', anchorErr instanceof Error ? anchorErr.message : anchorErr);
              }
            }

            for (let i = 0; i < targetIndexes.length; i++) {
              if (clientClosed) {
                console.log(`[stream] 客户端已断开，提前终止组图生成（已完成 ${i}/${total}）`);
                break;
              }
              const refSeq = targetIndexes[i];              // 1-based：swap=参考图序号；products=产品组序号
              const currentProductGroup = sceneGroupMode === 'products' ? cleanProductGroups[refSeq - 1] : undefined;
              const currentProductImages = currentProductGroup?.images ?? productImages;
              const currentProductLabel = currentProductGroup?.label;
              const currentGarmentCategories = currentProductGroup?.categories && currentProductGroup.categories.length > 0
                ? currentProductGroup.categories
                : (Array.isArray(sceneGroupGarmentCategories) ? sceneGroupGarmentCategories : undefined);
              const baseRef = sceneGroupMode === 'products' ? sceneRefImages[0] : sceneRefImages[refSeq - 1];

              let garmentDescription = sharedGarmentDescription;
              if (sceneGroupMode === 'products') {
                push('status', {
                  phase: 'analyzing',
                  current: i + 1,
                  total,
                  shotIndex: refSeq,
                  message: `正在分析产品组 #${refSeq} 的服装特征...`,
                });
                try {
                  const { analyzeProductImage } = await import('@/lib/ai-assistant');
                  const analysis = await withPhaseBeat(
                    push,
                    `正在分析产品组 #${refSeq} 的服装特征`,
                    { current: i + 1, total, shotIndex: refSeq },
                    () => analyzeProductImage(currentProductImages[0].data, currentProductImages[0].mimeType),
                  );
                  if (analysis.description) garmentDescription = analysis.description;
                  else console.log(`[sceneGroup] 产品组 #${refSeq} 服装分析未返回描述，prompt 缺 garmentDescription`);
                } catch (err) {
                  console.log(`[sceneGroup] 产品组 #${refSeq} 服装分析异常，prompt 缺 garmentDescription:`, err instanceof Error ? err.message : err);
                }
              }

              push('status', {
                phase: 'generating',
                current: i + 1,
                total,
                shotIndex: refSeq,
                message: sceneGroupMode === 'products'
                  ? `正在生成第 ${i + 1}/${total} 张同景换品（产品组 #${refSeq}）...`
                  : `正在生成第 ${i + 1}/${total} 张组图（参考图 #${refSeq}）...`,
              });

              const phaseMeta = { current: i + 1, total, shotIndex: refSeq };
              const balance = runId ? null : await withPhaseBeat(
                push,
                '正在核对余额',
                phaseMeta,
                () => checkBalance(auth.userId, costFen),
              );
              if (balance && !balance.sufficient) {
                const errMsg = `余额不足（当前 ¥${(balance.balanceFen / 100).toFixed(2)}），已停止生成`;
                push('error', { shotIndex: refSeq, current: i + 1, total, message: errMsg, fatal: true });
                recordGeneration({
                  userId: auth.userId, taskId, module: 'scene', shotIndex: refSeq,
                  promptText: '(skipped: balance insufficient)',
                  modelId, bodyType, skinTone, aspectRatio,
                  apiModel: requestedApiModel,
                  success: false, apiLatencyMs: 0, errorMessage: errMsg,
                }).catch(err => console.error('[recordGeneration]', err));
                failedCount += total - i;
                break;
              }

              const chargeLabel = chargeDescription(sceneGroupMode === 'products' ? `同景换品 #${refSeq}` : `组图换装 #${refSeq}`);
              const idempotencyKey = generationIdempotencyKey(auth.userId, taskId, refSeq, runId);
              const deduction = await withPhaseBeat(
                push,
                '正在核对余额',
                phaseMeta,
                () => deductBalance(auth.userId, costFen, chargeLabel, taskId, requestedApiModel, idempotencyKey),
              );
              if (!deduction.success) {
                const errMsg = `扣费失败: ${deduction.error || '未知错误'}`;
                push('error', { shotIndex: refSeq, current: i + 1, total, message: errMsg, fatal: true });
                recordGeneration({
                  userId: auth.userId, taskId, module: 'scene', shotIndex: refSeq,
                  promptText: '(skipped: deduction failed)',
                  modelId, bodyType, skinTone, aspectRatio,
                  apiModel: requestedApiModel,
                  success: false, apiLatencyMs: 0, errorMessage: errMsg,
                }).catch(err => console.error('[recordGeneration]', err));
                failedCount += total - i;
                break;
              }
              if (deduction.idempotent && idempotencyKey) {
                const reused = await redeliverIdempotentResult(push, auth.userId, idempotencyKey, {
                  shotIndex: refSeq,
                  current: i + 1,
                  total,
                });
                if (!reused) {
                  failedCount += total - i;
                  break;
                }
                successCount++;
                continue;
              }

              // —— 钱已扣：任何失败/异常/断开都必须退款 ——
              let result: Awaited<ReturnType<typeof generateBackendImage>> | null = null;
              let resultWidth = 0;
              let resultHeight = 0;
              let shotLatency = 0;
              let prompt = '';
              const timings = {
                t_generate: 0,
                t_encode: 0,
              };
              const logTimings = () => {
                console.log(`[timing] #${refSeq} ` + Object.entries(timings)
                  .map(([key, value]) => `${key}=${value}ms`)
                  .join(' '));
              };
              try {
                prompt = buildSceneGroupPrompt({
                  garmentDescription,
                  garmentCategories: currentGarmentCategories,
                  sceneGroupMode,
                  modelIdentityMode,
                  productLabel: currentProductLabel,
                  hasAnchor: shouldUseSceneGroupAnchor && !!anchorImage,
                  hasReplacementAccessory,
                  // 用户自己挑的脸不是「补齐已有组图」，不能套用重做口径的提示词
                  isRegeneration: requestHasSceneGroupAnchor && anchorIsUserChosen !== true,
                  customPrompt: safeCustomPrompt,
                });
                const shotStart = Date.now();
                const generateStart = Date.now();
                result = await withPhaseBeat(
                  push,
                  '正在生成场景换装',
                  phaseMeta,
                  () => generateBackendImage({
                    prompt,
                    productImages: currentProductImages,
                    sceneRefImages: [baseRef],
                    accessoryImages: hasReplacementAccessory ? accessoryImages : undefined,
                    anchorImage: shouldUseSceneGroupAnchor ? anchorImage : undefined,
                    sceneAsEditBase: true,
                    aspectRatio: aspectRatio as '1:1' | '3:4' | '4:3' | '9:16' | '16:9',
                    ...(engine === 'openai' ? { quality } : {}),
                  }, engine),
                );
                timings.t_generate = Date.now() - generateStart;

                shotLatency = Date.now() - shotStart;
                if (result.success && result.data) {
                  const encodeStart = Date.now();
                  const normalized = await normalizeGeneratedImage(result.data, declaredWidth, declaredHeight);
                  timings.t_encode = Date.now() - encodeStart;
                  result = { ...result, data: normalized.b64 };
                  resultWidth = normalized.width;
                  resultHeight = normalized.height;
                }
              } catch (innerErr) {
                const msg = innerErr instanceof Error ? innerErr.message : '生成异常';
                logTimings();
                await refundBalance(auth.userId, costFen, `${chargeLabel} 异常退款`, taskId);
                recordGeneration({
                  userId: auth.userId, taskId, module: 'scene', shotIndex: refSeq,
                  promptText: prompt || '(throw before prompt built)',
                  modelId, bodyType, skinTone, aspectRatio,
                  apiModel: requestedApiModel,
                  success: false, apiLatencyMs: 0, errorMessage: msg,
                }).catch(err => console.error('[recordGeneration]', err));
                push('error', { shotIndex: refSeq, current: i + 1, total, message: `${msg}（已自动退款）`, fatal: false });
                failedCount++;
                continue; // 组图每张独立，某张异常不整批中止
              }

              logTimings();
              const resultApiModel = result.model || resolveApiModel(result.backend);
              const deliveredButDisconnected = result.success && !!result.data && clientClosed;
              recordGeneration({
                userId: auth.userId, taskId, module: 'scene', shotIndex: refSeq,
                promptText: prompt,
                modelId, bodyType, skinTone, aspectRatio,
                apiModel: resultApiModel,
                success: result.success && !deliveredButDisconnected,
                apiLatencyMs: shotLatency,
                errorMessage: deliveredButDisconnected
                  ? 'client disconnected before delivery'
                  : (result.success ? undefined : result.error),
              }).catch(err => console.error('[recordGeneration] 失败:', err));

              if (result.success && result.data) {
                if (clientClosed) {
                  await refundBalance(auth.userId, costFen, `${chargeLabel} 客户端断开退款`, taskId);
                  failedCount++;
                  break;
                }
                if (shouldUseSceneGroupAnchor && !anchorImage) {
                  anchorImage = { data: result.data, mimeType: 'image/png' };
                }
                await deliverResult(push, auth.userId, taskId, {
                  shotIndex: refSeq,
                  data: result.data,
                  width: resultWidth,
                  height: resultHeight,
                  current: i + 1,
                  total,
                  idempotencyKey,
                });
                // 同产品图分支：push 内 enqueue 抛错是断连的唯一感知点，漏掉＝扣了钱不退款。
                if (clientClosed) {
                  await refundBalance(auth.userId, costFen, `${chargeLabel} 投递失败退款`, taskId);
                  failedCount++;
                  break;
                }
                successCount++;
              } else {
                failedCount++;
                await refundBalance(auth.userId, costFen, `${chargeLabel} 失败退款`, taskId);
                push('error', {
                  shotIndex: refSeq, current: i + 1, total,
                  message: `${result.error ?? '生成失败（未知原因）'}（已自动退款）`,
                  fatal: false,
                });
                // 组图每张独立：不整批中止，继续下一张
              }
            }
          } else {
          const preflightBalance = runId ? null : await checkBalance(auth.userId, costFen);
          if (preflightBalance && !preflightBalance.sufficient) {
            const errMsg = `余额不足（当前 ¥${(preflightBalance.balanceFen / 100).toFixed(2)}）`;
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: errMsg,
              fatal: true,
            });
            recordGeneration({
              userId: auth.userId, taskId, module: 'scene',
              promptText: '(skipped: balance insufficient)',
              modelId, bodyType, skinTone, aspectRatio,
              apiModel: requestedApiModel,
              success: false, apiLatencyMs: 0, errorMessage: errMsg,
            }).catch(err => console.error('[recordGeneration]', err));
            push('done', { successCount: 0, failedCount: 1, totalSeconds: 0 });
            controller.close();
            return;
          }

          // AI 服装分析放在扣费之前：分析上游挂起/失败时钱还没扣，
          // 不会出现"已扣费却卡在分析阶段"的资金悬置窗口（与产品图分支顺序一致）
          let garmentDescription: string | undefined;
          push('status', { phase: 'analyzing', message: '正在分析服装特征...' });
          try {
            const { analyzeProductImage } = await import('@/lib/ai-assistant');
            const analysis = await withPhaseBeat(
              push,
              '正在分析服装特征',
              {},
              () => analyzeProductImage(productImages[0].data, productImages[0].mimeType),
            );
            if (analysis.description) garmentDescription = analysis.description;
            else console.log('[scene] 服装分析未返回描述，本次 prompt 缺 garmentDescription（出图对衣服的还原会变差）');
          } catch (err) {
            console.log('[scene] 服装分析异常，本次 prompt 缺 garmentDescription:', err instanceof Error ? err.message : err);
          }

          push('status', { phase: 'generating', current: 1, total: 1, shotIndex: 0, message: '正在生成场景图...' });

          // 余额 + 扣费
          const chargeLabel = chargeDescription('场景图生成');
          const balance = runId ? null : await checkBalance(auth.userId, costFen);
          if (balance && !balance.sufficient) {
            const errMsg = `余额不足（当前 ¥${(balance.balanceFen / 100).toFixed(2)}）`;
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: errMsg,
              fatal: true,
            });
            recordGeneration({
              userId: auth.userId, taskId, module: 'scene',
              promptText: '(skipped: balance insufficient)',
              modelId, bodyType, skinTone, aspectRatio,
              apiModel: requestedApiModel,
              success: false, apiLatencyMs: 0, errorMessage: errMsg,
            }).catch(err => console.error('[recordGeneration]', err));
            push('done', { successCount: 0, failedCount: 1, totalSeconds: 0 });
            controller.close();
            return;
          }

          const idempotencyKey = generationIdempotencyKey(auth.userId, taskId, 0, runId);
          const sceneDeduction = await deductBalance(
            auth.userId,
            costFen,
            chargeLabel,
            taskId,
            requestedApiModel,
            idempotencyKey,
          );
          if (!sceneDeduction.success) {
            const errMsg = `扣费失败: ${sceneDeduction.error || '未知错误'}`;
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: errMsg,
              fatal: true,
            });
            recordGeneration({
              userId: auth.userId, taskId, module: 'scene',
              promptText: '(skipped: deduction failed)',
              modelId, bodyType, skinTone, aspectRatio,
              apiModel: requestedApiModel,
              success: false, apiLatencyMs: 0, errorMessage: errMsg,
            }).catch(err => console.error('[recordGeneration]', err));
            push('done', { successCount: 0, failedCount: 1, totalSeconds: 0 });
            controller.close();
            return;
          }
          if (sceneDeduction.idempotent && idempotencyKey) {
            const reused = await redeliverIdempotentResult(push, auth.userId, idempotencyKey, {
              shotIndex: 0,
              current: 1,
              total: 1,
            });
            push('done', {
              successCount: reused ? 1 : 0,
              failedCount: reused ? 0 : 1,
              totalSeconds: Math.round((Date.now() - startTime) / 1000),
            });
            controller.close();
            return;
          }

          const modelConfig = modelId ? MODELS.find(m => m.id === modelId) : undefined;
          const bodyTypeConfig = BODY_TYPES.find(b => b.id === (bodyType || 'standard'));
          const skinToneConfig = SKIN_TONES.find(s => s.id === (skinTone || 'light'));

          // 钱已扣 — 任何 prompt 构建或后端调用异常都必须退款
          let prompt = '';
          let result: Awaited<ReturnType<typeof generateBackendImage>>;
          let resultWidth = 0;
          let resultHeight = 0;
          let sceneShotLatency = 0;
          try {
            prompt = buildSceneShotPrompt({
              productImages,
              sceneRefImages,
              modelConfig,
              bodyTypeConfig,
              skinToneConfig,
              modelRefImages,
              accessoryImages,
              hasModel: sceneHasModel !== false,
              garmentDescription,
              customPrompt: safeCustomPrompt,
            });
            const sceneShotStart = Date.now();
            result = await withPhaseBeat(
              push,
              '正在生成场景图',
              { current: 1, total: 1, shotIndex: 0 },
              () => generateBackendImage({
                prompt,
                productImages,
                modelRefImages,
                sceneRefImages,
                accessoryImages,
                aspectRatio: aspectRatio as '1:1' | '3:4' | '4:3' | '9:16' | '16:9',
                ...(engine === 'openai' ? { quality } : {}),
              }, engine),
            );
            sceneShotLatency = Date.now() - sceneShotStart;
            if (result.success && result.data) {
              const normalized = await normalizeGeneratedImage(result.data, declaredWidth, declaredHeight);
              result = { ...result, data: normalized.b64 };
              resultWidth = normalized.width;
              resultHeight = normalized.height;
            }
          } catch (innerErr) {
            const msg = innerErr instanceof Error ? innerErr.message : '生成异常';
            await refundBalance(auth.userId, costFen, `${chargeLabel} 异常退款`, taskId);
            recordGeneration({
              userId: auth.userId, taskId, module: 'scene',
              promptText: prompt || '(throw before prompt built)',
              modelId, bodyType, skinTone, aspectRatio,
              apiModel: requestedApiModel,
              success: false, apiLatencyMs: 0, errorMessage: msg,
            }).catch(err => console.error('[recordGeneration]', err));
            push('error', { shotIndex: 0, current: 1, total: 1, message: `${msg}（已自动退款）`, fatal: true });
            push('done', { successCount: 0, failedCount: 1, totalSeconds: Math.round((Date.now() - startTime) / 1000) });
            controller.close();
            return;
          }
          const sceneApiModel = result.model || resolveApiModel(result.backend);

          // 持久化生成记录到 Postgres —— 只记一条，反映最终交付结果（理由同产品图分支）
          const sceneDeliveredButDisconnected = result.success && !!result.data && clientClosed;
          recordGeneration({
            userId: auth.userId,
            taskId,
            module: 'scene',
            promptText: prompt,
            modelId,
            bodyType,
            skinTone,
            aspectRatio,
            apiModel: sceneApiModel,
            success: result.success && !sceneDeliveredButDisconnected,
            apiLatencyMs: sceneShotLatency,
            errorMessage: sceneDeliveredButDisconnected
              ? 'client disconnected before delivery'
              : (result.success ? undefined : result.error),
          }).catch(err => console.error('[recordGeneration] 失败:', err));

          if (result.success && result.data) {
            // 客户端已断开 → push 会被吞 → 用户付了钱拿不到图。主动退款（记录已在上面记为 disconnect 失败）。
            if (clientClosed) {
              await refundBalance(auth.userId, costFen, `${chargeLabel} 客户端断开退款`, taskId);
              failedCount = 1;
            } else {
              await deliverResult(push, auth.userId, taskId, {
                shotIndex: 0,
                data: result.data,
                width: resultWidth,
                height: resultHeight,
                current: 1,
                total: 1,
                idempotencyKey,
              });
              // 同产品图分支：push 内 enqueue 抛错是断连的唯一感知点，漏掉＝扣了钱不退款。
              if (clientClosed) {
                await refundBalance(auth.userId, costFen, `${chargeLabel} 投递失败退款`, taskId);
                failedCount = 1;
              } else {
                successCount = 1;
              }
            }
          } else {
            failedCount = 1;
            await refundBalance(
              auth.userId,
              costFen,
              `${chargeLabel} 失败退款`,
              taskId,
            );
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: `${result.error ?? '生成失败'}（已自动退款）`,
              fatal: true,
            });
          }
          } // end 单张场景图 else
        }

        // 静默学习品牌偏好：至少 1 张成功就记住这次的 模特/体型/肤色/模块/引擎
        if (successCount > 0) {
          autoSaveBrandPreference(auth.userId, {
            modelId: modelId || undefined,
            bodyType: bodyType || undefined,
            skinTone: skinTone || undefined,
            module: moduleType,
            engine,
          }).catch(() => {});
        }

        push('done', {
          successCount,
          failedCount,
          totalSeconds: Math.round((Date.now() - startTime) / 1000),
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : '服务器内部错误';
        // 走到这里说明所有 inner try/catch 都没接住的"框架级"异常（如 push 抛错、modelConfig 查找失败、
        // analyzeProductImage 之外的 setup 错误等）。钱在每个扣费点的 inner try/catch 都已经处理过，
        // 这里只补一行 recordGeneration 让 admin 失败监控可以看到。
        recordGeneration({
          userId: auth.userId, taskId, module: moduleType,
          promptText: '(uncaught fatal error in stream)',
          modelId, bodyType, skinTone, aspectRatio: 'unknown',
          apiModel: requestedApiModel,
          success: false, apiLatencyMs: 0, errorMessage: msg,
        }).catch(e => console.error('[recordGeneration]', e));
        push('error', { shotIndex: -1, current: 0, total: 0, message: msg, fatal: true });
        push('done', { successCount, failedCount: failedCount + 1, totalSeconds: Math.round((Date.now() - startTime) / 1000) });
      } finally {
        clearInterval(heartbeat);
        clearInterval(backpressureMonitor);
        req.signal.removeEventListener('abort', onAbort);
        try { controller.close(); } catch { /* 已 close */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', // 禁止 nginx 缓冲
      Connection: 'keep-alive',
    },
  });
}
