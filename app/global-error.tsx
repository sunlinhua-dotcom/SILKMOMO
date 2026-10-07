'use client';

import { useEffect } from 'react';

/**
 * 根 layout 本身出错时的兜底页。它会替换整个 <html>，所以不能依赖 globals.css / next/font / Provider，
 * 颜色全部内联（与 globals.css 的 token 同值），字体用系统中文回退栈。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('全局错误:', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FBF8F4',
          color: '#2C2420',
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, padding: '0 24px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 300, letterSpacing: '0.3em' }}>SILXINE</p>
          <div style={{ width: 48, height: 1, background: '#C9A87C', margin: '0 auto 32px' }} />
          <h1 style={{ margin: '0 0 16px', fontSize: 28, fontWeight: 600 }}>服务暂时不可用</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: '#6B5A4A' }}>
            页面遇到了严重错误，请重新加载。如果反复出现，请联系管理员。
          </p>
          {error.digest && (
            <p style={{ margin: '16px 0 0', fontSize: 12, color: '#7D6B58' }}>
              错误编号 <span style={{ fontFamily: 'ui-monospace, monospace', userSelect: 'all' }}>{error.digest}</span>
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 32,
              minHeight: 44,
              padding: '0 32px',
              border: 'none',
              borderRadius: 999,
              background: '#8C6D3A',
              color: '#FFFFFF',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      </body>
    </html>
  );
}
