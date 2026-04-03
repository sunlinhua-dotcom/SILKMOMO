'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Users, CreditCard, Activity, Search, Plus, RefreshCw } from 'lucide-react';
import { Logo } from '@/components/Logo';

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

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [rechargeModal, setRechargeModal] = useState<{ userId: string; username: string; name: string } | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeNote, setRechargeNote] = useState('');
  const [recharging, setRecharging] = useState(false);
  const [message, setMessage] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [statsRes, usersRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch(`/api/admin/users?search=${encodeURIComponent(search)}`),
      ]);
      const statsData = await statsRes.json();
      const usersData = await usersRes.json();

      if (statsData.stats) setStats(statsData.stats);
      if (usersData.users) setUsers(usersData.users);
    } catch (error) {
      console.error('加载管理数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRecharge = async () => {
    if (!rechargeModal || !rechargeAmount) return;
    setRecharging(true);
    setMessage('');

    try {
      const amountFen = Math.round(parseFloat(rechargeAmount) * 100);
      if (isNaN(amountFen) || amountFen < 15000 || amountFen % 7500 !== 0) {
        setMessage('请输入正确的金额（最低充值 ¥150，且必须是 ¥75 的倍数）');
        setRecharging(false);
        return;
      }

      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: rechargeModal.userId,
          amountFen,
          description: rechargeNote || `管理员充值 ¥${rechargeAmount}`,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setMessage(`✅ 充值成功！新余额 ¥${(data.balanceAfter / 100).toFixed(2)}`);
        setRechargeModal(null);
        setRechargeAmount('');
        setRechargeNote('');
        loadData(); // 刷新
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch {
      setMessage('❌ 充值失败');
    } finally {
      setRecharging(false);
    }
  };

  const formatFen = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* 导航 */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
            <Logo width={32} height={32} />
            <span className="text-lg font-semibold tracking-tight">SILKMOMO</span>
          </Link>
          <span className="px-3 py-1 text-xs font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)] rounded-lg">
            管理后台
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="text-xs text-[var(--color-text-muted)]">总用户</span>
              </div>
              <p className="text-2xl font-bold">{stats.totalUsers}</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-4 h-4 text-green-500" />
                <span className="text-xs text-[var(--color-text-muted)]">总充值</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{formatFen(stats.totalRechargeFen)}</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-[var(--color-text-muted)]">总消费</span>
              </div>
              <p className="text-2xl font-bold text-orange-600">{formatFen(stats.totalConsumeFen)}</p>
            </div>
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-[var(--color-text-muted)]">今日消费</span>
              </div>
              <p className="text-2xl font-bold text-blue-600">{formatFen(stats.todayConsumeFen)}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{stats.todayConsumeCount} 次调用</p>
            </div>
          </div>
        )}

        {/* 成功/错误消息 */}
        {message && (
          <div className={`p-3 rounded-xl text-sm text-center ${
            message.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {/* 用户管理 */}
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border-light)]">
          <div className="p-5 border-b border-[var(--color-border-light)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] flex items-center gap-2">
              <Users className="w-4 h-4" />
              用户管理
            </h2>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索用户名或昵称"
                  className="w-full sm:w-64 pl-9 pr-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
                />
              </div>
              <button
                onClick={loadData}
                className="p-2 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-background)] transition-colors"
              >
                <RefreshCw className="w-4 h-4 text-[var(--color-text-muted)]" />
              </button>
            </div>
          </div>

          {/* 用户列表 */}
          <div className="divide-y divide-[var(--color-border-light)]">
            {users.length === 0 ? (
              <p className="text-center text-sm text-[var(--color-text-muted)] py-12">暂无用户</p>
            ) : users.map(u => (
              <div key={u.id} className="px-5 py-4 flex items-center justify-between hover:bg-[var(--color-background)]/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-accent)]/20 to-[var(--color-accent)]/5 flex items-center justify-center">
                    <span className="text-sm font-bold text-[var(--color-accent)]">
                      {u.name?.[0] || u.username.slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{u.name}</p>
                      {u.role === 'admin' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-accent)]/10 text-[var(--color-accent)] rounded font-semibold">
                          管理员
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {u.username} · {u._count.transactions} 笔交易
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatFen(u.balanceFen)}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">余额</p>
                  </div>
                  <button
                    onClick={() => setRechargeModal({ userId: u.id, username: u.username, name: u.name })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--color-accent)] text-white rounded-lg hover:bg-[var(--color-accent-dark)] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    充值
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* 充值 Modal */}
      {rechargeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-md shadow-2xl border border-[var(--color-border-light)]">
            <div className="p-5 border-b border-[var(--color-border-light)]">
              <h3 className="text-lg font-semibold">充值</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                为 {rechargeModal.name}（{rechargeModal.username}）充值
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  充值金额（元）
                </label>
                <input
                  type="number"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                  placeholder="例如：50"
                  min="1"
                  step="1"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
                />
              </div>
              {/* 快捷金额 */}
              <div className="flex gap-2">
                {['150', '300', '750', '1500'].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setRechargeAmount(amt)}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      rechargeAmount === amt
                        ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-background)]'
                    }`}
                  >
                    ¥{amt}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  备注 <span className="text-[var(--color-text-muted)]">(可选)</span>
                </label>
                <input
                  type="text"
                  value={rechargeNote}
                  onChange={(e) => setRechargeNote(e.target.value)}
                  placeholder="充值备注"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
                />
              </div>
            </div>
            <div className="p-5 border-t border-[var(--color-border-light)] flex gap-3">
              <button
                onClick={() => { setRechargeModal(null); setRechargeAmount(''); setRechargeNote(''); }}
                className="flex-1 py-2.5 text-sm border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-background)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleRecharge}
                disabled={recharging || !rechargeAmount}
                className="btn-primary flex-1 text-sm py-2.5"
              >
                <span>{recharging ? '充值中...' : `确认充值 ¥${rechargeAmount || '0'}`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
