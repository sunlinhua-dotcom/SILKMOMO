'use client';

import { Zap, RefreshCcw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ModelSelector } from '@/components/ModelSelector';
import { EngineSelector, type ImageEngine } from '@/components/EngineSelector';
import { ImageUploader } from '@/components/ImageUploader';
import { BodyTypeSelector } from '@/components/BodyTypeSelector';
import { SkinToneSelector } from '@/components/SkinToneSelector';
import { GPTQualitySelector } from '@/components/GPTQualitySelector';
import type { GenerationQuality } from '@/lib/billing-constants';
import type { CompressedImage } from '@/lib/image-compressor';
import { formatYuan } from '@/lib/task-page-helpers';
import { RECHARGE_BUTTON_CLASS } from './styles';

/** 「调整参数，重新生成」面板（统一用 <Modal>：Esc 关闭、焦点陷阱与归还、滚动锁、手机端底部抽屉）。 */
export function AdjustParamsModal({
  open,
  onClose,
  insufficient,
  onRecharge,
  onConfirm,
  fullRunCount,
  fullRunCostFen,
  isFollowSceneGroupTask,
  moduleType,
  currentModelName,
  currentBodyTypeName,
  currentSkinToneName,
  newEngine,
  setNewEngine,
  newQuality,
  setNewQuality,
  newModelId,
  setNewModelId,
  newBodyType,
  setNewBodyType,
  newSkinTone,
  setNewSkinTone,
  newStyleImages,
  setNewStyleImages,
}: {
  open: boolean;
  onClose: () => void;
  /** 已确认余额不足：确认按钮换成充值入口 */
  insufficient: boolean;
  onRecharge: () => void;
  /** 点「开始重新生成」（页面已包好余额校验） */
  onConfirm: () => void;
  fullRunCount: number;
  fullRunCostFen: number;
  isFollowSceneGroupTask: boolean;
  moduleType: string;
  currentModelName: string;
  currentBodyTypeName: string;
  currentSkinToneName: string;
  newEngine: ImageEngine;
  setNewEngine: (engine: ImageEngine) => void;
  newQuality: GenerationQuality;
  setNewQuality: (quality: GenerationQuality) => void;
  newModelId: string;
  setNewModelId: (id: string) => void;
  newBodyType: 'slim' | 'standard' | 'curvy';
  setNewBodyType: (value: 'slim' | 'standard' | 'curvy') => void;
  newSkinTone: 'light' | 'medium' | 'deep';
  setNewSkinTone: (value: 'light' | 'medium' | 'deep') => void;
  newStyleImages: CompressedImage[];
  setNewStyleImages: (images: CompressedImage[]) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="调整参数，重新生成"
      size="lg"
      footer={
        <div className="flex w-full flex-col gap-2">
          {insufficient ? (
            <button
              type="button"
              onClick={onRecharge}
              className={RECHARGE_BUTTON_CLASS}
            >
              <Zap className="w-5 h-5" aria-hidden="true" />
              余额不足，去充值
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              className="btn-primary w-full"
            >
              <RefreshCcw className="w-5 h-5" aria-hidden="true" />
              <span>开始重新生成 · {fullRunCount} 张 · <span className="num">{formatYuan(fullRunCostFen)}</span></span>
            </button>
          )}
          <p className="text-center text-xs text-[var(--color-text-muted)]">
            {isFollowSceneGroupTask
              ? '将使用原有的产品图与场景图重新生成，肤色·体型·发型继续跟随场景图'
              : '将使用原有的产品图，配合新的模特/体型/肤色参数重新生成'}
            ；旧图保留为备份，失败的镜次自动退款。
          </p>
        </div>
      }
    >
      <div className="space-y-6 pt-2">
        {/* 当前参数概览 */}
        <div className="text-sm text-[var(--color-text-secondary)] space-y-1">
          {isFollowSceneGroupTask ? (
            <div className="font-medium text-[var(--color-text)]">肤色·体型·发型跟随场景图</div>
          ) : (
            <>
              <div>当前模特: <span className="font-medium text-[var(--color-text)]">{currentModelName}</span></div>
              <div>当前体型: <span className="font-medium text-[var(--color-text)]">{currentBodyTypeName}</span></div>
              <div>当前肤色: <span className="font-medium text-[var(--color-text)]">{currentSkinToneName}</span></div>
            </>
          )}
        </div>

        {/* 生图引擎选择 */}
        <div>
          <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">生图引擎</h3>
          <EngineSelector
            selected={newEngine}
            onSelect={setNewEngine}
            variant="full"
          />
          {newEngine === 'openai' && (
            <GPTQualitySelector
              value={newQuality}
              onChange={setNewQuality}
              variant="full"
            />
          )}
        </div>

        {!isFollowSceneGroupTask && (
          <>
            {/* 模特选择 */}
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">选择模特</h3>
              <ModelSelector
                selectedModel={newModelId}
                onSelect={setNewModelId}
              />
            </div>

            {/* 体型选择（三选） */}
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">体型选择</h3>
              <BodyTypeSelector
                selectedBodyType={newBodyType}
                onSelect={setNewBodyType}
              />
            </div>

            {/* 肤色选择（三选） */}
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">肤色选择</h3>
              <SkinToneSelector
                selectedSkinTone={newSkinTone}
                onSelect={setNewSkinTone}
              />
            </div>
          </>
        )}

        {/* 风格参考上传 */}
        <div>
          <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
            更换{moduleType === 'scene' ? '场景' : '背景'}参考 <span className="text-[var(--color-text-muted)]">(可选)</span>
          </h3>
          <ImageUploader
            title=""
            description={moduleType === 'scene'
              ? '上传新的场景参考图，将覆盖原有设置'
              : '上传新的背景参考图，将覆盖原有设置'
            }
            maxFiles={5}
            images={newStyleImages}
            onImagesChange={setNewStyleImages}
            variant="gray"
          />
        </div>
      </div>
    </Modal>
  );
}
