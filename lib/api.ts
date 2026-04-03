/**
 * SILKMOMO API 封装 - Phase 2
 * 产品图模块 + 场景图模块分离的 Prompt 架构
 */

import { generateImageAction } from '@/app/actions/generate';
import type { ShotConfig, BodyTypeConfig, SkinToneConfig, ModelConfig, OutputSizeConfig } from './models';

// ===== 接口类型 =====

export interface GenerateOptions {
  productImages: Array<{ data: string; mimeType: string }>;
  styleId?: string;
  modelId?: string;
  styleImages?: Array<{ data: string; mimeType: string }>;
  accessoryImages?: Array<{ data: string; mimeType: string }>;
  modelRefImages?: Array<{ data: string; mimeType: string }>; // 模特参考图（新增）
  modelImage?: { data: string; mimeType: string };
  bgRefImages?: Array<{ data: string; mimeType: string }>;   // 背景参考图（新增）
  anchorImage?: { data: string; mimeType: string };           // 首图锚定（模特一致性）
  prompt: string;
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  imageSize?: '1K' | '2K' | '4K';
}

export interface GenerateResult {
  success: boolean;
  data?: string;
  error?: string;
  recordId?: string;  // Phase 4B: 生成记录 ID，用于反馈关联
}

export interface ShotGenerateOptions {
  shot: ShotConfig;
  productImages: Array<{ data: string; mimeType: string }>;
  modelConfig?: ModelConfig;
  bodyTypeConfig?: BodyTypeConfig;
  skinToneConfig?: SkinToneConfig;
  modelRefImages?: Array<{ data: string; mimeType: string }>;
  bgRefImages?: Array<{ data: string; mimeType: string }>;
  accessoryImages?: Array<{ data: string; mimeType: string }>;
  outputSize?: OutputSizeConfig;
  garmentDescription?: string; // AI 分析出的服装精确描述
}

export interface SceneGenerateOptions {
  productImages: Array<{ data: string; mimeType: string }>;
  sceneRefImages: Array<{ data: string; mimeType: string }>;
  modelConfig?: ModelConfig;
  bodyTypeConfig?: BodyTypeConfig;
  skinToneConfig?: SkinToneConfig;
  modelRefImages?: Array<{ data: string; mimeType: string }>;
  accessoryImages?: Array<{ data: string; mimeType: string }>;
  outputSize?: OutputSizeConfig;
  frameType?: string;
  angle?: string;
  hasModel?: boolean;
  garmentDescription?: string; // AI 分析出的服装精确描述
}

// ===== 趣味等待文案 =====

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
  '让您的产品在镜头前绽放光彩...',
  '面料的垂坠感正在被完美再现...',
  '光影与丝绸的对话即将呈现...',
  '每一处褶皱都在诉说品质...',
  '正在捕捉最自然的模特神韵...',
  '高级感正在像素间浮现...',
  '真丝的温度正在透过镜头传递...',
  '为您的产品挑选最衬的色调...',
  '正在雕琢一张值得被收藏的照片...',
  '让面料纹理在光线下完美绽放...',
  '一件好作品值得多等几秒...',
];

export function getRandomWaitingMessage(): string {
  return WAITING_MESSAGES[Math.floor(Math.random() * WAITING_MESSAGES.length)];
}

// ===== 通用底层调用 =====

export async function generateImage(options: GenerateOptions): Promise<GenerateResult> {
  return await generateImageAction(options);
}

// ===== 产品图模块：构建单张 Prompt =====

/**
 * 为产品图模块的单个镜次构建完整的 Prompt
 * 结构：镜次设置 → 模特外貌 → 体型/肤色（独立节点）→ 服装焦点 → 背景 → 摄影风格
 */
export function buildProductShotPrompt(options: ShotGenerateOptions): string {
  const { shot, modelConfig, bodyTypeConfig, skinToneConfig } = options;

  // 1. 镜次设置（固定结构）
  const shotSetup = shot.prompt;

  // 2. 模特外貌特征（深度融入 Excel 要求的：松弛感、不摆拍、活人感、融入场景）
  const modelAppearance = modelConfig
    ? `Model appearance: ${modelConfig.prompt}\nModel mood and posture: Effortless, raw, and authentic lifestyle presence ("活人感"). The posture must be 100% natural, candid, and unposed ("不摆拍"). The model must deeply integrate and interact with the environment naturally, adopting the most relaxed form based on the setting. Hair can be slightly messy but elegant. Absolutely NO stiff commercial catalog poses.`
    : `Model appearance and mood: Effortless, raw, and authentic lifestyle presence ("活人感"). The posture must be 100% natural, candid, and unposed ("不摆拍"). The model must deeply integrate and interact with the environment naturally, adopting the most relaxed form based on the setting. Hair can be slightly messy but elegant. Absolutely NO stiff commercial catalog poses.`;

  // 3. 体型（独立节点，不被模特图覆盖）
  const bodyPrompt = bodyTypeConfig
    ? `Body type (important, apply strictly): ${bodyTypeConfig.prompt} Pose style: ${bodyTypeConfig.poseModifier}`
    : '';

  // 4. 肤色（独立节点，不被模特图覆盖）
  const skinPrompt = skinToneConfig
    ? `Skin tone (important, apply strictly regardless of model reference): ${skinToneConfig.prompt}`
    : '';

  // 5. 服装聚焦（动态化：如果有 AI 分析结果则使用精确描述）
  const garmentDesc = options.garmentDescription
    ? `Garment (AI-analyzed): ${options.garmentDescription}. Extract and reproduce ALL details from the product reference images faithfully — fabric pattern, color hue, print motifs, neckline, sleeve style, and construction must be pixel-identical.`
    : `Garment: Extract all clothing details (style, cut, fabric drape, color, neckline, sleeves, hem) precisely from the product reference images. Reproduce the garment faithfully on the model.`;
  const fabricNote = options.garmentDescription && options.garmentDescription.toLowerCase().includes('silk')
    ? `Fabric quality: Premium silk — show the characteristic lustre, smooth drape, and refined texture.`
    : options.garmentDescription
      ? `Fabric quality: Show the authentic material texture and drape as visible in the reference images.`
      : `Fabric quality: Premium 22momme silk — show the characteristic lustre, smooth drape, and refined texture.`;
  const garmentFocus = `${garmentDesc}\n${fabricNote}`;

  // 6. 背景（产品图模块：杜绝纯白底，营造自然真实氛围）
  const bgPrompt = (options.bgRefImages && options.bgRefImages.length > 0)
    ? `Background: Use the exact background style and color tone from the provided background reference images. DO NOT use a pure white studio background. Create a warm, cozy, minimal real-life domestic or lifestyle setting (like a soft architectural corner, a blurred cozy bedroom, or sunlit textured wall). Use natural soft lighting, warm morning light, and real-world gentle shadows.`
    : `Background: DO NOT use a pure white studio background. Create a warm, cozy, minimal real-life domestic or lifestyle setting (like a soft architectural corner, a blurred cozy bedroom, or sunlit textured wall). Use natural soft lighting, warm morning light, and real-world gentle shadows.`;

  // 7. 摄影风格（高级生活方式特写，保留原图滤镜氛围）
  const photography = `Photography style: High-end editorial lifestyle photography. Critically analyze and RETAIN the exact overall vibe, lighting, aesthetics, and filter from the reference image. Film-inspired warmth (Kodak Portra 400 feel), soft natural light, subtle analog grain. Focus faithfully on fabric's authentic texture, drape, and skin-friendly softness.`;

  // 8. 防护指令（提高一次成功率）
  const safetyRules = `
CRITICAL RULES (follow strictly):
- Do NOT render any text, watermarks, logos, or letters on the image.
- Do NOT add accessories, jewelry, or items not shown in the reference images.
- Keep EXACTLY the same garment design as the product reference — do not modify neckline, hem length, sleeve style, pattern, or color. The fabric pattern, print, color hue, and construction details must be pixel-identical to the reference.
- Produce a single, clean, photorealistic image. No collage, split-screen, or multiple views.
- The output must look like a real photograph, not an illustration or 3D render.

MODEL IDENTITY CONSISTENCY (CRITICAL for multi-shot series):
- If an "Anchor Reference Image" is provided, you MUST use the EXACT SAME model identity: same face, same hairstyle, same hair color, same facial features, same skin complexion, same makeup style. The model must look like the SAME PERSON across all shots.
- Only the pose, camera angle, and framing should change between shots — the model's identity must remain absolutely identical.
  `.trim();

  // 如果是局部特写（无模特）
  if (!shot.hasModel) {
    return `
${shotSetup}

${garmentFocus}

${bgPrompt}

${photography}

IMPORTANT: Do NOT include any human figure in this shot. Focus entirely on the fabric surface and textile details.

${safetyRules}
    `.trim();
  }

  return `
${shotSetup}

${modelAppearance}

${bodyPrompt}

${skinPrompt}

${garmentFocus}

${bgPrompt}

${photography}

${safetyRules}
  `.trim();
}

// ===== 场景图模块：构建 Prompt =====

/**
 * 为场景图模块构建 Prompt
 * 背景由场景参考图完全驱动，不使用预设场景词库
 */
export function buildSceneShotPrompt(options: SceneGenerateOptions): string {
  const { modelConfig, bodyTypeConfig, skinToneConfig, hasModel = true } = options;

  // 1. 模特外貌
  const modelAppearance = modelConfig
    ? `Model appearance: ${modelConfig.prompt}`
    : `Model appearance: Professional model with a relaxed, authentic lifestyle presence.`;

  // 2. 体型（独立节点）
  const bodyPrompt = bodyTypeConfig
    ? `Body type (apply strictly): ${bodyTypeConfig.prompt} Pose and attitude: ${bodyTypeConfig.poseModifier}`
    : '';

  // 3. 肤色（独立节点）
  const skinPrompt = skinToneConfig
    ? `Skin tone (apply strictly): ${skinToneConfig.prompt}`
    : '';

  // 4. 服装（动态化）
  const sceneGarmentDesc = options.garmentDescription
    ? `Garment (AI-analyzed): ${options.garmentDescription}. Faithfully reproduce ALL details from the product reference images — fabric pattern, color, and construction must be identical.`
    : `Garment: Extract all clothing details from the product reference images and faithfully reproduce them on the model.`;
  const sceneFabricNote = options.garmentDescription && options.garmentDescription.toLowerCase().includes('silk')
    ? `Show premium silk quality — its natural lustre and fluid drape.`
    : options.garmentDescription
      ? `Show the authentic material texture and drape.`
      : `Show premium 22momme silk quality — its natural lustre and fluid drape.`;
  const garmentFocus = `${sceneGarmentDesc} ${sceneFabricNote}`;

  // 5. 场景（由场景参考图完全驱动）
  const sceneBg = `Scene & Background: Use the provided scene reference image(s) as the definitive environment guide. Extract the spatial structure, lighting direction, ambient color palette, and background elements from those images. Recreate a similar scene atmosphere for this shot — DO NOT invent a scene or use preset locations.`;

  // 6. 模特状态（场景图：根据环境解析，主打活人感不摆拍）
  const modelMood = `Model mood and posture: First, analyze the scene setting. Then, make the model adopt the most natural and relaxed pose that perfectly fits into that environment. Exhibit a candid, raw, and authentic human presence ("活人感", "不摆拍"). Avoid stiff commercial catalog looks entirely. Hair can be slightly messy but elegant.`;

  // 7. 摄影风格（整体氛围保留）
  const photography = `Photography style: Lifestyle and editorial fashion photography. Analyze the reference to retain the exact atmosphere, camera angle, and composition. Preserve everything except the product. Film-inspired warmth with 35mm analog feel (like Kodak Portra 400). Soft natural lighting, subtle grain, cinematic and deeply emotionally evocative.`;

  // 8. 防护指令
  const safetyRules = `
CRITICAL RULES (follow strictly):
- Do NOT render any text, watermarks, logos, or letters on the image.
- Do NOT add accessories or items not shown in the reference images.
- Keep the EXACT garment design from product reference — do not alter colors, patterns, print motifs, or construction. The fabric pattern and color hue must be pixel-identical to the reference.
- Produce a single, clean, photorealistic image. No collage or multi-panel.
- The output must look like a real analog photograph, not digital art.

MODEL IDENTITY CONSISTENCY (CRITICAL for multi-shot series):
- If an "Anchor Reference Image" is provided, you MUST use the EXACT SAME model identity: same face, same hairstyle, same hair color, same facial features, same skin complexion, same makeup style. The model must look like the SAME PERSON across all shots.
- Only the pose, camera angle, and framing should change between shots — the model's identity must remain absolutely identical.
  `.trim();

  if (!hasModel) {
    // 氛围静物图（无模特）
    return `
Still life atmospheric scene. No human figures.

${garmentFocus}

${sceneBg}

The garment or silk products should be artfully arranged or draped in the scene as decorative objects or props. Focus on lifestyle mood and aesthetic rather than product demonstration.

${photography}

${safetyRules}
    `.trim();
  }

  return `
${modelAppearance}

${bodyPrompt}

${skinPrompt}

${garmentFocus}

${sceneBg}

${modelMood}

${photography}

${safetyRules}
  `.trim();
}

// ===== 产品图模块：批量生成选中镜次 =====

export async function generateProductShots(
  selectedShots: ShotConfig[],
  productImages: Array<{ data: string; mimeType: string }>,
  options: {
    modelConfig?: ModelConfig;
    bodyTypeConfig?: BodyTypeConfig;
    skinToneConfig?: SkinToneConfig;
    modelRefImages?: Array<{ data: string; mimeType: string }>;
    bgRefImages?: Array<{ data: string; mimeType: string }>;
    accessoryImages?: Array<{ data: string; mimeType: string }>;
    outputSize?: OutputSizeConfig;
  },
  onProgress?: (current: number, total: number, shotIndex: number) => void
): Promise<Array<{ shotIndex: number; data: string; error?: string }>> {
  const results: Array<{ shotIndex: number; data: string; error?: string }> = [];
  const total = selectedShots.length;

  // 确定输出比例
  const aspectRatio = options.outputSize?.aspectRatio || '3:4';

  // ═══ 预分析：用 AI 识别服装特征（面料、颜色、款式），注入后续 prompt ═══
  let garmentDescription: string | undefined;
  try {
    const { analyzeProductImage } = await import('./ai-assistant');
    const firstProduct = productImages[0];
    if (firstProduct?.data) {
      const analysis = await analyzeProductImage(firstProduct.data);
      if (analysis.description) {
        garmentDescription = analysis.description;
        console.log('[ProductShots] AI 服装分析完成:', garmentDescription);
      }
    }
  } catch (e) {
    console.warn('[ProductShots] 服装分析跳过（不影响生成）:', e);
  }

  // ═══ 首图锚定：保存第一张成功的图片，作为后续图的模特参考 ═══
  let anchorImage: { data: string; mimeType: string } | undefined;

  for (let i = 0; i < selectedShots.length; i++) {
    const shot = selectedShots[i];
    onProgress?.(i + 1, total, shot.index);

    const prompt = buildProductShotPrompt({
      shot,
      productImages,
      ...options,
      garmentDescription,
    });

    // 构建图片输入：模特参考图优先（如果有），否则用预设模特
    const generateOptions: GenerateOptions = {
      productImages,
      prompt,
      aspectRatio,
      imageSize: '2K',
      modelId: options.modelConfig?.id,
      modelRefImages: options.modelRefImages,
      bgRefImages: options.bgRefImages,
      accessoryImages: options.accessoryImages,
      // 首图锚定：第二张及以后的图使用第一张成功生成的图作为模特锚点
      anchorImage: anchorImage,
    };

    const result = await generateImage(generateOptions);

    results.push({
      shotIndex: shot.index,
      data: result.data || '',
      error: result.success ? undefined : (result.error || '生成失败')
    });

    // 如果首张失败（可能 API 问题），提前返回
    if (!result.success && i === 0) {
      return results;
    }

    // ═══ 锚定：首张成功 → 存为锚定图 ═══
    if (result.success && result.data && !anchorImage) {
      anchorImage = { data: result.data, mimeType: 'image/png' };
      console.log('[ProductShots] 已锚定首图模特，后续图将保持同一模特身份');
    }
  }

  return results;
}

// ===== 场景图模块：批量生成 =====

export async function generateSceneShots(
  count: number,
  productImages: Array<{ data: string; mimeType: string }>,
  sceneRefImages: Array<{ data: string; mimeType: string }>,
  options: {
    modelConfig?: ModelConfig;
    bodyTypeConfig?: BodyTypeConfig;
    skinToneConfig?: SkinToneConfig;
    modelRefImages?: Array<{ data: string; mimeType: string }>;
    accessoryImages?: Array<{ data: string; mimeType: string }>;
    outputSize?: OutputSizeConfig;
    hasModel?: boolean;
  },
  onProgress?: (current: number, total: number) => void
): Promise<Array<{ index: number; data: string; error?: string }>> {
  const results: Array<{ index: number; data: string; error?: string }> = [];

  const prompt = buildSceneShotPrompt({
    productImages,
    sceneRefImages,
    hasModel: options.hasModel !== false,
    ...options,
  });

  const aspectRatio = options.outputSize?.aspectRatio || '3:4';

  onProgress?.(1, count);

  const result = await generateImage({
    productImages,
    styleImages: sceneRefImages,
    modelRefImages: options.modelRefImages,
    accessoryImages: options.accessoryImages,
    modelId: options.modelConfig?.id,
    prompt,
    aspectRatio,
    imageSize: '2K',
  });

  results.push({
    index: 1,
    data: result.data || '',
    error: result.success ? undefined : (result.error || '生成失败')
  });

  return results;
}

// ===== 兼容旧版（废弃，保留以防报错）=====

/** @deprecated 使用 generateProductShots 或 generateSceneShots 代替 */
export async function generateSevenImages(
  productImages: Array<{ data: string; mimeType: string }>,
  styleImages?: Array<{ data: string; mimeType: string }>,
  accessoryImages?: Array<{ data: string; mimeType: string }>,
  _customPrompts?: Record<string, string>,
  onProgress?: (current: number, total: number) => void,
  _styleId?: string,
  modelId?: string,
  bodyType?: 'slim' | 'curvy'
): Promise<Array<{ type: string; data: string; error?: string }>> {
  const { MODELS, BODY_TYPES, PRODUCT_SHOTS } = await import('./models');
  const modelConfig = modelId ? MODELS.find(m => m.id === modelId) : undefined;

  // 兼容旧 bodyType（curvy → curvy，其余 → standard）
  const bodyTypeId = bodyType === 'curvy' ? 'curvy' : 'standard';
  const bodyTypeConfig = BODY_TYPES.find(b => b.id === bodyTypeId);

  // 默认 7 张（套装默认）
  const { getDefaultShots } = await import('./models');
  const defaultIndexes = getDefaultShots('outfit');
  const selectedShots = PRODUCT_SHOTS.filter(s => defaultIndexes.includes(s.index));

  const results = await generateProductShots(
    selectedShots,
    productImages,
    { modelConfig, bodyTypeConfig, accessoryImages },
    (curr, total) => onProgress?.(curr, total)
  );

  return results.map(r => ({ type: `shot_${r.shotIndex}`, data: r.data, error: r.error }));
}
