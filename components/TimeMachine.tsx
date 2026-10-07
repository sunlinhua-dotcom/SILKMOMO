'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { History, Play, Trash2, ChevronRight } from 'lucide-react';
import { getSnapshots, removeSnapshot, type FlowSnapshot } from '@/lib/image-library';
import { formatRelativeTime } from '@/lib/format-time';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import Image from 'next/image';

interface TimeMachineProps {
  onReplay: (snapshot: FlowSnapshot) => void;
}

/** 操作按钮：悬停设备上平时隐藏，悬停 / 聚焦卡片时显示；触屏（无 hover）常显。 */
const REVEAL =
  '[@media(hover:hover)]:group-[:not(:hover):not(:focus-within)]/row:opacity-0';

export function TimeMachine({ onReplay }: TimeMachineProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const [snapshots, setSnapshots] = useState<FlowSnapshot[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => Date.now());
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // 异步加载避免 eslint setState-in-effect 警告
      queueMicrotask(() => setSnapshots(getSnapshots()));
    }
  }, []);

  const displayed = expanded ? snapshots : snapshots.slice(0, 3);

  const handleDelete = async (snap: FlowSnapshot) => {
    const ok = await confirm({
      title: '删除这条快速重做记录？',
      message: `「${snap.label}」删除后无法恢复（已生成的任务不受影响）。`,
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    setSnapshots(removeSnapshot(snap.id));
  };

  const handleCardClick = (snap: FlowSnapshot) => {
    // 优先：跳到原任务详情页查看已生成结果；老快照无 taskId 时回退到回放参数
    if (snap.taskId) {
      router.push(`/task/${snap.taskId}`);
    } else {
      onReplay(snap);
    }
  };

  const handleReplayClick = (snap: FlowSnapshot) => {
    // 快照只存 64px 缩略图、没有源图，首页表单无法真正重跑。
    // 有 taskId → 跳到任务详情页（源图 + 参数都持久化在 IndexedDB，可真正重生成）；
    // 无 taskId（老快照）→ 回退到首页参数回放。
    if (snap.taskId) {
      router.push(`/task/${snap.taskId}?redo=1`);
    } else {
      onReplay(snap);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2.5">
        <History className="w-3.5 h-3.5 text-brand-strong" aria-hidden="true" />
        <span className="text-xs font-medium tracking-wide text-text-secondary">快速重做</span>
      </div>

      <ul className="space-y-1.5">
        {displayed.map(snap => (
          <li
            key={snap.id}
            className="group/row relative flex items-center gap-1 rounded-xl bg-surface border border-border-light hover:border-brand/50 hover:shadow-sm transition-all has-[button.tm-main:focus-visible]:ring-2 has-[button.tm-main:focus-visible]:ring-brand-strong"
          >
            {/* 主点击区：缩略图 + 描述。::after 撑满整张卡片，操作按钮用 z-10 浮在上面，
                所以按钮上的 Enter / Space / 点击不会再冒泡成「打开任务」 */}
            <button
              type="button"
              onClick={() => handleCardClick(snap)}
              title={snap.taskId ? '查看任务详情' : '回放参数'}
              className="tm-main flex min-h-12 min-w-0 flex-1 items-center gap-3 p-2.5 text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
            >
              {/* 缩略图 */}
              <span className="flex -space-x-2 flex-shrink-0">
                {snap.productImageThumbs.slice(0, 2).map((thumb, i) => (
                  <span key={i} className="block w-9 h-9 rounded-lg overflow-hidden ring-2 ring-surface">
                    <Image src={thumb} alt="" className="w-full h-full object-cover" width={36} height={36} unoptimized />
                  </span>
                ))}
                {snap.productImageThumbs.length === 0 && (
                  <span className="w-9 h-9 rounded-lg bg-background flex items-center justify-center">
                    <History className="w-4 h-4 text-muted" aria-hidden="true" />
                  </span>
                )}
              </span>

              {/* 描述 */}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-ink truncate">
                  {snap.label}
                </span>
                <span className="block text-[11px] text-muted mt-0.5">
                  {formatRelativeTime(snap.createdAt, now)}
                </span>
              </span>
            </button>

            {/* 右侧操作：重做 / 删除（点卡片本身 = 查看任务 / 回放参数） */}
            <div className="relative z-10 flex items-center flex-shrink-0 pr-1">
              <button
                type="button"
                onClick={() => handleReplayClick(snap)}
                className={`${REVEAL} w-10 h-10 rounded-full flex items-center justify-center hover:bg-brand-soft focus-visible:opacity-100 transition-all`}
                aria-label={`用相同参数重新生成：${snap.label}`}
                title="重做"
              >
                <Play className="w-3.5 h-3.5 text-brand-strong" fill="currentColor" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(snap)}
                className={`${REVEAL} w-10 h-10 rounded-full flex items-center justify-center text-muted hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 transition-all`}
                aria-label={`删除快照：${snap.label}`}
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {snapshots.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-1 mt-1 min-h-10 px-3 text-[11px] text-brand-strong hover:text-primary transition-colors mx-auto"
        >
          {expanded ? '收起' : `显示全部 ${snapshots.length} 条`}
          <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
