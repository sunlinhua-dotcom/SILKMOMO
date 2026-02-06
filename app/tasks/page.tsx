'use client';

import { TaskList } from '@/components/TaskList';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import Link from 'next/link';

export default function TasksPage() {
  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 flex items-center justify-center transition-transform hover:scale-105">
                <Logo width={40} height={40} />
              </div>
              <span className="text-lg font-semibold tracking-tight">SILKMOMO</span>
            </Link>
            <span className="text-sm text-[var(--color-text-secondary)]">历史任务</span>
          </div>
        </div>
      </header>

      {/* Hero 区域 */}
      <section className="border-b border-[var(--color-border-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/"
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-light)] hover:border-[var(--color-accent)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--color-text-secondary)]" />
            </Link>
            <div className="flex-1">
              <h1 className="hero-title mb-2">历史任务</h1>
              <p className="hero-subtitle">查看和管理您的所有生成任务</p>
            </div>
          </div>
        </div>
      </section>

      {/* 任务列表 */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="bg-[var(--color-surface)] rounded-2xl p-4 sm:p-6 border border-[var(--color-border-light)]">
          <TaskList limit={20} />
        </div>
      </main>

      {/* 页脚 */}
      <footer className="border-t border-[var(--color-border-light)] py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-[var(--color-text-muted)]">
            SILKMOMO © 2025 · 奢华丝绸，AI 赋能
          </p>
        </div>
      </footer>
    </div>
  );
}
