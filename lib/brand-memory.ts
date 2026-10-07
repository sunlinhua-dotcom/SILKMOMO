/**
 * Phase 4A：品牌 DNA 记忆
 * 记住用户的模特/体型/肤色/背景偏好，下次自动回填
 */
import prisma from './prisma';

export interface BrandProfileData {
  name?: string;
  defaultModelId?: string;
  defaultBodyType?: string;
  defaultSkinTone?: string;
  lightingStyle?: string;
  bgPreference?: string;
  colorPalette?: string[];
  promptSuffix?: string;
  defaultModule?: string;
  defaultAspectRatio?: string;
  defaultEngine?: string;
}

// ═══ 入参校验 ═══
export const BRAND_LIMITS = {
  name: 64,
  idLike: 64, // defaultModelId / defaultBodyType / ... / lightingStyle / bgPreference
  promptSuffix: 500,
  paletteMaxItems: 12,
  paletteItem: 32,
} as const;

const ID_LIKE_FIELDS = [
  'defaultModelId', 'defaultBodyType', 'defaultSkinTone', 'lightingStyle',
  'bgPreference', 'defaultModule', 'defaultAspectRatio', 'defaultEngine',
] as const;

export type BrandValidationResult =
  | { ok: true; data: BrandProfileData }
  | { ok: false; error: string };

/**
 * 校验并清洗 PUT /api/brand 的请求体：只保留已知字段，字符串字段做类型与长度上限校验。
 * id 类字段（模型 id、体型、比例等）只允许字母数字及 _ - : . 且 ≤64 位，允许空串（表示未选）。
 */
export function validateBrandProfileInput(raw: unknown): BrandValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '请求体格式非法' };
  }
  const o = raw as Record<string, unknown>;
  const data: BrandProfileData = {};

  if (o.name !== undefined) {
    if (typeof o.name !== 'string') return { ok: false, error: '品牌名称必须是字符串' };
    const name = o.name.trim();
    if (name.length > BRAND_LIMITS.name) return { ok: false, error: `品牌名称最多 ${BRAND_LIMITS.name} 个字符` };
    if (name) data.name = name; // 空名称忽略，保留原值
  }

  for (const key of ID_LIKE_FIELDS) {
    const v = o[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') return { ok: false, error: `${key} 必须是字符串` };
    if (v.length > BRAND_LIMITS.idLike || !/^[\w:.\-]*$/.test(v)) {
      return { ok: false, error: `${key} 取值非法` };
    }
    data[key] = v;
  }

  if (o.promptSuffix !== undefined) {
    if (typeof o.promptSuffix !== 'string') return { ok: false, error: '提示词后缀必须是字符串' };
    if (o.promptSuffix.length > BRAND_LIMITS.promptSuffix) {
      return { ok: false, error: `提示词后缀最多 ${BRAND_LIMITS.promptSuffix} 个字符` };
    }
    data.promptSuffix = o.promptSuffix;
  }

  if (o.colorPalette !== undefined) {
    const p = o.colorPalette;
    if (
      !Array.isArray(p) || p.length > BRAND_LIMITS.paletteMaxItems ||
      p.some(c => typeof c !== 'string' || c.length > BRAND_LIMITS.paletteItem)
    ) {
      return { ok: false, error: '调色板格式非法' };
    }
    data.colorPalette = p as string[];
  }

  return { ok: true, data };
}

/**
 * 获取用户的默认品牌配置
 * 如果不存在，自动创建一个
 */
export async function getDefaultBrandProfile(userId: string) {
  // schema 没有 (userId, isDefault) 唯一约束，并发首次访问可能建出多条默认档案；
  // 固定按 createdAt 升序取最旧一条，保证读写始终命中同一档案
  let profile = await prisma.brandProfile.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!profile) {
    profile = await prisma.brandProfile.create({
      data: {
        userId,
        name: '默认品牌',
        isDefault: true,
      },
    });
  }

  return {
    id: profile.id,
    name: profile.name,
    defaultModelId: profile.defaultModelId,
    defaultBodyType: profile.defaultBodyType,
    defaultSkinTone: profile.defaultSkinTone,
    lightingStyle: profile.lightingStyle,
    bgPreference: profile.bgPreference,
    colorPalette: safeParseJSON(profile.colorPalette, []),
    promptSuffix: profile.promptSuffix,
    defaultModule: profile.defaultModule,
    defaultAspectRatio: profile.defaultAspectRatio,
    defaultEngine: profile.defaultEngine,
  };
}

/**
 * 更新品牌配置（自动保存用户每次的选择）
 */
export async function updateBrandProfile(
  userId: string,
  profileId: string,
  data: BrandProfileData
) {
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.defaultModelId !== undefined) updateData.defaultModelId = data.defaultModelId;
  if (data.defaultBodyType !== undefined) updateData.defaultBodyType = data.defaultBodyType;
  if (data.defaultSkinTone !== undefined) updateData.defaultSkinTone = data.defaultSkinTone;
  if (data.lightingStyle !== undefined) updateData.lightingStyle = data.lightingStyle;
  if (data.bgPreference !== undefined) updateData.bgPreference = data.bgPreference;
  if (data.colorPalette !== undefined) updateData.colorPalette = JSON.stringify(data.colorPalette);
  if (data.promptSuffix !== undefined) updateData.promptSuffix = data.promptSuffix;
  if (data.defaultModule !== undefined) updateData.defaultModule = data.defaultModule;
  if (data.defaultAspectRatio !== undefined) updateData.defaultAspectRatio = data.defaultAspectRatio;
  if (data.defaultEngine !== undefined) updateData.defaultEngine = data.defaultEngine;

  return await prisma.brandProfile.update({
    where: { id: profileId, userId },
    data: updateData,
  });
}

/**
 * 静默自动保存：用户每次生成时，自动将选择存入品牌配置
 * 不打扰用户，后台默默学习偏好
 */
export async function autoSaveBrandPreference(
  userId: string,
  preferences: {
    modelId?: string;
    bodyType?: string;
    skinTone?: string;
    module?: string;
    aspectRatio?: string;
    engine?: string;
  }
) {
  const profile = await prisma.brandProfile.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!profile) {
    // 第一次使用，创建品牌配置
    await prisma.brandProfile.create({
      data: {
        userId,
        name: '默认品牌',
        isDefault: true,
        defaultModelId: preferences.modelId || 'elena',
        defaultBodyType: preferences.bodyType || 'standard',
        defaultSkinTone: preferences.skinTone || 'light',
        defaultModule: preferences.module || 'product',
        defaultAspectRatio: preferences.aspectRatio || '3:4',
        defaultEngine: preferences.engine || 'gemini',
      },
    });
    return;
  }

  // 只更新用户这次选了的字段
  const updateData: Record<string, string> = {};
  if (preferences.modelId) updateData.defaultModelId = preferences.modelId;
  if (preferences.bodyType) updateData.defaultBodyType = preferences.bodyType;
  if (preferences.skinTone) updateData.defaultSkinTone = preferences.skinTone;
  if (preferences.module) updateData.defaultModule = preferences.module;
  if (preferences.aspectRatio) updateData.defaultAspectRatio = preferences.aspectRatio;
  if (preferences.engine) updateData.defaultEngine = preferences.engine;

  if (Object.keys(updateData).length > 0) {
    await prisma.brandProfile.update({
      where: { id: profile.id },
      data: updateData,
    });
  }
}

function safeParseJSON<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
