import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-cream)]">
      <div className="max-w-md px-6 text-center">
        {/* 品牌标识 */}
        <p className="mb-2 text-2xl font-light tracking-[0.3em] text-[var(--color-ink)]">SILXINE</p>
        <div className="mx-auto mb-8 h-px w-12 bg-[var(--color-brand)]" />

        {/* 404 内容 */}
        <p className="num mb-4 text-6xl font-extralight text-[var(--color-brand-strong)]" aria-hidden="true">404</p>
        <h1 className="mb-3 text-xl font-semibold text-[var(--color-ink)]">页面不存在</h1>
        <p className="mb-8 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          页面不存在或已被移除。
          <br />
          请检查链接是否正确。
        </p>

        {/* 返回首页 */}
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--color-brand-strong)] px-8 text-sm tracking-wide text-white transition-opacity hover:opacity-90"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
