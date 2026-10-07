'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Users, CreditCard, Activity, Search, Plus, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { RECHARGE_PACKAGES } from '@/lib/billing-constants';

interface AdminStats {
  totalUsers: number;
  totalRechargeFen: number;
  totalConsumeFen: number;
  todayConsumeFen: number;
  todayConsumeCount: number;
}

interface UserItem {
  id: string;
  username: string;
  name: string;
  role: string;
  balanceFen: number;
  createdAt: string;
  _count: { transactions: number };
}

interface RechargeTarget {
  userId: string;
  username: string;
  name: string;
}

const PAGE_SIZE = 50;

// 充值规则：起充额取自套餐表里最小的一档；步长与 POST /api/admin/users 的校验一致（¥75 倍数）
const MIN_RECHARGE_FEN = Math.min(...RECHARGE_PACKAGES.map(p => p.amountFen));
const RECHARGE_STEP_FEN = 7500;
const yuan = (fen: number) => String(fen / 100);
const RECHARGE_RULE_TEXT = `最低充值 ¥${yuan(MIN_RECHARGE_FEN)}，且必须是 ¥${yuan(RECHARGE_STEP_FEN)} 的倍数`;

const formatFen = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

/** 把输入的元数解析成分；不合规返回 null */
function parseRechargeFen(input: string): number | null {
  const n = parseFloat(input);
  if (!Number.isFinite(n)) return null;
  const fen = Math.round(n * 100);
  if (fen < MIN_RECHARGE_FEN || fen % RECHARGE_STEP_FEN !== 0) return null;
  return fen;
}

export default function AdminPage() {
  const toast = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // 防抖后的搜索词
  const [initialLoading, setInitialLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [rechargeModal, setRechargeModal] = useState<RechargeTarget | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeNote, setRechargeNote] = useState('');
  const [recharging, setRecharging] = useState(false);
  const [rechargeError, setRechargeError] = useState('');
  const rechargingRef = useRef(false);
  const listAbortRef = useRef<AbortController | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats');
      const data = await res.json();
      if (data.stats) setStats(data.stats);
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  }, []);

  // 拉用户列表；新请求会取消旧请求，防止搜索乱序覆盖
  const loadUsers = useCallback(async (targetPage: number, searchTerm: string) => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setListLoading(true);
    setListError('');
    try {
      const res = await fetch(
        `/api/admin/users?search=${encodeURIComponent(searchTerm)}&page=${targetPage}&pageSize=${PAGE_SIZE}`,
        { signal: controller.signal },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      const incoming: UserItem[] = data.users || [];
      setUsers(prev => {
        if (targetPage === 1) return incoming;
        const seen = new Set(prev.map(u => u.id));
        return [...prev, ...incoming.filter(u => !seen.has(u.id))];
      });
      setTotal(typeof data.total === 'number' ? data.total : incoming.length);
      setPage(targetPage);
    } catch (error) {
      if (controller.signal.aborted) return; // 被新请求取代，忽略
      setListError(error instanceof Error ? error.message : '加载失败');
    } finally {
      if (listAbortRef.current === controller) {
        setListLoading(false);
        setInitialLoading(false);
      }
    }
  }, []);

  // 搜索 300ms 防抖
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    void loadUsers(1, query);
    return () => listAbortRef.current?.abort();
  }, [query, loadUsers]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const closeRecharge = () => {
    if (rechargingRef.current) return;
    setRechargeModal(null);
    setRechargeAmount('');
    setRechargeNote('');
    setRechargeError('');
  };

  const handleRecharge = async () => {
    if (!rechargeModal || rechargingRef.current) return;
    const amountFen = parseRechargeFen(rechargeAmount);
    if (amountFen === null) {
      setRechargeError(`请输入正确的金额（${RECHARGE_RULE_TEXT}）`);
      return;
    }

    rechargingRef.current = true; // ref 兜底，防止同一帧内双击
    setRecharging(true);
    setRechargeError('');
    const target = rechargeModal;

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: target.userId,
          amountFen,
          description: rechargeNote.trim() || `管理员充值 ¥${amountFen / 100}`,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.success) {
        toast.success(`已为 ${target.name || target.username} 充值 ${formatFen(amountFen)}，新余额 ${formatFen(data.balanceAfter)}`);
        // 就地更新该用户行，再刷新统计
        setUsers(prev => prev.map(u => (u.id === target.userId
          ? { ...u, balanceFen: data.balanceAfter, _count: { transactions: u._count.transactions + 1 } }
          : u)));
        rechargingRef.current = false;
        setRecharging(false);
        setRechargeModal(null);
        setRechargeAmount('');
        setRechargeNote('');
        void loadStats();
        return;
      }
      setRechargeError(data.error || '充值失败');
    } catch {
      setRechargeError('充值失败，请检查网络后重试');
    }
    rechargingRef.current = false;
    setRecharging(false);
  };

  const hasMore = users.length < total;

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <PageHeader
        title="管理后台"
        backHref="/"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/pending-deliveries"
              className="inline-flex min-h-9 items-center whitespace-nowrap px-3 py-1 text-xs font-medium border border-warning text-warning hover:bg-warning-soft rounded-lg transition-colors"
            >
              未取走对账
            </Link>
            <Link
              href="/admin/failures"
              className="inline-flex min-h-9 items-center whitespace-nowrap px-3 py-1 text-xs font-medium border border-danger text-danger hover:bg-danger-soft rounded-lg transition-colors"
            >
              失败监控
            </Link>
          </div>
        }
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-border-light">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-brand-strong" aria-hidden="true" />
                <span className="text-xs text-muted">总用户</span>
              </div>
              <p className="text-2xl font-bold num">{stats.totalUsers}</p>
            </div>
            <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-border-light">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-4 h-4 text-success" aria-hidden="true" />
                <span className="text-xs text-muted">总充值</span>
              </div>
              <p className="text-2xl font-bold text-success num">{formatFen(stats.totalRechargeFen)}</p>
            </div>
            <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-border-light">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-warning" aria-hidden="true" />
                <span className="text-xs text-muted">总消费</span>
              </div>
              <p className="text-2xl font-bold text-warning num">{formatFen(stats.totalConsumeFen)}</p>
            </div>
            <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-border-light">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-brand-strong" aria-hidden="true" />
                <span className="text-xs text-muted">今日消费</span>
              </div>
              <p className="text-2xl font-bold text-brand-strong num">{formatFen(stats.todayConsumeFen)}</p>
              <p className="text-xs text-muted"><span className="num">{stats.todayConsumeCount}</span> 次调用</p>
            </div>
          </div>
        )}

        {/* 用户管理 */}
        <div className="bg-surface rounded-2xl border border-border-light">
          <div className="p-4 sm:p-5 border-b border-border-light flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
              <Users className="w-4 h-4" aria-hidden="true" />
              用户管理
              <span className="text-xs font-normal text-muted num">共 {total} 人</span>
            </h2>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" aria-hidden="true" />
                <input
                  type="text"
                  id="userSearch"
                  name="userSearch"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索用户名或昵称…"
                  aria-label="搜索用户名或昵称"
                  autoComplete="off"
                  className="w-full sm:w-64 pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:border-brand-strong transition-colors"
                />
              </div>
              <button
                onClick={() => { void loadUsers(1, query); void loadStats(); }}
                disabled={listLoading}
                className="p-2.5 rounded-xl border border-border hover:bg-background transition-colors disabled:opacity-60"
                aria-label="刷新用户列表"
              >
                <RefreshCw className={`w-4 h-4 text-muted ${listLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          {listError && (
            <p role="alert" className="px-4 sm:px-5 py-3 text-sm text-danger bg-danger-soft">
              {listError}
            </p>
          )}

          {/* 用户列表 */}
          <div className="divide-y divide-border-light">
            {users.length === 0 ? (
              <p className="text-center text-sm text-muted py-12">
                {listLoading ? '加载中…' : '暂无用户'}
              </p>
            ) : users.map(u => (
              <div key={u.id} className="px-4 sm:px-5 py-4 flex items-center justify-between gap-3 hover:bg-background/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-brand/20 to-brand/5 flex items-center justify-center">
                    <span className="text-sm font-bold text-brand-strong">
                      {u.name?.[0] || u.username.slice(0, 2)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      {u.role === 'admin' && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-brand-soft text-brand-strong rounded font-semibold">
                          管理员
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted truncate">
                      {u.username} · <span className="num">{u._count.transactions}</span> 笔交易
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold num">{formatFen(u.balanceFen)}</p>
                    <p className="text-xs text-muted">余额</p>
                  </div>
                  <button
                    onClick={() => { setRechargeError(''); setRechargeModal({ userId: u.id, username: u.username, name: u.name }); }}
                    className="flex items-center gap-1.5 min-h-9 px-3 py-1.5 text-xs font-medium bg-brand-strong text-white rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    充值
                  </button>
                </div>
              </div>
            ))}
          </div>

          {users.length > 0 && (
            <div className="p-4 border-t border-border-light flex flex-col items-center gap-2">
              <p className="text-xs text-muted">
                已显示 <span className="num">{users.length}</span> / <span className="num">{total}</span> 人
              </p>
              {hasMore && (
                <button
                  onClick={() => void loadUsers(page + 1, query)}
                  disabled={listLoading}
                  className="min-h-10 px-5 text-sm border border-border rounded-xl hover:bg-background transition-colors disabled:opacity-60"
                >
                  {listLoading ? '加载中…' : '加载更多'}
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      {/* 充值弹窗 */}
      <Modal
        open={rechargeModal !== null}
        onClose={closeRecharge}
        title="充值"
        size="md"
        closeOnOverlay={!recharging}
        initialFocusRef={amountRef}
        footer={
          <div className="flex gap-3">
            <button
              onClick={closeRecharge}
              disabled={recharging}
              className="flex-1 min-h-11 py-2.5 text-sm border border-border rounded-xl hover:bg-background transition-colors disabled:opacity-60"
            >
              取消
            </button>
            <button
              onClick={() => void handleRecharge()}
              disabled={recharging || !rechargeAmount}
              className="btn-primary flex-1 text-sm py-2.5"
            >
              <span>{recharging ? '充值中…' : `确认充值 ¥${rechargeAmount || '0'}`}</span>
            </button>
          </div>
        }
      >
        {rechargeModal && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              为 {rechargeModal.name}（{rechargeModal.username}）充值
            </p>
            {rechargeError && (
              <p role="alert" className="p-3 rounded-xl text-sm bg-danger-soft text-danger">
                {rechargeError}
              </p>
            )}
            <div>
              <label htmlFor="rechargeAmount" className="block text-sm font-medium text-text-secondary mb-1.5">
                充值金额（元）
              </label>
              <input
                ref={amountRef}
                type="number"
                inputMode="decimal"
                id="rechargeAmount"
                name="rechargeAmount"
                value={rechargeAmount}
                onChange={(e) => { setRechargeAmount(e.target.value); setRechargeError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleRecharge(); }}
                placeholder={`例如：${yuan(RECHARGE_PACKAGES[0].amountFen)}`}
                min={yuan(MIN_RECHARGE_FEN)}
                step={yuan(RECHARGE_STEP_FEN)}
                autoComplete="off"
                aria-describedby="rechargeRule"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background text-base sm:text-sm outline-none focus:border-brand-strong transition-colors"
              />
              <p id="rechargeRule" className="mt-1.5 text-xs text-muted">{RECHARGE_RULE_TEXT}</p>
            </div>
            {/* 快捷金额：取自充值套餐 */}
            <div className="grid grid-cols-4 gap-2">
              {RECHARGE_PACKAGES.map(pack => {
                const amt = yuan(pack.amountFen);
                const active = rechargeAmount === amt;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => { setRechargeAmount(amt); setRechargeError(''); }}
                    aria-pressed={active}
                    className={`min-h-10 py-2 text-xs font-medium rounded-lg border transition-colors num ${
                      active
                        ? 'bg-brand-strong text-white border-brand-strong'
                        : 'border-border hover:bg-background'
                    }`}
                  >
                    {pack.label}
                  </button>
                );
              })}
            </div>
            <div>
              <label htmlFor="rechargeNote" className="block text-sm font-medium text-text-secondary mb-1.5">
                备注 <span className="text-muted">(可选)</span>
              </label>
              <input
                type="text"
                id="rechargeNote"
                name="rechargeNote"
                value={rechargeNote}
                onChange={(e) => setRechargeNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleRecharge(); }}
                placeholder="充值备注"
                autoComplete="off"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background text-base sm:text-sm outline-none focus:border-brand-strong transition-colors"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
