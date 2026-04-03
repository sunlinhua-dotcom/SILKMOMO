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
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-cream)]">
      <div className="text-center px-6 max-w-md">
        {/* 品牌标识 */}
        <h1 className="text-2xl font-light tracking-[0.3em] text-[var(--color-text)] mb-2">
          SILKMOMO
        </h1>
        <div className="w-12 h-px bg-[var(--color-accent)] mx-auto mb-8" />

        {/* 错误信息 */}
        <div className="mb-8">
          <p className="text-5xl font-light text-[var(--color-accent)] mb-4">Oops</p>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            抱歉，页面遇到了一些问题。
            <br />
            请稍后重试，或返回首页。
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-full bg-[var(--color-accent)] text-white text-sm tracking-wide hover:opacity-90 transition-opacity"
          >
            重新加载
          </button>
          <Link
            href="/"
            className="px-6 py-2.5 rounded-full border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] transition-colors"
          >
            返回首页
          </Link>
        </div>

        {/* 错误摘要（仅开发环境） */}
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-8 text-left">
            <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer">
              错误详情
            </summary>
            <pre className="mt-2 p-3 rounded-xl bg-[var(--color-surface)] text-xs text-red-500 overflow-x-auto whitespace-pre-wrap break-words">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
