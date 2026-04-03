/**
 * SILKMOMO 模特与参数配置
 * Phase 2: 支持体型三选（纤细/标准/饱满）+ 肤色三选（浅/中/深）
 */

// ===== 预设模特（保留快捷选项）=====
export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  gender: 'female' | 'male';
  ethnicity: string;              // 民族/肤色描述
  prompt: string;
}

export const MODELS: ModelConfig[] = [
  {
    id: 'elena',
    name: 'Elena',
    description: '经典优雅的白人女性，柔和光感肌',
    gender: 'female',
    ethnicity: 'Caucasian',
    prompt: 'A sophisticated young Caucasian woman with glowing fair skin. Hair: shoulder-length soft wavy honey-blonde hair with a center part. Elegant posture, classic beauty with natural makeup, soft rosy lips.'
  },
  {
    id: 'naomi',
    name: 'Naomi',
    description: '高级时尚感的黑人女性，超模气场',
    gender: 'female',
    ethnicity: 'Black',
    prompt: 'A stunning Black woman with deep rich skin tone, refined facial structure, distinct cheekbones. Hair: cropped close-cut natural TWA (teeny weeny afro), dark brown-black color. High-fashion supermodel vibe, confident and strong. Minimal makeup, bold brows.'
  },
  {
    id: 'mei',
    name: 'Mei',
    description: '清冷东方感的亚裔女性，高级感肌',
    gender: 'female',
    ethnicity: 'East Asian',
    prompt: 'A beautiful East Asian woman with clear porcelain skin, sharp refined features. Hair: long straight jet-black hair past the shoulders, sleek with a slight center part, silky smooth texture. Calm sophisticated aura, high-fashion editorial look, dewy minimal makeup.'
  },
  {
    id: 'julian',
    name: 'Julian',
    description: '松弛感老钱风白人男性',
    gender: 'male',
    ethnicity: 'Caucasian',
    prompt: 'A handsome Caucasian man with a lean athletic build, light stubble. Hair: medium-length tousled dark brown hair, slightly swept back, natural texture. "Old money" luxury aesthetic, effortless and charming.'
  },
  {
    id: 'marcus',
    name: 'Marcus',
    description: '沉稳现代的黑人男性',
    gender: 'male',
    ethnicity: 'Black',
    prompt: 'A charismatic Black man with deep skin tone, strong calm presence. Hair: short fade haircut with a neat low taper, dark black hair. Well-groomed short beard. Modern luxury style, mature and sophisticated.'
  }
];

export const DEFAULT_MODEL = MODELS[0];

// ===== 体型配置（三选）=====
export interface BodyTypeConfig {
  id: 'slim' | 'standard' | 'curvy';
  name: string;
  description: string;
  prompt: string;
  poseModifier: string;
}

export const BODY_TYPES: BodyTypeConfig[] = [
  {
    id: 'slim',
    name: '纤细',
    description: '修长轻盈身材，适合展示垂坠感',
    prompt: 'Slim, slender build with an elegant, elongated silhouette. Long limbs, narrow shoulders, and a graceful, lithe frame.',
    poseModifier: 'Relaxed, natural posture. Avoid stiff or overly posed looks. Effortless and casual body language, as if in a candid moment.'
  },
  {
    id: 'standard',
    name: '标准',
    description: '标准时尚身材，适合常规款式',
    prompt: 'Standard fashion model build with a balanced, proportionate silhouette. Toned and healthy with a natural, approachable look.',
    poseModifier: 'Confident, natural posture. A balance of elegance and approachability. Think editorial but accessible.'
  },
  {
    id: 'curvy',
    name: '饱满',
    description: '丰盈曲线身材，适合展示合身款式',
    prompt: 'Full-figured, curvaceous build (body shape description only, NOT ethnicity). Pronounced bust, defined waistline, full rounded hips and shapely figure. Body-positive representation.',
    poseModifier: 'Confident, glamorous stance that shows the garment fit on curves naturally. Empowering and beautiful body language.'
  }
];

export const DEFAULT_BODY_TYPE = BODY_TYPES[1]; // 默认标准

// ===== 肤色配置（三选）=====
export interface SkinToneConfig {
  id: 'light' | 'medium' | 'deep';
  name: string;
  description: string;
  prompt: string;
  hexSample: string; // 仅用于 UI 展示色块
}

export const SKIN_TONES: SkinToneConfig[] = [
  {
    id: 'light',
    name: '浅',
    description: '浅肤色，白皙透亮',
    prompt: 'Light, fair skin tone with a luminous, porcelain complexion.',
    hexSample: '#F5E6D3'
  },
  {
    id: 'medium',
    name: '中',
    description: '中性肤色，自然健康',
    prompt: 'Medium, warm skin tone with a healthy, natural complexion.',
    hexSample: '#C8956C'
  },
  {
    id: 'deep',
    name: '深',
    description: '深肤色，深邃光泽',
    prompt: 'Deep, rich dark skin tone with a beautiful, luminous complexion.',
    hexSample: '#6B3A2A'
  }
];

export const DEFAULT_SKIN_TONE = SKIN_TONES[0]; // 默认浅

// ===== 产品图模块：9张候选池 =====
export interface ShotConfig {
  index: number;             // 1-9
  frameType: 'full_body' | 'upper_body' | 'lower_body' | 'close_up';
  frameLabel: string;        // 中文标签
  angle: 'front' | 'side' | 'back';
  angleLabel: string;        // 中文标签
  hasModel: boolean;
  coreValue: string;         // 核心价值描述
  prompt: string;            // 该镜次专属 prompt 节点
  // 各 SKU 类型默认是否选中
  defaultForOutfit: boolean;
  defaultForTop: boolean;
  defaultForBottom: boolean;
}

export const PRODUCT_SHOTS: ShotConfig[] = [
  {
    index: 1,
    frameType: 'full_body',
    frameLabel: '全身近景',
    angle: 'front',
    angleLabel: '正面',
    hasModel: true,
    coreValue: '完整版型轮廓，正面基准图',
    prompt: 'Full body shot, front-facing. The model stands upright showing the complete garment silhouette from head to toe. Focus on the overall fit, fabric drape, and clean front panels.',
    defaultForOutfit: true,
    defaultForTop: true,
    defaultForBottom: true,
  },
  {
    index: 2,
    frameType: 'full_body',
    frameLabel: '全身近景',
    angle: 'side',
    angleLabel: '侧面',
    hasModel: true,
    coreValue: '侧面廓形，面料垂坠方向',
    prompt: 'Full body shot, side profile. The model stands sideways showing the complete garment silhouette from the side. Emphasize the fabric drape direction, shoulder-to-hem flow, and side seams.',
    defaultForOutfit: true,
    defaultForTop: true,
    defaultForBottom: false,
  },
  {
    index: 3,
    frameType: 'full_body',
    frameLabel: '全身近景',
    angle: 'back',
    angleLabel: '背面',
    hasModel: true,
    coreValue: '后片版型，背部工艺细节',
    prompt: 'Full body shot, back view. The model faces away from camera, showing the complete back panel design, back seams, hem line, and any back detailing.',
    defaultForOutfit: true,
    defaultForTop: false,
    defaultForBottom: false,
  },
  {
    index: 4,
    frameType: 'upper_body',
    frameLabel: '上半身近景',
    angle: 'front',
    angleLabel: '正面',
    hasModel: true,
    coreValue: '领口设计，肩线，前片面料状态',
    prompt: 'Upper body close-up, front view. Cropped at the waist or mid-torso. Focus on neckline design, shoulder seams, sleeve caps, and the front fabric texture and drape.',
    defaultForOutfit: true,
    defaultForTop: true,
    defaultForBottom: false,
  },
  {
    index: 5,
    frameType: 'upper_body',
    frameLabel: '上半身近景',
    angle: 'side',
    angleLabel: '侧面',
    hasModel: true,
    coreValue: '侧面领口，袖型，面料厚度感知',
    prompt: 'Upper body close-up, side profile. Focus on the collar from the side angle, sleeve shape and construction, and how the fabric wraps around the body showing its weight and thickness.',
    defaultForOutfit: false,
    defaultForTop: true,
    defaultForBottom: false,
  },
  {
    index: 6,
    frameType: 'upper_body',
    frameLabel: '上半身近景',
    angle: 'back',
    angleLabel: '背面',
    hasModel: true,
    coreValue: '后领设计，背部面料垂坠',
    prompt: 'Upper body close-up, back view. Focus on the back collar design, upper back fabric drape, and any back construction details like buttons, zipper, or seaming.',
    defaultForOutfit: false,
    defaultForTop: false,
    defaultForBottom: false,
  },
  {
    index: 7,
    frameType: 'lower_body',
    frameLabel: '下半身近景',
    angle: 'front',
    angleLabel: '正面',
    hasModel: true,
    coreValue: '腰头设计，裤腿正面廓形',
    prompt: 'Lower body close-up, front view. Cropped at the waist showing downward. Focus on waistband design, trouser or skirt front panel, and how the fabric falls along the legs or from the hips.',
    defaultForOutfit: false,
    defaultForTop: false,
    defaultForBottom: true,
  },
  {
    index: 8,
    frameType: 'lower_body',
    frameLabel: '下半身近景',
    angle: 'side',
    angleLabel: '侧面',
    hasModel: true,
    coreValue: '侧缝线条，裤腿垂坠感',
    prompt: 'Lower body close-up, side profile. Focus on the side seam lines, pocket design if any, and the fabric drape along the legs from the side angle.',
    defaultForOutfit: false,
    defaultForTop: false,
    defaultForBottom: false,
  },
  {
    index: 9,
    frameType: 'close_up',
    frameLabel: '局部特写',
    angle: 'front',
    angleLabel: '正面',
    hasModel: false,
    coreValue: '面料纹理和光泽感，22momme质感视觉证据',
    prompt: 'Extreme close-up of the silk fabric surface. No model. Show the intricate weave texture, shimmering silk lustre, and how light plays across the 22momme fabric. Macro-level detail revealing the premium quality.',
    defaultForOutfit: true,
    defaultForTop: true,
    defaultForBottom: true,
  }
];

// ===== 尺寸配置 =====
export interface OutputSizeConfig {
  id: string;
  label: string;
  sublabel?: string;
  width: number;
  height: number;
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
}

export const PRODUCT_OUTPUT_SIZES: OutputSizeConfig[] = [
  { id: 'pdp_main', label: '产品卡片/主图', sublabel: '独立站 PDP', width: 1200, height: 1500, aspectRatio: '3:4' },
  { id: 'material', label: '材质区大图', sublabel: '独立站材质展示', width: 1600, height: 2000, aspectRatio: '3:4' },
  { id: 'meta_square', label: 'Meta/INS 方图', sublabel: '1:1', width: 1080, height: 1080, aspectRatio: '1:1' },
  { id: 'ins_vertical', label: 'INS 竖版', sublabel: '4:5', width: 1080, height: 1350, aspectRatio: '3:4' },
  { id: 'custom', label: '自定义尺寸', sublabel: '输入任意宽×高', width: 0, height: 0, aspectRatio: '3:4' }
];

export const SCENE_OUTPUT_SIZES: OutputSizeConfig[] = [
  { id: 'hero_desktop', label: '独立站 Hero·桌面', sublabel: '16:9', width: 2400, height: 1400, aspectRatio: '16:9' },
  { id: 'hero_mobile', label: '独立站 Hero·移动', sublabel: '4:5', width: 1200, height: 1500, aspectRatio: '3:4' },
  { id: 'stories', label: 'Meta/INS Stories·Reels', sublabel: '9:16', width: 1080, height: 1920, aspectRatio: '9:16' },
  { id: 'meta_feed', label: 'Meta 横版广告', sublabel: '1.91:1', width: 1200, height: 628, aspectRatio: '16:9' },
  { id: 'ins_vertical', label: 'INS Feed 竖版', sublabel: '4:5', width: 1080, height: 1350, aspectRatio: '3:4' },
  { id: 'google_rect', label: 'Google Display 矩形', sublabel: '300×250', width: 300, height: 250, aspectRatio: '4:3' },
  { id: 'google_banner', label: 'Google Display 横幅', sublabel: '728×90', width: 728, height: 90, aspectRatio: '16:9' },
  { id: 'custom', label: '自定义尺寸', sublabel: '输入任意宽×高', width: 0, height: 0, aspectRatio: '3:4' }
];

// ===== 工具函数 =====

/** 根据 SKU 类型获取默认选中的镜号 */
export function getDefaultShots(skuType: 'outfit' | 'top' | 'bottom'): number[] {
  return PRODUCT_SHOTS
    .filter(shot => {
      if (skuType === 'outfit') return shot.defaultForOutfit;
      if (skuType === 'top') return shot.defaultForTop;
      if (skuType === 'bottom') return shot.defaultForBottom;
      return false;
    })
    .map(shot => shot.index);
}

/** 将 AspectRatio 字符串转换为 API 格式 */
export function sizeToAspectRatio(width: number, height: number): '1:1' | '3:4' | '4:3' | '9:16' | '16:9' {
  const ratio = width / height;
  if (ratio > 1.5) return '16:9';
  if (ratio > 0.9) return '1:1';
  if (ratio < 0.6) return '9:16';
  return '3:4';
}
