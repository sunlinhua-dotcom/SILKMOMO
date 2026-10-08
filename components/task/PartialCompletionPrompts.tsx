'use client';

import { Wand2, Zap, Settings2 } from 'lucide-react';
import type { Project } from '@/lib/db';
import { formatYuan } from '@/lib/task-page-helpers';
import { RECHARGE_BUTTON_CLASS } from './styles';

/** 试生成完成 / 组图部分完成后的「生成剩余」提示条。 */
export function PartialCompletionPrompts({
  project,
  moduleType,
  generating,
  trialDone,
  imageCount,
  shotCount,
  unitCostFen,
  affordability,
  setRechargeNeedFen,
  runPaidAction,
  onGenerateRemaining,
  onAdjust,
}: {
  project: Project;
  moduleType: string;
  generating: boolean;
  trialDone: boolean;
  imageCount: number;
  shotCount: number;
  unitCostFen: number;
  affordability: (costFen: number) => 'ok' | 'insufficient' | 'unknown';
  setRechargeNeedFen: (costFen: number) => void;
  runPaidAction: (costFen: number, action: () => void) => void;
  onGenerateRemaining: () => void | Promise<void>;
  onAdjust: () => void;
}) {
  /** 「生成剩余 N 张 · ¥x」：试生成后 / 组图部分完成后补齐用；余额不足时变成充值入口。 */
  const renderRemainingButton = (remainingCount: number) => {
    const costFen = remainingCount * unitCostFen;
    if (affordability(costFen) === 'insufficient') {
      return (
        <button type="button" onClick={() => setRechargeNeedFen(costFen)} className={RECHARGE_BUTTON_CLASS}>
          <Zap className="w-4 h-4" aria-hidden="true" />
          余额不足，去充值
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => runPaidAction(costFen, () => void onGenerateRemaining())}
        className="btn-primary text-sm px-5 py-2.5"
      >
        <Wand2 className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
        <span>生成剩余 {remainingCount} 张 · <span className="num">{formatYuan(costFen)}</span></span>
      </button>
    );
  };

  return (
    <>
      {/* 试生成完成 / 部分完成 → 生成剩余按钮。
          用持久化的 project.status==='completed' 作主条件(trialDone 是内存态、刷新即丢,
          否则 reload 一个"已完成但只出了部分镜次"的任务后,所有"继续生成剩余"入口全消失,
          只剩会把已生成图降级重做的「调整参数」)。trialDone 作同会话兜底。 */}
      {!generating && moduleType === 'product' && (project.status === 'completed' || trialDone)
        && imageCount > 0 && imageCount < shotCount && (
        <div className="mb-8 p-5 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-brand)]/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">✅ 试生成完成 — 效果满意吗？</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              满意就继续生成剩余 {shotCount - imageCount} 张，不满意可以调整参数重试
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onAdjust}
              className="flex min-h-11 items-center justify-center gap-2 px-4 py-2.5 text-sm border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-background)] text-[var(--color-text-secondary)] transition-colors"
            >
              <Settings2 className="w-4 h-4" aria-hidden="true" />
              调整参数
            </button>
            {renderRemainingButton(shotCount - imageCount)}
          </div>
        </div>
      )}

      {/* 组图·部分完成（如大批量分批 / 中途失败）→ 生成剩余。张数多时 GPT 单条 SSE 跑不完，靠此续跑补齐 */}
      {!generating && moduleType === 'scene' && project.sceneGroup && project.status === 'completed'
        && imageCount > 0 && shotCount > 0 && imageCount < shotCount && (
        <div className="mb-8 p-5 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-brand)]/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">已完成 {imageCount} / {shotCount} 张组图</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              还差 {shotCount - imageCount} 张（张数多时会分批完成）——点下方补齐剩余。
            </p>
          </div>
          {renderRemainingButton(shotCount - imageCount)}
        </div>
      )}
    </>
  );
}
