'use client';

import { XCircle, AlertTriangle } from 'lucide-react';
import { FailureHistoryPanel } from '@/components/FailureHistoryPanel';
import { formatYuan, type GenerationError } from '@/lib/task-page-helpers';

// ===== [E] 结果 UI · 失败状态 · 开始 =====
/** 任务失败且没有任何结果图时的失败卡：具体错误、逐镜次错误详情（可单张重试）、服务端历史尝试与「重试」。 */
export function FailedPanel({
  taskId,
  displayErrorMessage,
  generationErrors,
  generating,
  unitCostFen,
  onRetryShot,
  onRetry,
}: {
  taskId: number;
  displayErrorMessage: string | null;
  generationErrors: GenerationError[];
  generating: boolean;
  unitCostFen: number;
  onRetryShot: (shotIndex: number) => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <div className="text-center py-16 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-danger-soft)] flex items-center justify-center">
        <XCircle className="w-8 h-8 text-[var(--color-danger)]" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold mb-2">生成失败</h2>

      {/* 优先展示具体错误信息 */}
      {displayErrorMessage ? (
        <div className="max-w-lg mx-auto mb-6">
          <div className="p-4 bg-[var(--color-danger-soft)] rounded-2xl border border-[var(--color-danger)]/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-[var(--color-danger)] mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-sm text-[var(--color-danger)] text-left break-words">{displayErrorMessage}</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[var(--color-text-secondary)] mb-4 text-sm max-w-md mx-auto">
          请检查网络连接或稍后重试
        </p>
      )}

      {/* SSE 过程中的详细错误列表 — 产品镜次可单张重试 */}
      {generationErrors.length > 0 && (
        <div className="max-w-lg mx-auto mb-6">
          <div className="p-4 bg-[var(--color-background)] rounded-2xl text-left">
            <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">错误详情</p>
            {generationErrors.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-3 mt-1.5">
                <p className="text-xs text-[var(--color-danger)] font-mono break-all">
                  {e.shotIndex >= 0 ? `镜次 #${e.shotIndex}: ` : ''}{e.message}
                </p>
                {e.shotIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => onRetryShot(e.shotIndex)}
                    disabled={generating}
                    className="shrink-0 min-h-9 text-xs px-3 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] disabled:opacity-40 transition-colors"
                  >
                    重试这张
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 服务端历史尝试（来自 Postgres GenerationRecord）*/}
      <FailureHistoryPanel taskId={taskId} />

      <button
        onClick={() => void onRetry()}
        className="btn-primary"
      >
        重试
      </button>
      <p className="mt-3 px-4 text-xs text-[var(--color-text-muted)]">
        重试只补生成缺失的镜次，按每张 <span className="num">{formatYuan(unitCostFen)}</span> 计费，失败自动退款；
        如页面提示「连接中断」，请先刷新页面，已生成但未送达的图会自动补回。
      </p>
    </div>
  );
}
// ===== [E] 结果 UI · 失败状态 · 结束 =====
