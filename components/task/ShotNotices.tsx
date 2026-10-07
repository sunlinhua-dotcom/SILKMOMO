'use client';

import { Info } from 'lucide-react';

export interface ShotNotice {
  shotIndex: number;
  message: string;
}

/**
 * 「该镜次的提示」：服务端幂等命中时推的非致命说明
 * （已交付过 / 上一次请求仍在生成 / 上一次请求未完成会自动退款）。
 * 这不是生成失败——图可能已经在本地或交接缓冲里，刷新即可取回；用信息样式而不是红 / 黄告警。
 */
export function ShotNotices({ notices }: { notices: ShotNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-2xl border border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)] p-4"
    >
      <div className="mb-1 flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-[var(--color-brand-strong)]" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--color-ink)]">镜次提示</p>
      </div>
      <ul className="space-y-1">
        {notices.map((notice, index) => (
          <li key={`${notice.shotIndex}-${index}`} className="break-words text-xs text-[var(--color-text-secondary)]">
            {notice.shotIndex > 0 ? `镜次 #${notice.shotIndex}：` : ''}
            {notice.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
