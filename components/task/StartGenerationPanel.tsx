'use client';

import { Wand2, Zap } from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';
import { EngineSelector, type ImageEngine } from '@/components/EngineSelector';
import { GPTQualitySelector } from '@/components/GPTQualitySelector';
import { getGenerationQualityEtaSeconds, type GenerationQuality } from '@/lib/billing-constants';
import { formatEtaText, formatYuan } from '@/lib/task-page-helpers';
import { RECHARGE_BUTTON_CLASS } from './styles';

/** 待生成任务的「开始生成」卡：最后一次微调引擎 / 模特，先试 1 张或全量生成，每个花钱按钮标价。 */
export function StartGenerationPanel({
  moduleType,
  shotCount,
  generateLabel,
  newEngine,
  setNewEngine,
  newQuality,
  setNewQuality,
  newModelId,
  setNewModelId,
  isFollowSceneGroupTask,
  unitCostFen,
  fullRunCostFen,
  fullRunCount,
  affordability,
  setRechargeNeedFen,
  runPaidAction,
  estimateRunSeconds,
  onTrial,
  onStart,
}: {
  moduleType: string;
  shotCount: number;
  generateLabel: string;
  newEngine: ImageEngine;
  setNewEngine: (engine: ImageEngine) => void;
  newQuality: GenerationQuality;
  setNewQuality: (quality: GenerationQuality) => void;
  newModelId: string;
  setNewModelId: (id: string) => void;
  isFollowSceneGroupTask: boolean;
  unitCostFen: number;
  fullRunCostFen: number;
  fullRunCount: number;
  affordability: (costFen: number) => 'ok' | 'insufficient' | 'unknown';
  setRechargeNeedFen: (costFen: number) => void;
  runPaidAction: (costFen: number, action: () => void) => void;
  estimateRunSeconds: (count: number) => number;
  onTrial: () => void | Promise<void>;
  onStart: () => void | Promise<void>;
}) {
  return (
    <div className="mb-12 text-center py-12 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
      <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-ink)] flex items-center justify-center">
        <Wand2 className="w-8 h-8 text-[var(--color-accent)]" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold mb-3">
        {moduleType === 'product' ? '准备生成产品图组' : '准备生成场景图'}
      </h2>
      <p className="text-[var(--color-text-secondary)] mb-6 text-sm max-w-md mx-auto">
        {moduleType === 'product'
          ? `AI 将为您生成 ${shotCount} 张专业产品图`
          : 'AI 将根据场景参考图生成专业场景图'
        }
      </p>

      {/* 生成前最后一次微调：引擎 + 模特 */}
      <div className="mb-8 px-4 sm:px-8 text-left space-y-6">
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
        {isFollowSceneGroupTask ? (
          <div className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-background)] px-4 py-3 text-sm font-medium text-[var(--color-text-secondary)]">
            肤色·体型·发型跟随场景图
          </div>
        ) : (
          <ModelSelector
            selectedModel={newModelId}
            onSelect={setNewModelId}
          />
        )}
      </div>

      {moduleType === 'product' && shotCount > 1 ? (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 px-4">
          {/* 推荐：先试 1 张 */}
          {affordability(unitCostFen) === 'insufficient' ? (
            <button type="button" onClick={() => setRechargeNeedFen(unitCostFen)} className={RECHARGE_BUTTON_CLASS}>
              <Zap className="w-5 h-5" aria-hidden="true" />
              余额不足，去充值
            </button>
          ) : (
            <button
              type="button"
              onClick={() => runPaidAction(unitCostFen, () => void onTrial())}
              className="btn-primary"
            >
              <Wand2 className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
              <span>先试 1 张 · <span className="num">{formatYuan(unitCostFen)}</span>（推荐）</span>
            </button>
          )}
          {/* 全量生成 */}
          {affordability(fullRunCostFen) === 'insufficient' ? (
            <button type="button" onClick={() => setRechargeNeedFen(fullRunCostFen)} className={RECHARGE_BUTTON_CLASS}>
              <Zap className="w-5 h-5" aria-hidden="true" />
              余额不足，去充值（全部需 {formatYuan(fullRunCostFen)}）
            </button>
          ) : (
            <button
              type="button"
              onClick={() => runPaidAction(fullRunCostFen, () => void onStart())}
              className="flex min-h-11 items-center justify-center gap-2 px-6 py-3 text-sm font-medium border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-background)] text-[var(--color-text-secondary)] transition-colors"
            >
              <span>{generateLabel} · <span className="num">{formatYuan(fullRunCostFen)}</span></span>
            </button>
          )}
        </div>
      ) : (
        affordability(fullRunCostFen) === 'insufficient' ? (
          <button type="button" onClick={() => setRechargeNeedFen(fullRunCostFen)} className={RECHARGE_BUTTON_CLASS}>
            <Zap className="w-5 h-5" aria-hidden="true" />
            余额不足，去充值（需 {formatYuan(fullRunCostFen)}）
          </button>
        ) : (
          <button
            type="button"
            onClick={() => runPaidAction(fullRunCostFen, () => void onStart())}
            className="btn-primary"
          >
            <Wand2 className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
            <span>{generateLabel} · <span className="num">{formatYuan(fullRunCostFen)}</span></span>
          </button>
        )
      )}

      <p className="text-xs text-[var(--color-text-muted)] mt-4 px-4">
        {moduleType === 'product' && shotCount > 1
          ? `先试 1 张确认效果（${formatYuan(unitCostFen)}，预计${formatEtaText(estimateRunSeconds(1))}），满意后再生成剩余 ${shotCount - 1} 张（${formatYuan((shotCount - 1) * unitCostFen)}）。全部生成预计${formatEtaText(estimateRunSeconds(shotCount))}，请保持页面开启`
          : `预计${formatEtaText(estimateRunSeconds(fullRunCount))}（${newEngine === 'openai' ? `GPT 单张约 ${getGenerationQualityEtaSeconds(newQuality)} 秒，` : ''}视网络与排队可能更久），请保持页面开启`
        }
      </p>
    </div>
  );
}
