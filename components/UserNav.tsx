'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wallet, Settings, LogOut, User as UserIcon, Sparkles } from 'lucide-react';
import { clearLocalWorkspaceSession } from '@/lib/client-session';
import { useBalance } from '@/hooks/useBalance';
import { useToast } from '@/components/ui/Toast';

const ITEM_CLS =
  'flex w-full items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-[var(--color-background)] focus-visible:bg-[var(--color-background)] transition-colors';

export function UserNav() {
  const router = useRouter();
  const toast = useToast();
  const { balanceFen, status, user, refresh } = useBalance();
  const [showMenu, setShowMenu] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setShowMenu(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const getItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // 打开后焦点移到第一项
  useEffect(() => {
    if (showMenu) getItems()[0]?.focus();
  }, [showMenu]);

  // Esc 关闭（焦点回按钮）；点外部关闭（不抢焦点，用户已点向别处）
  useEffect(() => {
    if (!showMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu(true);
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [showMenu, closeMenu]);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = getItems();
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') {
      // 菜单不是焦点陷阱：Tab 离开时收起
      closeMenu(false);
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
    }
  };

  const handleButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && !showMenu) {
      e.preventDefault();
      setShowMenu(true);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 清空本地缓存（IndexedDB + localStorage），防止下个用户登录时看到上个用户数据
      await clearLocalWorkspaceSession();
      router.push('/login');
      router.refresh();
    } catch {
      toast.error('退出登录失败，请稍后重试');
      setLoggingOut(false);
    }
  };

  // 未登录 / 状态未知：不渲染导航（与原行为一致）
  if (status === 'unauthenticated') return null;
  if (status === 'loading' && !user) {
    return (
      <div
        className="h-9 w-28 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)] animate-pulse"
        role="status"
        aria-label="正在加载账户信息"
      />
    );
  }

  const failed = status === 'error' && !user;

  // 加载失败：整个按钮变成「重试」，不打开菜单
  if (failed) {
    return (
      <button
        type="button"
        onClick={() => void refresh()}
        title="余额加载失败，点击重试"
        aria-label="余额加载失败，点击重试"
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-colors"
      >
        <Wallet className="w-4 h-4 text-[var(--color-brand-strong)]" aria-hidden="true" />
        <span className="text-sm font-semibold text-[var(--color-text)] num">¥—</span>
        <span className="text-xs text-[var(--color-text-muted)]">重试</span>
      </button>
    );
  }

  if (!user) return null;
  const balanceText = `¥${((balanceFen ?? user.balanceFen) / 100).toFixed(2)}`;

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setShowMenu((v) => !v)}
        onKeyDown={handleButtonKeyDown}
        aria-expanded={showMenu}
        aria-haspopup="menu"
        aria-controls={showMenu ? menuId : undefined}
        aria-label={`账户菜单，余额 ${balanceText}`}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-colors"
      >
        <Wallet className="w-4 h-4 text-[var(--color-brand-strong)]" aria-hidden="true" />
        <span className="text-sm font-semibold text-[var(--color-text)] num">{balanceText}</span>
        <div className="w-6 h-6 rounded-full bg-[var(--color-brand-soft)] flex items-center justify-center" aria-hidden="true">
          <span className="text-xs font-bold text-[var(--color-brand-strong)]">
            {user.name?.[0] || user.username.slice(0, 2)}
          </span>
        </div>
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="账户菜单"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full mt-2 w-56 max-w-[calc(100vw-2rem)] z-50 bg-[var(--color-surface)] rounded-xl shadow-xl border border-[var(--color-border-light)] py-2 animate-fade-in"
        >
          {/* 用户信息 */}
          <div className="px-4 py-2 border-b border-[var(--color-border-light)]">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-[var(--color-text-muted)] truncate">{user.username}</p>
          </div>

          {/* 余额 */}
          <div className="px-4 py-3 border-b border-[var(--color-border-light)]">
            <p className="text-xs text-[var(--color-text-muted)]">可用余额</p>
            <p className="text-lg font-bold text-[var(--color-brand-strong)] num">{balanceText}</p>
          </div>

          {/* 菜单项 */}
          <Link href="/billing" role="menuitem" onClick={() => closeMenu(false)} className={ITEM_CLS}>
            <Wallet className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            账户 & 账单
          </Link>

          {user.role === 'admin' && (
            <Link href="/admin" role="menuitem" onClick={() => closeMenu(false)} className={ITEM_CLS}>
              <Settings className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
              管理后台
            </Link>
          )}

          <Link href="/brand" role="menuitem" onClick={() => closeMenu(false)} className={ITEM_CLS}>
            <Sparkles className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            品牌设置
          </Link>

          <Link href="/tasks" role="menuitem" onClick={() => closeMenu(false)} className={ITEM_CLS}>
            <UserIcon className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            我的任务
          </Link>

          <div className="border-t border-[var(--color-border-light)] mt-1 pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              disabled={loggingOut}
              className={`${ITEM_CLS} text-[var(--color-danger)] disabled:opacity-50`}
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              {loggingOut ? '正在退出…' : '退出登录'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
