'use client';

import { useState } from 'react';
import { SCENE_OUTPUT_SIZES } from '@/lib/models';
import { ImageUploader } from './ImageUploader';
import type { CompressedImage } from '@/lib/image-compressor';

export interface GroupCategory { category: string; description: string; confidence?: number }
export interface GroupAccessory { type: string; description: string }
export interface GroupAnalysisState {
  loading: boolean;
  done: boolean;
  primaryCategories: GroupCategory[];
  accessories: GroupAccessory[];
  garmentsWornByPerson?: boolean;
  error?: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  dress: '连衣裙', top: '上衣', pants: '裤子', skirt: '半身裙',
  suit: '套装', outerwear: '外套', jumpsuit: '连体裤', other: '主品服装',
};
export const ACCESSORY_LABELS: Record<string, string> = {
  bag: '包', jewelry: '首饰', necklace: '项链', belt: '腰带',
  scarf: '围巾', hat: '帽子', shoes: '鞋', other: '附件',
};

// 后端 productImages 硬上限 8（stream/route.ts）——所有品类主品图合计不得超过此数
export const MAX_TOTAL_GARMENTS = 8;
// 固定品类展示顺序，避免识别返回顺序变化导致槽位跳位（layout shift）
const CATEGORY_ORDER = ['dress', 'top', 'pants', 'skirt', 'suit', 'outerwear', 'jumpsuit', 'other'];

interface Props {
  lookbookCount: number;
  groupAnalysis: GroupAnalysisState;
  onReanalyze: () => void;
  groupGarments: Record<string, CompressedImage[]>;
  onGroupGarmentChange: (category: string, images: CompressedImage[]) => void;
  accessoryImages: CompressedImage[];
  onAccessoryImagesChange: (images: CompressedImage[]) => void;
  outputSize: string;
  onOutputSizeChange: (sizeId: string) => void;
  customWidth?: number;
  customHeight?: number;
  onCustomSizeChange?: (w: number, h: number) => void;
  garmentsWornByPerson?: boolean;
}

export function LookbookGarmentSlots({
  lookbookCount,
  groupAnalysis,
  onReanalyze,
  groupGarments,
  onGroupGarmentChange,
  accessoryImages,
  onAccessoryImagesChange,
  outputSize,
  onOutputSizeChange,
  customWidth = 1080,
  customHeight = 1350,
  onCustomSizeChange,
  garmentsWornByPerson = false,
}: Props) {
  const [localCustomW, setLocalCustomW] = useState(customWidth);
  const [localCustomH, setLocalCustomH] = useState(customHeight);

  const detectedCats = Array.from(new Set(groupAnalysis.primaryCategories.map(c => c.category)))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  // 识别完成才显示槽位；识别到几类就几个槽；识别不到主品兜底一个通用槽；识别未完成不显示（骨架占位）
  const garmentSlots: string[] = groupAnalysis.done
    ? (detectedCats.length > 0 ? detectedCats : ['other'])
    : [];
  const totalGarments = Object.values(groupGarments).reduce((n, arr) => n + (arr?.length || 0), 0);
  const overLimit = totalGarments > MAX_TOTAL_GARMENTS;

  return (
    <div className="space-y-5">
      {/* ② 识别到的物品 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[rgba(201,168,108,0.2)]">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">② 识别 lookbook 里的物品</h3>
        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
          上传后系统自动识别其中的服装（衣服 / 裤子 / 连衣裙…）与附件（包 / 首饰 / 项链…），下面按识别结果给你留出上传框。
        </p>

        {lookbookCount === 0 ? (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <p className="text-xs text-amber-600 leading-relaxed">⬆️ 先在上方「① 整组 lookbook」上传你的一组参考图（上传几张，最后就出几张）。</p>
          </div>
        ) : groupAnalysis.loading ? (
          /* 骨架加载（多品类耗时不定，用骨架优于确定性进度条） */
          <div className="mt-4 space-y-2" aria-live="polite">
            <p className="text-xs text-[var(--color-text-secondary)] mb-2">正在识别 lookbook 里的服装与附件…</p>
            <div className="flex gap-2">
              {[0, 1].map(i => (
                <div key={i} className="h-7 w-20 rounded-full bg-[var(--color-background)] animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-text-secondary)]">
              {groupAnalysis.done
                ? `已识别：${detectedCats.length > 0
                    ? detectedCats.map(c => CATEGORY_LABELS[c] || c).join(' / ')
                    : '未明确识别到主品（可在下方通用槽上传）'}`
                : '等待识别…'}
            </p>
            <button
              onClick={onReanalyze}
              className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
            >
              重新识别
            </button>
          </div>
        )}
        {groupAnalysis.error && <p className="mt-2 text-xs text-amber-600">{groupAnalysis.error}</p>}
      </div>

      {/* ③ 按品类替换主品 */}
      {garmentSlots.length > 0 && (
        <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[rgba(201,168,108,0.2)] space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">③ 上传你要换上的服装（主品）</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">按识别出的品类分别上传，每类可传 1 到多张。它们会替换每张 lookbook 里对应的服装。</p>
            </div>
            <span className={`shrink-0 text-xs font-medium tabular-nums ${overLimit ? 'text-amber-600' : 'text-[var(--color-text-muted)]'}`}>
              合计 {totalGarments}/{MAX_TOTAL_GARMENTS}
            </span>
          </div>
          {garmentSlots.map((cat) => (
            <ImageUploader
              key={cat}
              title={CATEGORY_LABELS[cat] || cat}
              description={`上传你的${CATEGORY_LABELS[cat] || cat}（可多张）`}
              maxFiles={MAX_TOTAL_GARMENTS}
              images={groupGarments[cat] || []}
              onImagesChange={(imgs) => onGroupGarmentChange(cat, imgs)}
              variant="gold"
            />
          ))}
          {garmentsWornByPerson && (
            <p className="text-xs text-amber-600 leading-relaxed">
              检测到产品图为真人穿拍，可能干扰新模特长相；建议补充平铺图/白底图效果更稳。
            </p>
          )}
          {totalGarments === 0 && (
            <p className="text-xs text-amber-600">请至少上传一件要换上的服装。</p>
          )}
          {overLimit && (
            <p className="text-xs text-amber-600">主品图合计最多 {MAX_TOTAL_GARMENTS} 张，请减少后再生成。</p>
          )}
        </div>
      )}

      {/* ④ 替换附件（选填） */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">④ 替换附件（选填）</h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          留空则保留 lookbook 里原有的{groupAnalysis.accessories.length > 0
            ? groupAnalysis.accessories.map(a => ACCESSORY_LABELS[a.type] || a.type).join(' / ')
            : '包 / 首饰'}等附件；上传则替换。
        </p>
        <ImageUploader
          title="附件参考图"
          description="上传要替换的附件（包 / 首饰 / 项链等，最多 6 张）"
          maxFiles={6}
          images={accessoryImages}
          onImagesChange={onAccessoryImagesChange}
          variant="gold"
        />
      </div>

      {/* ⑤ 模特说明 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">⑤ 模特</h3>
        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
          每张都换成<span className="text-[var(--color-accent)] font-medium">同一个全新模特</span>（规避原图真人五官侵权），并保持原姿势与场景完全不变。
        </p>
      </div>

      {/* ⑥ 输出尺寸 */}
      <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">⑥ 输出尺寸</h3>
        <div className="space-y-2">
          {SCENE_OUTPUT_SIZES.map((size) => (
            <label
              key={size.id}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                outputSize === size.id
                  ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.05)]'
                  : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
              }`}
            >
              <input
                type="radio"
                name="lookbookOutputSize"
                value={size.id}
                checked={outputSize === size.id}
                onChange={() => onOutputSizeChange(size.id)}
                className="sr-only"
              />
              <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                outputSize === size.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
              }`}>
                {outputSize === size.id && <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />}
              </div>
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--color-text)]">{size.label}</span>
                {size.sublabel && <span className="text-xs text-[var(--color-text-muted)] ml-2">{size.sublabel}</span>}
              </div>
              {size.id !== 'custom' && (
                <span className="text-xs text-[var(--color-text-muted)] font-mono">{size.width}×{size.height}</span>
              )}
            </label>
          ))}
        </div>
        {outputSize === 'custom' && (
          <div className="mt-3 flex items-center gap-3 p-3 bg-[var(--color-background)] rounded-xl">
            <input
              type="number"
              value={localCustomW}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setLocalCustomW(v); onCustomSizeChange?.(v, localCustomH); }}
              placeholder="宽"
              className="w-full text-sm text-center border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-[var(--color-text-muted)] text-sm font-medium">×</span>
            <input
              type="number"
              value={localCustomH}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setLocalCustomH(v); onCustomSizeChange?.(localCustomW, v); }}
              placeholder="高"
              className="w-full text-sm text-center border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-xs text-[var(--color-text-muted)]">px</span>
          </div>
        )}
      </div>
    </div>
  );
}
