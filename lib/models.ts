export interface ModelConfig {
    id: string;
    name: string;
    description: string;
    gender: 'female' | 'male';
    prompt: string; // The specific prompt to inject for this model
}

export const MODELS: ModelConfig[] = [
    {
        id: 'elena',
        name: 'Elena',
        description: '经典优雅的白人女性，柔和光感肌',
        gender: 'female',
        prompt: 'A sophisticated young Caucasian woman with glowing fair skin, soft wavy hair, elegant posture. Classic beauty with a soft, premium skincare aesthetic.'
    },
    {
        id: 'naomi',
        name: 'Naomi',
        description: '高级时尚感的黑人女性，超模气场',
        gender: 'female',
        prompt: 'A stunning Black woman with deep rich skin tone, refined facial structure, distinct cheekbones, and sleek hair. High-fashion supermodel vibe, confident and strong.'
    },
    {
        id: 'julian',
        name: 'Julian',
        description: '松弛感的老钱风白人男性',
        gender: 'male',
        prompt: 'A handsome Caucasian man with a lean athletic build, light stubble, and a relaxed luxury vibe. "Old money" aesthetic, effortless and charming.'
    },
    {
        id: 'marcus',
        name: 'Marcus',
        description: '沉稳现代的黑人男性',
        gender: 'male',
        prompt: 'A charismatic Black man with a well-groomed beard, deep skin tone, and a strong, calm presence. Modern luxury style, mature and sophisticated.'
    }
];

export const DEFAULT_MODEL = MODELS[0];

// --- Body Type ---
export interface BodyType {
    id: 'slim' | 'curvy';
    name: string;
    description: string;
    prompt: string;
    poseModifier: string; // 附加的姿态指令
}

export const BODY_TYPES: BodyType[] = [
    {
        id: 'slim',
        name: '苗条',
        description: '标准时尚身材，适合常规款式',
        prompt: 'Slim, athletic build with an elegant, elongated silhouette.',
        poseModifier: 'Relaxed, natural posture. Avoid stiff or overly posed looks. Think "candid moment on a lazy Sunday morning". Body language should feel effortless and casual.'
    },
    {
        id: 'curvy',
        name: '性感',
        description: '丰满曲线，适合蕾丝/内衣款式',
        prompt: 'Curvy, voluptuous body with fuller bust, defined waist, full hips and shapely thighs. Sensual and confident.',
        poseModifier: 'Confident, expressive poses that accentuate curves. Highlight the bust, waist-to-hip ratio, and thigh contours. Alluring and self-assured body language.'
    }
];

export const DEFAULT_BODY_TYPE = BODY_TYPES[0];
