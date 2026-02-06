'use client';

import { useEffect, useState, useCallback } from 'react';
import { db, type Project } from '@/lib/db';
import { Clock, CheckCircle, XCircle, Loader, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface TaskWithImages extends Project {
  imageCount: number;
}

interface TaskListProps {
  limit?: number;
}

export function TaskList({ limit = 5 }: TaskListProps) {
  const [tasks, setTasks] = useState<TaskWithImages[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const loadTasks = useCallback(async () => {
    try {
      const projects = await db.projects
        .orderBy('createdAt')
        .reverse()
        .limit(limit)
        .toArray();

      const tasksWithImages = await Promise.all(
        projects.map(async (project) => {
          const count = await db.images
            .where('projectId')
            .equals(project.id!)
            .and(img => img.type === 'result')
            .count();
          return { ...project, imageCount: count };
        })
      );

      setTasks(tasksWithImages);
    } catch (error) {
      console.error('加载任务失败:', error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);



  const getStatusIcon = (status: Project['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-[var(--color-text-muted)]" />;
      case 'processing':
        return <Loader className="w-4 h-4 text-[var(--color-accent)] animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-[var(--color-accent)]" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-[var(--color-text-muted)]" />;
    }
  };



  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-[var(--color-background)] rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-full bg-[var(--color-background)] flex items-center justify-center mx-auto mb-4">
          <Clock className="w-6 h-6 text-[var(--color-text-muted)]" />
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">暂无任务</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">创建您的第一个生成任务</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <button
          key={task.id}
          onClick={() => router.push(`/task/${task.id}`)}
          className="w-full text-left p-4 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:shadow-md transition-all group"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="mt-0.5">
                {getStatusIcon(task.status)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">
                  {task.name}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {formatDate(task.createdAt)}
                  </span>
                  {task.imageCount > 0 && (
                    <span className="text-xs text-[var(--color-accent)]">
                      {task.imageCount} 张图片
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors flex-shrink-0 mt-1" />
          </div>
        </button>
      ))}
    </div>
  );
}
