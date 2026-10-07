'use client';

import { useState } from 'react';
import { type Project } from '@/lib/db';
import { useRecentTasks } from '@/lib/recent-tasks';
import { formatRelativeTime } from '@/lib/format-time';
import { Clock, CheckCircle, XCircle, Loader, ChevronRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';

const STATUS_LABEL: Record<Project['status'], string> = {
  pending: '待生成',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
};

const STATUS_DOT: Record<Project['status'], string> = {
  pending: 'bg-muted',
  processing: 'bg-brand-strong animate-pulse',
  completed: 'bg-success',
  failed: 'bg-danger',
};

const STATUS_ICON: Record<Project['status'], React.ReactNode> = {
  pending: <Clock className="w-3.5 h-3.5 text-muted" aria-hidden="true" />,
  processing: <Loader className="w-3.5 h-3.5 text-brand-strong animate-spin" aria-hidden="true" />,
  completed: <CheckCircle className="w-3.5 h-3.5 text-success" aria-hidden="true" />,
  failed: <XCircle className="w-3.5 h-3.5 text-danger" aria-hidden="true" />,
};

/**
 * 紧凑版最近项目 — 水平胶囊条
 * 移动端：横向可滑动的胶囊条，一行即走，不影响主流程
 * 无任务（或加载失败）时完全隐藏（不占空间）
 */
export function RecentProjectsStrip() {
  const { tasks, status } = useRecentTasks(5);
  const [now] = useState(() => Date.now());

  // SSR / 加载中 / 加载失败 / 无任务 — 返回 null（不渲染任何东西，避免 hydration mismatch）
  if (status !== 'ready' || tasks.length === 0) return null;

  return (
    <nav aria-label="最近项目" className="flex items-center gap-2">
      {/* 标签 */}
      <span className="text-[11px] text-muted tracking-wider uppercase flex-shrink-0 hidden sm:inline">
        最近
      </span>

      {/* 胶囊条 — 水平滚动 */}
      <ul className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5 min-w-0">
        {tasks.map((task) => (
          <li key={task.id} className="flex-shrink-0">
            <Link
              href={`/task/${task.id}`}
              className="group flex min-h-10 max-w-[180px] items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border-light hover:border-brand-strong hover:shadow-sm transition-all"
            >
              {/* 状态点 */}
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[task.status]}`} aria-hidden="true" />
              <span className="sr-only">{STATUS_LABEL[task.status]}：</span>
              {/* 名字 */}
              <span className="text-xs text-ink truncate">
                {task.name?.replace(/产品图|场景图/, '').trim() || '任务'}
              </span>
              {/* 时间 */}
              <span className="text-[11px] text-muted flex-shrink-0">
                {formatRelativeTime(task.createdAt, now)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* 查看全部 */}
      <Link
        href="/tasks"
        className="flex min-h-10 items-center gap-0.5 px-1 text-[11px] text-brand-strong hover:text-primary transition-colors flex-shrink-0 uppercase tracking-wider"
      >
        全部
        <ChevronRight className="w-3 h-3" aria-hidden="true" />
      </Link>
    </nav>
  );
}

/**
 * 桌面端侧栏紧凑版 — 小行列表
 */
export function RecentProjectsCompact() {
  const { tasks, status, retry } = useRecentTasks(5);
  const [now] = useState(() => Date.now());

  // SSR 和未加载 — 返回 null 避免 hydration mismatch
  if (status === 'loading') return null;

  // 加载失败 — 与「暂无项目」区分，给重试入口
  if (status === 'error') {
    return (
      <div className="py-3 text-center" role="alert">
        <p className="text-xs text-muted">最近项目加载失败</p>
        <button
          type="button"
          onClick={retry}
          className="mt-1 inline-flex min-h-10 items-center gap-1 px-3 text-xs text-brand-strong hover:text-primary transition-colors"
        >
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          重试
        </button>
      </div>
    );
  }

  // 无任务 — 单行提示
  if (tasks.length === 0) {
    return (
      <p className="text-xs text-muted py-3 text-center">
        暂无项目，上传产品图开始创作
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link
            href={`/task/${task.id}`}
            className="w-full flex min-h-10 items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-background transition-all text-left"
          >
            <span className="flex-shrink-0">{STATUS_ICON[task.status]}</span>
            <span className="sr-only">{STATUS_LABEL[task.status]}：</span>
            <span className="text-xs text-ink truncate flex-1 leading-tight">
              {task.name}
            </span>
            <span className="text-[11px] text-muted flex-shrink-0">
              {formatRelativeTime(task.createdAt, now)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
