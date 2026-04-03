import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-cream)]">
      <div className="text-center px-6 max-w-md">
        {/* 品牌标识 */}
        <h1 className="text-2xl font-light tracking-[0.3em] text-[var(--color-text)] mb-2">
          SILKMOMO
        </h1>
        <div className="w-12 h-px bg-[var(--color-accent)] mx-auto mb-8" />

        {/* 404 内容 */}
        <p className="text-6xl font-extralight text-[var(--color-accent)] mb-4">404</p>
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-8">
          页面不存在或已被移除。
          <br />
          请检查链接是否正确。
        </p>

        {/* 返回首页 */}
        <Link
          href="/"
          className="inline-block px-8 py-2.5 rounded-full bg-[var(--color-accent)] text-white text-sm tracking-wide hover:opacity-90 transition-opacity"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
