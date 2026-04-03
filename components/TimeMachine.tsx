'use client';

import { useState, useEffect, useRef } from 'react';
import { History, Play, Trash2, ChevronRight } from 'lucide-react';
import { getSnapshots, removeSnapshot, type FlowSnapshot } from '@/lib/image-library';
import Image from 'next/image';

interface TimeMachineProps {
  onReplay: (snapshot: FlowSnapshot) => void;
}

export function TimeMachine({ onReplay }: TimeMachineProps) {
  const [snapshots, setSnapshots] = useState<FlowSnapshot[]>([]);
  const [expanded, setExpanded] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // 异步加载避免 eslint setState-in-effect 警告
      queueMicrotask(() => setSnapshots(getSnapshots()));
    }
  }, []);

  const displayed = expanded ? snapshots : snapshots.slice(0, 3);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = removeSnapshot(id);
    setSnapshots(updated);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - ts;
    
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2.5">
        <History className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        <span className="text-xs font-medium tracking-wide text-[var(--color-text-secondary)]">快速重做</span>
      </div>

      <div className="space-y-1.5">
        {displayed.map(snap => (
          <button
            key={snap.id}
            onClick={() => onReplay(snap)}
            className="w-full group flex items-center gap-3 p-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-light)] hover:border-[var(--color-accent)]/50 hover:shadow-sm transition-all text-left"
          >
            {/* 缩略图 */}
            <div className="flex -space-x-2 flex-shrink-0">
              {snap.productImageThumbs.slice(0, 2).map((thumb, i) => (
                <div key={i} className="w-9 h-9 rounded-lg overflow-hidden ring-2 ring-[var(--color-surface)]">
                  <Image src={thumb} alt="" className="w-full h-full object-cover" width={36} height={36} unoptimized />
                </div>
              ))}
              {snap.productImageThumbs.length === 0 && (
                <div className="w-9 h-9 rounded-lg bg-[var(--color-background)] flex items-center justify-center">
                  <History className="w-4 h-4 text-[var(--color-text-muted)]" />
                </div>
              )}
            </div>

            {/* 描述 */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--color-text)] truncate">
                {snap.label}
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                {formatTime(snap.createdAt)}
              </p>
            </div>

            {/* 右侧操作 */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <span
                onClick={(e) => handleDelete(snap.id, e)}
                className="w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all cursor-pointer"
              >
                <Trash2 className="w-3 h-3 text-[var(--color-text-muted)] hover:text-red-500" />
              </span>
              <Play className="w-3.5 h-3.5 text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" />
            </div>
          </button>
        ))}
      </div>

      {snapshots.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-2 text-[10px] text-[var(--color-accent)] hover:text-[var(--color-accent-dark)] transition-colors mx-auto"
        >
          {expanded ? '收起' : `显示全部 ${snapshots.length} 条`}
          <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      )}
    </div>
  );
}
