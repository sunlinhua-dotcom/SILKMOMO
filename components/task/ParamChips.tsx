'use client';

import type { Project } from '@/lib/db';
import type { TaskParamSummary } from './taskParams';

/** 任务参数芯片（引擎 / 画质 / 模特 / 体型 / 肤色 / SKU / 镜次 / 尺寸），只在「输入图片」卡里显示一份。 */
export function ParamChips({
  project,
  moduleType,
  isFollowSceneGroupTask,
  summary,
}: {
  project: Project;
  moduleType: string;
  isFollowSceneGroupTask: boolean;
  summary: TaskParamSummary;
}) {
  const {
    currentEngineName, currentEngineId, currentQualityLabel, currentModelName, currentEthnicityLabel,
    currentBodyTypeName, currentSkinToneName, currentSkuLabel, currentShotCount, currentOutputSizeLabel,
  } = summary;
  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
        引擎: {currentEngineName}
      </span>
      {currentEngineId === 'openai' && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          画质: {currentQualityLabel}
        </span>
      )}
      {isFollowSceneGroupTask ? (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          肤色·体型·发型跟随场景图
        </span>
      ) : project.modelId && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          模特: {currentModelName}{currentEthnicityLabel ? ` · ${currentEthnicityLabel}` : ''}
        </span>
      )}
      {!isFollowSceneGroupTask && (
        <>
          <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
            体型: {currentBodyTypeName}
          </span>
          <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
            肤色: {currentSkinToneName}
          </span>
        </>
      )}
      {moduleType === 'product' && currentSkuLabel && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          SKU: {currentSkuLabel}
        </span>
      )}
      {moduleType === 'product' && currentShotCount !== null && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          镜次: {currentShotCount} 张
        </span>
      )}
      {moduleType === 'scene' && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          场景: {project.sceneHasModel === false ? '氛围静物' : '有模特'}
        </span>
      )}
      {currentOutputSizeLabel && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          尺寸: {currentOutputSizeLabel}
        </span>
      )}
    </div>
  );
}
