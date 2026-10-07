'use client';

import { useEffect, useState } from 'react';

interface GenerationProgressProps {
  /** 本轮生成开始的时间戳（ms） */
  startedAt: number;
  /** 预计完成的时间戳（ms）；每出一张图由父组件重算 */
  etaDeadline: number;
  /** 服装分析阶段：进度条固定 8% */
  analyzing: boolean;
  /** 图都到齐、等 done 事件收尾：进度条 100% */
  finishing: boolean;
  /** 已完成镜次占比 0~1 */
  shotFrac: number;
  /** 进度条下方左侧的阶段说明 */
  subLabel: string;
  /** 超过多少秒提示「响应较慢」 */
  slowAfterSec: number;
}

/**
 * 生成中的进度条 + 秒表。
 * 每秒一次的 setState 只发生在本组件内部，且仅在 generating 时挂载，
 * 不会再带动整个任务页（2400 行的大组件）每秒重渲染一次。
 */
export function GenerationProgress({
  startedAt,
  etaDeadline,
  analyzing,
  finishing,
  shotFrac,
  subLabel,
  slowAfterSec,
}: GenerationProgressProps) {
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const secondsLeft = Math.max(0, Math.ceil((etaDeadline - now) / 1000));

  // 进度条宽度：
  // - analyzing：固定 8% 起步
  // - 收尾窗口（图都到齐、等 done 事件）：100%
  // - 生成中：取「已完成镜次占比」与「按已耗时/预计时间的估算占比」的较大值。
  //   单张长任务（GPT 一张 ~2-3 分钟）上游不返回中途进度，靠 timeFrac 让进度条
  //   随秒表匀速往前爬，不至于卡在起点显得僵住；估算值封顶 95%，真正出图/收尾才到 100%。
  let percent: number;
  if (analyzing) {
    percent = 8;
  } else if (finishing) {
    percent = 100;
  } else {
    const denom = elapsedSeconds + secondsLeft;
    const timeFrac = denom > 0 ? elapsedSeconds / denom : 0;
    const frac = Math.min(0.95, Math.max(shotFrac, timeFrac));
    percent = Math.max(8, frac * 100);
  }
  const rounded = Math.round(percent);

  return (
    <div className="mx-auto max-w-sm">
      <div
        role="progressbar"
        aria-label="生成进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${subLabel}，已完成约 ${rounded}%`}
        className="h-2 overflow-hidden rounded-full bg-[var(--color-background)]"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-light)] transition-all duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p aria-live="polite" className="text-xs text-[var(--color-text-muted)]">{subLabel}</p>
        <p className="num flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)]">
          <span>已耗时 {elapsedSeconds}s</span>
          {secondsLeft > 0 && (
            <span className="font-medium text-[var(--color-brand-strong)]">预计剩余 {secondsLeft} 秒</span>
          )}
          {elapsedSeconds > slowAfterSec && (
            <span className="text-[var(--color-warning)]">（响应较慢，请稍候）</span>
          )}
        </p>
      </div>
    </div>
  );
}
