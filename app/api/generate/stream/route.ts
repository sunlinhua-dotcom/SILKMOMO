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
import { checkBalance, deductBalance } from '@/lib/billing';
import { buildProductShotPrompt, buildSceneShotPrompt } from '@/lib/api';
import { MODELS, BODY_TYPES, SKIN_TONES, PRODUCT_SHOTS, PRODUCT_OUTPUT_SIZES, SCENE_OUTPUT_SIZES } from '@/lib/models';

// ═══ Route Segment Config ═══
// 禁止 Next.js 对此 route 的 fetch 做缓存/patch 干扰
export const fetchCache = 'force-no-store';
export const maxDuration = 300; // 最长 5 分钟

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
  productImages: ImageInput[];
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
}

// ═══════════════════════════════════════
// SSE 辅助函数
// ═══════════════════════════════════════

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ═══════════════════════════════════════
// API 配置
// ═══════════════════════════════════════

const API_CONFIG = {
  baseUrl: 'https://api.apiyi.com/v1beta',
  model: 'gemini-3.1-flash-image-preview',
  apiKey: process.env.GEMINI_API_KEY || '',
};

// ═══════════════════════════════════════
// 调用 Gemini API 生成单张图片
// ═══════════════════════════════════════

async function callGeminiApi(
  parts: Array<Record<string, unknown>>,
  aspectRatio: string,
  retryCount = 0
): Promise<{ success: boolean; data?: string; error?: string }> {
  if (!API_CONFIG.apiKey) {
    return { success: false, error: 'API Key 未配置' };
  }

  const url = `${API_CONFIG.baseUrl}/models/${API_CONFIG.model}:generateContent?key=${API_CONFIG.apiKey}`;
  const MAX_RETRIES = 1; // 失败后自动重试 1 次

  let response: Response;
  try {
    // 使用原生 fetch 并禁用 Next.js cache 避免大响应体干扰
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000), // 单张图 120 秒超时
      cache: 'no-store',
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: {
            aspectRatio,
            image_size: '2K',
          },
        },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络连接失败';
    const isTimeout = msg.includes('abort') || msg.includes('timeout') || msg.includes('TimeoutError');
    if (isTimeout && retryCount < MAX_RETRIES) {
      console.log(`[生图API] 超时，自动重试 (${retryCount + 1}/${MAX_RETRIES})...`);
      return callGeminiApi(parts, aspectRatio, retryCount + 1);
    }
    return { success: false, error: `网络连接失败${isTimeout ? '（超时 120s）' : ''}: ${msg}` };
  }

  if (!response.ok) {
    let errorText = '';
    try { errorText = await response.text(); } catch { /* ignore */ }
    // 503/429 自动重试
    if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
      console.log(`[生图API] HTTP ${response.status}，自动重试 (${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, 3000)); // 等 3 秒再重试
      return callGeminiApi(parts, aspectRatio, retryCount + 1);
    }
    return {
      success: false,
      error: `API 请求失败 (${response.status}): ${errorText.substring(0, 300)}`,
    };
  }

  // 先读 text 再解析 JSON（避免大响应流式读取失败时丢失调试信息）
  let responseText: string;
  try {
    responseText = await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    console.error('[生图API] 读取响应体失败:', msg);
    if (retryCount < MAX_RETRIES) {
      console.log(`[生图API] 响应体读取失败，自动重试...`);
      return callGeminiApi(parts, aspectRatio, retryCount + 1);
    }
    return { success: false, error: `响应体读取失败: ${msg}` };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error('[生图API] JSON 解析失败，响应前 500 字符:', responseText.substring(0, 500));
    return { success: false, error: `响应 JSON 解析失败（响应长度: ${responseText.length}，前100字: ${responseText.substring(0, 100)}）` };
  }

  const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates || candidates.length === 0) {
    console.error('[生图API] candidates 为空，完整响应:', JSON.stringify(data).substring(0, 500));
    return { success: false, error: 'API 未返回生成结果（candidates 为空）' };
  }

  const finishReason = (candidates[0]?.finishReason as string) || '';
  const finishMessage = (candidates[0]?.finishMessage as string) || '';
  console.log(`[生图API] finishReason=${finishReason}, finishMessage=${finishMessage.substring(0, 100)}`);

  // IMAGE_RECITATION: Gemini 拒绝生成（常因参考图与训练数据冲突）
  if (finishReason === 'IMAGE_RECITATION') {
    return { success: false, error: '图片生成被拒绝（IMAGE_RECITATION）— 请更换参考图或调整参数后重试' };
  }

  const content = candidates[0]?.content as Record<string, unknown> | undefined;
  const resultParts = content?.parts as Array<Record<string, unknown>> | undefined;
  if (!resultParts || resultParts.length === 0) {
    console.error('[生图API] parts 为空，candidate:', JSON.stringify(candidates[0]).substring(0, 300));
    return { success: false, error: `返回内容为空（finishReason: ${finishReason}${finishMessage ? ', ' + finishMessage.substring(0, 100) : ''}）` };
  }

  for (const part of resultParts) {
    const inlineData = (part.inlineData || part.inline_data) as Record<string, string> | undefined;
    if (inlineData?.data) {
      return { success: true, data: inlineData.data };
    }
  }

  // candidates 有内容但没有图片，可能被安全过滤
  if (finishReason === 'SAFETY') {
    return { success: false, error: '图片被安全策略过滤，请调整 prompt 或更换参考图' };
  }

  return { success: false, error: `生成结果中未找到图片数据（finishReason: ${finishReason}）` };
}

// ═══════════════════════════════════════
// 构建 Gemini API Parts（图片 + 文字）
// ═══════════════════════════════════════

function buildParts(
  prompt: string,
  productImages: ImageInput[],
  options: {
    modelRefImages?: ImageInput[];
    bgRefImages?: ImageInput[];
    sceneRefImages?: ImageInput[];
    accessoryImages?: ImageInput[];
    anchorImage?: ImageInput;
  }
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];

  parts.push({ text: prompt });

  if (options.modelRefImages && options.modelRefImages.length > 0) {
    parts.push({ text: '\n\nModel Reference Images (match hairstyle, makeup style, facial mood, and age feel):' });
    options.modelRefImages.forEach(img => {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    });
  }

  parts.push({ text: '\n\nProduct Reference Images (extract garment design, fabric, color, and construction details):' });
  productImages.forEach(img => {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  });

  if (options.sceneRefImages && options.sceneRefImages.length > 0) {
    parts.push({ text: '\n\nScene Reference Images (use these to define the background environment, lighting, and atmosphere):' });
    options.sceneRefImages.forEach(img => {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    });
  }

  if (options.bgRefImages && options.bgRefImages.length > 0) {
    parts.push({ text: '\n\nBackground Reference Images (product photo module: use these to define the background color tone):' });
    options.bgRefImages.forEach(img => {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    });
  }

  if (options.accessoryImages && options.accessoryImages.length > 0) {
    parts.push({ text: '\n\nAccessory Reference Images (naturally incorporate these accessories into the scene):' });
    options.accessoryImages.forEach(img => {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    });
  }

  if (options.anchorImage) {
    parts.push({
      text: '\n\nAnchor Reference Image (CRITICAL — MODEL IDENTITY LOCK):\nThis is a previously generated image from the SAME photo series. You MUST reproduce the EXACT SAME model: same face, same hairstyle, same skin complexion, same makeup. Only the pose and framing should differ.',
    });
    parts.push({ inline_data: { mime_type: options.anchorImage.mimeType, data: options.anchorImage.data } });
  }

  return parts;
}

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
    moduleType,
    productImages,
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
  } = body;

  if (!productImages || productImages.length === 0) {
    return new Response(JSON.stringify({ error: '产品图不能为空' }), { status: 400 });
  }

  // ═══ SSE 流式响应 ═══
  const stream = new ReadableStream({
    async start(controller) {
      const push = (type: string, data: unknown) => {
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(type, data)));
        } catch {
          // 客户端已断开
        }
      };

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
          const aspectRatio = outputSizeConfig.aspectRatio;

          // AI 服装分析（可选，失败不阻塞）
          let garmentDescription: string | undefined;
          push('status', { phase: 'analyzing', message: '正在分析服装特征...' });
          try {
            const { analyzeProductImage } = await import('@/lib/ai-assistant');
            const analysis = await analyzeProductImage(productImages[0].data);
            if (analysis.description) {
              garmentDescription = analysis.description;
            }
          } catch {
            // 分析失败，沿用默认 prompt
          }

          // 首图锚定
          let anchorImage: ImageInput | undefined;

          for (let i = 0; i < shotConfigs.length; i++) {
            const shot = shotConfigs[i];
            push('status', {
              phase: 'generating',
              current: i + 1,
              total,
              shotIndex: shot.index,
              message: `正在生成第 ${i + 1} 张（镜次 #${shot.index}）...`,
            });

            // 余额检查 + 扣费
            const balance = await checkBalance(auth.userId);
            if (!balance.sufficient) {
              push('error', {
                shotIndex: shot.index,
                current: i + 1,
                total,
                message: `余额不足（当前 ¥${(balance.balanceFen / 100).toFixed(2)}），已停止生成`,
                fatal: true,
              });
              failedCount += total - i;
              break;
            }

            const deduction = await deductBalance(auth.userId, `生成镜次 #${shot.index}`);
            if (!deduction.success) {
              push('error', {
                shotIndex: shot.index,
                current: i + 1,
                total,
                message: `扣费失败: ${deduction.error || '未知错误'}`,
                fatal: true,
              });
              failedCount += total - i;
              break;
            }

            // 构建 prompt
            const prompt = buildProductShotPrompt({
              shot,
              productImages,
              modelConfig,
              bodyTypeConfig,
              skinToneConfig,
              modelRefImages,
              bgRefImages,
              accessoryImages,
              garmentDescription,
            });

            const parts = buildParts(prompt, productImages, {
              modelRefImages,
              bgRefImages,
              accessoryImages,
              anchorImage,
            });

            const result = await callGeminiApi(parts, aspectRatio);

            if (result.success && result.data) {
              successCount++;
              // 锚定首图
              if (!anchorImage) {
                anchorImage = { data: result.data, mimeType: 'image/png' };
              }
              push('result', {
                shotIndex: shot.index,
                imageData: result.data,
                current: i + 1,
                total,
              });
            } else {
              failedCount++;
              push('error', {
                shotIndex: shot.index,
                current: i + 1,
                total,
                message: result.error ?? '生成失败（未知原因）',
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
          const aspectRatio = outputSizeConfig.aspectRatio;

          push('status', { phase: 'generating', current: 1, total: 1, shotIndex: 0, message: '正在生成场景图...' });

          // 余额 + 扣费
          const balance = await checkBalance(auth.userId);
          if (!balance.sufficient) {
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: `余额不足（当前 ¥${(balance.balanceFen / 100).toFixed(2)}）`,
              fatal: true,
            });
            push('done', { successCount: 0, failedCount: 1, totalSeconds: 0 });
            controller.close();
            return;
          }

          await deductBalance(auth.userId, '场景图生成');

          // AI 服装分析
          let garmentDescription: string | undefined;
          push('status', { phase: 'analyzing', message: '正在分析服装特征...' });
          try {
            const { analyzeProductImage } = await import('@/lib/ai-assistant');
            const analysis = await analyzeProductImage(productImages[0].data);
            if (analysis.description) garmentDescription = analysis.description;
          } catch { /* skip */ }

          push('status', { phase: 'generating', current: 1, total: 1, shotIndex: 0, message: '正在生成场景图...' });

          const modelConfig = modelId ? MODELS.find(m => m.id === modelId) : undefined;
          const bodyTypeConfig = BODY_TYPES.find(b => b.id === (bodyType || 'standard'));
          const skinToneConfig = SKIN_TONES.find(s => s.id === (skinTone || 'light'));

          const prompt = buildSceneShotPrompt({
            productImages,
            sceneRefImages,
            modelConfig,
            bodyTypeConfig,
            skinToneConfig,
            modelRefImages,
            accessoryImages,
            hasModel: true,
            garmentDescription,
          });

          const parts = buildParts(prompt, productImages, {
            modelRefImages,
            sceneRefImages,
            accessoryImages,
          });

          const result = await callGeminiApi(parts, aspectRatio);

          if (result.success && result.data) {
            successCount = 1;
            push('result', { shotIndex: 0, imageData: result.data, current: 1, total: 1 });
          } else {
            failedCount = 1;
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: result.error ?? '生成失败',
              fatal: true,
            });
          }
        }

        push('done', {
          successCount,
          failedCount,
          totalSeconds: Math.round((Date.now() - startTime) / 1000),
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : '服务器内部错误';
        push('error', { shotIndex: -1, current: 0, total: 0, message: msg, fatal: true });
        push('done', { successCount, failedCount: failedCount + 1, totalSeconds: Math.round((Date.now() - startTime) / 1000) });
      } finally {
        controller.close();
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
