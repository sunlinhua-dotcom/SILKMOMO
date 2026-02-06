/**
 * Gemini API 调用封装
 */

export interface GenerateOptions {
  productImages: Array<{ data: string; mimeType: string }>;
  styleImages?: Array<{ data: string; mimeType: string }>;
  accessoryImages?: Array<{ data: string; mimeType: string }>;
  modelImage?: { data: string; mimeType: string };
  prompt: string;
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  imageSize?: '1K' | '2K' | '4K';
}

export interface GenerateResult {
  success: boolean;
  data?: string; // Base64 image
  error?: string;
}

// API 配置 - 使用 apiyi.com 提供的 Gemini API 代理
const API_CONFIG = {
  baseUrl: 'https://api.apiyi.com/v1beta',
  model: 'gemini-2.0-flash-exp-image-generation', // 尝试使用更新的模型
  fallbackModel: 'gemini-3-pro-image-preview',
  apiKey: process.env.GEMINI_API_KEY || ''
};

// 默认提示词模板
export const PROMPT_TEMPLATES = {
  hero: `生成一张电商产品头图：
- 一位年轻优雅的亚洲女性模特（20-25岁，白皙肤色，精致妆容）
- 身穿着丝绸材质的服装，面料光泽柔和
- 站姿优雅，自信大方
- 背景：INS风格的复古室内场景（壁炉、木质地板、护墙板）或自然户外（绿植庭院）
- 光线：柔和自然光，无 harsh 阴影
- 色调：浅蓝+米白+暖棕，低饱和度，暖调胶片滤镜
- 比例：1:1 正方形
- 画面清晰，产品细节突出`,

  full_body: `生成一张电商产品全身照：
- 一位年轻优雅的亚洲女性模特（20-25岁，白皙肤色）
- 全身展示，站立或优雅行走姿态
- 身穿着丝绸服装，展示服装的垂坠感和整体版型
- 背景：INS风格复古场景或自然户外
- 比例：3:4 竖版
- 高质量，细节清晰`,

  half_body: `生成一张电商产品半身照：
- 一位年轻优雅的亚洲女性模特
- 半身构图，腰部以上
- 优雅姿态，可以手轻轻触碰头发或配饰
- 身穿着丝绸服装，展示上身设计和面料质感
- 背景：INS风格复古场景或自然户外
- 比例：3:4 竖版
- 高质量`,

  close_up: `生成一张电商产品特写照：
- 丝绸服装的细节特写
- 展示面料的光泽、纹理、蕾丝拼接等工艺细节
- 可以有模特的局部（如手、肩部）作为点缀
- 背景简洁，突出产品细节
- 比例：3:4 竖版
- 超高细节`
};

// 趣味等待文案
export const WAITING_MESSAGES = [
  '正在为您的丝绸服装注入灵魂...',
  '模特正在挑选最优雅的姿态...',
  '正在调柔和的自然光线...',
  '丝绸的光泽正在展现...',
  '为您打造 INS 风格大片...',
  '正在让每一根丝线都闪耀...',
  '将优雅融入每一个像素...',
  'SILKMOMO 正在为您创造美...',
  '正在为产品找到最完美的背景...',
  '让您的产品在镜头前绽放光彩...'
];

export function getRandomWaitingMessage(): string {
  return WAITING_MESSAGES[Math.floor(Math.random() * WAITING_MESSAGES.length)];
}

/**
 * 检查 API 配置
 */
function checkApiConfig(): { ok: boolean; error?: string } {
  if (!API_CONFIG.apiKey) {
    return { ok: false, error: 'API Key 未配置，请检查 .env.local 文件' };
  }
  if (API_CONFIG.apiKey.startsWith('sk-')) {
    // Key 格式正确
  } else {
    return { ok: false, error: 'API Key 格式不正确' };
  }
  return { ok: true };
}

export async function generateImage(options: GenerateOptions, useFallback = false): Promise<GenerateResult> {
  // 检查 API 配置
  const configCheck = checkApiConfig();
  if (!configCheck.ok) {
    return { success: false, error: configCheck.error };
  }

  const modelName = useFallback ? API_CONFIG.fallbackModel : API_CONFIG.model;

  try {
    // 构建请求 parts
    const parts: Array<Record<string, unknown>> = [];

    // 添加提示词
    parts.push({ text: options.prompt });

    // 添加模特参考图（如果有）
    if (options.modelImage) {
      parts.push({
        inline_data: {
          mime_type: options.modelImage.mimeType,
          data: options.modelImage.data
        }
      });
      parts.push({ text: '\n\n请保持以上图片中模特的形象和特征一致。' });
    }

    // 添加产品图
    options.productImages.forEach((img) => {
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.data
        }
      });
    });

    // 添加风格参考图
    if (options.styleImages && options.styleImages.length > 0) {
      parts.push({ text: '\n\n请参考以下图片的风格和场景：' });
      options.styleImages.forEach(img => {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.data
          }
        });
      });
    } else {
      parts.push({ text: '\n\n如果没有风格参考，请使用 INS 风格的复古优雅场景（壁炉、木地板、护墙板）或自然户外（绿植庭院）。' });
    }

    // 添加配件图
    if (options.accessoryImages && options.accessoryImages.length > 0) {
      parts.push({ text: '\n\n请将以下配件自然地融入画面中：' });
      options.accessoryImages.forEach(img => {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.data
          }
        });
      });
    }

    // 构建请求 URL
    const url = `${API_CONFIG.baseUrl}/models/${modelName}:generateContent?key=${API_CONFIG.apiKey}`;

    console.log(`正在调用 API: ${modelName}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
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
      console.error('API 错误响应:', response.status, errorText);

      // 如果是 404 或模型找不到，尝试使用备用模型
      if (!useFallback && (response.status === 404 || errorText.includes('not found'))) {
        console.log('尝试使用备用模型...');
        return generateImage(options, true);
      }

      return { success: false, error: `API 请求失败 (${response.status}): ${errorText.substring(0, 200)}` };
    }

    const data = await response.json();
    console.log('API 响应:', JSON.stringify(data).substring(0, 200));

    // 解析响应 - Gemini API 响应格式
    const candidates = data?.candidates;
    if (!candidates || candidates.length === 0) {
      return { success: false, error: 'API 未返回生成结果' };
    }

    const content = candidates[0]?.content;
    const parts_result = content?.parts;

    if (!parts_result || parts_result.length === 0) {
      return { success: false, error: '返回结果格式错误' };
    }

    // 查找图片数据
    for (const part of parts_result) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        return { success: true, data: inlineData.data };
      }
    }

    return { success: false, error: '未找到图片数据' };

  } catch (error) {
    console.error('生成图片时出错:', error);

    // 如果是网络错误，尝试使用备用模型
    if (!useFallback && error instanceof Error && error.message.includes('fetch')) {
      console.log('网络错误，尝试使用备用模型...');
      // 可以在这里添加重试逻辑
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return {
      success: false,
      error: `网络连接失败: ${errorMessage}`
    };
  }
}

export async function generateSevenImages(
  productImages: Array<{ data: string; mimeType: string }>,
  styleImages?: Array<{ data: string; mimeType: string }>,
  accessoryImages?: Array<{ data: string; mimeType: string }>,
  customPrompts?: Record<string, string>,
  onProgress?: (current: number, total: number) => void
): Promise<Array<{ type: string; data: string; error?: string }>> {
  const results: Array<{ type: string; data: string; error?: string }> = [];

  // 1. 先生成头图作为模特参考
  onProgress?.(1, 7);
  const heroPrompt = customPrompts?.hero || PROMPT_TEMPLATES.hero;
  const heroResult = await generateImage({
    productImages,
    styleImages,
    accessoryImages,
    prompt: heroPrompt,
    aspectRatio: '1:1',
    imageSize: '2K'
  });

  if (!heroResult.success || !heroResult.data) {
    return [{ type: 'hero', data: '', error: heroResult.error || '生成失败' }];
  }

  results.push({ type: 'hero', data: heroResult.data });

  // 使用头图作为模特参考
  const modelImage = { data: heroResult.data, mimeType: 'image/png' };

  // 2. 生成两张全身照
  for (let i = 0; i < 2; i++) {
    onProgress?.(2 + i, 7);
    const prompt = customPrompts?.full_body || PROMPT_TEMPLATES.full_body;
    const result = await generateImage({
      productImages,
      styleImages,
      accessoryImages,
      modelImage,
      prompt: `${prompt}\n\n请稍作变化，展现不同的姿态和角度。`,
      aspectRatio: '3:4',
      imageSize: '2K'
    });

    results.push({
      type: `full_body_${i + 1}`,
      data: result.data || '',
      error: result.success ? undefined : result.error
    });
  }

  // 3. 生成两张半身照
  for (let i = 0; i < 2; i++) {
    onProgress?.(4 + i, 7);
    const prompt = customPrompts?.half_body || PROMPT_TEMPLATES.half_body;
    const result = await generateImage({
      productImages,
      styleImages,
      accessoryImages,
      modelImage,
      prompt: `${prompt}\n\n请稍作变化，展现不同的姿态。`,
      aspectRatio: '3:4',
      imageSize: '2K'
    });

    results.push({
      type: `half_body_${i + 1}`,
      data: result.data || '',
      error: result.success ? undefined : result.error
    });
  }

  // 4. 生成两张特写
  for (let i = 0; i < 2; i++) {
    onProgress?.(6 + i, 7);
    const prompt = customPrompts?.close_up || PROMPT_TEMPLATES.close_up;
    const result = await generateImage({
      productImages,
      styleImages,
      accessoryImages,
      modelImage,
      prompt: i === 0 ? prompt : `${prompt}\n\n请展示不同部位的细节。`,
      aspectRatio: '3:4',
      imageSize: '2K'
    });

    results.push({
      type: `close_up_${i + 1}`,
      data: result.data || '',
      error: result.success ? undefined : result.error
    });
  }

  return results;
}
