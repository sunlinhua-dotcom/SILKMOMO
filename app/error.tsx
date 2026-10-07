'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('应用错误:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-cream)]">
      <div className="max-w-md px-6 text-center">
        {/* 品牌标识 */}
        <p className="mb-2 text-2xl font-light tracking-[0.3em] text-[var(--color-ink)]">SILXINE</p>
        <div className="mx-auto mb-8 h-px w-12 bg-[var(--color-brand)]" />

        {/* 错误信息 */}
        <div className="mb-8">
          <h1 className="mb-4 text-3xl font-semibold text-[var(--color-ink)]">页面出了点问题</h1>
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
            抱歉，页面遇到了一些问题。
            <br />
            请重新加载，或返回首页。
          </p>
          {error.digest && (
            <p className="mt-4 text-xs text-[var(--color-text-muted)]">
              错误编号 <span className="num select-all font-mono">{error.digest}</span>
              <br />
              如需反馈，请把编号发给管理员以便排查。
            </p>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-full bg-[var(--color-brand-strong)] px-6 text-sm tracking-wide text-white transition-opacity hover:opacity-90"
          >
            重新加载
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--color-border)] px-6 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-brand-strong)]"
          >
            返回首页
          </Link>
        </div>

        {/* 错误摘要（仅开发环境） */}
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-8 text-left">
            <summary className="cursor-pointer text-xs text-[var(--color-text-muted)]">错误详情</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--color-surface)] p-3 text-xs text-[var(--color-danger)]">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
