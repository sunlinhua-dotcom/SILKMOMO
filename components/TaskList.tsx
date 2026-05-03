'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { db, type Project } from '@/lib/db';
import { Clock, CheckCircle, XCircle, Loader, ChevronRight, Trash2, Pencil, Check, X, Search } from 'lucide-react';
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Project['status']>('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
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

  const handleDelete = async (e: React.MouseEvent, taskId: number, name: string) => {
    e.stopPropagation();
    if (!confirm(`删除任务"${name}"？此操作不可撤销，所有相关图片将一同删除。`)) return;
    try {
      await db.images.where('projectId').equals(taskId).delete();
      await db.projects.delete(taskId);
      await loadTasks();
    } catch (err) {
      console.error('删除任务失败:', err);
      alert('删除失败，请重试');
    }
  };

  const startRename = (e: React.MouseEvent, taskId: number, currentName: string) => {
    e.stopPropagation();
    setEditingId(taskId);
    setEditValue(currentName);
  };

  const cancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setEditValue('');
  };

  const commitRename = async (e: React.MouseEvent | React.FormEvent, taskId: number) => {
    e.stopPropagation();
    e.preventDefault();
    const newName = editValue.trim();
    if (!newName || newName.length > 80) {
      setEditingId(null);
      return;
    }
    try {
      await db.projects.update(taskId, { name: newName, updatedAt: new Date() });
      setEditingId(null);
      await loadTasks();
    } catch (err) {
      console.error('重命名失败:', err);
      alert('重命名失败，请重试');
    }
  };

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, search, statusFilter]);



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
    <div className="space-y-3">
      {/* 搜索 + 筛选 */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="按项目名搜索..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-0 transition-colors placeholder:text-[var(--color-text-muted)]"
          />
        </div>
        <div className="flex gap-1 bg-[var(--color-background)] rounded-xl p-1 border border-[var(--color-border-light)]">
          {(['all', 'completed', 'processing', 'failed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                statusFilter === s
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {s === 'all' ? '全部' : s === 'completed' ? '已完成' : s === 'processing' ? '生成中' : '失败'}
            </button>
          ))}
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
          没有匹配的任务
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => editingId !== task.id && router.push(`/task/${task.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== task.id) router.push(`/task/${task.id}`); }}
              className="w-full text-left p-4 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="mt-0.5">
                    {getStatusIcon(task.status)}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editingId === task.id ? (
                      <form onSubmit={(e) => commitRename(e, task.id!)} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          maxLength={80}
                          className="flex-1 min-w-0 px-2 py-1 text-sm rounded-md bg-[var(--color-background)] border border-[var(--color-accent)] focus:outline-none focus:ring-0"
                        />
                        <button
                          type="submit"
                          className="w-7 h-7 flex items-center justify-center rounded-md text-green-600 hover:bg-green-50 transition-colors"
                          aria-label="保存"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-background)] transition-colors"
                          aria-label="取消"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">
                        {task.name}
                      </p>
                    )}
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
                {editingId !== task.id && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => startRename(e, task.id!, task.name)}
                      className="opacity-0 group-hover:opacity-100 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-secondary)] transition-all"
                      aria-label="重命名"
                      title="重命名"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, task.id!, task.name)}
                      className="opacity-0 group-hover:opacity-100 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-500 transition-all"
                      aria-label="删除任务"
                      title="删除任务"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors mt-1" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
