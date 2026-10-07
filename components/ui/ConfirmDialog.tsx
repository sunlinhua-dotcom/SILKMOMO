'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认钮变红，且默认聚焦「取消」 */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((ok: boolean) => {
    const cur = pendingRef.current;
    if (!cur) return;
    pendingRef.current = null;
    setPending(null);
    cur.resolve(ok);
  }, []);

  const confirm = useCallback<ConfirmFn>((opts) => {
    // 上一个还没答复就又来一个：把上一个按「取消」处理
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { opts, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  // Provider 卸载时别让调用方的 await 永远悬着
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  const opts = pending?.opts;
  const danger = !!opts?.danger;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => settle(false)}
        title={opts?.title}
        size="sm"
        initialFocusRef={danger ? cancelBtnRef : confirmBtnRef}
        footer={
          <>
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={() => settle(false)}
              className="min-h-11 rounded-xl border border-[var(--color-border)] px-5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-brand-strong)]"
            >
              {opts?.cancelText ?? '取消'}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={() => settle(true)}
              className={`min-h-11 rounded-xl px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 ${
                danger ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-brand-strong)]'
              }`}
            >
              {opts?.confirmText ?? '确定'}
            </button>
          </>
        }
      >
        {opts?.message && <div className="leading-relaxed">{opts.message}</div>}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * const confirm = useConfirm();
 * if (!(await confirm({ title: '删除这张图？', danger: true }))) return;
 * 没有 ConfirmProvider 时退化为 window.confirm，不会抛错。
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? fallbackConfirm;
}

const fallbackConfirm: ConfirmFn = async (opts) =>
  typeof window !== 'undefined' ? window.confirm(opts.title) : false;
