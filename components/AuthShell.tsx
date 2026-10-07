'use client';

import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { Logo } from '@/components/Logo';

const INPUT_CLASS =
  'w-full min-h-11 px-4 py-3 rounded-xl border bg-[var(--color-background)] text-[var(--color-ink)] ' +
  'placeholder:text-[var(--color-muted)] outline-none transition-all text-base sm:text-sm ' +
  'focus:border-[var(--color-brand-strong)] focus:ring-2 focus:ring-[var(--color-brand)]/30 ' +
  'disabled:opacity-60';

export interface AuthShellProps {
  /** 品牌下方的副标题，如「AI 丝绸服装摄影平台」 */
  tagline: string;
  /** 卡片内标题 */
  title: string;
  children: ReactNode;
  /** 卡片底部的切换链接：「还没有账户？ 注册」 */
  switchPrompt?: string;
  switchLabel?: string;
  switchHref?: string;
}

/** 登录 / 注册共用外壳：背景装饰 + Logo + 标题 + 卡片 + 底部切换链接。表单本体由页面作为 children 传入。 */
export function AuthShell({ tagline, title, children, switchPrompt, switchLabel, switchHref }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-background)] flex items-center justify-center px-4 py-8">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-[var(--color-accent)]/5 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-[var(--color-accent)]/3 to-transparent blur-3xl" />
      </div>

      <main className="relative w-full max-w-md">
        <header className="text-center mb-8 animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <Logo width={64} height={64} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">SILXINE</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">{tagline}</p>
        </header>

        <div className="bg-[var(--color-surface)] rounded-2xl p-6 sm:p-8 shadow-lg border border-[var(--color-border-light)] animate-fade-in-up">
          <h2 className="text-lg font-semibold mb-6 text-center">{title}</h2>
          {children}
          {switchHref && switchLabel && (
            <p className="mt-4 text-center text-sm text-[var(--color-text-secondary)]">
              {switchPrompt}{' '}
              <Link
                href={switchHref}
                className="inline-flex min-h-11 items-center px-1 font-medium text-[var(--color-brand-strong)] hover:underline"
              >
                {switchLabel}
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

/** 错误提示条：role="alert"，屏幕阅读器会立即播报 */
export function AuthAlert({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 p-3 rounded-xl bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-sm text-center"
    >
      {message}
    </div>
  );
}

interface FieldChromeProps {
  label: ReactNode;
  /** 常驻辅助文字（规则说明），不是 placeholder */
  hint?: string;
  /** 实时校验提示；有值时输入框标红并 aria-invalid */
  issue?: string | null;
}

type AuthFieldProps = FieldChromeProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

/** 带 label / 常驻辅助文字 / 实时校验提示的输入框，aria-describedby 自动关联 */
export function AuthField({ label, hint, issue, id, ...inputProps }: AuthFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const issueId = `${fieldId}-issue`;
  const describedBy = [hint ? hintId : '', issue ? issueId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
        {label}
      </label>
      <input
        {...inputProps}
        id={fieldId}
        aria-invalid={issue ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLASS} ${issue ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'}`}
      />
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
          {hint}
        </p>
      )}
      {issue && (
        <p id={issueId} className="mt-1 text-xs leading-relaxed text-[var(--color-danger)]">
          {issue}
        </p>
      )}
    </div>
  );
}

type PasswordFieldProps = FieldChromeProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>;

/** 密码框 + 「显示密码」切换按钮（aria-pressed）。按钮在输入框之后、Tab 顺序自然。 */
export function PasswordField({ label, hint, issue, id, ...inputProps }: PasswordFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const issueId = `${fieldId}-issue`;
  const describedBy = [hint ? hintId : '', issue ? issueId : ''].filter(Boolean).join(' ') || undefined;
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          {...inputProps}
          id={fieldId}
          type={visible ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={issue ? true : undefined}
          aria-describedby={describedBy}
          className={`${INPUT_CLASS} pr-12 ${issue ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label="显示密码"
          title={visible ? '隐藏密码' : '显示密码'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-[var(--color-text-secondary)] hover:text-[var(--color-ink)]"
        >
          {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">
          {hint}
        </p>
      )}
      {issue && (
        <p id={issueId} className="mt-1 text-xs leading-relaxed text-[var(--color-danger)]">
          {issue}
        </p>
      )}
    </div>
  );
}
