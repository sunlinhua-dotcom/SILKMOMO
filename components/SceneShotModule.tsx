'use client';

import { useId, useState } from 'react';
import { SCENE_OUTPUT_SIZES } from '@/lib/models';
import { ImageUploader } from './ImageUploader';
import type { CompressedImage } from '@/lib/image-compressor';
import { useRadioGroup } from './useRadioGroup';

interface SceneShotModuleProps {
  sceneRefImages: CompressedImage[];
  onSceneRefImagesChange: (images: CompressedImage[]) => void;
  hasModel: boolean;
  onHasModelChange: (v: boolean) => void;
  outputSize: string;
  onOutputSizeChange: (sizeId: string) => void;
  customWidth?: number;
  customHeight?: number;
  onCustomSizeChange?: (w: number, h: number) => void;
}

export function SceneShotModule({
  sceneRefImages,
  onSceneRefImagesChange,
  hasModel,
  onHasModelChange,
  outputSize,
  onOutputSizeChange,
  customWidth = 1080,
  customHeight = 1350,
  onCustomSizeChange,
}: SceneShotModuleProps) {
  const [localCustomW, setLocalCustomW] = useState(customWidth);
  const [localCustomH, setLocalCustomH] = useState(customHeight);
  const modelLabelId = useId();
  const sizeLabelId = useId();
  // 布尔值映射成 'yes' | 'no' 两个选项，只在这里转换，对外 props 不变
  const modelRadio = useRadioGroup(['yes', 'no'] as const, hasModel ? 'yes' : 'no', (v) => onHasModelChange(v === 'yes'));

  return (
    <div className="space-y-5">
      {/* 场景参考图（必须） */}
      <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-brand/40">
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-ink">场景参考图</h3>
            <p className="text-xs text-muted mt-0.5">
              上传想要的场景氛围图。系统提取空间结构、光线角度、背景元素，生成相似场景。
            </p>
          </div>
        </div>
        <ImageUploader
          title="场景参考图"
          description="上传 1-5 张场景氛围参考图（生活方式、室内、户外场景均可）"
          maxFiles={5}
          images={sceneRefImages}
          onImagesChange={onSceneRefImagesChange}
          variant="gold"
        />

        {sceneRefImages.length === 0 && (
          <div className="mt-3 p-3 bg-warning-soft border border-warning/30 rounded-xl">
            <p className="text-xs text-warning leading-relaxed">
              <span aria-hidden="true">💡 </span>场景图模块由场景参考图驱动。上传什么风格的场景参考图，就生成相似风格的场景。
            </p>
          </div>
        )}
      </div>

      {/* 模特设置 */}
      <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-border-light">
        <h3 id={modelLabelId} className="text-sm font-semibold text-ink mb-4">模特设置</h3>

        <div {...modelRadio.groupProps} aria-labelledby={modelLabelId} className="grid grid-cols-2 gap-3">
          <button
            type="button"
            {...modelRadio.itemProps('yes')}
            onClick={() => onHasModelChange(true)}
            className={`
              flex flex-col items-center gap-2 p-4 min-h-12 rounded-xl border transition-all duration-200
              ${hasModel
                ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                : 'border-border hover:border-brand-strong/60 hover:bg-background'
              }
            `}
          >
            <span className="text-2xl" aria-hidden="true">👱</span>
            <span className="text-sm font-medium text-ink">
              有模特
            </span>
            <span className="text-xs text-text-secondary text-center leading-tight">
              生活场景图，模特自然融入
            </span>
          </button>

          <button
            type="button"
            {...modelRadio.itemProps('no')}
            onClick={() => onHasModelChange(false)}
            className={`
              flex flex-col items-center gap-2 p-4 min-h-12 rounded-xl border transition-all duration-200
              ${!hasModel
                ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                : 'border-border hover:border-brand-strong/60 hover:bg-background'
              }
            `}
          >
            <span className="text-2xl" aria-hidden="true">🏡</span>
            <span className="text-sm font-medium text-ink">
              氛围静物
            </span>
            <span className="text-xs text-text-secondary text-center leading-tight">
              纯场景氛围，无人物
            </span>
          </button>
        </div>

        {hasModel && (
          <p className="mt-3 text-xs text-text-secondary bg-background p-3 rounded-xl">
            <span aria-hidden="true">💡 </span>场景图中的模特状态自由、舒展、松弛，不预设固定姿势和景别——重点是融入场景的真实感。
          </p>
        )}
      </div>

      {/* 输出尺寸 */}
      <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-border-light">
        <h3 id={sizeLabelId} className="text-sm font-semibold text-ink mb-4">输出尺寸</h3>

        <div role="radiogroup" aria-labelledby={sizeLabelId} className="space-y-2">
          {SCENE_OUTPUT_SIZES.map((size) => (
            <label
              key={size.id}
              className={`
                flex items-center gap-3 p-3 min-h-12 rounded-xl border cursor-pointer transition-all duration-200
                has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-strong
                ${outputSize === size.id
                  ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                  : 'border-border hover:border-brand-strong/60 hover:bg-background'
                }
              `}
            >
              <input
                type="radio"
                name="sceneOutputSize"
                value={size.id}
                checked={outputSize === size.id}
                onChange={() => onOutputSizeChange(size.id)}
                className="sr-only"
              />
              <div aria-hidden="true" className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                outputSize === size.id ? 'border-brand-strong' : 'border-muted'
              }`}>
                {outputSize === size.id && (
                  <div className="w-2 h-2 rounded-full bg-brand-strong" />
                )}
              </div>

              <div className="flex-1">
                <span className="text-sm font-medium text-ink">{size.label}</span>
                {size.sublabel && (
                  <span className="text-xs text-text-secondary ml-2">{size.sublabel}</span>
                )}
              </div>

              {size.id !== 'custom' && (
                <span className="text-xs text-text-secondary font-mono">
                  {size.width}×{size.height}
                </span>
              )}
            </label>
          ))}
        </div>

        {outputSize === 'custom' && (
          <div className="mt-3 flex items-center gap-3 p-3 bg-background rounded-xl">
            <div className="flex items-center gap-2 flex-1">
              <input
                type="number"
                value={localCustomW}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 0;
                  setLocalCustomW(v);
                  onCustomSizeChange?.(v, localCustomH);
                }}
                placeholder="宽"
                aria-label="自定义宽度（像素）"
                className="w-full text-sm text-center border border-border rounded-lg px-3 py-2 min-h-10 bg-surface focus:outline-none focus:border-brand-strong"
              />
            </div>
            <span className="text-muted text-sm font-medium">×</span>
            <div className="flex items-center gap-2 flex-1">
              <input
                type="number"
                value={localCustomH}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 0;
                  setLocalCustomH(v);
                  onCustomSizeChange?.(localCustomW, v);
                }}
                placeholder="高"
                aria-label="自定义高度（像素）"
                className="w-full text-sm text-center border border-border rounded-lg px-3 py-2 min-h-10 bg-surface focus:outline-none focus:border-brand-strong"
              />
            </div>
            <span className="text-xs text-muted">px</span>
          </div>
        )}
      </div>
    </div>
  );
}
