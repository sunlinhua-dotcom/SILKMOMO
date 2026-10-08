/**
 * 「离开拦截」的纯判断逻辑（无 DOM / React 依赖，可被 node:test 直接加载）。
 * 配套 hook：hooks/useLeaveGuard.ts。
 */

/** 一次 click 与被点锚点里和「是否拦截」有关的字段（从 MouseEvent / HTMLAnchorElement 抄出来的纯数据）。 */
export interface LinkClickInfo {
  /** `anchor.getAttribute('href')`（原始属性值，不是解析后的 `.href`） */
  href: string | null;
  /** `anchor.getAttribute('target')` */
  target: string | null;
  /** `anchor.hasAttribute('download')` */
  download: boolean;
  /** MouseEvent.button：0 = 主键 */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** 别的监听器已经 preventDefault 过（它自己会处理这次点击） */
  defaultPrevented: boolean;
}

export interface CurrentLocation {
  origin: string;
  pathname: string;
  search: string;
}

export type LeaveGuardDecision =
  | { intercept: false }
  /** `to` 是同源相对路径（pathname + search + hash），确认后交给 `router.push` */
  | { intercept: true; to: string };

/**
 * 这次点击会不会让用户离开当前页面？只有「同源、会真的换页面」的普通左键点击才拦。
 *
 * 放行（不弹确认）的情形：
 * - 修饰键 / 非左键点击（新标签页打开、下载另存等，当前页不受影响）
 * - `target` 不是 `_self`（`_blank` 等，当前页留着）
 * - 带 `download` 属性的下载链接
 * - `mailto:` / `tel:` / `javascript:` 等非 http(s) 协议
 * - 跨域链接（交给浏览器原生 beforeunload 兜底）
 * - 目标和当前页是同一个 pathname + search（含仅 hash 变化的页内锚点）
 * - 别的监听器已 preventDefault
 */
export function decideLeaveGuardLink(info: LinkClickInfo, current: CurrentLocation): LeaveGuardDecision {
  if (info.defaultPrevented) return { intercept: false };
  if (info.button !== 0) return { intercept: false };
  if (info.metaKey || info.ctrlKey || info.shiftKey || info.altKey) return { intercept: false };
  if (info.download) return { intercept: false };

  const target = (info.target ?? '').trim().toLowerCase();
  if (target !== '' && target !== '_self') return { intercept: false };

  const rawHref = (info.href ?? '').trim();
  if (rawHref === '') return { intercept: false };

  let url: URL;
  try {
    url = new URL(rawHref, `${current.origin}${current.pathname}${current.search}`);
  } catch {
    return { intercept: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { intercept: false };
  if (url.origin !== current.origin) return { intercept: false };
  if (url.pathname === current.pathname && url.search === current.search) return { intercept: false };

  return { intercept: true, to: `${url.pathname}${url.search}${url.hash}` };
}
