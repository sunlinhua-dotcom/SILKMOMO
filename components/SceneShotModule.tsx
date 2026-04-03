'use client';

import { useState } from 'react';
import { SCENE_OUTPUT_SIZES } from '@/lib/models';
import { ImageUploader } from './ImageUploader';
import type { CompressedImage } from '@/lib/image-compressor';

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
  onCustomSizeChange
}: SceneShotModuleProps) {
  const [localCustomW, setLocalCustomW] = useState(customWidth);
  const [localCustomH, setLocalCustomH] = useState(customHeight);

  return (
    <div className="space-y-5">
      {/* 场景参考图（必须） */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[rgba(201,168,108,0.2)]">
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">场景参考图</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
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
          <div className="mt-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <p className="text-xs text-amber-600 leading-relaxed">
              💡 场景图模块由场景参考图驱动。上传什么风格的场景参考图，就生成相似风格的场景。
            </p>
          </div>
        )}
      </div>

      {/* 模特设置 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">模特设置</h3>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onHasModelChange(true)}
            className={`
              flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200
              ${hasModel
                ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)]'
                : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
              }
            `}
          >
            <span className="text-2xl">👱</span>
            <span className={`text-sm font-medium ${hasModel ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}>
              有模特
            </span>
            <span className="text-xs text-[var(--color-text-muted)] text-center leading-tight">
              生活场景图，模特自然融入
            </span>
          </button>

          <button
            onClick={() => onHasModelChange(false)}
            className={`
              flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200
              ${!hasModel
                ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)]'
                : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
              }
            `}
          >
            <span className="text-2xl">🏡</span>
            <span className={`text-sm font-medium ${!hasModel ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}>
              氛围静物
            </span>
            <span className="text-xs text-[var(--color-text-muted)] text-center leading-tight">
              纯场景氛围，无人物
            </span>
          </button>
        </div>

        {hasModel && (
          <p className="mt-3 text-xs text-[var(--color-text-muted)] bg-[var(--color-background)] p-3 rounded-xl">
            💡 场景图中的模特状态自由、舒展、松弛，不预设固定姿势和景别——重点是融入场景的真实感。
          </p>
        )}
      </div>

      {/* 输出尺寸 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">输出尺寸</h3>

        <div className="space-y-2">
          {SCENE_OUTPUT_SIZES.map((size) => (
            <label
              key={size.id}
              className={`
                flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200
                ${outputSize === size.id
                  ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.05)]'
                  : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
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
              <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                outputSize === size.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
              }`}>
                {outputSize === size.id && (
                  <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                )}
              </div>

              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--color-text)]">{size.label}</span>
                {size.sublabel && (
                  <span className="text-xs text-[var(--color-text-muted)] ml-2">{size.sublabel}</span>
                )}
              </div>

              {size.id !== 'custom' && (
                <span className="text-xs text-[var(--color-text-muted)] font-mono">
                  {size.width}×{size.height}
                </span>
              )}
            </label>
          ))}
        </div>

        {outputSize === 'custom' && (
          <div className="mt-3 flex items-center gap-3 p-3 bg-[var(--color-background)] rounded-xl">
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
                className="w-full text-sm text-center border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <span className="text-[var(--color-text-muted)] text-sm font-medium">×</span>
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
                className="w-full text-sm text-center border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">px</span>
          </div>
        )}
      </div>
    </div>
  );
}
