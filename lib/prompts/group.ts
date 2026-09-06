/**
 * 场景图·组图（换装）模块的提示词构造器。0906 从 lib/api.ts 原样搬来，文案未改。
 */

import { FACE_REALISM_DIRECTIVE, SAFE_CROPPED_COMPOSITION_DIRECTIVE } from './shared.ts';

export type ModelIdentityMode = 'fresh' | 'follow_scene';

// 组图（换装）模式：以一张 lookbook 参考图为底图做「编辑」——
// 冻结场景+姿势，只换服装 + 换成全新匿名模特（规避五官侵权）。
export interface SceneGroupGenerateOptions {
  garmentDescription?: string;        // AI 分析出的用户主品服装描述
  garmentCategories?: string[];       // 用户上传替换的主品品类（top/pants/dress…），用于点明换哪几件
  sceneGroupMode?: 'swap' | 'products'; // swap=N景1品；products=1景N品
  modelIdentityMode?: ModelIdentityMode; // fresh=全新模特；follow_scene=贴近场景模特
  productLabel?: string;              // products 模式下当前产品组名称（用于 prompt 点名）
  hasAnchor?: boolean;                // 是否附了身份锚（fresh=完整新人；follow_scene=派生脸部身份）
  hasReplacementAccessory?: boolean;  // 用户是否上传了替换附件（否则保留原图附件）
  isRegeneration?: boolean;           // 单张重做/补齐：需要贴合已通过组图，不重新发散
  customPrompt?: string;              // 用户对该次生成的额外要求
}

const GARMENT_CATEGORY_EN: Record<string, string> = {
  dress: 'dress', top: 'top', pants: 'pants/trousers', skirt: 'skirt',
  suit: 'suit set', outerwear: 'outerwear', jumpsuit: 'jumpsuit', other: 'garment',
};

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
    modelIdentityMode = 'fresh',
    productLabel,
  } = options;
  const identityMode: ModelIdentityMode = modelIdentityMode === 'follow_scene' ? 'follow_scene' : 'fresh';
  const groupModelConsistencyRule = identityMode === 'follow_scene'
    ? hasAnchor
      ? 'the Anchor Reference Image is a front-facing identity portrait of the same person shown in the scene-base image. Keep that exact same person across this image and the set: match the anchor face shape, eye shape, eyebrow shape, nose bridge, cheekbone structure, lip shape, jawline, chin, and facial proportions, while keeping each scene-base person\'s exact skin tone (same tan depth and undertone — never paler or pinker), hair color/length/styling, body build/proportions, exposure, lighting, and all face/body occlusions from the scene-base image. Never replace her with another person. Never copy the anchor\'s studio skin rendering, hair arrangement, body, styling, lighting, or exposure.'
      : 'keep the exact same person shown in each scene-base image: preserve her ethnicity, face shape, facial features, skin tone (same tan depth and undertone — never paler or pinker), hair color/length/styling, body build/proportions, and age feeling. Do not replace her with another person or invent a different face.'
    : hasAnchor
      ? 'an Anchor Reference Image is provided; precisely match that same fictional model identity across this image and the set.'
      : 'no anchor is provided; create one new fictional model identity and lock it for the group instead of copying a real reference person.';
  const groupContinuityRule = identityMode === 'follow_scene'
    ? hasAnchor
      ? 'treat outputs as one set. Keep the anchor facial identity continuous across the group, while each output preserves its own scene-base skin tone, hair color/length/styling, body build, occlusion, lighting, product color, fabric texture, silhouette proportions, and photographic language.'
      : 'treat outputs as one set. Keep output size/framing logic, lighting, product color, fabric texture, silhouette proportions, and photographic language continuous across the group; each output keeps the exact same person from its own scene-base image.'
    : 'treat outputs as one set. Keep model identity, output size/framing logic, lighting, product color, fabric texture, silhouette proportions, and photographic language continuous across the group.';
  const freezeIdentityRule = identityMode === 'follow_scene'
    ? hasAnchor
      ? '- Preserve the base person as the exact same individual: keep her ethnicity, facial identity, expression, mood, makeup language, exact hair color, visible length category, texture, tucked-or-loose state, overall hairstyle, body build/proportions, and skin tone unchanged. The provided anchor is a front-facing identity card of that same person; use it to recover and confirm her face shape, eye shape, eyebrow shape, nose bridge, cheekbone structure, lip shape, jawline, chin, and facial proportions wherever visible. Do NOT copy the anchor\'s studio skin rendering, hair arrangement, body, pose, expression, makeup, lighting, exposure, or accessories; those remain locked to the scene-base image.'
      : '- Preserve the base person as the exact same individual: keep her ethnicity, face shape, facial features, expression, mood, makeup language, exact hair color, visible length category, texture, tucked-or-loose state, overall hairstyle, body build/proportions, and skin tone unchanged. Do not replace her face or identity with another person.'
    : '- Preserve the base person\'s expression, mood, makeup language, and hair styling; only the facial identity/features may change. Hair styling means HOW the hair is worn (visible length category under headwear, wave pattern, tucked or loose), NOT the base person\'s exact hair color or identity — the new model\'s visible hair color/texture must differ noticeably from the base person\'s.';

  const referenceIdentityAction = identityMode === 'follow_scene'
    ? "keep the scene-base person's exact facial identity, expression, mood, makeup language, hairstyle styling, pose, and body attitude. Face visibility must match the base: if the base person's face is partially or fully hidden by headwear, eyewear, hair, or camera angle, keep it hidden the same way."
    : "keep the scene-base person's expression, mood, makeup language, hairstyle styling, pose, and body attitude, while changing only facial identity as required. Face visibility must match the base: if the base person's face is partially or fully hidden by headwear, eyewear, hair, or camera angle, keep it hidden the same way.";
  const priorityRules = `PRIORITY ORDER FOR THIS GROUP IMAGE (resolve every conflict in this order):
1. Product fidelity first: the user's product reference image(s) define the garment silhouette, cut, tailoring, proportions, neckline, collar, sleeves, hem, seams, closures, print/pattern, color, fabric texture, and drape. These product details override any clothing visible in the scene-base/lookbook reference. Product reference images are garment-only references; they provide NO background, wall, floor, lighting, color grade, filter, props, or scene context.
2. Group model consistency second: ${groupModelConsistencyRule}
3. Reference lighting/filter/atmosphere third: the scene-base image is the ONLY authority for lighting direction, shadow softness, color temperature, color grade, filter, atmosphere, scene, background, environment, and overall photographic language; preserve these pixel-faithfully.
4. Worn accessories fourth: every non-garment item the scene-base person wears or carries (headwear/hat, sunglasses/eyeglasses, jewelry, belt, bag, watch, scarf, shoes) MUST stay present, worn the same way, in the same position, with the same occlusion of face or body. The garment swap and the identity swap NEVER add, remove, lift, or reposition these items.
5. Reference expression/makeup/styling fifth: ${referenceIdentityAction}
6. Group continuity sixth: ${groupContinuityRule}`;

  const regenerationRule = isRegeneration
    ? `REGENERATION / FILL-IN RULE: This image is replacing or filling one image inside an already approved group. Match the approved group anchored by the provided anchor/result image and the existing references. Do not redesign the model, do not change the product interpretation, do not invent a new filter or lighting style, and do not explore a new creative direction.`
    : '';

  const freshComplexionOwner = hasAnchor ? 'anchor model' : 'new fictional model identity';
  const exposureSkinRule = identityMode === 'follow_scene'
    ? " Never shift the person's skin toward paler, pinker, or lighter than the base image — skin tan depth and warmth must match the base person exactly."
    : ` The ${freshComplexionOwner}'s visible skin complexion belongs to that fictional identity, not the scene-base person. Preserve that complexion across face, neck, chest, and limbs while rendering it under the scene-base lighting and exposure.`;

  // 底图冻结指令：这是组图的核心——除服装与人物外，其余一切都必须与底图完全一致
  const finalPhotoAction = identityMode === 'follow_scene'
    ? 'The result must look like the SAME photo with the SAME person, changing only the product garment.'
    : "The result must look like the SAME photo with only the product garment and the person's identity swapped.";
  const freeze = `TASK: Edit the FIRST reference image (tagged "scene-base"). Treat it as the exact base photograph. The scene-base is the single source of truth for pose, composition, crop, lighting, scene, background, environment, color grade, filter, atmosphere, expression, makeup, styling language, and overall photography language. Preserve, pixel-faithfully, EVERYTHING except the two elements listed under REPLACE below:
- The scene, background, environment, props, furniture, and accessories — including every accessory WORN by the person (headwear/hat, sunglasses/eyeglasses, jewelry, belt, bag, watch, scarf) — all in their exact positions. If headwear or eyewear covers part of the person's face or head in the base image, keep that exact coverage; NEVER remove, lift, or reposition it to reveal the new face.
- The lighting direction, color grade, overall atmosphere, filter, and film grain of the base image.
- The person's exposure and lighting: light the new person EXACTLY as the base person is lit — same light direction, same exposure, same shadows on face and body. If the base person is backlit (e.g., sunset behind them) with the face underexposed or in shadow, the output face MUST stay equally underexposed/in shadow with only the same rim light. Do NOT add fill light, do NOT brighten or evenly light the face, do NOT boost sky saturation or glow. Preserve the subject-to-background exposure RATIO of the base image exactly: if the base subject reads darker than the sky/background, keep the subject equally darker in the output — never lift the subject's exposure toward the background's. Match the base image's sensor noise/grain on skin and fabric.${exposureSkinRule}
- The camera angle, framing, crop, and composition. ${SAFE_CROPPED_COMPOSITION_DIRECTIVE}
- The model's exact body pose, gesture, hand/leg position, head orientation if visible, and where they stand in the frame.
${freezeIdentityRule}
Product reference images are garment-only inputs. Completely ignore every product-reference background, wall, floor, studio setup, outdoor/indoor scene, prop, lighting direction, shadow, color tone, color filter, and atmosphere. None of those product-reference non-garment elements may appear in the output.
Do NOT re-stage, re-pose, re-frame, re-light, or change the filter. ${finalPhotoAction}`;

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
  let newModel: string;
  if (identityMode === 'follow_scene' && hasAnchor) {
    newModel = `REPLACE #2 - Person: Keep the SAME person shown in the scene-base image. The "anchor" reference image is a front-facing identity portrait card derived from that scene and depicts that same person; her face identity must match the anchor wherever visible. Preserve her ethnicity, overall appearance, face shape, eye shape, eyebrow shape, nose bridge, cheekbone structure, lip shape, jawline, chin, facial proportions, and visible facial feature geometry. You must not replace her with another person, invent a new face, or make her look like a different model. DO NOT copy the anchor's skin complexion/tone, hair arrangement, body build/proportions, pose, expression, makeup language, lighting, exposure, scene, crop, clothing, or accessories because the studio portrait presentation is not the target scene. Instead, preserve the scene-base person's exact skin tone (sample the tan depth, warmth, and undertone from the scene-base person's skin and reproduce them on the face AND body/limbs — paler, pinker, lighter, or less tanned skin is a FAILURE), the same hair color, hair length, hair styling, hairline visibility, the same body build and proportions, and the same age feeling. Keep the same expression, mood, and makeup language from the scene-base image. The output must read unmistakably as the same individual in both the scene-base and anchor, now wearing the product garment. ${productIdentityRule} Face/head visibility and occlusion must match the scene-base image exactly. If the base person's face is partially or fully occluded by headwear, sunglasses, hair, or the camera angle, keep the SAME occlusion — do NOT uncover the face, remove or lift any accessory, or rotate/change the head pose to show more face. Identity matching applies ONLY to the parts of the face/head actually visible in the scene-base image; wherever facial features ARE visible, preserve that same person's facial structure with the SCENE-BASE skin tone and hair.`;
  } else if (identityMode === 'follow_scene') {
    newModel = `REPLACE #2 - Person: Keep the SAME person shown in the scene-base image. Strictly preserve her ethnicity, overall appearance, face shape, facial features, exact skin tone (sample the tan depth, warmth, and undertone from the scene-base person's skin and reproduce them on the face AND body/limbs — paler, pinker, lighter, or less tanned skin is a FAILURE), hair color, hair length, hair styling, hairline visibility, body build and proportions, and age feeling. You must not replace her with another person, invent a new face, or make her look like a different model. Keep the same expression, mood, and makeup language. ${productIdentityRule} Face/head visibility and occlusion must match the scene-base image exactly. If the base person's face is partially or fully occluded by headwear, sunglasses, hair, or the camera angle, keep the SAME occlusion — do NOT uncover the face, remove or lift any accessory, or rotate/change the head pose to show more face.`;
  } else if (hasAnchor) {
    newModel = `REPLACE #2 - Person: Replace the person with the SAME fictional model shown in the "anchor" reference image. The anchor is the COMPLETE IDENTITY ANCHOR: faithfully preserve her face, hair, hairline, complexion, and age as one indivisible fictional identity across the entire set. Precisely match the anchor model's face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling, so this image and the rest of the set clearly depict ONE consistent fictional person. The anchor is the ONLY identity reference. ${productIdentityRule} This model must remain clearly different from the real person in the scene-base image and from any person appearing in the product reference image(s). Keep the anchor identity, but the pose, body position, expression, mood, makeup language, hair styling, lighting, scene, crop, and photography must follow the scene-base image, NOT the anchor. Identity matching applies ONLY to the parts of the face/head actually visible in the scene-base image. If the base person's face is partially or fully occluded by headwear, sunglasses, hair, or the camera angle, keep the SAME occlusion — do NOT uncover the face, remove or lift any accessory, or rotate the head to show more of the anchor's face. Where the anchor's features are occluded in this shot, keep the occlusion; wherever features ARE visible, show the ANCHOR's features (the anchor's hair color, lips, jawline) — NEVER the scene-base person's. Visible hair and face must be recognizably the anchor model, clearly distinct from the scene-base person.`;
  } else {
    newModel = `REPLACE #2 - Person: Replace the person with a new anonymous fictional model, with moderately changed facial features so the output does not replicate the scene-base person's real identity. Do not make a fixed generic face; create a fashion-appropriate fictional model and keep the same face shape, eye shape, eyebrow shape, nose bridge, lip shape, hair color, hair length, hairline, makeup feel, skin complexion, and overall age feeling locked for this group. ${productIdentityRule} Do NOT reproduce or resemble the base person's facial identity or any product-reference person's facial identity. Keep the same pose, body position, build, expression, mood, makeup language, hair styling, lighting, crop, and scene as the base image; only swap identity. The new fictional model identity owns her skin complexion across every visible body area; do not inherit the scene-base person's skin tone. Identity replacement applies ONLY to the parts of the face/head actually visible in the scene-base image. If the base person's face is partially or fully occluded by headwear, sunglasses, hair, or the camera angle, keep the SAME occlusion — do NOT uncover the face, remove or lift any accessory, or change the head pose to show the new face. Keeping the occlusion the SAME never means copying the base person. Wherever any facial feature or hair IS visible, it MUST clearly belong to a DIFFERENT person: noticeably change the visible features (lips, nose, jawline, chin) AND noticeably change the hair color and/or length/texture, so the output person cannot be mistaken for the scene-base person. Keep only the styling language (how the hair is worn under any headwear, the makeup style), never the person's identity.`;
  }

  // 脸↔颈肤色连续性：唯一压过真实感指令的硬规则。
  // 真实感块要求毛孔级质感，模型为了「把质感显出来」会顺手把脸提亮，脸就浮在脖子上面
  // （＝客户反馈的「脸明显偏白」）。离线四轮同底图对照，脸颊-下颌 ΔRGB：
  // 不加此块 23.62~31.90，加了之后 7.05，而真实照片自身的天然落差是 6.06。
  // 最后一句是冲突裁决：质感必须在颈部的亮度上渲染，不许靠提亮换质感。
  const lowerFaceIdentityInstruction = hasAnchor
    ? "take the anchor's lip outline and cupid's bow, mouth width, philtrum length, chin point, jaw angle, and lower-cheek contour as confirmation of the same person's identity"
    : "match the scene-base person's lip outline and cupid's bow, mouth width, philtrum length, chin point, jaw angle, and lower-cheek contour";
  const lowerFaceIdentitySource = hasAnchor ? "the anchor's" : "the new model's";
  const skinContinuity = identityMode === 'follow_scene'
    ? `SKIN TONE CONTINUITY (this outranks the realism block below): the new face is the same skin as the neck directly beneath it. Sample the scene-base person's neck, throat and chest, and paint the face to that exact value — same depth of tan, same warmth, same undertone, same brightness. There must be no visible step, edge, or tonal seam anywhere along the jawline, chin, or hairline; face, neck, chest and limbs read as one continuous piece of skin under one light. Render every pore, texture break and film grain AT the neck's own brightness — never lighten, cool down, or flatten the face in order to make its texture visible. A face that reads lighter, paler, cooler, or flatter than the neck below it is a failure, no matter how good its texture is.
If the scene-base person's eyes are behind sunglasses or eyeglasses, her identity reads entirely from the lower face: ${lowerFaceIdentityInstruction}. Any lower face that changes her into another person is a failure. The eyewear itself stays exactly where it is, untouched, and no eye is drawn behind it.`
    : `FRESH MODEL SKIN CONTINUITY (this outranks the realism block below): the visible skin complexion comes from the ${freshComplexionOwner}, never from the scene-base person. Preserve that identity's depth, warmth, and undertone continuously across the face, neck, throat, chest, and limbs, while matching only the scene-base light direction, exposure, shadows, and color grade. Do NOT sample or inherit the scene-base person's complexion. There must be no visible tonal seam along the jawline, chin, hairline, neckline, or limbs. Render every pore, texture break and film grain AT the ${freshComplexionOwner}'s own brightness under the scene exposure — never lighten, cool down, or flatten the face in order to make its texture visible. A face that reads lighter, paler, cooler, or flatter than the same person's neck/chest is a failure, no matter how good its texture is.
If the scene-base person's eyes are behind sunglasses or eyeglasses, her identity reads entirely from the lower face: take ${lowerFaceIdentitySource} lip outline and cupid's bow, mouth width, philtrum length, chin point, jaw angle, and lower-cheek contour. Reproducing the scene-base person's lips, mouth width, jawline, or chin is a failure. The eyewear itself stays exactly where it is, untouched, and no eye is drawn behind it.`;

  // 附件处理
  const accessory = hasReplacementAccessory
    ? `Accessories: Replace the accessories (bag/jewelry/etc.) with the ones shown in the "accessory" reference image(s), placed naturally where accessories appear in the base image. Keep every other worn accessory (headwear, eyewear, etc.) from the base image unchanged.`
    : `Accessories: Keep EVERY existing accessory (headwear/hat, sunglasses/eyeglasses, bag, jewelry, belt, watch, scarf, shoes) from the base image, worn the same way, in the ORIGINAL position, unchanged. Replacing the garment or the person's identity NEVER removes headwear or eyewear.`;

  const allowedChangesRule = identityMode === 'follow_scene'
    ? '- Do NOT alter the scene, person, pose, framing, or lighting. Only the garment changes. Never add, remove, or reposition worn accessories.'
    : "- Do NOT alter the scene, pose, framing, or lighting. Only the garment and the person's identity change. Never add, remove, or reposition worn accessories.";
  const rules = `
CRITICAL RULES (follow strictly):
- Output exactly ONE photorealistic image. No collage, split-screen, grid, or multiple views.
- Do NOT render any text, watermark, logo, or letters.
${allowedChangesRule}
- Product reference images are garment references ONLY - ignore any person, face, hairstyle, identity, background, wall, floor, lighting, color tone, filter, prop, or scene element visible in them.
- The scene-base image is the sole authority for scene, background, lighting, filter, color grade, and atmosphere; preserve them pixel-faithfully.
- The output must read as the SAME exposure and development as the base photo: same histogram character, same subject-to-background brightness ratio, same white balance, same grain. No added fill light on the face, no brightening, no beauty relighting, no extra saturation or glow in the sky or on skin.
- Scene-base/lookbook clothing is not a garment design reference; it only shows how clothing sits on the body in that pose.
- The result must look like a real film photograph, not an illustration, 3D render, beauty-filter image, or synthetic AI fashion render.`.trim();

  const userAddon = options.customPrompt
    ? `\n\nUser adjustment request (apply on top of the above, but never violate the CRITICAL RULES, the scene/pose freeze, or garment fidelity): ${options.customPrompt}`
    : '';
  const faceRealismBlock = `\n\n${FACE_REALISM_DIRECTIVE}`;

  return `
${priorityRules}

${regenerationRule}

${freeze}

${garment}

${newModel}

${skinContinuity}

${accessory}${faceRealismBlock}

${rules}${userAddon}
  `.trim();
}
