'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, RefreshCw, Copy } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';

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

// 筛选下拉的显示名；数据里出现过但这里没有的 apiModel 直接显示原始 id
const API_MODEL_LABELS: Record<string, string> = {
  'gemini-3.1-flash-image-preview': 'Gemini Flash Image',
  'gpt-image-2': 'GPT Image 2',
  'gpt-image-2-all': 'GPT Image 2（旧通道）',
};

export default function AdminFailuresPage() {
  const toast = useToast();
  const [summary, setSummary] = useState<FailureSummary | null>(null);
  const [topErrors, setTopErrors] = useState<TopError[]>([]);
  const [records, setRecords] = useState<FailureRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [apiModels, setApiModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [apiModelFilter, setApiModelFilter] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const url = `/api/admin/failures?days=${days}${apiModelFilter ? `&apiModel=${encodeURIComponent(apiModelFilter)}` : ''}`;
      const r = await fetch(url, { signal: controller.signal });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(`加载失败: ${err.error || r.statusText}`);
        return;
      }
      const data = await r.json();
      setSummary(data.summary);
      setTopErrors(data.topErrors || []);
      setRecords(data.records || []);
      setTotal(typeof data.total === 'number' ? data.total : (data.records || []).length);
      setApiModels(data.apiModels || []);
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(`加载失败: ${error instanceof Error ? error.message : '网络错误'}`);
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [days, apiModelFilter, toast]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`已复制${what}`);
    } catch {
      toast.error('复制失败，请手动选择文字');
    }
  };

  const formatTime = (s: string) => new Date(s).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  // 当前筛选值即使这次窗口里没出现，也要留在下拉里，避免选中项消失
  const modelOptions = Array.from(new Set([...apiModels, ...(apiModelFilter ? [apiModelFilter] : [])]));

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="失败任务监控" backHref="/admin" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* 控制栏 */}
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="failDays" className="text-sm text-text-secondary">最近</label>
          <select
            id="failDays"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="min-h-10 px-3 py-2 text-sm border border-border-light rounded-lg bg-surface focus:border-brand-strong focus:outline-none"
          >
            <option value={1}>1 天</option>
            <option value={3}>3 天</option>
            <option value={7}>7 天</option>
            <option value={14}>14 天</option>
            <option value={30}>30 天</option>
          </select>

          <label htmlFor="failModel" className="text-sm text-text-secondary ml-2">引擎</label>
          <select
            id="failModel"
            value={apiModelFilter}
            onChange={(e) => setApiModelFilter(e.target.value)}
            className="min-h-10 max-w-[12rem] px-3 py-2 text-sm border border-border-light rounded-lg bg-surface focus:border-brand-strong focus:outline-none"
          >
            <option value="">全部</option>
            {modelOptions.map(m => (
              <option key={m} value={m}>{API_MODEL_LABELS[m] ?? m}</option>
            ))}
          </select>

          <button
            onClick={() => void load()}
            disabled={loading}
            className="ml-auto flex min-h-10 items-center gap-2 px-3 py-2 text-sm border border-border-light rounded-lg hover:bg-surface transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            刷新
          </button>
        </div>

        {/* 概览 */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-surface rounded-2xl border border-border-light">
              <div className="text-xs text-muted mb-1">总尝试</div>
              <div className="text-2xl font-semibold num">{summary.totalAttempts}</div>
            </div>
            <div className="p-4 bg-surface rounded-2xl border border-border-light">
              <div className="text-xs text-muted mb-1">成功</div>
              <div className="text-2xl font-semibold text-success num">{summary.totalSuccesses}</div>
            </div>
            <div className="p-4 bg-surface rounded-2xl border border-border-light">
              <div className="text-xs text-muted mb-1">失败</div>
              <div className="text-2xl font-semibold text-danger num">{summary.totalFailures}</div>
            </div>
            <div className="p-4 bg-surface rounded-2xl border border-border-light">
              <div className="text-xs text-muted mb-1">失败率</div>
              <div className={`text-2xl font-semibold num ${summary.failureRate > 20 ? 'text-danger' : summary.failureRate > 10 ? 'text-warning' : 'text-success'}`}>{summary.failureRate}%</div>
            </div>
          </div>
        )}

        {/* Top 错误 */}
        {topErrors.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium tracking-widest uppercase text-text-secondary">高频错误 Top 10</h2>
            <div className="bg-surface rounded-2xl border border-border-light divide-y divide-border-light">
              {topErrors.map((e, i) => (
                <div key={i} className="p-3 flex items-start gap-3 text-sm">
                  <span className="font-mono text-xs text-muted mt-0.5 flex-shrink-0 w-6">{i + 1}</span>
                  <span className="font-mono text-danger break-all flex-1">{e.message}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-danger-soft text-danger flex-shrink-0 num">×{e.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 记录列表 */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium tracking-widest uppercase text-text-secondary">
            最近失败记录（共 <span className="num">{total}</span> 条
            {total > records.length && <>，显示最近 <span className="num">{records.length}</span> 条</>}）
          </h2>
          <div className="bg-surface rounded-2xl border border-border-light overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="bg-background text-muted">
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
              <tbody className="divide-y divide-border-light">
                {records.map((r) => {
                  const who = r.user ? `${r.user.name || r.user.username}（${r.user.username}）` : '(用户已删除)';
                  return (
                    <tr key={r.id} className="hover:bg-background">
                      <td className="px-3 py-2 whitespace-nowrap num">{formatTime(r.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="whitespace-nowrap">{who}</div>
                        <button
                          type="button"
                          onClick={() => void copy(`${r.userId}${r.taskId != null ? ` / task ${r.taskId}` : ''}`, 'ID')}
                          className="mt-0.5 inline-flex min-h-6 items-center gap-1 font-mono text-[10px] text-muted hover:text-ink"
                          aria-label={`复制 ${who} 的用户 ID 与任务号`}
                        >
                          <Copy className="w-3 h-3" aria-hidden="true" />
                          <span className="select-all">{r.userId}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap num">{r.taskId ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.module}</td>
                      <td className="px-3 py-2 whitespace-nowrap num">{r.shotIndex ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px]">{r.apiModel.replace(/-preview$/, '').replace(/^gemini-3\.1-/, 'gemini-')}</td>
                      <td className="px-3 py-2 whitespace-nowrap num">{(r.apiLatencyMs / 1000).toFixed(1)}s</td>
                      <td className="px-3 py-2 min-w-[14rem] max-w-md">
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="w-3 h-3 text-danger mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <span className="font-mono text-danger break-all">{r.errorMessage || '(无)'}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {records.length === 0 && !loading && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted">无失败记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
