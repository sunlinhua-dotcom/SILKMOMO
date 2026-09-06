/**
 * 场景图模块的提示词构造器。0906 从 lib/api.ts 原样搬来，文案未改。
 */

import type { BodyTypeConfig, SkinToneConfig, ModelConfig, OutputSizeConfig } from '../models';
import { FACE_REALISM_DIRECTIVE, SAFE_CROPPED_COMPOSITION_DIRECTIVE } from './shared.ts';

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
  customPrompt?: string;       // 用户对该次生成的额外要求
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
    ? `Garment (AI-analyzed): ${options.garmentDescription}. The product reference image(s) are the ONLY source for garment style, cut, silhouette, proportion, fabric pattern, color, and construction. Faithfully reproduce ALL product details on the model.`
    : `Garment: The product reference image(s) are the ONLY source for clothing style, cut, silhouette, fabric, color, seams, and construction. Extract all clothing details from them and faithfully reproduce them on the model.`;
  const sceneFabricNote = options.garmentDescription && /\bsilk\b(?!-look|-like)/i.test(options.garmentDescription)
    ? `Show premium silk quality — its natural lustre and fluid drape.`
    : options.garmentDescription
      ? `Show the authentic material texture and drape.`
      : `Render the material texture and drape exactly as the reference shows.`;
  const garmentFocus = `${sceneGarmentDesc} ${sceneFabricNote}`;

  // 5. 场景（由场景参考图完全驱动）
  const sceneBg = `Scene & Background: Use the provided scene reference image(s) as the definitive environment guide. Extract the spatial structure, lighting direction, ambient color palette, filter, atmosphere, and background elements from those images. Light the model to MATCH the scene's lighting exactly - same light direction, softness, color temperature, contrast, and shadow character - so the person is naturally integrated into the scene and never lit differently from it. Recreate the exact scene atmosphere for this shot - DO NOT invent a scene or use preset locations.`;

  // 6. 模特状态（场景图：根据环境解析，主打活人感不摆拍）
  const modelMood = `Model mood and posture: Make the model adopt the most natural and relaxed pose that perfectly fits into the scene environment. Exhibit a candid, raw, and authentic human presence ("活人感", "不摆拍"). Avoid stiff commercial catalog looks entirely. Hair can be slightly messy but elegant.`;

  // 7. 摄影风格（整体氛围保留）
  const photography = `Photography style: Lifestyle and editorial fashion photography. Analyze the scene reference to retain its exact atmosphere, camera angle, composition, light, filter, expression, makeup language, and overall photographic language. Film-inspired 35mm analog feel, subtle grain, natural contrast, and restrained color.`;

  // 8. 防护指令
  const safetyRules = `
CRITICAL RULES (follow strictly):
- Do NOT render any text, watermarks, logos, or letters on the image.
- Do NOT add accessories or items not shown in the reference images.
- Keep the EXACT garment design from product reference - do not alter silhouette, proportion, colors, patterns, print motifs, seams, closures, or construction.
- Clothing visible in scene/model/background references is NOT a product design source. Those references only provide pose, composition, lighting, scene, expression, makeup, styling energy, and photographic language.
- Produce a single, clean, photorealistic image. No collage or multi-panel.
- The output must look like a real analog photograph, not digital art.
${SAFE_CROPPED_COMPOSITION_DIRECTIVE}
${hasModel ? `
MODEL IDENTITY CONSISTENCY (CRITICAL for multi-shot series):
- If an "Anchor Reference Image" is provided, you MUST use the EXACT SAME fictional model identity: same face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling. The model must look like the SAME PERSON across all shots.
- Only the pose, camera angle, and framing should change between shots - the model's identity must remain absolutely identical.` : ''}
  `.trim();

  // 用户额外要求
  const userAddon = options.customPrompt
    ? `\n\nUser adjustment request (apply this on top of the above, but never violate the CRITICAL RULES or garment fidelity): ${options.customPrompt}`
    : '';

  if (!hasModel) {
    // 氛围静物图（无模特）
    return `
Still life atmospheric scene. No human figures.

${garmentFocus}

${sceneBg}

The garment or silk products should be artfully arranged or draped in the scene as decorative objects or props. Focus on lifestyle mood and aesthetic rather than product demonstration.

${photography}

${safetyRules}${userAddon}
    `.trim();
  }

  return `
${modelAppearance}

${bodyPrompt}

${skinPrompt}

${FACE_REALISM_DIRECTIVE}

${garmentFocus}

${sceneBg}

${modelMood}

${photography}

${safetyRules}${userAddon}
  `.trim();
}
