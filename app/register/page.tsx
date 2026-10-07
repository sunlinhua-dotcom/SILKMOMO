'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { AuthAlert, AuthField, AuthShell, PasswordField } from '@/components/AuthShell';
import { ContactAdmin } from '@/components/ContactAdmin';
import { syncLocalWorkspaceForUser } from '@/lib/client-session';
import {
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  getPasswordIssue,
  getUsernameIssue,
  postAuthJson,
  safeNextPath,
} from '@/lib/auth-shared';
import { refreshBalance } from '@/hooks/useBalance';

const TAGLINE = '创建您的专属账户';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const loginHref = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState(false);
  const submitting = useRef(false);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  const usernameIssue = getUsernameIssue(username);
  const passwordIssue = getPasswordIssue(password);
  const canSubmit = !loading && username.length > 0 && password.length > 0 && !usernameIssue && !passwordIssue;

  // 注册成功面板出现后把焦点交给标题，读屏用户能听到结果，键盘用户下一个 Tab 就是复制 / 进入首页
  useEffect(() => {
    if (registered) doneHeadingRef.current?.focus();
  }, [registered]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || !canSubmit) return;
    submitting.current = true;
    setError('');
    setLoading(true);

    try {
      const result = await postAuthJson<{ user?: { username?: string } }>('/api/auth/register', {
        username,
        password,
        name,
      });
      if (!result.ok) {
        setError(result.failure.message);
        return;
      }

      try {
        await syncLocalWorkspaceForUser(result.data.user?.username || username, { forceReset: true });
      } catch (workspaceError) {
        console.warn('注册后同步本地工作区失败:', workspaceError);
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        setError('注册成功，但本地缓存清理失败。请关闭其它 SILXINE 标签页后重新登录，或清除本站点数据。');
        return;
      }

      await refreshBalance().catch(() => {});
      // 不立刻跳走：新账户余额为 0，先在落地面板里告诉用户怎么充值，再由用户点「先去看看」
      setRegistered(true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const enter = () => {
    router.replace(next);
    router.refresh();
  };

  if (registered) {
    return (
      <AuthShell tagline={TAGLINE} title="注册成功">
        <div className="space-y-5">
          <div className="text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[var(--color-success)]" aria-hidden="true" />
            <h3 ref={doneHeadingRef} tabIndex={-1} className="text-base font-semibold outline-none">
              账户已创建，欢迎加入
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              新账户余额为 0，充值后即可开始出图。
            </p>
          </div>
          <ContactAdmin variant="card" note="联系顾问充值后即可出图" />
          <button type="button" onClick={enter} className="btn-primary w-full">
            <span>先去看看</span>
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      tagline={TAGLINE}
      title="注册账户"
      switchPrompt="已有账户？"
      switchLabel="登录"
      switchHref={loginHref}
    >
      <form onSubmit={handleRegister}>
        <AuthAlert message={error} />

        <div className="space-y-4">
          <AuthField
            label="用户名"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint="2–32 位，可用字母、数字、下划线和短横线"
            issue={usernameIssue}
            required
            autoComplete="username"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
          />

          <PasswordField
            label="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={`${PASSWORD_MIN}–${PASSWORD_MAX} 位，需同时包含字母和数字`}
            issue={passwordIssue}
            required
            autoComplete="new-password"
            enterKeyHint="next"
          />

          <AuthField
            label={
              <>
                昵称 <span className="font-normal text-[var(--color-muted)]">（可选）</span>
              </>
            }
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={`最多 ${NAME_MAX} 个字符，用于页面上显示`}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            enterKeyHint="go"
          />
        </div>

        <button type="submit" disabled={!canSubmit} aria-busy={loading} className="btn-primary w-full mt-6">
          <span>{loading ? '注册中...' : '注册'}</span>
        </button>
      </form>
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <AuthShell tagline={TAGLINE} title="注册账户">
          <div className="h-64" aria-busy="true" />
        </AuthShell>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
