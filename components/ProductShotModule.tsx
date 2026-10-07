'use client';

import { useId, useState } from 'react';
import { PRODUCT_SHOTS, PRODUCT_OUTPUT_SIZES, getDefaultShots } from '@/lib/models';
import { ImageUploader } from './ImageUploader';
import type { CompressedImage } from '@/lib/image-compressor';
import { Check, Info } from 'lucide-react';
import { useRadioGroup } from './useRadioGroup';

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
  const skuLabelId = useId();
  const shotLabelId = useId();
  const sizeLabelId = useId();
  const bgPanelId = useId();
  const skuRadio = useRadioGroup(SKU_TYPES.map(t => t.id), skuType, handleSkuChange);

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
      <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-border-light">
        <div className="flex items-center gap-2 mb-4">
          <h3 id={skuLabelId} className="text-sm font-semibold text-ink">产品类型</h3>
          <span className="text-xs text-muted bg-background px-2 py-0.5 rounded-lg">
            决定默认生成的镜次
          </span>
        </div>

        <div {...skuRadio.groupProps} aria-labelledby={skuLabelId} className="grid grid-cols-3 gap-3">
          {SKU_TYPES.map((item) => (
            <button
              key={item.id}
              type="button"
              {...skuRadio.itemProps(item.id)}
              onClick={() => handleSkuChange(item.id)}
              className={`
                flex flex-col items-center gap-1.5 p-3.5 min-h-10 rounded-xl border transition-all duration-200
                ${skuType === item.id
                  ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                  : 'border-border hover:border-brand-strong/60 hover:bg-background'
                }
              `}
            >
              <span className="text-xl" aria-hidden="true">{item.icon}</span>
              <span className="text-sm font-semibold text-ink">
                {item.label}
              </span>
              <span className="text-xs text-text-secondary text-center leading-tight">
                {item.sublabel}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 9张候选池 */}
      <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-border-light">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 id={shotLabelId} className="text-sm font-semibold text-ink">镜次选择</h3>
            <p className="text-xs text-muted mt-0.5">从候选池中选择要生成的镜次</p>
          </div>
          <span aria-live="polite" className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
            selectedCount > 0
              ? 'bg-brand-strong text-white'
              : 'bg-background text-muted'
          }`}>
            已选 {selectedCount} 张
          </span>
        </div>

        <div role="group" aria-labelledby={shotLabelId} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PRODUCT_SHOTS.map((shot) => {
            const isSelected = selectedShots.includes(shot.index);
            return (
              <button
                key={shot.index}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleShot(shot.index)}
                className={`
                  flex items-start gap-3 p-3.5 min-h-12 rounded-xl border text-left transition-all duration-200 group
                  ${isSelected
                    ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                    : 'border-border hover:border-brand-strong/60 hover:bg-background'
                  }
                `}
              >
                {/* 镜号徽章 */}
                <div className={`
                  flex-shrink-0 w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition-all
                  ${isSelected
                    ? 'bg-brand-strong text-white'
                    : 'bg-background text-text-secondary group-hover:bg-[var(--color-border-light)]'
                  }
                `}>
                  {shot.index}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* 取景框架 */}
                    <span className="text-xs font-medium text-ink">
                      {FRAME_LABELS[shot.frameType]}
                    </span>
                    <span className="text-muted text-xs" aria-hidden="true">·</span>
                    {/* 角度 */}
                    <span className="text-xs text-text-secondary">
                      {ANGLE_LABELS[shot.angle]}
                    </span>
                    {/* 无模特标签 */}
                    {!shot.hasModel && (
                      <span className="text-xs px-1.5 py-0.5 bg-surface text-text-secondary rounded-md border border-border">
                        无模特
                      </span>
                    )}
                  </div>
                  {/* 核心价值 */}
                  <p className="text-xs text-text-secondary mt-0.5 leading-tight">
                    {shot.coreValue}
                  </p>
                </div>

                {/* 选中勾 */}
                <div aria-hidden="true" className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  isSelected
                    ? 'border-brand-strong bg-brand-strong'
                    : 'border-muted'
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
          <div role="alert" className="mt-3 flex items-center gap-2 p-3 bg-warning-soft border border-warning/30 rounded-xl">
            <Info className="w-4 h-4 text-warning flex-shrink-0" aria-hidden="true" />
            <p className="text-xs text-warning">请至少选择 1 个镜次</p>
          </div>
        )}
      </div>

      {/* 背景参考图（可选） */}
      <div className="bg-surface rounded-2xl border border-border-light overflow-hidden">
        <button
          type="button"
          onClick={() => setShowBgUpload(!showBgUpload)}
          aria-expanded={showBgUpload}
          aria-controls={bgPanelId}
          className="w-full flex items-center justify-between gap-2 px-5 sm:px-6 py-4 min-h-12 hover:bg-background transition-colors"
        >
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-left">
            <span className="text-sm font-medium text-text-secondary">
              背景参考图
            </span>
            <span className="text-xs text-muted bg-background px-2 py-0.5 rounded">
              可选
            </span>
            {bgRefImages.length > 0 && (
              <span className="text-xs font-semibold text-brand-strong">
                已上传 {bgRefImages.length} 张
              </span>
            )}
          </div>
          <svg
            aria-hidden="true"
            className={`w-4 h-4 flex-shrink-0 text-muted transition-transform ${showBgUpload ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showBgUpload && (
          <div id={bgPanelId} className="px-5 sm:px-6 pb-5 pt-2 border-t border-border-light">
            <p className="text-xs text-text-secondary mb-3">
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
      <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-border-light">
        <h3 id={sizeLabelId} className="text-sm font-semibold text-ink mb-4">输出尺寸</h3>

        <div role="radiogroup" aria-labelledby={sizeLabelId} className="space-y-2">
          {PRODUCT_OUTPUT_SIZES.map((size) => (
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
                name="outputSize"
                value={size.id}
                checked={outputSize === size.id}
                onChange={() => onOutputSizeChange(size.id)}
                className="sr-only"
              />
              {/* 单选圈 */}
              <div aria-hidden="true" className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                outputSize === size.id
                  ? 'border-brand-strong'
                  : 'border-muted'
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

        {/* 自定义尺寸输入 */}
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
                min={100}
                max={10000}
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
                min={100}
                max={10000}
              />
            </div>
            <span className="text-xs text-muted">px</span>
          </div>
        )}
      </div>
    </div>
  );
}
