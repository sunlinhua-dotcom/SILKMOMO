'use client';

import { useState } from 'react';
import { ChevronDown, History, AlertTriangle } from 'lucide-react';

interface GenerationRecord {
    id: string;
    module: string;
    shotIndex: number | null;
    apiModel: string;
    success: boolean;
    apiLatencyMs: number;
    errorMessage: string | null;
    createdAt: string;
}

interface Props {
    taskId: number;
}

export function FailureHistoryPanel({ taskId }: Props) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [records, setRecords] = useState<GenerationRecord[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleToggle = async () => {
        const next = !open;
        setOpen(next);
        if (next && records === null && !loading) {
            setLoading(true);
            try {
                const r = await fetch(`/api/generation/by-task/${taskId}`);
                if (!r.ok) {
                    const body = await r.json().catch(() => ({}));
                    setError(body.error || `HTTP ${r.status}`);
                    setRecords([]);
                    return;
                }
                const body = await r.json();
                setRecords(body.records || []);
            } catch (e) {
                setError(e instanceof Error ? e.message : '加载失败');
                setRecords([]);
            } finally {
                setLoading(false);
            }
        }
    };

    const fmt = (s: string) => new Date(s).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    return (
        <div className="max-w-lg mx-auto mb-6">
            <button
                type="button"
                onClick={handleToggle}
                className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-[var(--color-border-light)] rounded-xl transition-colors"
            >
                <span className="flex items-center gap-2">
                    <History className="w-3.5 h-3.5" />
                    查看历史尝试 (服务端记录)
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="mt-2 p-3 bg-[var(--color-background)] rounded-xl text-left space-y-2 animate-fade-in">
                    {loading && <p className="text-xs text-[var(--color-text-muted)]">加载中…</p>}
                    {error && <p className="text-xs text-red-600">加载失败: {error}</p>}
                    {records && records.length === 0 && !loading && !error && (
                        <p className="text-xs text-[var(--color-text-muted)]">无历史记录（服务端可能未持久化此任务的尝试）</p>
                    )}
                    {records && records.map((r) => (
                        <div key={r.id} className="text-xs space-y-1 p-2 bg-white rounded-lg">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{fmt(r.createdAt)}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                    {r.success ? '成功' : '失败'}
                                </span>
                                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{r.apiModel.replace(/-preview$/, '')}</span>
                                {r.shotIndex !== null && (
                                    <span className="text-[10px] text-[var(--color-text-muted)]">镜次 #{r.shotIndex}</span>
                                )}
                                <span className="text-[10px] text-[var(--color-text-muted)]">{(r.apiLatencyMs / 1000).toFixed(1)}s</span>
                            </div>
                            {r.errorMessage && (
                                <div className="flex items-start gap-1.5">
                                    <AlertTriangle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                                    <span className="font-mono text-red-700 break-all">{r.errorMessage}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
