'use client';

import { Copy } from 'lucide-react';
import { ADMIN_WECHAT } from '@/lib/contact';
import { useToast } from '@/components/ui/Toast';

export interface ContactAdminProps {
  variant?: 'inline' | 'card';
  /** 卡片 / 行内的说明文字，如「余额不足，请联系管理员充值」 */
  note?: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非 https / 权限被拒时的老办法
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** 显示管理员微信号 + 一键复制；复制结果用 toast 反馈（需要 ToastProvider，layout 已挂载）。 */
export function ContactAdmin({ variant = 'inline', note }: ContactAdminProps) {
  const toast = useToast();

  const copy = async () => {
    if (await copyText(ADMIN_WECHAT)) {
      toast.success(`已复制管理员微信号 ${ADMIN_WECHAT}，请前往微信添加`);
    } else {
      toast.error(`自动复制失败，请手动添加管理员微信号：${ADMIN_WECHAT}`);
    }
  };

  if (variant === 'card') {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center">
        {note && <p className="mb-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{note}</p>}
        <p className="mb-1 text-xs text-[var(--color-text-muted)]">管理员微信号</p>
        <p className="num mb-4 select-all font-mono text-base font-semibold text-[var(--color-ink)]">{ADMIN_WECHAT}</p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-strong)] px-6 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          复制微信号
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-sm text-[var(--color-text-secondary)]">
      {note && <span>{note}</span>}
      <span>管理员微信</span>
      <span className="num select-all font-mono font-medium text-[var(--color-ink)]">{ADMIN_WECHAT}</span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-medium text-[var(--color-brand-strong)] underline-offset-2 hover:underline"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        复制
      </button>
    </span>
  );
}
