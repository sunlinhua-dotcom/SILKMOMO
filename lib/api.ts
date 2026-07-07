/**
 * SILXINE API 封装 - Phase 2
 * 产品图模块 + 场景图模块分离的 Prompt 架构
 */

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
  customPrompt?: string;       // 用户对该次生成的额外要求
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
  customPrompt?: string;       // 用户对该次生成的额外要求
}

// 组图（换装）模式：以一张 lookbook 参考图为底图做「编辑」——
// 冻结场景+姿势，只换服装 + 换成全新匿名模特（规避五官侵权）。
export interface SceneGroupGenerateOptions {
  garmentDescription?: string;        // AI 分析出的用户主品服装描述
  garmentCategories?: string[];       // 用户上传替换的主品品类（top/pants/dress…），用于点明换哪几件
  sceneGroupMode?: 'swap' | 'products'; // swap=N景1品；products=1景N品
  productLabel?: string;              // products 模式下当前产品组名称（用于 prompt 点名）
  hasAnchor?: boolean;                // 是否附了「首张成功图」作为新模特身份锚（保证 N 张同一新人）
  hasReplacementAccessory?: boolean;  // 用户是否上传了替换附件（否则保留原图附件）
  customPrompt?: string;              // 用户对该次生成的额外要求
}

const GARMENT_CATEGORY_EN: Record<string, string> = {
  dress: 'dress', top: 'top', pants: 'pants/trousers', skirt: 'skirt',
  suit: 'suit set', outerwear: 'outerwear', jumpsuit: 'jumpsuit', other: 'garment',
};

// ===== 趣味等待文案 =====

export const WAITING_MESSAGES = [
  '正在为您的丝绸服装注入灵魂...',
  '模特正在挑选最优雅的姿态...',
  '正在调柔和的自然光线...',
  '丝绸的光泽正在展现...',
  '为您打造 INS 风格大片...',
  '正在让每一根丝线都闪耀...',
  '将优雅融入每一个像素...',
  'SILXINE 正在为您创造美...',
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

${garmentFocus}

${bgPrompt}

${photography}

${safetyRules}${userAddon}
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

${garmentFocus}

${sceneBg}

${modelMood}

${photography}

${safetyRules}${userAddon}
  `.trim();
}

// ===== 场景图·组图（换装）模块：构建单张 Prompt =====

/**
 * 组图模式单张 prompt：把「本张 lookbook 参考图」当作可编辑底图，
 * 冻结场景/背景/光线/机位/构图 + 模特姿势与身体位置，只做两处替换：
 *   1) 服装 → 用户上传的主品；2) 人物 → 全新匿名模特（规避原图真人五官侵权）。
 * 附件默认保留原位（除非用户上传了替换附件）。
 * 附了 anchor 时：新模特身份对齐 anchor（保证 N 张同一新人），但姿势/场景仍随本张底图。
 */
export function buildSceneGroupPrompt(options: SceneGroupGenerateOptions): string {
  const {
    garmentDescription,
    hasAnchor = false,
    hasReplacementAccessory = false,
    sceneGroupMode = 'swap',
    productLabel,
  } = options;

  // 底图冻结指令：这是组图的核心——除服装与人物外，其余一切都必须与底图完全一致
  const freeze = `TASK: Edit the FIRST reference image (tagged "scene-base"). Treat it as the exact base photograph. You MUST preserve, pixel-faithfully, EVERYTHING except the two elements listed under REPLACE below:
- The scene, background, environment, props, furniture, and their exact positions.
- The lighting direction, color grade, overall atmosphere, filter, and film-grain of the base image.
- The camera angle, framing, crop, and composition.
- The model's exact body POSE, gesture, hand/leg position, head orientation, and where they stand in the frame.
- Preserve the base person's expression and mood exactly; only the facial identity/features may change.
Do NOT re-stage, re-pose, re-frame, or re-light. The result must look like the SAME photo with only the garment and the person's identity swapped.`;

  // 服装替换（可能是多件：上衣 + 裤子…按品类点明，只换这些件，其余保持底图）
  const cats = (options.garmentCategories || [])
    .map(c => GARMENT_CATEGORY_EN[c] || c)
    .filter(Boolean);
  const piecesPhrase = cats.length > 0
    ? `Replace ONLY the ${cats.join(' and the ')} worn in the base image with the matching piece(s) from the "product" reference image(s); leave any other clothing the model wears unchanged.`
    : sceneGroupMode === 'products'
      ? `Replace the clothing worn in the base image with this product group${productLabel ? ` ("${productLabel}")` : ''} shown in the "product" reference image(s).`
      : `Replace the clothing worn in the base image with the user's product garment shown in the "product" reference image(s).`;
  const garment = garmentDescription
    ? `REPLACE #1 — Garment: ${piecesPhrase} The new garment is: ${garmentDescription}. Reproduce ALL of its details faithfully — fabric, color hue, pattern/print motifs, neckline, sleeves, length, and construction must match the product reference exactly. Fit it naturally onto the model in the SAME pose.`
    : `REPLACE #1 — Garment: ${piecesPhrase} Reproduce every detail of the product garment faithfully (fabric, color, pattern, neckline, sleeves, length, construction) and fit it naturally onto the model in the SAME pose.`;

  // 人物替换为全新匿名模特（规避侵权）
  const productIdentityRule = `Any person visible in the "product" reference image(s) is NOT an identity reference. Completely ignore their face, hairstyle, facial features, age, expression, and identity. Use product images ONLY for garment fabric, color, pattern, silhouette, and construction.`;
  const newModel = hasAnchor
    ? `REPLACE #2 — Person: Replace the person with the SAME brand-new model shown in the "anchor" reference image — identical face, hairstyle, and features as the anchor, so this image and the rest of the set clearly depict ONE consistent new person. The anchor is the ONLY identity reference. ${productIdentityRule} This new model must look CLEARLY DIFFERENT from the person in the scene-base image and from any person appearing in the product reference image(s). Do NOT copy the scene-base person's facial identity or any product-reference person's facial identity. Keep the anchor person's identity, but the POSE, body position, expression, mood, and scene must follow the scene-base image, NOT the anchor.`
    : `REPLACE #2 — Person: Replace the person with a COMPLETELY NEW, anonymous, fictional model. Generate a fresh face and identity that looks CLEARLY DIFFERENT from the person in the scene-base image and from any person appearing in the product reference image(s). ${productIdentityRule} Do NOT reproduce or resemble the base person's facial identity or any product-reference person's facial identity. Keep the SAME pose, body position, skin-tone range, build, expression, and mood as the base image; only swap facial identity/features.`;

  // 附件处理
  const accessory = hasReplacementAccessory
    ? `Accessories: Replace the accessories (bag/jewelry/etc.) with the ones shown in the "accessory" reference image(s), placed naturally where accessories appear in the base image.`
    : `Accessories: Keep any existing accessories (bag, jewelry, belt, hat, shoes) from the base image in their ORIGINAL positions, unchanged.`;

  const rules = `
CRITICAL RULES (follow strictly):
- Output exactly ONE photorealistic image. No collage, split-screen, grid, or multiple views.
- Do NOT render any text, watermark, logo, or letters.
- Do NOT alter the scene, pose, framing, or lighting. Only the garment and the person's identity change.
- Product reference images are garment references ONLY — ignore any person, face, hairstyle, or identity visible in them.
- The result must look like a real photograph, not an illustration or 3D render.`.trim();

  const userAddon = options.customPrompt
    ? `\n\nUser adjustment request (apply on top of the above, but never violate the CRITICAL RULES, the scene/pose freeze, or garment fidelity): ${options.customPrompt}`
    : '';

  return `
${freeze}

${garment}

${newModel}

${accessory}

${rules}${userAddon}
  `.trim();
}

// 旧版 generateProductShots / generateSceneShots / generateSevenImages 已删除。
// 所有生图调用都已迁移到 POST /api/generate/stream（SSE 流式接口，避免 Server Action
// 路径上"扣费成功但不退款"的资金安全 bug）。
