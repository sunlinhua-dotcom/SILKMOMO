/**
 * Gemini API 调用封装
 */

export interface GenerateOptions {
  productImages: Array<{ data: string; mimeType: string }>;
  styleId?: string;
  modelId?: string;
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

// API 配置移至 Server Action (app/actions/generate.ts) 以保护 Key
import { generateImageAction } from '@/app/actions/generate';

// 默认提示词模板 (不再使用)
export const PROMPT_TEMPLATES = {
  hero: '', full_body: '', half_body: '', close_up: ''
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

// --- NEW: Random Vintage Scenes ---
const VINTAGE_SCENES = [
  {
    name: "The Open Window Garden",
    prompt: "Background: A vintage French apartment room with open french doors revealing a lush, overgrown green garden. Natural sunlight streaming in. Furniture: A white linen slipcover armchair. Vibe: Lazy afternoon, fresh, organic, 35mm film grain, Kodak Portra 400 aesthetic."
  },
  {
    name: "The Parquet Floor & Shadows",
    prompt: "Background: An elegant room with warm wooden parquet floors and cream plaster walls. Sunlight casting soft, geometric shadows through blinds or leaves. Furniture: Minimalist antique wooden furniture. Vibe: Quiet luxury, intimate, warm tones, high-fashion editorial style."
  },
  {
    name: "The Garden Terrace",
    prompt: "Background: A semi-outdoor terrace with stone tiles, surrounded by rich greenery and white hydrangeas. Soft, diffused lighting. Furniture: White wrought-iron garden chair. Vibe: Vacation mode, breezy, romantic, soft focus, film photography."
  },
  {
    name: "The Sun-Drenched Nook",
    prompt: "Background: A cozy corner of a room with high ceilings and crown molding. Harsh but artistic direct sunlight hitting the wall. Furniture: A vintage velvet ottoman or daybed. Vibe: Dreamy, nostalgic, cinematic lighting, grain texture."
  }
];

export function getRandomWaitingMessage(styleId?: string): string {
  // 简化逻辑，不再依赖 styleId
  return WAITING_MESSAGES[Math.floor(Math.random() * WAITING_MESSAGES.length)];
}

export async function generateImage(options: GenerateOptions): Promise<GenerateResult> {
  // 直接调用 Server Action
  return await generateImageAction(options);
}

export async function generateSevenImages(
  productImages: Array<{ data: string; mimeType: string }>,
  styleImages?: Array<{ data: string; mimeType: string }>,
  accessoryImages?: Array<{ data: string; mimeType: string }>,
  customPrompts?: Record<string, string>,
  onProgress?: (current: number, total: number) => void,
  styleId?: string,
  modelId?: string,
  bodyType?: 'slim' | 'curvy'
): Promise<Array<{ type: string; data: string; error?: string }>> {
  const results: Array<{ type: string; data: string; error?: string }> = [];

  // 获取 Model 和 BodyType 配置
  const { MODELS, BODY_TYPES, DEFAULT_BODY_TYPE } = await import('./models');
  const selectedModel = modelId ? MODELS.find(m => m.id === modelId) : undefined;
  const selectedBodyType = bodyType ? BODY_TYPES.find(b => b.id === bodyType) : DEFAULT_BODY_TYPE;

  // --- 核心变更：随机选择一个复古场景作为本次任务的基调 ---
  const randomScene = VINTAGE_SCENES[Math.floor(Math.random() * VINTAGE_SCENES.length)];

  // 构建基础 Prompt 片段
  // 1. 模特外貌
  const modelPrompt = selectedModel ? `Model: ${selectedModel.prompt}` : 'Model: Professional fashion model.';

  // 2. 体型和姿态
  const bodyPrompt = selectedBodyType ? `Body Type: ${selectedBodyType.prompt} Pose: ${selectedBodyType.poseModifier}` : '';

  // 3. 场景
  const scenePrompt = styleImages && styleImages.length > 0
    ? "Background: Use the exact style and environment from the uploaded Style Reference images."
    : randomScene.prompt;

  // 4. 通用胶片质感
  const filmPrompt = "Photography: 35mm film aesthetic, Kodak Portra 400, soft grain, high resolution, photorealistic, cinematic lighting.";

  // 组合成完整的模特描述
  const fullModelDescription = `${modelPrompt} ${bodyPrompt}`.trim();

  // 组合场景和风格
  const activeStyleDescription = `${scenePrompt} ${filmPrompt}`;


  // --- 节省 Token 测试模式: 一次生成 7 张组合图 ---
  const TEST_MODE = true;

  if (TEST_MODE) {
    onProgress?.(1, 1);
    const comboPrompt = `
      Create a high-fashion contact sheet (composite image) featuring 7 distinct shots of a model wearing [Product Description].
      
      ${fullModelDescription}
      
      ${activeStyleDescription}
      
      Layout: A creative grid or collage containing:
      - 1 Main Hero Shot (Large, lounging or sitting, relaxed)
      - 2 Full Body Shots (Standing, walking, showing flow of fabric)
      - 2 Half Body Shots (Leaning, posing)
      - 2 Close-up Detail Shots (Focus on silk texture and accessories)
      
      Ensure variety in poses and angles. High resolution, 8k.
      Coherent lighting and color grading across all shots.
    `;

    const result = await generateImage({
      productImages,
      styleImages,
      accessoryImages,
      modelId: modelId,
      prompt: comboPrompt,
      aspectRatio: '3:4',
      imageSize: '2K'
    });

    if (result.success && result.data) {
      results.push({ type: 'hero', data: result.data });
      return results;
    } else {
      return [{ type: 'hero', data: '', error: result.error || '生成失败' }];
    }
  }

  // Fallback to distinct generation (Loop) - retaining simplified logic
  // 1. Hero
  onProgress?.(1, 7);
  const heroPromptRaw = customPrompts?.hero || `A cinematic hero shot. ${fullModelDescription} ${activeStyleDescription} The model is in an elegant pose.`;

  const heroResult = await generateImage({
    productImages,
    styleImages,
    accessoryImages,
    modelId: modelId,
    prompt: heroPromptRaw,
    aspectRatio: '1:1',
    imageSize: '2K'
  });

  if (!heroResult.success || !heroResult.data) {
    return [{ type: 'hero', data: '', error: heroResult.error || '生成失败' }];
  }
  results.push({ type: 'hero', data: heroResult.data });
  const modelImage = { data: heroResult.data, mimeType: 'image/png' };

  // Helper for other shots
  const generateShot = async (type: string, basePrompt: string, i: number, indexOffset: number) => {
    onProgress?.(indexOffset + i, 7);
    const prompt = `${basePrompt} ${activeStyleDescription} Different pose and angle.`;
    const res = await generateImage({
      productImages, styleImages, accessoryImages, modelImage, modelId: modelId,
      prompt, aspectRatio: '3:4', imageSize: '2K'
    });
    results.push({ type: `${type}_${i + 1}`, data: res.data || '', error: res.success ? undefined : res.error });
  };

  await generateShot('full_body', "Full body shot, standing or walking, showing the drape of the silk.", 0, 2);
  await generateShot('full_body', "Full body shot, back view or side view.", 1, 3);
  await generateShot('half_body', "Medium shot, upper body focus.", 0, 4);
  await generateShot('half_body', "Medium shot, interacting with a prop or furniture.", 1, 5);
  await generateShot('close_up', "extreme close-up on fabric texture and details.", 0, 6);
  await generateShot('close_up', "Close-up on face and neckline details.", 1, 7); // Note: progress total is 7, this logic pushes slightly past 7 steps in UI but func is fine.

  return results;
}
