'use server';

import { GenerateOptions, GenerateResult } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { deductBalance, checkBalance } from '@/lib/billing';
import { recordGeneration } from '@/lib/generation-record';
import { autoSaveBrandPreference } from '@/lib/brand-memory';

// API 配置
const API_CONFIG = {
  baseUrl: 'https://api.apiyi.com/v1beta',
  model: 'gemini-3.1-flash-image-preview',
  fallbackModel: 'gemini-3.1-flash-image-preview',
  apiKey: process.env.GEMINI_API_KEY || ''
};

function checkApiConfig(): { ok: boolean; error?: string } {
  if (!API_CONFIG.apiKey) {
    return { ok: false, error: 'API Key 未配置，请检查 .env.local 文件' };
  }
  return { ok: true };
}

export async function generateImageAction(options: GenerateOptions, useFallback = false): Promise<GenerateResult> {
  const configCheck = checkApiConfig();
  if (!configCheck.ok) {
    return { success: false, error: configCheck.error };
  }

  // ═══ 计费扣费 ═══
  const auth = await getCurrentUser();
  if (!auth) {
    return { success: false, error: '请先登录后再使用生成功能' };
  }

  const balance = await checkBalance(auth.userId);
  if (!balance.sufficient) {
    return { success: false, error: `余额不足（当前 ¥${(balance.balanceFen / 100).toFixed(2)}，需要 ¥${(balance.requiredFen / 100).toFixed(2)}/张）。请充值后重试。` };
  }

  const deduction = await deductBalance(auth.userId, '图片生成');
  if (!deduction.success) {
    return { success: false, error: deduction.error || '扣费失败' };
  }

  const modelName = useFallback ? API_CONFIG.fallbackModel : API_CONFIG.model;
  const startTime = Date.now();

  try {
    const parts: Array<Record<string, unknown>> = [];

    // 1. 核心 Prompt（已由 api.ts 中的 buildProductShotPrompt / buildSceneShotPrompt 完整构建）
    let finalPrompt = options.prompt;

    // 双保险：如果 prompt 中没有模特描述（旧版兼容），追加
    if (options.modelId && !finalPrompt.includes('Model appearance') && !finalPrompt.includes('Model Description')) {
      const { MODELS } = await import('@/lib/models');
      const model = MODELS.find(m => m.id === options.modelId);
      if (model && !finalPrompt.includes(model.prompt)) {
        finalPrompt = `Model Description: ${model.prompt}\n\n${finalPrompt}`;
      }
    }

    parts.push({ text: finalPrompt });

    // 2. 模特参考图（Phase 2 新增：系统模仿妆发、神情、年龄感）
    if (options.modelRefImages && options.modelRefImages.length > 0) {
      parts.push({
        text: '\n\nModel Reference Images (match hairstyle, makeup style, facial mood, and age feel from these references — but apply body type and skin tone as specified in the prompt, do NOT copy body shape from these images):'
      });
      options.modelRefImages.forEach(img => {
        parts.push({
          inline_data: { mime_type: img.mimeType, data: img.data }
        });
      });
    }

    // 3. 产品参考图（核心输入）
    parts.push({ text: '\n\nProduct Reference Images (extract garment design, fabric, color, and construction details):' });
    options.productImages.forEach(img => {
      parts.push({
        inline_data: { mime_type: img.mimeType, data: img.data }
      });
    });

    // 4. 场景参考图（场景图模块）
    if (options.styleImages && options.styleImages.length > 0) {
      parts.push({ text: '\n\nScene Reference Images (use these to define the background environment, lighting, spatial structure, and atmosphere):' });
      options.styleImages.forEach(img => {
        parts.push({
          inline_data: { mime_type: img.mimeType, data: img.data }
        });
      });
    }

    // 5. 背景参考图（产品图模块专用）
    if (options.bgRefImages && options.bgRefImages.length > 0) {
      parts.push({ text: '\n\nBackground Reference Images (product photo module: use these images to define the background color tone and minimal environmental feel):' });
      options.bgRefImages.forEach(img => {
        parts.push({
          inline_data: { mime_type: img.mimeType, data: img.data }
        });
      });
    }

    // 6. 旧版模特图（向后兼容）
    if (options.modelImage && !options.modelRefImages?.length) {
      parts.push({
        inline_data: { mime_type: options.modelImage.mimeType, data: options.modelImage.data }
      });
      parts.push({ text: '\n\n请保持以上图片中模特的形象和特征。' });
    }

    // 7. 首图锚定（模特一致性：将首张成功生成的图回灌为强制参考）
    if (options.anchorImage) {
      parts.push({
        text: '\n\nAnchor Reference Image (CRITICAL — MODEL IDENTITY LOCK):\nThis is a previously generated image from the SAME photo series. You MUST reproduce the EXACT SAME model in this new shot:\n- SAME face (facial structure, eye shape, nose, lips, jawline)\n- SAME hairstyle (length, texture, color, parting)\n- SAME skin complexion and makeup style\n- SAME body proportions\nThe model in the new image must be IDENTICAL to this anchor — as if photographed by the same photographer in the same session. Only the pose, camera angle, and framing should differ.'
      });
      parts.push({
        inline_data: { mime_type: options.anchorImage.mimeType, data: options.anchorImage.data }
      });
    }

    // 8. 配件图
    if (options.accessoryImages && options.accessoryImages.length > 0) {
      parts.push({ text: '\n\nAccessory Reference Images (naturally incorporate these accessories into the scene):' });
      options.accessoryImages.forEach(img => {
        parts.push({
          inline_data: { mime_type: img.mimeType, data: img.data }
        });
      });
    }

    // 构建请求 URL
    const url = `${API_CONFIG.baseUrl}/models/${modelName}:generateContent?key=${API_CONFIG.apiKey}`;
    console.log(`[Server Action] 调用 API: ${modelName}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: {
            aspectRatio: options.aspectRatio,
            image_size: options.imageSize || '2K'
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Server Action] API 错误:', response.status, errorText);

      if (!useFallback && (response.status === 404 || errorText.includes('not found'))) {
        console.log('[Server Action] 切换备用模型...');
        return generateImageAction(options, true);
      }

      return { success: false, error: `API 请求失败 (${response.status}): ${errorText.substring(0, 200)}` };
    }

    const data = await response.json();
    const candidates = data?.candidates;
    if (!candidates || candidates.length === 0) {
      return { success: false, error: 'API 未返回生成结果' };
    }

    const content = candidates[0]?.content;
    const parts_result = content?.parts;
    if (!parts_result || parts_result.length === 0) {
      return { success: false, error: '返回结果格式错误' };
    }

    for (const part of parts_result) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        // ═══ Phase 4B：记录成功生成 ═══
        const recordId = await recordGeneration({
          userId: auth.userId,
          module: options.styleImages?.length ? 'scene' : 'product',
          promptText: finalPrompt,
          modelId: options.modelId,
          aspectRatio: options.aspectRatio,
          apiModel: modelName,
          success: true,
          apiLatencyMs: Date.now() - startTime,
        }).catch(() => '');

        // ═══ Phase 4A：静默保存品牌偏好 ═══
        autoSaveBrandPreference(auth.userId, {
          modelId: options.modelId,
          module: options.styleImages?.length ? 'scene' : 'product',
          aspectRatio: options.aspectRatio,
        }).catch(() => {}); // 不影响主流程

        return { success: true, data: inlineData.data, recordId };
      }
    }

    // 未找到图片 — 记录失败
    await recordGeneration({
      userId: auth.userId,
      module: options.styleImages?.length ? 'scene' : 'product',
      promptText: finalPrompt,
      modelId: options.modelId,
      aspectRatio: options.aspectRatio,
      apiModel: modelName,
      success: false,
      apiLatencyMs: Date.now() - startTime,
      errorMessage: '未找到图片数据',
    }).catch(() => {});

    return { success: false, error: '未找到图片数据' };

  } catch (error) {
    console.error('[Server Action] 出错:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';

    // ═══ 记录失败 ═══
    await recordGeneration({
      userId: auth.userId,
      module: options.styleImages?.length ? 'scene' : 'product',
      promptText: options.prompt,
      modelId: options.modelId,
      aspectRatio: options.aspectRatio,
      apiModel: modelName,
      success: false,
      apiLatencyMs: Date.now() - startTime,
      errorMessage,
    }).catch(() => {});

    return { success: false, error: `网络连接失败: ${errorMessage}` };
  }
}
