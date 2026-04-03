'use client';

import { TaskList } from '@/components/TaskList';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import Link from 'next/link';

export default function TasksPage() {
  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* 顶部导航 — 与主页同步 */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-20">
            <Link href="/" className="flex items-center gap-2.5 sm:gap-4 group">
              <div className="w-8 h-8 sm:w-11 sm:h-11 flex-shrink-0 flex items-center justify-center">
                <Logo width={32} height={32} />
              </div>
              <div className="min-w-0">
                <span className="font-serif text-base sm:text-2xl tracking-[0.1em] sm:tracking-[0.15em] text-[var(--color-primary)]">SILKMOMO</span>
                <span className="hidden sm:block text-[10px] tracking-[0.25em] uppercase text-[var(--color-text-muted)] mt-0.5">Maison de Création Digitale</span>
              </div>
            </Link>
            <span className="text-xs sm:text-sm tracking-widest uppercase text-[var(--color-text-muted)]">历史生成</span>
          </div>
        </div>
      </header>

      {/* Hero 区域 */}
      <section className="border-b border-[var(--color-border-light)]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/"
              className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-light)] hover:border-[var(--color-accent)] transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--color-text-secondary)]" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="font-serif text-2xl sm:text-4xl text-[var(--color-primary)] tracking-tight">历史生成</h1>
              <p className="text-xs sm:text-sm text-[var(--color-text-muted)] mt-1">查看和管理您的所有 AI 生成任务</p>
            </div>
          </div>
        </div>
      </section>

      {/* 任务列表 */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="bg-[var(--color-surface)] rounded-2xl p-4 sm:p-6 border border-[var(--color-border-light)]">
          <TaskList limit={20} />
        </div>
      </main>

      {/* 页脚 — 与主页同步 */}
      <footer className="mt-8 sm:mt-16 mb-6 sm:mb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="border-t border-[var(--color-border-light)] pt-6 sm:pt-10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="font-serif text-xs sm:text-sm tracking-widest text-[var(--color-text-muted)]">
              SILKMOMO
            </p>
            <p className="text-[9px] sm:text-[10px] tracking-widest uppercase text-[var(--color-text-muted)]">
              © 2025 · Haute Couture, AI-Powered
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
