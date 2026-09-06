/**
 * 身份锚 / 模特脸库的提示词构造器。0906 从 lib/api.ts 原样搬来，文案未改。
 * 自动派生锚与脸库共用本文件，改一处等于同时改两条链路。
 */

/**
 * 派生锚肖像（白底身份卡）提示词。
 *
 * 从 app/api/generate/stream/route.ts 挪到这里，让「生成流程自动创建的锚」和
 * 「模特脸库让用户自己挑的脸」共用同一份提示词 —— 两处各写一份必然随时间漂移。
 *
 * faceVariation：脸库需要一次生成多张**互不相同**的脸；不传则保持原行为。
 */
export function buildDerivedAnchorPortraitPrompt(skinToneNote?: string, faceVariation?: string): string {
  const skinToneLine = skinToneNote
    ? `Her skin tone is ${skinToneNote} — match this exact scene-reference tan depth and warm/cool undertone. This portrait records her identity, face, hair, and skin tone from the scene; body, pose, clothing styling, and lighting come from each scene later.`
    : 'This portrait records her identity, face, hair color, and hairstyle directly from the scene reference. Body, pose, clothing styling, and lighting come from each scene later.';

  const variationLine = faceVariation
    ? `\n\nOptional portrait detail, only if it preserves the same identity and overall appearance: ${faceVariation}`
    : '';

  // 09-04 仅改年龄与美化句；影棚打光、肤色与其余肖像指令保持不变。
  return `
A studio identity portrait of the same fictional woman shown in the uploaded scene reference image — not any real person or celebrity.

Her apparent age matches the scene reference. Strictly match the ethnicity, face shape, facial features, hair color, and hairstyle of the model in the scene reference image; generate a front-facing identity portrait card of the same model. Only clean commercial retouching is allowed; do not change any facial feature, facial proportion, or recognizable appearance. Her face is specific and memorable, with the small asymmetries a real face has — one eye opening slightly wider, one brow a little higher.

${skinToneLine}

Head and shoulders, shot on an 85mm lens from about two metres, her face filling roughly 40% of the frame. Facing camera, chin level, a neutral expression easing toward a faint smile. Plain light grey seamless behind her. One large soft source from the front left, a weak fill on the right, so the light rakes gently across her cheek and reveals the texture of the skin.

Keep her exact scene-reference hair color, texture, length, and recognizable hairstyle; arrange it only enough that the jawline, hairline and ears read cleanly. The frame is free of text, letters, watermarks and logos.

Skin: rested and healthy, rendered at pore level — pores across the T-zone and cheeks, fine vellus hair at the hairline, faint natural tonal shifts between forehead, cheek and chin, sheen only on the nose bridge, upper cheekbone and chin. The retouching is a good retoucher's: texture intact, nothing sanded away.

Grade: restrained analog color, gentle highlight rolloff, fine film grain in the shadow areas of the skin. A photograph.${variationLine}
  `.trim();
}

/** 脸库候选脸的族裔取向。follow_scene 自动派生锚不使用这些族裔配方。 */
export type ModelFaceEthnicity = 'eurasian' | 'western';

export interface ModelFaceSpec {
  ethnicity: ModelFaceEthnicity;
  /** 脸型/五官的具体差异描述。必须写死具体特征——只说「换一张脸」会出一批雷同的脸。 */
  variation: string;
}

const ETHNICITY_BLOCK: Record<ModelFaceEthnicity, string> = {
  eurasian:
    'She is of mixed European and East Asian heritage — the blend should be legible in her features: a softly defined eyelid crease, a moderate nose bridge, warm ivory-to-light-olive skin.',
  western:
    'She is a white European / North American woman — Caucasian features: a defined nose bridge and brow ridge, a visible upper-eyelid crease, fair to lightly tanned skin. She must NOT read as East Asian or mixed-Asian.',
};

/**
 * 脸库候选脸的提示词。
 *
 * 与自动锚那份的区别：①族裔可选（脸库要 3 亚欧混血 + 7 欧美，自动锚仍固定美亚混血）；
 * ②脸型差异写得很硬——实测只给「换一张脸」这种弱指令，十张会高度雷同，必须逐项写死
 * 脸型、颧骨、下颌、眼型、鼻型、唇形、发色瞳色。
 */
export function buildModelFacePortraitPrompt(spec: ModelFaceSpec): string {
  return `
A studio identity portrait of one fictional woman, newly invented — not any real person, celebrity, or anyone in an uploaded image.

She is a 24-32 year old agency fashion model. ${ETHNICITY_BLOCK[spec.ethnicity]}

HER FACE — follow this exactly, it is what makes her different from the other candidates:
${spec.variation}

Her face is specific and memorable, with the small asymmetries a real face has — one eye opening slightly wider, one brow a little higher.

Head and shoulders, shot on an 85mm lens from about two metres, her face filling roughly 40% of the frame. Facing camera, chin level, a neutral expression easing toward a faint smile. Plain light grey seamless behind her. One large soft source from the front left, a weak fill on the right, so the light rakes gently across her cheek and reveals the texture of the skin.

Her hair is pulled clear of the face so the jawline, hairline and ears read cleanly. The frame is free of text, letters, watermarks and logos.

Skin: rested and healthy, rendered at pore level — pores across the T-zone and cheeks, fine vellus hair at the hairline, faint natural tonal shifts between forehead, cheek and chin, sheen only on the nose bridge, upper cheekbone and chin. The retouching is a good retoucher's: texture intact, nothing sanded away.

Grade: restrained analog color, gentle highlight rolloff, fine film grain in the shadow areas of the skin. A photograph.
  `.trim();
}

/**
 * 脸库的十张固定配方：3 亚欧混血 + 7 欧美，脸型两两拉开。
 * 顺序即展示顺序；改这里就等于改脸库长什么样。
 */
export const MODEL_FACE_SPECS: ModelFaceSpec[] = [
  { ethnicity: 'eurasian', variation: 'A round face with full cheeks and a soft, barely-defined jaw. Wide-set almond eyes with a shallow crease, a short straight nose with a rounded tip, a small full mouth. Dark brown hair, dark brown eyes.' },
  { ethnicity: 'eurasian', variation: 'A long oval face with high sharp cheekbones and a narrow tapered jaw. Long narrow eyes set close together, a slim high nose bridge, thin precisely drawn lips. Near-black hair, deep brown eyes.' },
  { ethnicity: 'eurasian', variation: 'A heart-shaped face: broad forehead narrowing to a small pointed chin. Large rounded eyes with a clear double crease, a short upturned nose, a wide full mouth. Chestnut hair, light hazel eyes.' },
  { ethnicity: 'western', variation: 'A square face with a broad strong jaw and a wide flat forehead. Deep-set eyes under a heavy brow ridge, a straight high-bridged nose, a thin wide mouth. Ash-blonde hair, pale blue eyes. Nordic.' },
  { ethnicity: 'western', variation: 'A long narrow face with a prominent aquiline nose and a slightly receding chin. Close-set green eyes, sparse light brows, a small mouth. Copper-red hair, dense freckles across the nose and cheeks.' },
  { ethnicity: 'western', variation: 'A round face with soft full cheeks and a short rounded jaw. Large dark-brown eyes, thick strong brows that nearly meet, a broad nose with a rounded tip, a wide full mouth. Near-black wavy hair, olive Mediterranean skin.' },
  { ethnicity: 'western', variation: 'A diamond face: narrow forehead, very wide sharp cheekbones, a pointed chin. Hooded eyes with almost no visible lid, a thin straight nose, a small thin mouth. Platinum-blonde hair, grey eyes.' },
  { ethnicity: 'western', variation: 'A heart-shaped face with a delicate pointed chin and a wide mouth with a pronounced cupid\'s bow. Large round eyes set far apart, a short button nose, arched thin brows. Honey-blonde hair, warm brown eyes.' },
  { ethnicity: 'western', variation: 'A classic oval face with balanced proportions and a firm but not heavy jaw. Almond eyes, strong straight dark brows, a straight medium nose, medium-full lips. Dark brown hair, deep green eyes.' },
  { ethnicity: 'western', variation: 'A short square face with a very broad forehead and a wide low-set jaw. Small deep-set eyes, a wide flat nose bridge, thin lips with a slight natural downturn, a visible gap between the front teeth. Mousy light-brown hair, pale grey-blue eyes.' },
];
