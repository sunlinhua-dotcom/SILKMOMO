'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  success(msg: string): void;
  error(msg: string): void;
  info(msg: string): void;
}

const TOAST_DURATION_MS = 4000;
const MAX_VISIBLE = 4;

const FALLBACK_API: ToastApi = {
  success: (msg) => console.info('[toast:success]', msg),
  error: (msg) => console.error('[toast:error]', msg),
  info: (msg) => console.info('[toast:info]', msg),
};

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLE: Record<ToastKind, { icon: React.ReactNode; className: string }> = {
  success: {
    icon: <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-success)]" aria-hidden="true" />,
    className: 'border-[var(--color-success)]/30',
  },
  error: {
    icon: <AlertCircle className="h-5 w-5 shrink-0 text-[var(--color-danger)]" aria-hidden="true" />,
    className: 'border-[var(--color-danger)]/30',
  },
  info: {
    icon: <Info className="h-5 w-5 shrink-0 text-[var(--color-brand-strong)]" aria-hidden="true" />,
    className: 'border-[var(--color-brand)]/50',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((prev) => {
        const next = [...prev, { id, kind, message }];
        // 超出上限时丢掉最旧的，并清掉它们的定时器
        const dropped = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
        for (const d of dropped) {
          const t = timers.current.get(d.id);
          if (t) clearTimeout(t);
          timers.current.delete(d.id);
        }
        return next.slice(-MAX_VISIBLE);
      });
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (msg) => push('success', msg),
      error: (msg) => push('error', msg),
      info: (msg) => push('info', msg),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* 通知区常驻 DOM：读屏器需要 live region 先存在，之后插入的内容才会被播报。
          手机贴顶、避开底部固定 CTA；>=640px 靠右上。 */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6"
        style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)', zIndex: 'var(--z-toast)' }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`ui-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-[var(--color-surface)] py-3 pl-4 pr-2 shadow-[var(--shadow-lg)] ${KIND_STYLE[t.kind].className}`}
          >
            <span className="mt-0.5">{KIND_STYLE[t.kind].icon}</span>
            <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-[var(--color-ink)]">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="关闭提示"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-background)] hover:text-[var(--color-ink)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 返回稳定引用的 { success, error, info }。没有 ToastProvider 时退化为 console 输出，不会抛错。 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? FALLBACK_API;
}
