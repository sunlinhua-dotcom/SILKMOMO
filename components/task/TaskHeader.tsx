'use client';

import Link from 'next/link';
import { Clock, CheckCircle, XCircle, Loader, Settings2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import type { Project } from '@/lib/db';

/** 任务页顶栏：Logo、任务名、模块类型、状态胶囊、「调整参数」入口。 */
export function TaskHeader({
  project,
  moduleType,
  generating,
  liveCount,
  progressTotal,
  onAdjust,
}: {
  project: Project;
  moduleType: string;
  generating: boolean;
  liveCount: number;
  progressTotal: number;
  onAdjust: () => void;
}) {
  return (
    <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 flex items-center justify-center transition-transform hover:scale-105">
              <Logo width={40} height={40} />
            </div>
            <span className="text-lg font-semibold tracking-tight">SILXINE</span>
          </Link>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {/* 项目名称和状态 */}
            <h1 className="hidden sm:block text-base font-medium truncate max-w-[150px] text-[var(--color-text)]">
              {project.name}
            </h1>

            {/* 模块类型标签 */}
            <span className="hidden sm:inline-block text-xs font-medium px-2.5 py-1 rounded-lg bg-[var(--color-background)] text-[var(--color-text-secondary)]">
              {moduleType === 'product' ? '产品图' : '场景图'}
            </span>

            {project.status === 'pending' && (
              <span className="flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-background)] rounded-full">
                <Clock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                等待生成
              </span>
            )}
            {project.status === 'processing' && (
              <span className="num flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-brand-soft)] rounded-full text-[var(--color-brand-strong)]">
                <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                {liveCount}/{progressTotal}
              </span>
            )}
            {project.status === 'completed' && (
              <span className="flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-success-soft)] rounded-full text-[var(--color-success)]">
                <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                已完成
              </span>
            )}
            {project.status === 'failed' && (
              <span className="flex shrink-0 items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-danger-soft)] rounded-full text-[var(--color-danger)]">
                <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                失败
              </span>
            )}

            {/* 调整参数按钮 */}
            {(project.status === 'completed' || project.status === 'failed') && !generating && (
              <button
                type="button"
                onClick={onAdjust}
                aria-label="调整参数"
                className="flex min-h-10 shrink-0 items-center gap-2 px-3 sm:px-4 py-2 text-sm font-medium bg-[var(--color-brand-strong)] text-white rounded-xl hover:opacity-90 transition-opacity"
              >
                <Settings2 className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">调整参数</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
