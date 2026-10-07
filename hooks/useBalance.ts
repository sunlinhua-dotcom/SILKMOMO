'use client';

import { useMemo, useSyncExternalStore } from 'react';

/** /api/auth/me 返回的 user（createdAt 经 JSON 序列化后是 ISO 字符串） */
export interface MeUser {
  id: string;
  username: string;
  name: string;
  role: string; // "user" | "admin"
  balanceFen: number;
  createdAt: string;
}

export type BalanceStatus = 'loading' | 'ready' | 'error' | 'unauthenticated';

interface BalanceState {
  status: BalanceStatus;
  user: MeUser | null;
}

const FOCUS_REFRESH_THROTTLE_MS = 30_000;

// ── 模块级单一 store：所有组件共享一份，不各自 fetch ──
const INITIAL: BalanceState = { status: 'loading', user: null };
let state: BalanceState = INITIAL;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let lastFetchAt = 0;
let focusBound = false;

function setState(next: BalanceState) {
  state = next;
  listeners.forEach((l) => l());
}

async function load(): Promise<void> {
  lastFetchAt = Date.now();
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) {
      setState({ status: 'unauthenticated', user: null });
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { user?: MeUser };
    if (!data.user) throw new Error('响应缺少 user');
    setState({ status: 'ready', user: data.user });
  } catch {
    // 已有数据时保留旧值（余额短暂显示旧数优于闪成错误态）；还没拿到过数据才进 error
    if (state.user) return;
    setState({ status: 'error', user: null });
  }
}

/** 重新拉取余额与用户信息。并发调用共用同一个请求（in-flight 去重）。 */
export function refreshBalance(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

function onWindowFocus() {
  if (Date.now() - lastFetchAt >= FOCUS_REFRESH_THROTTLE_MS) void refreshBalance();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (!focusBound) {
      window.addEventListener('focus', onWindowFocus);
      focusBound = true;
    }
    // 首个订阅者出现：没数据就拉；有数据但已过期则按 focus 节流规则补拉
    if (state.status === 'loading' || state.status === 'error') void refreshBalance();
    else onWindowFocus();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && focusBound) {
      window.removeEventListener('focus', onWindowFocus);
      focusBound = false;
    }
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

export interface UseBalanceResult {
  /** 余额（分）；未就绪时为 null。展示用 (balanceFen / 100).toFixed(2) */
  balanceFen: number | null;
  status: BalanceStatus;
  user: MeUser | null;
  refresh: () => Promise<void>;
}

export function useBalance(): UseBalanceResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(
    () => ({
      balanceFen: snap.user ? snap.user.balanceFen : null,
      status: snap.status,
      user: snap.user,
      refresh: refreshBalance,
    }),
    [snap],
  );
}
