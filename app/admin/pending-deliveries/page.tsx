'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

interface PendingDelivery {
  id: string;
  userId: string;
  taskId: number;
  shotIndex: number;
  width: number;
  height: number;
  mimeType: string;
  idempotencyKey: string | null;
  createdAt: string;
  user?: { username: string; name: string } | null;
}

export default function PendingDeliveriesPage() {
  const [records, setRecords] = useState<PendingDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/pending-deliveries', { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载失败');
      setRecords(data.records || []);
      setHasMore(data.hasMore === true);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // 渲染期读时钟会触发 purity 规则；用 state 持有“现在”，每次加载完成时更新
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!loading) setNow(Date.now());
  }, [loading, records]);

  const ageMinutes = (createdAt: string) =>
    now === 0 ? 0 : Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="已扣费未取走" backHref="/admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-start gap-2 text-sm text-warning bg-warning-soft border border-warning rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>pending 超过 10 分钟的结果，仅供人工对账，不会自动退款。</span>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="ml-auto flex min-h-10 items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />刷新
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {hasMore && (
          <p className="text-sm text-warning">
            当前仅显示最早的 200 条，仍有更多记录；请优先处理本页后刷新。
          </p>
        )}
        <div className="bg-surface rounded-2xl border border-border-light overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-background text-muted">
              <tr>
                <th className="text-left px-3 py-2">等待</th><th className="text-left px-3 py-2">用户</th>
                <th className="text-left px-3 py-2">任务</th><th className="text-left px-3 py-2">镜次</th>
                <th className="text-left px-3 py-2">尺寸</th><th className="text-left px-3 py-2">幂等交付键</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {records.map(record => (
                <tr key={record.id}>
                  <td className="px-3 py-2 whitespace-nowrap num">{ageMinutes(record.createdAt)} 分钟</td>
                  <td className="px-3 py-2">
                    <div className="whitespace-nowrap">
                      {record.user ? `${record.user.name || record.user.username}（${record.user.username}）` : '(用户已删除)'}
                    </div>
                    <div className="font-mono text-[10px] text-muted break-all select-all">{record.userId}</div>
                  </td>
                  <td className="px-3 py-2 num">{record.taskId}</td>
                  <td className="px-3 py-2 num">{record.shotIndex || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap num">{record.width}×{record.height}</td>
                  <td className="px-3 py-2 font-mono break-all">{record.idempotencyKey || '老客户端（无键）'}</td>
                </tr>
              ))}
              {!loading && records.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted">暂无超过 10 分钟的未取走结果</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
