/**
 * 鉴权相关的纯函数（无任何 node / next 依赖，Edge 与浏览器都能 import，可直接被 node --test 测试）：
 * - proxy 路径分类
 * - 登录后跳转的 next 参数校验与构造
 * - 登录 / 注册入参校验
 */

// ═══ 路径分类 ═══

/** 允许免鉴权访问的静态文件扩展名（不含 .html / .json / .map 等） */
export const STATIC_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico', 'css', 'js', 'woff2', 'txt'] as const;

export const PUBLIC_PAGES = ['/login', '/register'] as const;
export const PUBLIC_API_PATHS = ['/api/auth/login', '/api/auth/register', '/api/admin/setup', '/api/health'] as const;

export type PathKind = 'asset' | 'public-page' | 'public-api' | 'protected';

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/**
 * 静态资源判断：只认 /_next/、/favicon.ico、/icon.svg，以及白名单扩展名的文件。
 * 不再用 pathname.includes('.') 一刀切 —— 带点号的动态路由 / API 不能借此绕过鉴权。
 * /api/ 下即使以 .png 结尾也不算静态资源。
 */
export function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico' || pathname === '/icon.svg') return true;
  if (pathname.startsWith('/api/')) return false;
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0 || dot === last.length - 1) return false;
  const ext = last.slice(dot + 1).toLowerCase();
  return (STATIC_EXTENSIONS as readonly string[]).includes(ext);
}

export function classifyPath(pathname: string): PathKind {
  if (isStaticAssetPath(pathname)) return 'asset';
  const p = stripTrailingSlash(pathname);
  // 精确匹配：/api/auth/login-x 之类前缀相似的路径不能被放行
  if ((PUBLIC_API_PATHS as readonly string[]).includes(p)) return 'public-api';
  if ((PUBLIC_PAGES as readonly string[]).includes(p)) return 'public-page';
  return 'protected';
}

// ═══ next 参数 ═══

/**
 * 登录后跳转目标校验：只接受以单个 "/" 开头的站内路径。
 * 拒绝 "//evil.com"、"/\evil.com"、带协议的绝对 URL、控制字符。
 * 登录页读取 ?next= 后必须先过这个函数。
 */
export function isSafeNextPath(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (raw.length === 0 || raw.length > 2048) return false;
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  if (raw.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return false;
  try {
    const u = new URL(raw, 'http://safe.invalid');
    if (u.origin !== 'http://safe.invalid') return false;
  } catch {
    return false;
  }
  return true;
}

/** 校验 next；不安全或指向登录 / 注册页本身（避免跳转回环）时返回 fallback */
export function safeNextPath(raw: unknown, fallback: string = '/'): string {
  if (!isSafeNextPath(raw)) return fallback;
  const pathOnly = raw.split(/[?#]/)[0].replace(/\/+$/, '');
  if (pathOnly === '/login' || pathOnly === '/register') return fallback;
  return raw;
}

/** 构造未登录重定向目标：/login?next=<编码后的原路径+query>；首页不带 next */
export function buildLoginRedirectPath(pathname: string, search: string = ''): string {
  const original = `${pathname}${search}`;
  if (!isSafeNextPath(original) || pathname === '/') return '/login';
  return `/login?next=${encodeURIComponent(original)}`;
}

// ═══ 入参校验 ═══

export const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 32;
/** 登录时用户名长度上限（老账号可能不满足注册规则，所以登录只做宽松的长度限制） */
export const LOGIN_USERNAME_MAX = 64;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function validateLoginInput(body: unknown): ValidationResult<{ username: string; password: string }> {
  const o = asObject(body);
  if (!o) return { ok: false, error: '请求体格式非法' };
  const { username, password } = o;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, error: '用户名和密码格式不正确' };
  }
  if (!username || !password) return { ok: false, error: '请输入用户名和密码' };
  if (username.length > LOGIN_USERNAME_MAX || password.length > PASSWORD_MAX) {
    return { ok: false, error: '用户名或密码过长' };
  }
  return { ok: true, value: { username, password } };
}

export function validateRegisterInput(
  body: unknown,
): ValidationResult<{ username: string; password: string; name: string | null }> {
  const o = asObject(body);
  if (!o) return { ok: false, error: '请求体格式非法' };
  const { username, password, name } = o;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, error: '用户名和密码必须是字符串' };
  }
  if (!username || !password) return { ok: false, error: '用户名和密码为必填项' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: '用户名只能包含字母、数字、下划线和短横线，长度 2-32' };
  }
  if (password.length < PASSWORD_MIN) return { ok: false, error: `密码至少 ${PASSWORD_MIN} 位` };
  if (password.length > PASSWORD_MAX) return { ok: false, error: `密码最多 ${PASSWORD_MAX} 位` };
  // 起码包含一个字母 + 一个数字（弱强度门槛）
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: '密码需要同时包含字母和数字' };
  }
  let cleanName: string | null = null;
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') return { ok: false, error: '昵称必须是字符串' };
    const trimmed = name.trim();
    if (trimmed.length > NAME_MAX) return { ok: false, error: `昵称最多 ${NAME_MAX} 个字符` };
    cleanName = trimmed || null;
  }
  return { ok: true, value: { username, password, name: cleanName } };
}
