'use client';

import { useState } from 'react';
import { PRODUCT_SHOTS, PRODUCT_OUTPUT_SIZES, getDefaultShots } from '@/lib/models';
import { ImageUploader } from './ImageUploader';
import type { CompressedImage } from '@/lib/image-compressor';
import { Check, Info } from 'lucide-react';

interface ProductShotModuleProps {
  skuType: 'outfit' | 'top' | 'bottom';
  onSkuTypeChange: (sku: 'outfit' | 'top' | 'bottom') => void;
  selectedShots: number[];
  onShotsChange: (shots: number[]) => void;
  bgRefImages: CompressedImage[];
  onBgRefImagesChange: (images: CompressedImage[]) => void;
  outputSize: string;
  onOutputSizeChange: (sizeId: string) => void;
  customWidth?: number;
  customHeight?: number;
  onCustomSizeChange?: (w: number, h: number) => void;
}

const SKU_TYPES = [
  { id: 'outfit' as const, label: '套装', sublabel: '上下装搭配', icon: '👔' },
  { id: 'top' as const, label: '单件上装', sublabel: '上衣/衬衫/连衣裙', icon: '👚' },
  { id: 'bottom' as const, label: '单件下装', sublabel: '裤子/半裙', icon: '👖' }
];

const FRAME_LABELS: Record<string, string> = {
  full_body: '全身近景',
  upper_body: '上半身近景',
  lower_body: '下半身近景',
  close_up: '局部特写'
};

const ANGLE_LABELS: Record<string, string> = {
  front: '正面',
  side: '侧面',
  back: '背面'
};

export function ProductShotModule({
  skuType,
  onSkuTypeChange,
  selectedShots,
  onShotsChange,
  bgRefImages,
  onBgRefImagesChange,
  outputSize,
  onOutputSizeChange,
  customWidth = 1200,
  customHeight = 1500,
  onCustomSizeChange
}: ProductShotModuleProps) {
  const [showBgUpload, setShowBgUpload] = useState(false);
  const [localCustomW, setLocalCustomW] = useState(customWidth);
  const [localCustomH, setLocalCustomH] = useState(customHeight);

  // SKU 类型变化时自动更新默认选中
  function handleSkuChange(sku: 'outfit' | 'top' | 'bottom') {
    onSkuTypeChange(sku);
    onShotsChange(getDefaultShots(sku));
  }

  // 切换单张镜次
  function toggleShot(index: number) {
    if (selectedShots.includes(index)) {
      onShotsChange(selectedShots.filter(i => i !== index));
    } else {
      onShotsChange([...selectedShots, index].sort((a, b) => a - b));
    }
  }

  const selectedCount = selectedShots.length;

  return (
    <div className="space-y-5">
      {/* SKU 类型选择 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">产品类型</h3>
          <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-0.5 rounded-lg">
            决定默认生成的镜次
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {SKU_TYPES.map((sku) => (
            <button
              key={sku.id}
              onClick={() => handleSkuChange(sku.id)}
              className={`
                flex flex-col items-center gap-1.5 p-3.5 rounded-xl border transition-all duration-200
                ${skuType === sku.id
                  ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)]'
                  : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
                }
              `}
            >
              <span className="text-xl">{sku.icon}</span>
              <span className={`text-sm font-semibold ${skuType === sku.id ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                {sku.label}
              </span>
              <span className="text-xs text-[var(--color-text-muted)] text-center leading-tight">
                {sku.sublabel}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 9张候选池 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">镜次选择</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">从候选池中选择要生成的镜次</p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
            selectedCount > 0
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-background)] text-[var(--color-text-muted)]'
          }`}>
            已选 {selectedCount} 张
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PRODUCT_SHOTS.map((shot) => {
            const isSelected = selectedShots.includes(shot.index);
            return (
              <button
                key={shot.index}
                onClick={() => toggleShot(shot.index)}
                className={`
                  flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all duration-200 group
                  ${isSelected
                    ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.05)]'
                    : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
                  }
                `}
              >
                {/* 镜号徽章 */}
                <div className={`
                  flex-shrink-0 w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition-all
                  ${isSelected
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-background)] text-[var(--color-text-muted)] group-hover:bg-[var(--color-border-light)]'
                  }
                `}>
                  {shot.index}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* 取景框架 */}
                    <span className={`text-xs font-medium ${isSelected ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}`}>
                      {FRAME_LABELS[shot.frameType]}
                    </span>
                    <span className="text-[var(--color-border)] text-xs">·</span>
                    {/* 角度 */}
                    <span className={`text-xs ${isSelected ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`}>
                      {ANGLE_LABELS[shot.angle]}
                    </span>
                    {/* 无模特标签 */}
                    {!shot.hasModel && (
                      <span className="text-xs px-1.5 py-0.5 bg-[var(--color-background)] text-[var(--color-text-muted)] rounded-md border border-[var(--color-border-light)]">
                        无模特
                      </span>
                    )}
                  </div>
                  {/* 核心价值 */}
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-tight">
                    {shot.coreValue}
                  </p>
                </div>

                {/* 选中勾 */}
                <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  isSelected
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                    : 'border-[var(--color-border)] group-hover:border-[var(--color-border)]'
                }`}>
                  {isSelected && (
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* 提示 */}
        {selectedCount === 0 && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <Info className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-amber-600">请至少选择 1 个镜次</p>
          </div>
        )}
      </div>

      {/* 背景参考图（可选） */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border-light)] overflow-hidden">
        <button
          onClick={() => setShowBgUpload(!showBgUpload)}
          className="w-full flex items-center justify-between px-5 sm:px-6 py-4 hover:bg-[var(--color-background)] transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">
              背景参考图
            </span>
            <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-0.5 rounded">
              可选
            </span>
            {bgRefImages.length > 0 && (
              <span className="text-xs font-semibold text-[var(--color-accent)]">
                已上传 {bgRefImages.length} 张
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${showBgUpload ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showBgUpload && (
          <div className="px-5 sm:px-6 pb-5 pt-2 border-t border-[var(--color-border-light)]">
            <p className="text-xs text-[var(--color-text-muted)] mb-3">
              上传 1-3 张背景参考图，系统提取色调和轻微环境感。同批产品图背景保持一致，不同产品可更换。
            </p>
            <ImageUploader
              title="背景参考图"
              description="1-3 张，轻微环境感背景（有色调的浅背景）"
              maxFiles={3}
              images={bgRefImages}
              onImagesChange={onBgRefImagesChange}
              variant="dashed"
            />
          </div>
        )}
      </div>

      {/* 输出尺寸 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">输出尺寸</h3>

        <div className="space-y-2">
          {PRODUCT_OUTPUT_SIZES.map((size) => (
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
                name="outputSize"
                value={size.id}
                checked={outputSize === size.id}
                onChange={() => onOutputSizeChange(size.id)}
                className="sr-only"
              />
              {/* 单选圈 */}
              <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                outputSize === size.id
                  ? 'border-[var(--color-accent)]'
                  : 'border-[var(--color-border)]'
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

        {/* 自定义尺寸输入 */}
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
                min={100}
                max={10000}
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
                min={100}
                max={10000}
              />
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">px</span>
          </div>
        )}
      </div>
    </div>
  );
}
