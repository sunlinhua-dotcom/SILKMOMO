/**
 * 产品图模块的提示词构造器。0906 从 lib/api.ts 原样搬来，文案未改。
 */

import type { ShotConfig, BodyTypeConfig, SkinToneConfig, ModelConfig, OutputSizeConfig } from '../models';
import { FACE_REALISM_DIRECTIVE, SAFE_CROPPED_COMPOSITION_DIRECTIVE } from './shared.ts';

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
  customPrompt?: string;       // 用户对该次生成的额外要求
}

// ===== 产品图模块：构建单张 Prompt =====
// 注：原来的 generateImage / generateProductShots / generateSceneShots / generateSevenImages
// 已废弃，全部生图走 POST /api/generate/stream（SSE 流式接口）

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
    ? `Garment (AI-analyzed): ${options.garmentDescription}. The product reference image(s) are the ONLY source for garment style, cut, silhouette, proportion, neckline, sleeve style, hem, fabric, color hue, pattern/print motifs, seams, closures, and construction. Reproduce these details faithfully.`
    : `Garment: The product reference image(s) are the ONLY source for clothing style, cut, silhouette, fabric drape, color, neckline, sleeves, hem, seams, and construction. Extract and reproduce them faithfully on the model.`;
  const fabricNote = options.garmentDescription && /\bsilk\b(?!-look|-like)/i.test(options.garmentDescription)
    ? `Fabric quality: Premium silk — show the characteristic lustre, smooth drape, and refined texture.`
    : options.garmentDescription
      ? `Fabric quality: Show the authentic material texture and drape as visible in the reference images.`
      : `Fabric quality: Render the material texture and drape exactly as the reference shows.`;
  const garmentFocus = `${garmentDesc}\n${fabricNote}`;

  // 6. 背景（产品图模块：杜绝纯白底，营造自然真实氛围）
  const bgPrompt = (options.bgRefImages && options.bgRefImages.length > 0)
    ? `Background: Use the exact background style and color tone from the provided background reference images. DO NOT use a pure white studio background. Read the lighting, filter, and atmosphere from those background reference images and light the model to MATCH them - same light direction, softness, color temperature, contrast, and shadow character - so the model looks naturally shot in that environment, never pasted-in or lit differently from the background. Real-world gentle shadows.`
    : `Background: DO NOT use a pure white studio background. Create a warm, cozy, minimal real-life domestic or lifestyle setting (like a soft architectural corner, a blurred cozy bedroom, or sunlit textured wall). Use natural soft lighting, warm morning light, and real-world gentle shadows.`;

  // 7. 摄影风格（高级生活方式特写，保留原图滤镜氛围）
  const photography = `Photography style: High-end editorial lifestyle photography. Critically analyze and RETAIN the exact overall vibe, lighting, aesthetics, color filter, and photographic language from the relevant reference image(s). Film-inspired warmth, soft natural light when no reference light is present, subtle analog grain. Focus faithfully on fabric's authentic texture, drape, and skin-friendly softness.`;

  // 8. 防护指令（提高一次成功率）
  const safetyRules = `
CRITICAL RULES (follow strictly):
- Do NOT render any text, watermarks, logos, or letters on the image.
- Do NOT add accessories, jewelry, or items not shown in the reference images.
- Keep EXACTLY the same garment design as the product reference - do not modify silhouette, proportion, neckline, hem length, sleeve style, pattern, color, seams, closures, or construction.
- Any clothing visible in model, background, or lifestyle reference images is NOT a garment design reference. It may only inform styling energy, wearing manner, pose, composition, lighting, expression, makeup, and photographic language.
- Produce a single, clean, photorealistic image. No collage, split-screen, or multiple views.
- The output must look like a real photograph, not an illustration or 3D render.
${SAFE_CROPPED_COMPOSITION_DIRECTIVE}
${shot.hasModel ? `
MODEL IDENTITY CONSISTENCY (CRITICAL for multi-shot series):
- If an "Anchor Reference Image" is provided, you MUST use the EXACT SAME fictional model identity: same face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling. The model must look like the SAME PERSON across all shots.
- Only the pose, camera angle, and framing should change between shots - the model's identity must remain absolutely identical.` : ''}
  `.trim();

  // 9. 用户额外要求（仅当提供时追加，且不能覆盖 safetyRules / 服装一致性）
  const userAddon = options.customPrompt
    ? `\n\nUser adjustment request (apply this on top of the above, but never violate the CRITICAL RULES or garment fidelity): ${options.customPrompt}`
    : '';

  // 如果是局部特写（无模特）
  if (!shot.hasModel) {
    return `
${shotSetup}

${garmentFocus}

${bgPrompt}

${photography}

IMPORTANT: Do NOT include any human figure in this shot. Focus entirely on the fabric surface and textile details.

${safetyRules}${userAddon}
    `.trim();
  }

  return `
${shotSetup}

${modelAppearance}

${bodyPrompt}

${skinPrompt}

${FACE_REALISM_DIRECTIVE}

${garmentFocus}

${bgPrompt}

${photography}

${safetyRules}${userAddon}
  `.trim();
}
