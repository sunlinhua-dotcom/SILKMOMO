'use client';

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthAlert, AuthField, AuthShell, PasswordField } from '@/components/AuthShell';
import { syncLocalWorkspaceForUser } from '@/lib/client-session';
import { postAuthJson, safeNextPath } from '@/lib/auth-shared';
import { refreshBalance } from '@/hooks/useBalance';

const TAGLINE = 'AI 丝绸服装摄影平台';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // proxy 重定向过来时带 ?next=<编码路径>；必须先过 safeNextPath，防开放重定向
  const next = safeNextPath(searchParams.get('next'));
  const registerHref = next === '/' ? '/register' : `/register?next=${encodeURIComponent(next)}`;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return; // 防重复提交（按钮禁用之前的连点 / 回车连按）
    submitting.current = true;
    setError('');
    setLoading(true);

    let navigating = false;
    try {
      const result = await postAuthJson<{ user?: { username?: string } }>('/api/auth/login', {
        username: username.trim(),
        password,
      });
      if (!result.ok) {
        setError(result.failure.message);
        return;
      }

      try {
        await syncLocalWorkspaceForUser(result.data.user?.username || username.trim());
      } catch (workspaceError) {
        console.warn('登录后同步本地工作区失败:', workspaceError);
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        setError('登录已验证，但本地缓存清理失败。请关闭其它 SILXINE 标签页后重试，或清除本站点数据。');
        return;
      }

      // 登录成功后让全局余额 store 立即拿到新用户的数据（失败不影响跳转）
      await refreshBalance().catch(() => {});
      navigating = true;
      router.replace(next);
      router.refresh();
    } finally {
      // 成功跳转期间保持禁用，避免页面还没切走时被再次提交
      if (!navigating) {
        submitting.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <AuthShell
      tagline={TAGLINE}
      title="登录账户"
      switchPrompt="还没有账户？"
      switchLabel="注册"
      switchHref={registerHref}
    >
      <form onSubmit={handleLogin}>
        <AuthAlert message={error} />

        <div className="space-y-4">
          <AuthField
            label="用户名"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
          />
          {/* 登录页不设 minLength：老账号可能是 6 位或更短的旧规则密码 */}
          <PasswordField
            label="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            enterKeyHint="go"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          aria-busy={loading}
          className="btn-primary w-full mt-6"
        >
          <span>{loading ? '登录中...' : '登录'}</span>
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  // useSearchParams 在 Next 16 的静态预渲染下必须包在 Suspense 里
  return (
    <Suspense
      fallback={
        <AuthShell tagline={TAGLINE} title="登录账户">
          <div className="h-48" aria-busy="true" />
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
