'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wallet, Settings, LogOut, User as UserIcon } from 'lucide-react';

interface UserInfo {
  username: string;
  name: string;
  role: string;
  balanceFen: number;
}

export function UserNav() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.user) setUser(d.user); })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-colors"
      >
        <Wallet className="w-4 h-4 text-[var(--color-accent)]" />
        <span className="text-sm font-semibold text-[var(--color-text)]">
          ¥{(user.balanceFen / 100).toFixed(2)}
        </span>
        <div className="w-6 h-6 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center">
          <span className="text-xs font-bold text-[var(--color-accent)]">
            {user.name?.[0] || user.username.slice(0, 2)}
          </span>
        </div>
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 z-50 bg-[var(--color-surface)] rounded-xl shadow-xl border border-[var(--color-border-light)] py-2 animate-fade-in">
            {/* 用户信息 */}
            <div className="px-4 py-2 border-b border-[var(--color-border-light)]">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{user.username}</p>
            </div>

            {/* 余额 */}
            <div className="px-4 py-3 border-b border-[var(--color-border-light)]">
              <p className="text-xs text-[var(--color-text-muted)]">可用余额</p>
              <p className="text-lg font-bold text-[var(--color-accent)]">
                ¥{(user.balanceFen / 100).toFixed(2)}
              </p>
            </div>

            {/* 菜单项 */}
            <Link
              href="/billing"
              onClick={() => setShowMenu(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[var(--color-background)] transition-colors"
            >
              <Wallet className="w-4 h-4 text-[var(--color-text-muted)]" />
              账户 & 账单
            </Link>

            {user.role === 'admin' && (
              <Link
                href="/admin"
                onClick={() => setShowMenu(false)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[var(--color-background)] transition-colors"
              >
                <Settings className="w-4 h-4 text-[var(--color-text-muted)]" />
                管理后台
              </Link>
            )}

            <Link
              href="/tasks"
              onClick={() => setShowMenu(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[var(--color-background)] transition-colors"
            >
              <UserIcon className="w-4 h-4 text-[var(--color-text-muted)]" />
              我的任务
            </Link>

            <div className="border-t border-[var(--color-border-light)] mt-1 pt-1">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[var(--color-background)] text-red-500 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                退出登录
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
