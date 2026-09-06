/**
 * 提示词公共层：接口类型、等待文案、跨模块复用的指令片段。
 *
 * 0906 板块拆分：内容从 lib/api.ts 原样搬来，一个字都没改。
 * 这里的常量被 product / scene / group 三个构造器共用，改动会同时影响三条链路。
 */

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

/**
 * 脸 / 皮肤真实感指令（反「AI 完美磨皮脸」）。
 * 图像模型默认出对称、无毛孔、磨皮的「AI 美人脸」；不显式要求真实质感就会太假。
 * 复用于肖像卡（route.ts）与产品/场景/换装三个构造器，让生成的模特看着像被真实拍下的活人。
 */
export const FACE_REALISM_DIRECTIVE = `REALISM (highest priority — this is a photograph, 35mm film, 85mm lens):
- Skin renders at pore level: visible pores across the T-zone and cheeks, fine vellus hair along the hairline and jaw, one or two small natural marks, tone that shifts between forehead, cheek and chin, and sheen only where sebum naturally sits — nose bridge, upper cheekbone, chin.
- The face carries real asymmetry: the two eyes differ slightly in shape and opening, one brow sits higher, the smile pulls further to one side.
- Every pore, texture break and tonal shift survives at 100% zoom.
- Grade: restrained analog color, gentle highlight rolloff, soft shadow shoulder, fine film grain visible in the shadow areas of skin and fabric.
- Lighting comes from the scene or background reference: copy its light direction, hardness, color temperature, contrast, shadow density and mood. With no scene or background reference, use soft directional daylight from one side. An anchor portrait is an identity reference only and never a lighting reference.`;

export const SAFE_CROPPED_COMPOSITION_DIRECTIVE = `Cropped composition safety: If the reference or shot calls for a face-outside-frame crop, describe and render it as a standard e-commerce crop: frame cropped at the neck/shoulders or with the head naturally outside the frame. Keep normal human anatomy and garment fit; never interpret it as a "headless" or "no head" body concept.`;
