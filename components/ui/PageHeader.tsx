import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';

export interface PageHeaderProps {
  title: string;
  /** 返回链接，默认首页 */
  backHref?: string;
  /** 右侧操作区（按钮 / 余额等），和标题并排 */
  actions?: React.ReactNode;
}

/** 通用顶栏：返回 + Logo + 页面标题，样式对齐 app/billing/page.tsx 的 header。 */
export function PageHeader({ title, backHref = '/', actions }: PageHeaderProps) {
  return (
    <header className="glass sticky top-0 z-50 border-b border-[var(--color-border-light)]">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={backHref} aria-label="返回" className="group flex min-h-11 shrink-0 items-center gap-3">
          <ArrowLeft
            className="h-5 w-5 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-text)]"
            aria-hidden="true"
          />
          <Logo width={32} height={32} />
          <span className="hidden text-lg font-semibold tracking-tight min-[420px]:inline">SILXINE</span>
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-sm font-medium text-[var(--color-text-secondary)]">{title}</h1>
          {actions}
        </div>
      </div>
    </header>
  );
}
