'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { decideLeaveGuardLink } from '@/lib/leave-guard';

/** 写进 history.state 的哨兵标记（保留 Next 自己的 state 字段，只多加这一项） */
const SENTINEL_KEY = '__silkmomoLeaveGuard';

export interface LeaveGuardOptions {
  /** 确认框标题 */
  title?: string;
  /** 「确认离开」按钮文案 */
  confirmText?: string;
  /** 「留下」按钮文案 */
  cancelText?: string;
}

/**
 * 页面有「正在进行、离开会被打断」的事（如生成中）时，拦住所有离开路径并让用户确认。
 *
 * `active` 为 true 期间：
 * 1. 刷新 / 关闭标签页：挂浏览器原生 `beforeunload` 提醒（原生文案不可定制，`message` 不会出现在这里）；
 * 2. 站内链接：document 捕获阶段拦截同源 `<a href>` 的普通左键点击（Next `<Link>`、导航栏、Logo 都是 `<a>`），
 *    弹项目自带的 `ConfirmDialog`，确认后才 `router.push`；
 *    新标签页打开 / 下载 / 修饰键 / `mailto:` / 跨域 / 页内 hash 不拦（规则见 `lib/leave-guard.ts`）；
 * 3. 浏览器后退（含手机侧滑返回）：生效时多 push 一条同 URL 的「哨兵」历史记录，后退只会先落到原记录并触发
 *    popstate，此时弹确认；取消就重新 push 哨兵，确认就再后退一步真正离开。
 *
 * `active` 变 false 或组件卸载时移除全部监听，并把还留着的哨兵 `history.back()` 掉，
 * 不会留下多余的历史记录（用户确认离开站内链接时也先吃掉哨兵再 push，所以「后退」不会多退一格）。
 *
 * 复用方式：`useLeaveGuard(generating, '离开后……')`。需要在 `ConfirmProvider` 内使用（app/providers.tsx 已全局提供）。
 *
 * @param active  是否需要拦截
 * @param message 确认框正文，要把后果说清楚（谁继续跑、钱怎么算、回来能不能找回）
 * @param options 标题 / 按钮文案覆盖
 */
export function useLeaveGuard(active: boolean, message: string, options?: LeaveGuardOptions): void {
  const router = useRouter();
  const confirm = useConfirm();

  // 确认框正文 / 文案 / router 随渲染更新，但不让它们触发监听器重挂
  const latest = useRef({ router, confirm, message, options });
  useEffect(() => {
    latest.current = { router, confirm, message, options };
  });

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let sentinelOn = false;
    let asking = false;

    const ask = () => {
      const { confirm: confirmFn, message: text, options: opts } = latest.current;
      return confirmFn({
        title: opts?.title ?? '生成还在进行中，确定离开？',
        message: text,
        confirmText: opts?.confirmText ?? '离开此页',
        cancelText: opts?.cancelText ?? '留在此页',
        // danger：默认聚焦「留在此页」，手滑回车不会离开
        danger: true,
      });
    };

    const pushSentinel = () => {
      const current = window.history.state;
      const base = current && typeof current === 'object' ? current : {};
      window.history.pushState({ ...base, [SENTINEL_KEY]: true }, '', window.location.href);
      sentinelOn = true;
    };

    /** 把还留着的哨兵退掉（等 popstate 落定再返回，避免紧跟着的 push 被这次回退吞掉） */
    const removeSentinel = () =>
      new Promise<void>(resolve => {
        if (!sentinelOn || !window.history.state?.[SENTINEL_KEY]) {
          sentinelOn = false;
          resolve();
          return;
        }
        sentinelOn = false;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          window.removeEventListener('popstate', finish);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, 500);
        window.addEventListener('popstate', finish);
        window.history.back();
      });

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      const origin = event.target;
      const anchor = origin instanceof Element ? origin.closest('a[href]') : null;
      if (!anchor) return;
      const decision = decideLeaveGuardLink(
        {
          href: anchor.getAttribute('href'),
          target: anchor.getAttribute('target'),
          download: anchor.hasAttribute('download'),
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          defaultPrevented: event.defaultPrevented,
        },
        { origin: window.location.origin, pathname: window.location.pathname, search: window.location.search },
      );
      if (!decision.intercept) return;

      // 捕获阶段先于 React / Next <Link> 的 onClick：preventDefault 让 Link 看到 defaultPrevented 不再导航
      event.preventDefault();
      event.stopPropagation();
      if (asking) return;
      asking = true;
      void ask().then(async ok => {
        asking = false;
        if (!ok) return;
        detach();
        await removeSentinel();
        latest.current.router.push(decision.to);
      });
    };

    const onPopState = () => {
      if (window.history.state?.[SENTINEL_KEY]) {
        // 前进键又回到了哨兵上，什么都不用做
        sentinelOn = true;
        return;
      }
      // 后退越过了哨兵：此刻停在原记录上，先问再决定是补回哨兵还是真的再退一步
      sentinelOn = false;
      if (asking) return;
      asking = true;
      void ask().then(ok => {
        asking = false;
        if (ok) {
          detach();
          window.history.back();
        } else if (!disposed) {
          pushSentinel();
        }
      });
    };

    function detach() {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    pushSentinel();

    return () => {
      disposed = true;
      detach();
      void removeSentinel();
    };
  }, [active]);
}
