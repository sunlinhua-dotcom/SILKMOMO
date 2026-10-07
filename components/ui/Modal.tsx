'use client';

import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** 点遮罩是否关闭，默认 true */
  closeOnOverlay?: boolean;
  /** 打开时优先聚焦的元素；不传则聚焦面板里第一个可聚焦元素 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ── 模块级：多个 Modal 叠加时只让最上面那个响应 Esc / Tab；滚动锁用计数 ──
const modalStack: symbol[] = [];
let scrollLockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

function lockScroll() {
  if (scrollLockCount++ > 0) return;
  const body = document.body;
  savedOverflow = body.style.overflow;
  savedPaddingRight = body.style.paddingRight;
  // 补偿滚动条消失造成的横向跳动
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}

function unlockScroll() {
  if (--scrollLockCount > 0) return;
  scrollLockCount = 0;
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPaddingRight;
}

const noopSubscribe = () => () => {};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  initialFocusRef,
}: ModalProps) {
  // 服务端渲染 / hydration 期间返回 false，客户端之后为 true；避免在 SSR 里调用 createPortal
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusRefRef = useRef(initialFocusRef);
  useEffect(() => {
    onCloseRef.current = onClose;
    initialFocusRefRef.current = initialFocusRef;
  });

  const visible = open && mounted;

  useEffect(() => {
    if (!visible) return;
    const token = Symbol('modal');
    modalStack.push(token);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    lockScroll();

    const panel = panelRef.current;
    const target =
      initialFocusRefRef.current?.current ??
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      // 跳过右上角关闭钮，优先聚焦正文 / 页脚里的第一个可操作元素
      panel?.querySelector<HTMLElement>(`:is(${FOCUSABLE}):not([data-modal-close])`) ??
      panel;
    target?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const idx = modalStack.indexOf(token);
      if (idx !== -1) modalStack.splice(idx, 1);
      unlockScroll();
      // 关闭后焦点归还给打开前的元素（元素若已被移除则忽略）
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div
      className="ui-modal-overlay fixed inset-0 flex items-end justify-center sm:items-center sm:p-6"
      style={{ zIndex: 'var(--z-modal)', background: 'var(--color-overlay)' }}
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : '对话框'}
        tabIndex={-1}
        className={`ui-modal-panel flex w-full ${SIZE_CLASS[size]} max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-[var(--shadow-xl)] outline-none sm:rounded-2xl`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-2 sm:px-6">
          {title ? (
            <h2 id={titleId} className="text-lg font-semibold text-[var(--color-ink)]">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="关闭"
            data-modal-close
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-background)] hover:text-[var(--color-ink)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 text-sm text-[var(--color-text-secondary)] sm:px-6">
          {children}
        </div>
        {footer && (
          <div
            className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--color-border-light)] px-5 pt-4 sm:flex-row sm:justify-end sm:px-6"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
        {/* 无 footer 时也要给底部抽屉留出 safe-area */}
        {!footer && <div className="shrink-0 sm:hidden" style={{ height: 'env(safe-area-inset-bottom)' }} />}
      </div>
    </div>,
    document.body,
  );
}
