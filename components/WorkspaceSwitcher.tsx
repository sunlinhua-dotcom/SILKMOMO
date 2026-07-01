'use client';

import Link from 'next/link';
import { Camera, Sparkles } from 'lucide-react';

/**
 * 双工作台入口：产品图工作台(/) 与 组图·换装(/lookbook) 是两个完全独立的入口。
 * 放在两个页面顶部，当前所在的一张高亮，另一张是跳转链接。
 */
export function WorkspaceSwitcher({ active }: { active: 'product' | 'lookbook' }) {
  const cards = [
    {
      key: 'product' as const,
      href: '/',
      icon: Camera,
      title: '产品图工作台',
      desc: '上传参考图，逐项选镜次 / 模特 / 尺寸 · 电商主图',
    },
    {
      key: 'lookbook' as const,
      href: '/lookbook',
      icon: Sparkles,
      title: '组图 · 换装',
      desc: '上传整组 lookbook，自动识别、一键换装换模特 · 上传几张出几张',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
      {cards.map(c => {
        const isActive = c.key === active;
        const Icon = c.icon;
        return (
          <Link
            key={c.key}
            href={c.href}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex items-start gap-3 sm:gap-4 p-4 sm:p-5 rounded-2xl sm:rounded-[1.75rem] transition-[background-color,border-color,box-shadow] duration-500 overflow-hidden ${
              isActive
                ? 'bg-[#3D2E20] text-white shadow-xl sm:shadow-2xl cursor-default'
                : 'bg-[#FAFAFA] border border-transparent hover:border-[var(--color-border)] text-[var(--color-text)]'
            }`}
          >
            <div className={`mt-0.5 w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center flex-shrink-0 ${
              isActive ? 'bg-white/10 text-white' : 'bg-white text-[var(--color-primary)] shadow-sm'
            }`}>
              <Icon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 relative z-10">
              <div className="font-serif text-base sm:text-lg tracking-wide flex items-center gap-2">
                {c.title}
                {isActive && <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded-full bg-white/15">当前</span>}
              </div>
              <div className={`text-[11px] sm:text-xs mt-1 leading-relaxed ${isActive ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
                {c.desc}
              </div>
            </div>
            {isActive && <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-[var(--color-accent)]/20 rounded-full blur-3xl pointer-events-none" />}
          </Link>
        );
      })}
    </div>
  );
}
