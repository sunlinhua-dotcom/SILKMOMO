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
  isRegeneration?: boolean;           // 单张重做/补齐：需要贴合已通过组图，不重新发散
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
 * 脸 / 皮肤真实感指令（反「AI 完美磨皮脸」）。
 * 图像模型默认出对称、无毛孔、磨皮的「AI 美人脸」；不显式要求真实质感就会太假。
 * 复用于肖像卡（route.ts）与产品/场景/换装三个构造器，让生成的模特看着像被真实拍下的活人。
 */
export const FACE_REALISM_DIRECTIVE = `FACE, SKIN & LIGHT REALISM (critical — the image must look like a REAL photograph of a REAL person taken on a real camera, NOT an AI/CGI or retouched beauty render):
- Skin: natural film-photograph texture with visible pores, fine texture, tiny blemishes, subtle under-eye shadows, slight uneven tone, and normal skin sheen. Preserve these details; do not invent a porcelain, wax, plastic, or uniformly matte surface.
- Face: believable fashion-model features with small real asymmetries. Keep the requested expression, makeup language, hair styling, and age feeling from the relevant reference; do not beautify into a fixed flawless face or a generic AI model face.
- Retouching limits: no airbrushing, no beauty filter, no skin-smoothing, no over-sharpened HDR, no glossy CGI highlights, no heavy digital color grading. Use a film look with subtle analog grain and natural micro-contrast.
- Lighting: reference first. If any scene, background, anchor, or style reference is provided, match that reference's light direction, softness/hardness, color temperature, contrast, shadow density, filter, and mood. Do not create a new studio lighting setup or glamour light unless the reference itself uses it. Only when no lighting reference exists, use soft natural directional daylight.
- Overall: authentic editorial lookbook photography with real skin texture and restrained film color, not a polished render, synthetic beauty ad, or over-retouched studio portrait.`;

const SAFE_CROPPED_COMPOSITION_DIRECTIVE = `Cropped composition safety: If the reference or shot calls for a face-outside-frame crop, describe and render it as a standard e-commerce crop: frame cropped at the neck/shoulders or with the head naturally outside the frame. Keep normal human anatomy and garment fit; never interpret it as a "headless" or "no head" body concept.`;

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
  const fabricNote = options.garmentDescription && options.garmentDescription.toLowerCase().includes('silk')
    ? `Fabric quality: Premium silk — show the characteristic lustre, smooth drape, and refined texture.`
    : options.garmentDescription
      ? `Fabric quality: Show the authentic material texture and drape as visible in the reference images.`
      : `Fabric quality: Premium 22momme silk — show the characteristic lustre, smooth drape, and refined texture.`;
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

MODEL IDENTITY CONSISTENCY (CRITICAL for multi-shot series):
- If an "Anchor Reference Image" is provided, you MUST use the EXACT SAME fictional model identity: same face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling. The model must look like the SAME PERSON across all shots.
- Only the pose, camera angle, and framing should change between shots - the model's identity must remain absolutely identical.
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
  const sceneFabricNote = options.garmentDescription && options.garmentDescription.toLowerCase().includes('silk')
    ? `Show premium silk quality — its natural lustre and fluid drape.`
    : options.garmentDescription
      ? `Show the authentic material texture and drape.`
      : `Show premium 22momme silk quality — its natural lustre and fluid drape.`;
  const garmentFocus = `${sceneGarmentDesc} ${sceneFabricNote}`;

  // 5. 场景（由场景参考图完全驱动）
  const sceneBg = `Scene & Background: Use the provided scene reference image(s) as the definitive environment guide. Extract the spatial structure, lighting direction, ambient color palette, filter, atmosphere, and background elements from those images. Light the model to MATCH the scene's lighting exactly - same light direction, softness, color temperature, contrast, and shadow character - so the person is naturally integrated into the scene and never lit differently from it. Recreate a similar scene atmosphere for this shot - DO NOT invent a scene or use preset locations.`;

  // 6. 模特状态（场景图：根据环境解析，主打活人感不摆拍）
  const modelMood = `Model mood and posture: First, analyze the scene setting. Then, make the model adopt the most natural and relaxed pose that perfectly fits into that environment. Exhibit a candid, raw, and authentic human presence ("活人感", "不摆拍"). Avoid stiff commercial catalog looks entirely. Hair can be slightly messy but elegant.`;

  // 7. 摄影风格（整体氛围保留）
  const photography = `Photography style: Lifestyle and editorial fashion photography. Analyze the scene reference to retain its exact atmosphere, camera angle, composition, light, filter, expression, makeup language, and overall photographic language. Preserve everything except the product garment. Film-inspired 35mm analog feel, subtle grain, natural contrast, and restrained color.`;

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

MODEL IDENTITY CONSISTENCY (CRITICAL for multi-shot series):
- If an "Anchor Reference Image" is provided, you MUST use the EXACT SAME fictional model identity: same face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling. The model must look like the SAME PERSON across all shots.
- Only the pose, camera angle, and framing should change between shots - the model's identity must remain absolutely identical.
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
    isRegeneration = false,
    sceneGroupMode = 'swap',
    productLabel,
  } = options;

  const priorityRules = `PRIORITY ORDER FOR THIS GROUP IMAGE (resolve every conflict in this order):
1. Product fidelity first: the user's product reference image(s) define the garment silhouette, cut, tailoring, proportions, neckline, collar, sleeves, hem, seams, closures, print/pattern, color, fabric texture, and drape. These product details override any clothing visible in the scene-base/lookbook reference.
2. Group model consistency second: ${hasAnchor
  ? 'an Anchor Reference Image is provided; precisely match that same fictional model identity across this image and the set.'
  : 'no anchor is provided; create one new fictional model identity and lock it for the group instead of copying a real reference person.'}
3. Reference lighting/filter/atmosphere third: strictly follow the scene-base image's lighting direction, shadow softness, color temperature, color grade, filter, atmosphere, scene, and overall photographic language.
4. Reference expression/makeup/styling fourth: keep the scene-base person's expression, mood, makeup language, hairstyle styling, pose, and body attitude, while changing only facial identity as required.
5. Group continuity fifth: treat outputs as one set. Keep model identity, output size/framing logic, lighting, product color, fabric texture, silhouette proportions, and photographic language continuous across the group.`;

  const regenerationRule = isRegeneration
    ? `REGENERATION / FILL-IN RULE: This image is replacing or filling one image inside an already approved group. Match the approved group anchored by the provided anchor/result image and the existing references. Do not redesign the model, do not change the product interpretation, do not invent a new filter or lighting style, and do not explore a new creative direction.`
    : '';

  // 底图冻结指令：这是组图的核心——除服装与人物外，其余一切都必须与底图完全一致
  const freeze = `TASK: Edit the FIRST reference image (tagged "scene-base"). Treat it as the exact base photograph. The scene-base is a reference ONLY for pose, composition, crop, lighting, scene, expression, makeup, styling language, and overall photography language. Preserve, pixel-faithfully, EVERYTHING except the two elements listed under REPLACE below:
- The scene, background, environment, props, furniture, accessories, and their exact positions.
- The lighting direction, color grade, overall atmosphere, filter, and film grain of the base image.
- The camera angle, framing, crop, and composition. ${SAFE_CROPPED_COMPOSITION_DIRECTIVE}
- The model's exact body pose, gesture, hand/leg position, head orientation if visible, and where they stand in the frame.
- Preserve the base person's expression, mood, makeup language, and hair styling; only the facial identity/features may change.
Do NOT re-stage, re-pose, re-frame, re-light, or change the filter. The result must look like the SAME photo with only the product garment and the person's identity swapped.`;

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
    ? `REPLACE #1 - Garment: ${piecesPhrase} The new garment is: ${garmentDescription}. The scene-base model's original clothing only indicates wearing method, body contact, layering position, and natural drape direction. Its silhouette, cut, tailoring, collar/neckline, sleeves, length, construction, seams, closures, color, print, pattern, and fabric details are NOT references. Reproduce ALL product-reference garment details faithfully and fit them naturally onto the model in the SAME pose.`
    : `REPLACE #1 - Garment: ${piecesPhrase} The scene-base model's original clothing only indicates wearing method, body contact, layering position, and natural drape direction. Its silhouette, cut, tailoring, collar/neckline, sleeves, length, construction, seams, closures, color, print, pattern, and fabric details are NOT references. Reproduce every product-reference garment detail faithfully and fit it naturally onto the model in the SAME pose.`;

  // 人物替换为全新匿名模特（规避侵权）
  const productIdentityRule = `Any person visible in the "product" reference image(s) is NOT an identity reference. Completely ignore their face, hairstyle, facial features, age, expression, and identity. Use product images ONLY for garment fabric, color, pattern, silhouette, cut, tailoring, and construction.`;
  const newModel = hasAnchor
    ? `REPLACE #2 - Person: Replace the person with the SAME fictional model shown in the "anchor" reference image. Precisely match the anchor model's face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling, so this image and the rest of the set clearly depict ONE consistent fictional person. The anchor is the ONLY identity reference. ${productIdentityRule} This model must remain clearly different from the real person in the scene-base image and from any person appearing in the product reference image(s). Keep the anchor identity, but the pose, body position, expression, mood, makeup language, hair styling, lighting, scene, crop, and photography must follow the scene-base image, NOT the anchor.`
    : `REPLACE #2 - Person: Replace the person with a new anonymous fictional model, with moderately changed facial features so the output does not replicate the scene-base person's real identity. Do not make a fixed generic face; create a fashion-appropriate fictional model and keep the same face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling locked for this group. ${productIdentityRule} Do NOT reproduce or resemble the base person's facial identity or any product-reference person's facial identity. Keep the same pose, body position, skin-tone range, build, expression, mood, makeup language, hair styling, lighting, crop, and scene as the base image; only swap facial identity/features.`;

  // 附件处理
  const accessory = hasReplacementAccessory
    ? `Accessories: Replace the accessories (bag/jewelry/etc.) with the ones shown in the "accessory" reference image(s), placed naturally where accessories appear in the base image.`
    : `Accessories: Keep any existing accessories (bag, jewelry, belt, hat, shoes) from the base image in their ORIGINAL positions, unchanged.`;

  const rules = `
CRITICAL RULES (follow strictly):
- Output exactly ONE photorealistic image. No collage, split-screen, grid, or multiple views.
- Do NOT render any text, watermark, logo, or letters.
- Do NOT alter the scene, pose, framing, or lighting. Only the garment and the person's identity change.
- Product reference images are garment references ONLY - ignore any person, face, hairstyle, or identity visible in them.
- Scene-base/lookbook clothing is not a garment design reference; it only shows how clothing sits on the body in that pose.
- The result must look like a real film photograph, not an illustration, 3D render, beauty-filter image, or synthetic AI fashion render.`.trim();

  const userAddon = options.customPrompt
    ? `\n\nUser adjustment request (apply on top of the above, but never violate the CRITICAL RULES, the scene/pose freeze, or garment fidelity): ${options.customPrompt}`
    : '';

  return `
${priorityRules}

${regenerationRule}

${freeze}

${garment}

${newModel}

${accessory}

${FACE_REALISM_DIRECTIVE}

${rules}${userAddon}
  `.trim();
}

// 旧版 generateProductShots / generateSceneShots / generateSevenImages 已删除。
// 所有生图调用都已迁移到 POST /api/generate/stream（SSE 流式接口，避免 Server Action
// 路径上"扣费成功但不退款"的资金安全 bug）。
