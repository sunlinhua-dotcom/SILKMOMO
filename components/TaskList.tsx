'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { db, type Project } from '@/lib/db';
import { useRecentTasks } from '@/lib/recent-tasks';
import { formatRelativeTime } from '@/lib/format-time';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Clock, CheckCircle, XCircle, Loader, ChevronRight, Trash2, Pencil, Check, X, Search, AlertTriangle, RefreshCw } from 'lucide-react';

interface TaskListProps {
  limit?: number;
}

type Status = Project['status'];

const STATUS_LABEL: Record<Status, string> = {
  pending: '待生成',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
};

const FILTERS = ['all', 'pending', 'completed', 'processing', 'failed'] as const;

/** 操作按钮：悬停设备上平时隐藏，悬停 / 聚焦卡片时显示；触屏（无 hover）常显。 */
const REVEAL =
  '[@media(hover:hover)]:group-[:not(:hover):not(:focus-within)]/row:opacity-0';

const STATUS_ICON: Record<Status, React.ReactNode> = {
  pending: <Clock className="w-4 h-4 text-muted" aria-hidden="true" />,
  processing: <Loader className="w-4 h-4 text-brand-strong animate-spin" aria-hidden="true" />,
  completed: <CheckCircle className="w-4 h-4 text-success" aria-hidden="true" />,
  failed: <XCircle className="w-4 h-4 text-danger" aria-hidden="true" />,
};

export function TaskList({ limit = 5 }: TaskListProps) {
  const { tasks, status, reload, retry } = useRecentTasks();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  // 分页显示条数：limit 作为每页大小。不能在查询层截断 —— 否则第 limit+1 条
  // 之前的任务在 UI 上永久不可达（搜索/筛选也只作用于截断后的子集）
  const [displayCount, setDisplayCount] = useState(limit);
  const [now] = useState(() => Date.now());

  const handleDelete = async (taskId: number, name: string) => {
    const ok = await confirm({
      title: `删除任务「${name}」？`,
      message: '此操作不可撤销，所有相关图片将一同删除。',
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    try {
      await db.images.where('projectId').equals(taskId).delete();
      await db.projects.delete(taskId);
      await reload();
      toast.success('任务已删除');
    } catch (err) {
      console.error('删除任务失败:', err);
      toast.error('删除失败，请重试');
    }
  };

  const startRename = (taskId: number, currentName: string) => {
    setEditingId(taskId);
    setEditValue(currentName);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditValue('');
  };

  const commitRename = async (e: React.FormEvent, taskId: number) => {
    e.preventDefault();
    const newName = editValue.trim();
    if (!newName || newName.length > 80) {
      cancelRename();
      return;
    }
    try {
      await db.projects.update(taskId, { name: newName, updatedAt: new Date() });
      cancelRename();
      await reload();
    } catch (err) {
      console.error('重命名失败:', err);
      toast.error('重命名失败，请重试');
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

  const visibleTasks = useMemo(
    () => filteredTasks.slice(0, displayCount),
    [filteredTasks, displayCount]
  );
  const hasMore = filteredTasks.length > displayCount;

  if (status === 'loading') {
    return (
      <div className="space-y-3" role="status" aria-label="正在加载任务">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-background rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-12" role="alert">
        <div className="w-16 h-16 rounded-full bg-danger-soft flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-danger" aria-hidden="true" />
        </div>
        <p className="text-sm text-text-secondary">任务加载失败</p>
        <p className="text-xs text-muted mt-1">本地数据库暂时读取不了，请重试；若持续失败请刷新页面</p>
        <button
          type="button"
          onClick={retry}
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm text-ink hover:border-brand-strong transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          重新加载
        </button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-full bg-background flex items-center justify-center mx-auto mb-4">
          <Clock className="w-6 h-6 text-muted" aria-hidden="true" />
        </div>
        <p className="text-sm text-text-secondary">暂无任务</p>
        <p className="text-xs text-muted mt-1">创建您的第一个生成任务</p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-brand-strong px-5 text-sm text-white hover:opacity-90 transition-opacity"
        >
          去首页新建任务
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 搜索 + 筛选 */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="按项目名搜索..."
            aria-label="按项目名搜索"
            className="w-full min-h-10 pl-9 pr-3 py-2 text-sm rounded-xl bg-background border border-border-light focus:border-brand-strong focus:outline-none focus:ring-0 transition-colors placeholder:text-muted"
          />
        </div>
        <div
          role="group"
          aria-label="按状态筛选"
          className="flex gap-1 bg-background rounded-xl p-1 border border-border-light overflow-x-auto no-scrollbar max-w-full"
        >
          {FILTERS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={`min-h-10 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                statusFilter === s
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-muted hover:text-text-secondary'
              }`}
            >
              {s === 'all' ? '全部' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="text-center py-8 text-xs text-muted" role="status">
          没有匹配的任务
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleTasks.map((task) => {
            const editing = editingId === task.id;
            return (
              <li
                key={task.id}
                className="group/row relative p-4 bg-surface rounded-2xl border border-border-light hover:border-brand-strong hover:shadow-md transition-all has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="mt-0.5 flex-shrink-0">
                      {STATUS_ICON[task.status]}
                      <span className="sr-only">{STATUS_LABEL[task.status]}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <form
                          onSubmit={(e) => commitRename(e, task.id!)}
                          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelRename(); } }}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            maxLength={80}
                            aria-label="任务名称"
                            className="flex-1 min-w-0 min-h-10 px-2 py-1 text-sm rounded-md bg-background border border-brand-strong focus:outline-none focus:ring-0"
                          />
                          <button
                            type="submit"
                            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-md text-success hover:bg-success-soft transition-colors"
                            aria-label="保存"
                            title="保存"
                          >
                            <Check className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-md text-muted hover:bg-background transition-colors"
                            aria-label="取消"
                            title="取消"
                          >
                            <X className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </form>
                      ) : (
                        // 整张卡片的点击区由这条链接的 ::after 撑开；操作按钮用 relative z-10 浮在上面，
                        // 因此按钮上的 Enter / 点击不会冒泡成跳转
                        <Link
                          href={`/task/${task.id}`}
                          className="block text-sm font-medium text-ink truncate focus-visible:outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
                        >
                          {task.name}
                        </Link>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                        <span className="text-xs text-muted">
                          {formatRelativeTime(task.createdAt, now)}
                        </span>
                        {task.imageCount > 0 && (
                          <span className="text-xs text-brand-strong">
                            {task.imageCount} 张图片
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!editing && (
                    <div className="relative z-10 flex items-center gap-0.5 flex-shrink-0 -my-1.5 -mr-1.5">
                      <button
                        type="button"
                        onClick={() => startRename(task.id!, task.name)}
                        className={`${REVEAL} w-10 h-10 flex items-center justify-center rounded-lg text-muted hover:bg-background hover:text-text-secondary focus-visible:opacity-100 transition-all`}
                        aria-label={`重命名任务「${task.name}」`}
                        title="重命名"
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(task.id!, task.name)}
                        className={`${REVEAL} w-10 h-10 flex items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 transition-all`}
                        aria-label={`删除任务「${task.name}」`}
                        title="删除任务"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <ChevronRight className="pointer-events-none w-5 h-5 text-muted group-hover/row:text-brand-strong transition-colors" aria-hidden="true" />
                    </div>
                  )}
                </div>
              </li>
            );
          })}

          {/* 加载更多 */}
          {hasMore && (
            <li>
              <button
                type="button"
                onClick={() => setDisplayCount(c => c + limit)}
                className="w-full min-h-11 py-3 text-xs font-medium text-text-secondary bg-background rounded-2xl border border-border-light hover:border-brand-strong hover:text-primary transition-all"
              >
                加载更多（还有 {filteredTasks.length - displayCount} 个任务）
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
