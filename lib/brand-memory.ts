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
}

/**
 * 获取用户的默认品牌配置
 * 如果不存在，自动创建一个
 */
export async function getDefaultBrandProfile(userId: string) {
  let profile = await prisma.brandProfile.findFirst({
    where: { userId, isDefault: true },
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
  }
) {
  const profile = await prisma.brandProfile.findFirst({
    where: { userId, isDefault: true },
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
