'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Wallet, TrendingDown, Clock, Package, Sparkles } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { PRICING, RECHARGE_PACKAGES } from '@/lib/billing-constants';

interface UserInfo {
  id: string;
  username: string;
  name: string;
  role: string;
  balanceFen: number;
}

interface Transaction {
  id: string;
  type: string;
  amountFen: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

export default function BillingPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadData = useCallback(async () => {
    try {
      const [userRes, txRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(`/api/billing/transactions?page=${page}`),
      ]);
      const userData = await userRes.json();
      const txData = await txRes.json();

      if (userData.user) setUser(userData.user);
      if (txData.transactions) {
        setTransactions(txData.transactions);
        setTotalPages(txData.totalPages);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatFen = (fen: number) => `¥${(Math.abs(fen) / 100).toFixed(2)}`;
  const formatDate = (d: string) => new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
            <Logo width={32} height={32} />
            <span className="text-lg font-semibold tracking-tight">SILKMOMO</span>
          </Link>
          <h1 className="text-sm font-medium text-[var(--color-text-secondary)]">账户 & 账单</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* 余额卡片 */}
        <div className="bg-gradient-to-br from-[var(--color-primary)] to-[#2a2a2a] rounded-3xl p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--color-accent)]/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-5 h-5 text-[var(--color-accent)]" />
              <span className="text-sm text-white/70">可用余额</span>
            </div>
            <p className="text-4xl font-bold tracking-tight mb-1">
              {user ? formatFen(user.balanceFen) : '¥0.00'}
            </p>
            <p className="text-sm text-white/50">
              约可生成 {user ? Math.floor(user.balanceFen / PRICING.pricePerCallFen) : 0} 张图片
            </p>
          </div>
        </div>

        {/* 定价说明 */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-6 border border-[var(--color-border-light)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
            <Package className="w-4 h-4" />
            计费标准
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-[var(--color-border-light)]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[rgba(201,168,108,0.1)] flex items-center justify-center">
                  <Package className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">图片生成</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Gemini 3.1 Flash Image</p>
                </div>
              </div>
              <span className="text-lg font-bold text-[var(--color-accent)]">¥{PRICING.pricePerCallYuan}<span className="text-xs font-normal text-[var(--color-text-muted)] ml-1">/张</span></span>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">AI 智能分析</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Gemini 3.1 Flash Lite · 产品识别</p>
                </div>
              </div>
              <span className="text-lg font-bold text-purple-600">¥{PRICING.aiAnalysisPriceYuan}<span className="text-xs font-normal text-[var(--color-text-muted)] ml-1">/次</span></span>
            </div>
          </div>
        </div>

        {/* 充值套餐 */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-6 border border-[var(--color-border-light)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            充值套餐
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {RECHARGE_PACKAGES.map(pkg => (
              <div
                key={pkg.id}
                className="p-4 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors cursor-pointer group"
              >
                <p className="text-lg font-bold text-[var(--color-text)] group-hover:text-[var(--color-accent)] transition-colors">
                  {pkg.label}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">{pkg.name}</p>
                {pkg.bonus > 0 && (
                  <p className="text-xs text-[var(--color-accent)] mt-1 font-medium">
                    +送 ¥{(pkg.bonus / 100).toFixed(0)}
                  </p>
                )}
                <p className="text-[10px] text-[var(--color-text-muted)] mt-2">{pkg.description}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-4 text-center">
            请联系管理员进行充值
          </p>
        </div>

        {/* 消费记录 */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-6 border border-[var(--color-border-light)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            消费记录
          </h2>

          {transactions.length === 0 ? (
            <p className="text-center text-sm text-[var(--color-text-muted)] py-8">
              暂无消费记录
            </p>
          ) : (
            <div className="space-y-2">
              {transactions.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-3 border-b border-[var(--color-border-light)] last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      tx.type === 'recharge' ? 'bg-green-50 text-green-600' :
                      tx.type === 'consume' ? 'bg-orange-50 text-orange-600' :
                      'bg-blue-50 text-blue-600'
                    }`}>
                      {tx.type === 'recharge' ? '+' : tx.type === 'consume' ? '-' : '♻'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text)]">{tx.description || (tx.type === 'recharge' ? '充值' : '图片生成')}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{formatDate(tx.createdAt)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${tx.amountFen > 0 ? 'text-green-600' : 'text-[var(--color-text)]'}`}>
                      {tx.amountFen > 0 ? '+' : ''}{formatFen(tx.amountFen)}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      余额 {formatFen(tx.balanceAfter)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-background)] transition-colors"
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-xs text-[var(--color-text-muted)]">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-background)] transition-colors"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
