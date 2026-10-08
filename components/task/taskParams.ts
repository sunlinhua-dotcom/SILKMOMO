import type { Project } from '@/lib/db';
import { ENGINES, type ImageEngine } from '@/components/EngineSelector';
import { getGenerationQualityLabel, normalizeGenerationQuality } from '@/lib/billing-constants';
import {
  MODELS, BODY_TYPES, SKIN_TONES,
  PRODUCT_OUTPUT_SIZES, SCENE_OUTPUT_SIZES,
  DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE,
  ETHNICITY_LABELS, SKU_LABELS,
} from '@/lib/models';

/** 任务当前参数的展示用摘要（从 project 纯推导，参数芯片 / 调整面板 / AI 聊天上下文共用）。 */
export function getTaskParamSummary(project: Project | null | undefined) {
  const currentModel = project?.modelId ? MODELS.find(m => m.id === project.modelId) : undefined;
  const currentModelName = currentModel?.name ?? '未选择预设模特';
  const currentBodyTypeName = BODY_TYPES.find(b => b.id === project?.bodyType)?.name || DEFAULT_BODY_TYPE.name;
  const currentSkinToneName = SKIN_TONES.find(s => s.id === project?.skinTone)?.name || DEFAULT_SKIN_TONE.name;
  const currentEthnicityLabel = currentModel ? ETHNICITY_LABELS[currentModel.ethnicity] : null;
  const currentSkuLabel = project?.skuType ? SKU_LABELS[project.skuType] : null;

  const currentShotCount = (() => {
    if (!project?.selectedShots) return null;
    try { return JSON.parse(project.selectedShots).length as number; } catch { return null; }
  })();

  const currentOutputSizeLabel = (() => {
    if (!project) return null;
    const moduleT = project.moduleType || 'product';
    const sizeId = moduleT === 'scene' ? project.sceneOutputSize : project.outputSize;
    if (!sizeId) return null;
    const sizes = moduleT === 'scene' ? SCENE_OUTPUT_SIZES : PRODUCT_OUTPUT_SIZES;
    const size = sizes.find(s => s.id === sizeId);
    if (!size) return null;
    if (size.id === 'custom') {
      // 显示用户实际输入的宽高（'custom' 条目里的 aspectRatio 只是 3:4 占位）
      return project.customWidth && project.customHeight
        ? `自定义 ${project.customWidth}×${project.customHeight}`
        : '自定义尺寸';
    }
    return `${size.label} ${size.aspectRatio}`;
  })();

  const currentEngineId: ImageEngine = project?.engine === 'openai' ? 'openai' : 'gemini';
  const currentEngineName = ENGINES.find(e => e.id === currentEngineId)?.name ?? 'Gemini Flash Image';
  const currentQuality = normalizeGenerationQuality(project?.generationQuality);
  const currentQualityLabel = getGenerationQualityLabel(currentQuality);

  return {
    currentModelName,
    currentBodyTypeName,
    currentSkinToneName,
    currentEthnicityLabel,
    currentSkuLabel,
    currentShotCount,
    currentOutputSizeLabel,
    currentEngineId,
    currentEngineName,
    currentQualityLabel,
  };
}

export type TaskParamSummary = ReturnType<typeof getTaskParamSummary>;
