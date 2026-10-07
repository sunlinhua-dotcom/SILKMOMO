'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, TrendingDown, Clock, Package, Sparkles, ShieldCheck, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ContactAdmin } from '@/components/ContactAdmin';
import { useBalance } from '@/hooks/useBalance';
import { formatRelativeTime } from '@/lib/format-time';
import {
  GPT_IMAGE_QUALITY_OPTIONS,
  PRICING,
  RECHARGE_PACKAGES,
  getGenerationCostFen,
} from '@/lib/billing-constants';

interface Transaction {
  id: string;
  type: string;
  amountFen: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

type TxStatus = 'loading' | 'ready' | 'error';

const formatYuan = (fen: number) => `¥${(Math.abs(fen) / 100).toFixed(2)}`;

const formatAbsolute = (d: string) =>
  new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 流水方向：消费为负，退款 / 充值为正；未知类型按金额符号。 */
function txDirection(tx: Transaction): -1 | 1 {
  if (tx.type === 'consume') return -1;
  if (tx.type === 'refund' || tx.type === 'recharge') return 1;
  return tx.amountFen < 0 ? -1 : 1;
}

const TX_META: Record<string, { label: string; badge: string; amount: string; fallback: string }> = {
  consume: {
    label: '消费',
    badge: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
    amount: 'text-[var(--color-ink)]',
    fallback: '图片生成',
  },
  refund: {
    label: '退款',
    badge: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]',
    amount: 'text-[var(--color-success)]',
    fallback: '失败退款',
  },
  recharge: {
    label: '充值',
    badge: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    amount: 'text-[var(--color-success)]',
    fallback: '充值',
  },
};

export default function BillingPage() {
  const router = useRouter();
  const { balanceFen, status, refresh } = useBalance();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txStatus, setTxStatus] = useState<TxStatus>('loading');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const reqSeq = useRef(0);

  const loadTransactions = useCallback(async () => {
    const seq = ++reqSeq.current;
    setTxStatus('loading');
    try {
      const res = await fetch(`/api/billing/transactions?page=${page}`, { cache: 'no-store' });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { transactions?: Transaction[]; totalPages?: number };
      if (seq !== reqSeq.current) return; // 已被更新的请求取代
      setTransactions(data.transactions ?? []);
      setTotalPages(Math.max(1, data.totalPages ?? 1));
      setTxStatus('ready');
    } catch (error) {
      if (seq !== reqSeq.current) return;
      console.error('加载流水失败:', error);
      setTxStatus('error');
    }
  }, [page, router]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const geminiFen = PRICING.pricePerCallFen;
  const gptStandardFen = getGenerationCostFen('openai', 'medium');
  const isZero = balanceFen !== null && balanceFen <= 0;
  const txBusy = txStatus === 'loading';

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <PageHeader title="账户 & 账单" />

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8">
        {/* 余额卡片 */}
        <section
          aria-label="可用余额"
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-ink)] p-6 text-white sm:p-8"
        >
          <div className="absolute right-0 top-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-[var(--color-accent)]/10 blur-3xl" />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-[var(--color-accent)]" aria-hidden="true" />
              <span className="text-sm text-white/80">可用余额</span>
            </div>

            {balanceFen !== null ? (
              <>
                <p className="num mb-1 text-4xl font-bold tracking-tight">{formatYuan(balanceFen)}</p>
                <p className="text-sm text-white/70">
                  Gemini 约 <span className="num">{Math.floor(balanceFen / geminiFen)}</span> 张
                  <span className="mx-1 text-white/40">/</span>
                  GPT 标准约 <span className="num">{Math.floor(balanceFen / gptStandardFen)}</span> 张
                </p>
              </>
            ) : status === 'error' ? (
              <div role="alert" className="space-y-3">
                <p className="flex items-center gap-2 text-base font-medium">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                  余额加载失败
                </p>
                <p className="text-sm text-white/70">这不代表余额为 0，请检查网络后重试。</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/30 px-4 text-sm font-medium transition-colors hover:bg-white/10"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  重试
                </button>
              </div>
            ) : (
              <div className="space-y-2" aria-busy="true" aria-live="polite">
                <div className="h-10 w-40 animate-pulse rounded-lg bg-white/15" />
                <p className="text-sm text-white/70">正在加载余额…</p>
              </div>
            )}
          </div>
        </section>

        {/* 联系管理员：余额为 0 时作为主引导 */}
        <ContactAdmin
          variant="card"
          note={
            isZero
              ? '余额不足，无法继续出图。在线充值暂未开放，请联系管理员充值：'
              : '在线充值暂未开放，充值请联系管理员：'
          }
        />

        {/* 计费规则 */}
        <section className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]">
            <Package className="h-4 w-4" aria-hidden="true" />
            计费标准
          </h2>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--color-border-light)] py-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-soft)]">
                  <Package className="h-3.5 w-3.5 text-[var(--color-brand-strong)]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">图片生成 · Gemini</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Gemini 3.1 Flash Image</p>
                </div>
              </div>
              <span className="num text-lg font-bold text-[var(--color-brand-strong)]">
                ¥{PRICING.pricePerCallYuan}
                <span className="ml-1 text-xs font-normal text-[var(--color-text-muted)]">/张</span>
              </span>
            </div>

            <div className="border-b border-[var(--color-border-light)] py-2">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-soft)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand-strong)]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">图片生成 · GPT Image 2</p>
                  <p className="text-xs text-[var(--color-text-muted)]">302.AI 官转通道 · 按画质档位计费</p>
                </div>
              </div>
              <ul className="grid gap-2 sm:grid-cols-3">
                {GPT_IMAGE_QUALITY_OPTIONS.map((option) => (
                  <li
                    key={option.id}
                    className="flex items-baseline justify-between gap-2 rounded-xl bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-text-secondary)] sm:block"
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="sm:mt-1 sm:block">
                      <span className="num text-sm font-bold text-[var(--color-brand-strong)]">
                        ¥{(option.priceFen / 100).toFixed(2)}
                      </span>
                      <span className="ml-1 text-[var(--color-text-muted)]">/张 · {option.etaLabel}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--color-border-light)] py-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-soft)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand-strong)]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">AI 智能分析</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Gemini 3.1 Flash Lite · 产品识别 / AI 助手</p>
                </div>
              </div>
              <span className="num text-lg font-bold text-[var(--color-brand-strong)]">
                ¥{PRICING.aiAnalysisPriceYuan}
                <span className="ml-1 text-xs font-normal text-[var(--color-text-muted)]">/次</span>
              </span>
            </div>

            <ul className="space-y-2 pt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" aria-hidden="true" />
                <span>
                  <strong className="font-medium text-[var(--color-text)]">组图换装按张扣费：</strong>
                  每生成一张按所选引擎与画质的单价计，规则与上表一致。
                </span>
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" aria-hidden="true" />
                <span>
                  <strong className="font-medium text-[var(--color-text)]">模特脸库按张扣费：</strong>
                  每张候选脸 <span className="num">{formatYuan(gptStandardFen)}</span>（GPT 标准档单价）。
                </span>
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" aria-hidden="true" />
                <span>
                  <strong className="font-medium text-[var(--color-text)]">失败自动退款：</strong>
                  生成失败的费用会自动退回，并在下方记录中显示为「退款」。
                </span>
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" aria-hidden="true" />
                <span>
                  <strong className="font-medium text-[var(--color-text)]">断线不重复扣费：</strong>
                  生成中网络中断，刷新页面即可取回结果，不会再扣一次。
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* 充值套餐 */}
        <section className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]">
            <TrendingDown className="h-4 w-4" aria-hidden="true" />
            充值套餐
            <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-xs font-normal text-[var(--color-brand-strong)]">
              仅供参考，暂未开放在线购买
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RECHARGE_PACKAGES.map((pkg) => (
              <div
                key={pkg.id}
                className="cursor-default rounded-xl border border-[var(--color-border-light)] bg-[var(--color-background)] p-4"
              >
                <p className="num text-lg font-bold text-[var(--color-text-secondary)]">{pkg.label}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{pkg.name}</p>
                {pkg.bonus > 0 && (
                  <p className="num mt-1 text-xs font-medium text-[var(--color-brand-strong)]">
                    +送 ¥{(pkg.bonus / 100).toFixed(0)}
                  </p>
                )}
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">{pkg.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 消费记录 */}
        <section className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]">
            <Clock className="h-4 w-4" aria-hidden="true" />
            消费记录
          </h2>

          {txStatus === 'error' ? (
            <div role="alert" className="py-8 text-center">
              <p className="mb-3 text-sm text-[var(--color-danger)]">记录加载失败，请重试</p>
              <button
                type="button"
                onClick={() => void loadTransactions()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-background)]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                重试
              </button>
            </div>
          ) : txStatus === 'loading' && transactions.length === 0 ? (
            <div className="space-y-3 py-2" aria-busy="true" aria-live="polite">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--color-background)]" />
              ))}
              <span className="sr-only">正在加载记录</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">还没有任何记录</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                出图扣费、失败退款和管理员充值都会显示在这里
              </p>
            </div>
          ) : (
            <ul className={`transition-opacity ${txBusy ? 'opacity-50' : ''}`} aria-busy={txBusy}>
              {transactions.map((tx) => {
                const meta = TX_META[tx.type] ?? TX_META.consume;
                const dir = txDirection(tx);
                return (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--color-border-light)] py-3 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-medium ${meta.badge}`}
                      >
                        {TX_META[tx.type]?.label ?? '其他'}
                      </span>
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-[var(--color-text)]">
                          {tx.description || meta.fallback}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          <time dateTime={tx.createdAt} title={formatAbsolute(tx.createdAt)}>
                            {formatRelativeTime(tx.createdAt) || formatAbsolute(tx.createdAt)}
                          </time>
                          <span className="num ml-2 hidden sm:inline">{formatAbsolute(tx.createdAt)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`num text-sm font-semibold ${meta.amount}`}>
                        {dir < 0 ? '-' : '+'}
                        {formatYuan(tx.amountFen)}
                      </p>
                      <p className="num text-xs text-[var(--color-text-muted)]">余额 {formatYuan(tx.balanceAfter)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 分页 */}
          {txStatus !== 'error' && totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || txBusy}
                onClick={() => setPage((p) => p - 1)}
                className="min-h-11 rounded-lg border border-[var(--color-border)] px-4 text-xs transition-colors hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <span className="num px-3 text-xs text-[var(--color-text-muted)]" aria-live="polite">
                {txBusy ? '加载中…' : `${page} / ${totalPages}`}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || txBusy}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-11 rounded-lg border border-[var(--color-border)] px-4 text-xs transition-colors hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
