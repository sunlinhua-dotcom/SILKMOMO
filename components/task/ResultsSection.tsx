'use client';

import type { RefObject } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ResultGallery } from '@/components/ResultGallery';
import type { ImageItem } from '@/lib/db';
import { formatYuan } from '@/lib/task-page-helpers';
import { ShotNotices, type ShotNotice } from './ShotNotices';

// ===== [E] 结果 UI · 结果展示 · 开始 =====
/** 结果展示区：混款告警、部分成功提示、幂等提示、产品组标签与结果画廊。 */
export function ResultsSection({
  images,
  resultsRef,
  warningMessage,
  generating,
  projectStatus,
  displayErrorMessage,
  shotNotices,
  productGroupLabels,
  unitCostFen,
  handleRegenerate,
  handleAcceptNewVersion,
  handleRejectNewVersion,
}: {
  images: ImageItem[];
  resultsRef: RefObject<HTMLDivElement | null>;
  warningMessage: string | null;
  generating: boolean;
  projectStatus: string;
  displayErrorMessage: string | null;
  shotNotices: ShotNotice[];
  productGroupLabels: string[];
  unitCostFen: number;
  handleRegenerate: (imageId: number, customPrompt?: string) => void | Promise<void>;
  handleAcceptNewVersion: (imageId: number) => void | Promise<void>;
  handleRejectNewVersion: (imageId: number) => void | Promise<void>;
}) {
  return (
    <div ref={resultsRef}>
      {/* 混款告警：卖家把两件不同单品混在一次上传里，出图会串味。
          不是失败、不打断生成，所以单独一条黄条，和错误提示区分开。 */}
      {warningMessage && (
        <div className="mb-5 p-4 bg-[var(--color-warning-soft)] rounded-2xl border border-[var(--color-warning)]/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm text-[var(--color-warning)] font-medium">这次上传的产品图像是不止一件单品</p>
              <p className="text-sm text-[var(--color-warning)] break-words mt-1">{warningMessage}</p>
              <p className="text-xs text-[var(--color-warning)] mt-1.5">
                混在一起会让出图串味。建议每件单品单独建一个任务重新生成。
              </p>
            </div>
          </div>
        </div>
      )}
      {/* 部分成功提示：任务"已完成"但中途有镜次失败 / 余额不足。
          不渲染的话余额不足等 fatal 信息在已完成任务上完全不可见 */}
      {!generating && projectStatus === 'completed' && displayErrorMessage && (
        <div className="mb-5 p-4 bg-[var(--color-warning-soft)] rounded-2xl border border-[var(--color-warning)]/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] mt-0.5 shrink-0" aria-hidden="true" />
            {/* 仅展示错误信息;"生成剩余"入口已由上方持久化条件的面板统一提供,此处不再重复按钮 */}
            <p className="text-sm text-[var(--color-warning)] break-words flex-1">{displayErrorMessage}</p>
          </div>
        </div>
      )}
      {!generating && <ShotNotices notices={shotNotices} />}
      <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        生成结果 · {images.length} 张
      </h2>

      {/* 参数芯片（引擎 / 画质 / 模特…）只在上方「输入图片」卡里显示一份，这里不再重复 */}

      {productGroupLabels.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {productGroupLabels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="text-xs px-2.5 py-1 rounded-lg bg-[var(--color-background)] text-[var(--color-text-secondary)]"
            >
              产品 {index + 1}: {label || `产品 ${index + 1}`}
            </span>
          ))}
        </div>
      )}

      <ResultGallery
        images={images.map(img => ({
          id: img.id!,
          type: img.imageType || 'close_up',
          imageType: img.imageType || 'close_up',
          data: img.data,
          prompt: img.prompt,
          index: img.index,
          backup: img.backup,
        }))}
        onRegenerate={handleRegenerate}
        regenerateCostLabel={formatYuan(unitCostFen)}
        onAcceptNewVersion={handleAcceptNewVersion}
        onRejectNewVersion={handleRejectNewVersion}
      />
    </div>
  );
}
// ===== [E] 结果 UI · 结果展示 · 结束 =====
