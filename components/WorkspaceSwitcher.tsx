'use client';

import Link from 'next/link';
import { Camera, Sparkles } from 'lucide-react';

/**
 * 双工作台入口：产品图工作台(/) 与 组图·换装(/lookbook) 是两个完全独立的路由。
 * 放在两个页面顶部，当前所在的一张高亮，另一张是跳转链接。
 *
 * 语义：这是页面导航而不是同页切换，所以用 <nav> + 列表 + aria-current="page"，
 * 不用 tablist / radiogroup（那两种要求同页面板与方向键漫游，和真实行为不符）。
 * 当前页那张不再是链接（点了只会原地刷新），键盘不会 Tab 到它。
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
    <nav aria-label="工作台切换">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {cards.map(c => {
          const isActive = c.key === active;
          const Icon = c.icon;
          const cardClass = `relative flex min-w-0 items-start gap-3 sm:gap-4 p-4 sm:p-5 rounded-2xl sm:rounded-[1.75rem] transition-[background-color,border-color,box-shadow] duration-500 overflow-hidden ${
            isActive
              ? 'bg-primary text-white shadow-xl sm:shadow-2xl'
              : 'bg-background border border-border hover:border-brand-strong text-ink'
          }`;
          const body = (
            <>
              <div className={`mt-0.5 w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center flex-shrink-0 ${
                isActive ? 'bg-white/10 text-white' : 'bg-surface text-primary shadow-sm'
              }`}>
                <Icon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 relative z-10">
                <div className="font-serif text-base sm:text-lg tracking-wide flex flex-wrap items-center gap-x-2 gap-y-1">
                  {c.title}
                  {isActive && <span className="text-[10px] tracking-widest uppercase px-1.5 py-0.5 rounded-full bg-white/15">当前</span>}
                </div>
                <div className={`text-[11px] sm:text-xs mt-1 leading-relaxed ${isActive ? 'text-white/80' : 'text-muted'}`}>
                  {c.desc}
                </div>
              </div>
              {isActive && <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-brand/20 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />}
            </>
          );
          return (
            <li key={c.key} className="min-w-0">
              {isActive ? (
                <div aria-current="page" className={cardClass}>{body}</div>
              ) : (
                <Link href={c.href} className={cardClass}>{body}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
