'use client';

import { Loader, Wand2, Ban, CheckCircle, AlertTriangle } from 'lucide-react';
import { ResultGallery } from '@/components/ResultGallery';
import type { ImageEngine } from '@/components/EngineSelector';
import type { ImageItem } from '@/lib/db';
import { formatYuan, type GenerationError, type GenerationPhase } from '@/lib/task-page-helpers';
import { GenerationProgress } from './GenerationProgress';
import { RotatingTips } from './RotatingTips';
import { ShotNotices, type ShotNotice } from './ShotNotices';

// ===== [E] 结果 UI · 生成中（SSE 实时） · 开始 =====
// ═══ 生成中状态（SSE 实时） ═══
/** 生成中的主进度卡 + 实时追加的已完成图 + 幂等提示 + 非致命错误汇总。 */
export function GeneratingPanel({
  generationPhase,
  phaseTitle,
  phaseSubLabel,
  waitingMessage,
  startedAt,
  etaDeadline,
  isFinishingUp,
  progress,
  liveImages,
  moduleType,
  currentEngineId,
  shotNotices,
  generationErrors,
  unitCostFen,
  onCancel,
  handleRegenerate,
  handleAcceptNewVersion,
  handleRejectNewVersion,
}: {
  generationPhase: GenerationPhase;
  phaseTitle: string;
  phaseSubLabel: string;
  waitingMessage: string;
  startedAt: number;
  etaDeadline: number;
  isFinishingUp: boolean;
  progress: { current: number; total: number; shotIndex: number };
  liveImages: ImageItem[];
  moduleType: string;
  currentEngineId: ImageEngine;
  shotNotices: ShotNotice[];
  generationErrors: GenerationError[];
  unitCostFen: number;
  onCancel: () => void;
  handleRegenerate: (imageId: number, customPrompt?: string) => void | Promise<void>;
  handleAcceptNewVersion: (imageId: number) => void | Promise<void>;
  handleRejectNewVersion: (imageId: number) => void | Promise<void>;
}) {
  return (
    <div className="mb-8">
      {/* 主进度卡 */}
      <div className="mb-4 text-center py-10 px-4 sm:px-6 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center shadow-lg">
          {generationPhase === 'analyzing'
            ? <Loader className="w-8 h-8 text-white animate-spin" strokeWidth={1.5} aria-hidden="true" />
            : <Wand2 className="w-8 h-8 text-white animate-pulse" strokeWidth={1.5} aria-hidden="true" />
          }
        </div>

        <h2 aria-live="polite" className="text-xl font-semibold mb-1">{phaseTitle}</h2>

        <p className="text-sm text-[var(--color-text-secondary)] mb-6">
          {generationPhase === 'analyzing'
            ? '这将帮助 AI 更精准地还原面料细节'
            : <RotatingTips override={waitingMessage} />
          }
        </p>

        {/* 秒表与进度条的每秒刷新封装在这个小组件里，不再带动整页重渲 */}
        <GenerationProgress
          startedAt={startedAt}
          etaDeadline={etaDeadline}
          analyzing={generationPhase === 'analyzing'}
          finishing={isFinishingUp}
          shotFrac={liveImages.length / Math.max(progress.total, 1)}
          subLabel={phaseSubLabel}
          slowAfterSec={currentEngineId === 'openai' ? 300 : 90}
        />

        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          生成期间请保持页面开启；失败的镜次会自动退款。
        </p>

        {moduleType === 'product' && liveImages.length >= 1 && progress.total > 1 && (
          <div className="mt-6 max-w-sm mx-auto p-3.5 rounded-2xl bg-[var(--color-brand-soft)] border border-[var(--color-brand)]/40 text-[var(--color-brand-strong)] text-xs text-center animate-fade-in shadow-sm flex items-center justify-center gap-2">
            <span>✨ 模特身份已成功锚定！正在以此模特渲染剩余的镜次…</span>
          </div>
        )}

        {/* 取消按钮 */}
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 flex min-h-11 items-center gap-1.5 mx-auto px-3 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors"
        >
          <Ban className="w-3.5 h-3.5" aria-hidden="true" />
          取消生成
        </button>
      </div>

      {/* 实时已生成图片追加区 */}
      {liveImages.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)]" aria-hidden="true" />
            已完成 {liveImages.length} 张（生成中实时追加）
          </h3>
          <ResultGallery
            images={liveImages.map(img => ({
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
      )}

      {/* 服务端幂等命中的镜次提示（不是失败） */}
      <ShotNotices notices={shotNotices} />

      {/* 错误汇总（非 fatal，生成仍在继续）。这里只做信息展示——同一条 SSE 流还在跑，
          无法中途单独重试某一张；失败镜次的单张重试在生成结束后用「补生成剩余」或失败态的
          「重试这张」完成。 */}
      {generationErrors.filter(e => !e.fatal).length > 0 && (
        <div className="p-4 bg-[var(--color-warning-soft)] rounded-2xl border border-[var(--color-warning)]/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--color-warning)]">部分镜次生成失败（生成继续，稍后可补生成）</p>
          </div>
          {generationErrors.filter(e => !e.fatal).map((e, i) => (
            <p key={i} className="text-xs text-[var(--color-warning)] font-mono mt-1 break-all">
              镜次 #{e.shotIndex}: {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
// ===== [E] 结果 UI · 生成中（SSE 实时） · 结束 =====
