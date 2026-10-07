'use client';

import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { X, ChevronLeft, ChevronRight, RefreshCw, Wand2 } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
  footer?: ReactNode;
  zIndex?: number;
  /** 传了才启用上一张：显示左箭头、响应 ← 键与右滑 */
  onPrev?: () => void;
  /** 传了才启用下一张：显示右箭头、响应 → 键与左滑 */
  onNext?: () => void;
  /** 顶部说明文字，如「全身照 · 3 / 8」 */
  caption?: ReactNode;
  /** 传了才显示「重新生成」入口 */
  onRegenerate?: () => void;
  /** 传了才显示「微调描述」入口 */
  onAdjust?: () => void;
  /** 为 true 时重做 / 微调入口置灰 */
  busy?: boolean;
}

const SWIPE_MIN_PX = 50;

const ACTION_BTN =
  'flex items-center justify-center gap-2 min-h-11 px-5 rounded-full bg-surface text-ink font-medium whitespace-nowrap transition-colors hover:bg-brand-strong hover:text-surface disabled:opacity-50 disabled:pointer-events-none';
const ICON_BTN =
  'w-11 h-11 flex items-center justify-center rounded-full bg-surface/15 text-surface transition-colors hover:bg-surface/30';

export function ImageLightbox({
  src,
  alt,
  onClose,
  footer,
  zIndex = 50,
  onPrev,
  onNext,
  caption,
  onRegenerate,
  onAdjust,
  busy = false,
}: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // 回调放 ref：父组件每次渲染传新函数也不必重绑键盘监听、不重复锁滚动
  const handlersRef = useRef({ onClose, onPrev, onNext });
  useEffect(() => {
    handlersRef.current = { onClose, onPrev, onNext };
  });
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      if (e.key === 'Escape') {
        h.onClose();
      } else if (e.key === 'ArrowLeft' && h.onPrev) {
        e.preventDefault();
        h.onPrev();
      } else if (e.key === 'ArrowRight' && h.onNext) {
        e.preventDefault();
        h.onNext();
      } else if (e.key === 'Tab' && dialogRef.current) {
        // 焦点陷阱：Tab 只在灯箱内部循环
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // 关闭后焦点回到打开它的缩略图
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const handleTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
  const handleTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  const backdropClose = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const hasActions = !!(onRegenerate || onAdjust || footer);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 bg-ink/95 flex flex-col animate-fade-in"
      style={{
        zIndex,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      onClick={backdropClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 flex-shrink-0" onClick={backdropClose}>
        <div className="min-w-0 text-sm text-surface/80 truncate">{caption}</div>
        <button ref={closeRef} type="button" onClick={onClose} className={ICON_BTN} aria-label="关闭">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div
        className="relative flex-1 min-h-0 px-4 sm:px-20"
        style={{ touchAction: 'pan-y pinch-zoom' }}
        onClick={backdropClose}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data:/base64 内存图，next/image 无法优化 */}
        <img src={src} alt={alt} decoding="async" className="w-full h-full object-contain select-none" draggable={false} />

        {onPrev && (
          <button type="button" onClick={onPrev} className={`${ICON_BTN} absolute left-2 top-1/2 -translate-y-1/2`} aria-label="上一张">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {onNext && (
          <button type="button" onClick={onNext} className={`${ICON_BTN} absolute right-2 top-1/2 -translate-y-1/2`} aria-label="下一张">
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {hasActions && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3 flex-shrink-0" onClick={backdropClose}>
          {onRegenerate && (
            <button type="button" onClick={onRegenerate} disabled={busy} className={ACTION_BTN}>
              <RefreshCw className="w-5 h-5" strokeWidth={1.5} />
              重新生成
            </button>
          )}
          {onAdjust && (
            <button type="button" onClick={onAdjust} disabled={busy} className={ACTION_BTN}>
              <Wand2 className="w-5 h-5" strokeWidth={1.5} />
              微调描述
            </button>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
