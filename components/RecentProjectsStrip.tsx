'use client';

import { useState, useEffect } from 'react';
import { db, type Project } from '@/lib/db';
import { Clock, CheckCircle, XCircle, Loader, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface TaskWithImages extends Project {
  imageCount: number;
}

async function loadRecentTasks(limit: number): Promise<TaskWithImages[]> {
  const projects = await db.projects
    .orderBy('createdAt')
    .reverse()
    .limit(limit)
    .toArray();

  return Promise.all(
    projects.map(async (project) => {
      const count = await db.images
        .where('projectId')
        .equals(project.id!)
        .and(img => img.type === 'result')
        .count();
      return { ...project, imageCount: count };
    })
  );
}

/**
 * 紧凑版最近项目 — 水平胶囊条
 * 移动端：横向可滑动的胶囊条，一行即走，不影响主流程
 * 无任务时完全隐藏（不占空间）
 */
export function RecentProjectsStrip() {
  const [tasks, setTasks] = useState<TaskWithImages[]>([]);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadRecentTasks(5)
      .then(setTasks)
      .catch(e => console.error('加载任务失败:', e))
      .finally(() => setLoaded(true));
  }, []);

  const getStatusDot = (status: Project['status']) => {
    switch (status) {
      case 'pending': return 'bg-[var(--color-text-muted)]';
      case 'processing': return 'bg-[var(--color-accent)] animate-pulse';
      case 'completed': return 'bg-green-500';
      case 'failed': return 'bg-red-400';
    }
  };

  const formatTime = (date: Date) => {
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}h前`;
    return `${Math.floor(diff / 86400000)}d前`;
  };

  // SSR 和未加载完 — 返回 null（不渲染任何东西，避免 hydration mismatch）
  if (!loaded || tasks.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {/* 标签 */}
      <span className="text-[10px] text-[var(--color-text-muted)] tracking-wider uppercase flex-shrink-0 hidden sm:inline">
        最近
      </span>

      {/* 胶囊条 — 水平滚动 */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => router.push(`/task/${task.id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:shadow-sm transition-all flex-shrink-0 group max-w-[180px]"
          >
            {/* 状态点 */}
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDot(task.status)}`} />
            {/* 名字 */}
            <span className="text-[11px] text-[var(--color-text)] truncate">
              {task.name?.replace(/产品图|场景图/, '').trim() || '任务'}
            </span>
            {/* 时间 */}
            <span className="text-[9px] text-[var(--color-text-muted)] flex-shrink-0">
              {formatTime(task.createdAt)}
            </span>
          </button>
        ))}
      </div>

      {/* 查看全部 */}
      <Link
        href="/tasks"
        className="flex items-center gap-0.5 text-[10px] text-[var(--color-accent)] hover:text-[var(--color-accent-dark)] transition-colors flex-shrink-0 uppercase tracking-wider"
      >
        全部
        <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

/**
 * 桌面端侧栏紧凑版 — 小行列表
 */
export function RecentProjectsCompact() {
  const [tasks, setTasks] = useState<TaskWithImages[]>([]);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadRecentTasks(5)
      .then(setTasks)
      .catch(e => console.error('加载任务失败:', e))
      .finally(() => setLoaded(true));
  }, []);

  const getStatusIcon = (status: Project['status']) => {
    switch (status) {
      case 'pending': return <Clock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />;
      case 'processing': return <Loader className="w-3.5 h-3.5 text-[var(--color-accent)] animate-spin" />;
      case 'completed': return <CheckCircle className="w-3.5 h-3.5 text-green-600" />;
      case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    }
  };

  const formatTime = (date: Date) => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(diff / 86400000)}天前`;
  };

  // SSR 和未加载 — 返回 null 避免 hydration mismatch
  if (!loaded) return null;

  // 无任务 — 单行提示
  if (tasks.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)] py-3 text-center">
        暂无项目，上传产品图开始创作
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {tasks.map((task) => (
        <button
          key={task.id}
          onClick={() => router.push(`/task/${task.id}`)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[var(--color-background)] transition-all group text-left"
        >
          <span className="flex-shrink-0">{getStatusIcon(task.status)}</span>
          <span className="text-[12px] text-[var(--color-text)] truncate flex-1 leading-tight">
            {task.name}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">
            {formatTime(task.createdAt)}
          </span>
        </button>
      ))}
    </div>
  );
}
