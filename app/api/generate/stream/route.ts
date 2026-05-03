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
import { checkBalance, deductBalance, refundBalance, PRICING } from '@/lib/billing';
import { buildProductShotPrompt, buildSceneShotPrompt } from '@/lib/api';
import { MODELS, BODY_TYPES, SKIN_TONES, PRODUCT_SHOTS, PRODUCT_OUTPUT_SIZES, SCENE_OUTPUT_SIZES } from '@/lib/models';
import { generateImage, ACTIVE_BACKEND } from '@/lib/image-backends';

const VALID_SHOT_INDEXES = new Set(PRODUCT_SHOTS.map(s => s.index));

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
// 生图调用现已抽到 lib/image-backends.ts，由 IMAGE_BACKEND env 切换
// gemini（默认） / openai (gpt-image-2-all)
// ═══════════════════════════════════════

console.log(`[生图] active backend = ${ACTIVE_BACKEND}`);

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

  if (moduleType === 'product' && selectedShotIndexes) {
    const valid = Array.isArray(selectedShotIndexes)
      && selectedShotIndexes.length > 0
      && selectedShotIndexes.every(i => Number.isInteger(i) && VALID_SHOT_INDEXES.has(i));
    if (!valid) {
      return new Response(JSON.stringify({ error: '镜次参数非法' }), { status: 400 });
    }
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

            const deduction = await deductBalance(auth.userId, `生成镜次 #${shot.index}`, taskId);
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

            const result = await generateImage({
              prompt,
              productImages,
              modelRefImages,
              bgRefImages,
              accessoryImages,
              anchorImage,
              aspectRatio,
            });

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
              await refundBalance(
                auth.userId,
                PRICING.pricePerCallFen,
                `生成镜次 #${shot.index} 失败退款`,
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

          const sceneDeduction = await deductBalance(auth.userId, '场景图生成', taskId);
          if (!sceneDeduction.success) {
            push('error', {
              shotIndex: 0,
              current: 1,
              total: 1,
              message: `扣费失败: ${sceneDeduction.error || '未知错误'}`,
              fatal: true,
            });
            push('done', { successCount: 0, failedCount: 1, totalSeconds: 0 });
            controller.close();
            return;
          }

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

          const result = await generateImage({
            prompt,
            productImages,
            modelRefImages,
            sceneRefImages,
            accessoryImages,
            aspectRatio,
          });

          if (result.success && result.data) {
            successCount = 1;
            push('result', { shotIndex: 0, imageData: result.data, current: 1, total: 1 });
          } else {
            failedCount = 1;
            await refundBalance(
              auth.userId,
              PRICING.pricePerCallFen,
              '场景图生成失败退款',
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
