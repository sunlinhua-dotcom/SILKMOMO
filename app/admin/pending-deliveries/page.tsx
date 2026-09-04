'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Logo } from '@/components/Logo';

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
}
export default function PendingDeliveriesPage() {
  const [records, setRecords] = useState<PendingDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/pending-deliveries', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载失败');
      setRecords(data.records || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ageMinutes = (createdAt: string) => Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-3 group">
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-muted)]" aria-hidden="true" />
            <Logo width={32} height={32} />
            <span className="text-lg font-semibold tracking-tight">SILXINE</span>
          </Link>
          <h1 className="text-sm font-medium text-[var(--color-text-secondary)]">已扣费未取走</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            pending 超过 10 分钟的结果，仅供人工对账，不会自动退款。
          </div>
          <button onClick={() => void load()} disabled={loading} className="ml-auto flex items-center gap-2 px-3 py-2 text-sm border rounded-lg">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />刷新
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="bg-white rounded-2xl border border-[var(--color-border-light)] overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-background)] text-[var(--color-text-muted)]">
              <tr>
                <th className="text-left px-3 py-2">等待</th><th className="text-left px-3 py-2">用户</th>
                <th className="text-left px-3 py-2">任务</th><th className="text-left px-3 py-2">镜次</th>
                <th className="text-left px-3 py-2">尺寸</th><th className="text-left px-3 py-2">幂等交付键</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-light)]">
              {records.map(record => (
                <tr key={record.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{ageMinutes(record.createdAt)} 分钟</td>
                  <td className="px-3 py-2 font-mono">{record.userId}</td>
                  <td className="px-3 py-2">{record.taskId}</td>
                  <td className="px-3 py-2">{record.shotIndex || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{record.width}×{record.height}</td>
                  <td className="px-3 py-2 font-mono break-all">{record.idempotencyKey || '老客户端（无键）'}</td>
                </tr>
              ))}
              {!loading && records.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-[var(--color-text-muted)]">暂无超过 10 分钟的未取走结果</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
