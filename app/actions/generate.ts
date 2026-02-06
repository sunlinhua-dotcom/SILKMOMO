'use server';

import { GenerateOptions, GenerateResult } from '@/lib/api';

// API 配置 - 使用 apiyi.com 提供的 Gemini API 代理
const API_CONFIG = {
    baseUrl: 'https://api.apiyi.com/v1beta',
    model: 'gemini-3-pro-image-preview-2k', // 用户指定唯一可用模型
    fallbackModel: 'gemini-3-pro-image-preview-2k', // 备用也设为同一个，因为指明“只能用”
    // 由于这是 Server Action，process.env.GEMINI_API_KEY 在服务器端是可用的
    apiKey: process.env.GEMINI_API_KEY || 'sk-ACN3Ih2xcK0RYRuZFc65880cB6Af489186D50eC26bD6C95c'
};

function checkApiConfig(): { ok: boolean; error?: string } {
    if (!API_CONFIG.apiKey) {
        return { ok: false, error: 'API Key 未配置，请检查 .env.local 文件' };
    }
    return { ok: true };
}

export async function generateImageAction(options: GenerateOptions, useFallback = false): Promise<GenerateResult> {
    // 检查 API 配置
    const configCheck = checkApiConfig();
    if (!configCheck.ok) {
        return { success: false, error: configCheck.error };
    }

    const modelName = useFallback ? API_CONFIG.fallbackModel : API_CONFIG.model;

    try {
        // 构建请求 parts
        const parts: Array<Record<string, unknown>> = [];

        // 添加提示词 (自动注入模特描述)
        let finalPrompt = options.prompt;

        // 如果有 modelId，注入模特特定的 Prompt（如果之前没有注入的话，这里做个双保险）
        if (options.modelId) {
            const { MODELS } = await import('@/lib/models');
            const model = MODELS.find(m => m.id === options.modelId);
            if (model) {
                // 简单的检查避免重复
                if (!finalPrompt.includes(model.prompt)) {
                    finalPrompt = `Model Description: ${model.prompt}\n\n${finalPrompt}`;
                }
            }
        }

        parts.push({ text: finalPrompt });

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

        console.log(`[Server Action] 正在调用 API: ${modelName}`);

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
            console.error('[Server Action] API 错误响应:', response.status, errorText);

            // 如果是 404 或模型找不到，尝试使用备用模型
            if (!useFallback && (response.status === 404 || errorText.includes('not found'))) {
                console.log('[Server Action] 尝试使用备用模型...');
                return generateImageAction(options, true);
            }

            return { success: false, error: `API 请求失败 (${response.status}): ${errorText.substring(0, 200)}` };
        }

        const data = await response.json();
        // console.log('API 响应:', JSON.stringify(data).substring(0, 200));

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
        console.error('[Server Action] 生成图片时出错:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        return {
            success: false,
            error: `网络连接失败: ${errorMessage}`
        };
    }
}
