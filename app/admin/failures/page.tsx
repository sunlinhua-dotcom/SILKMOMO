'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { Logo } from '@/components/Logo';

interface FailureRecord {
  id: string;
  userId: string;
  taskId: number | null;
  module: string;
  shotIndex: number | null;
  modelId: string | null;
  bodyType: string | null;
  skinTone: string | null;
  apiModel: string;
  apiLatencyMs: number;
  errorMessage: string | null;
  createdAt: string;
  user: { username: string; name: string } | null;
}

interface FailureSummary {
  days: number;
  totalAttempts: number;
  totalFailures: number;
  totalSuccesses: number;
  failureRate: number;
}

interface TopError {
  message: string;
  count: number;
}

export default function AdminFailuresPage() {
  const [summary, setSummary] = useState<FailureSummary | null>(null);
  const [topErrors, setTopErrors] = useState<TopError[]>([]);
  const [records, setRecords] = useState<FailureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [apiModelFilter, setApiModelFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/admin/failures?days=${days}${apiModelFilter ? `&apiModel=${encodeURIComponent(apiModelFilter)}` : ''}`;
      const r = await fetch(url);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert(`加载失败: ${err.error || r.statusText}`);
        return;
      }
      const data = await r.json();
      setSummary(data.summary);
      setTopErrors(data.topErrors || []);
      setRecords(data.records || []);
    } finally {
      setLoading(false);
    }
  }, [days, apiModelFilter]);

  useEffect(() => { load(); }, [load]);

  const formatTime = (s: string) => new Date(s).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-3 group">
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
            <Logo width={32} height={32} />
            <span className="text-lg font-semibold tracking-tight">SILXINE</span>
          </Link>
          <h1 className="text-sm font-medium text-[var(--color-text-secondary)]">失败任务监控</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* 控制栏 */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[var(--color-text-secondary)]">最近</label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 text-sm border border-[var(--color-border-light)] rounded-lg bg-white focus:border-[var(--color-accent)] focus:outline-none"
          >
            <option value={1}>1 天</option>
            <option value={3}>3 天</option>
            <option value={7}>7 天</option>
            <option value={14}>14 天</option>
            <option value={30}>30 天</option>
          </select>

          <label className="text-sm text-[var(--color-text-secondary)] ml-2">引擎</label>
          <select
            value={apiModelFilter}
            onChange={(e) => setApiModelFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-[var(--color-border-light)] rounded-lg bg-white focus:border-[var(--color-accent)] focus:outline-none"
          >
            <option value="">全部</option>
            <option value="gemini-3.1-flash-image-preview">Gemini Flash Image</option>
            <option value="gpt-image-2-all">GPT Image 2</option>
          </select>

          <button
            onClick={load}
            disabled={loading}
            className="ml-auto flex items-center gap-2 px-3 py-2 text-sm border border-[var(--color-border-light)] rounded-lg hover:bg-white transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 概览 */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-white rounded-2xl border border-[var(--color-border-light)]">
              <div className="text-xs text-[var(--color-text-muted)] mb-1">总尝试</div>
              <div className="text-2xl font-semibold">{summary.totalAttempts}</div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-[var(--color-border-light)]">
              <div className="text-xs text-[var(--color-text-muted)] mb-1">成功</div>
              <div className="text-2xl font-semibold text-emerald-600">{summary.totalSuccesses}</div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-[var(--color-border-light)]">
              <div className="text-xs text-[var(--color-text-muted)] mb-1">失败</div>
              <div className="text-2xl font-semibold text-red-500">{summary.totalFailures}</div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-[var(--color-border-light)]">
              <div className="text-xs text-[var(--color-text-muted)] mb-1">失败率</div>
              <div className={`text-2xl font-semibold ${summary.failureRate > 20 ? 'text-red-500' : summary.failureRate > 10 ? 'text-amber-500' : 'text-emerald-600'}`}>{summary.failureRate}%</div>
            </div>
          </div>
        )}

        {/* Top 错误 */}
        {topErrors.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">高频错误 Top 10</h2>
            <div className="bg-white rounded-2xl border border-[var(--color-border-light)] divide-y divide-[var(--color-border-light)]">
              {topErrors.map((e, i) => (
                <div key={i} className="p-3 flex items-start gap-3 text-sm">
                  <span className="font-mono text-xs text-[var(--color-text-muted)] mt-0.5 flex-shrink-0 w-6">{i + 1}</span>
                  <span className="font-mono text-red-700 break-all flex-1">{e.message}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 flex-shrink-0">×{e.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 记录列表 */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">最近失败记录（{records.length}）</h2>
          <div className="bg-white rounded-2xl border border-[var(--color-border-light)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--color-background)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">时间</th>
                  <th className="text-left px-3 py-2 font-medium">用户</th>
                  <th className="text-left px-3 py-2 font-medium">任务</th>
                  <th className="text-left px-3 py-2 font-medium">模块</th>
                  <th className="text-left px-3 py-2 font-medium">镜次</th>
                  <th className="text-left px-3 py-2 font-medium">引擎</th>
                  <th className="text-left px-3 py-2 font-medium">耗时</th>
                  <th className="text-left px-3 py-2 font-medium">错误</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-light)]">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--color-background)]">
                    <td className="px-3 py-2 whitespace-nowrap">{formatTime(r.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.user?.name || r.user?.username || r.userId.slice(0, 8)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.taskId ?? '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.module}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.shotIndex ?? '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px]">{r.apiModel.replace(/-preview$/, '').replace(/^gemini-3\.1-/, 'gemini-')}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{(r.apiLatencyMs / 1000).toFixed(1)}s</td>
                    <td className="px-3 py-2 max-w-md">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                        <span className="font-mono text-red-700 break-all">{r.errorMessage || '(无)'}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {records.length === 0 && !loading && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--color-text-muted)]">无失败记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
