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
/** 注册 / 改密时的密码长度范围 */
export const PASSWORD_MAX = 128;
/**
 * 登录时的密码长度上限：只防滥用（bcrypt 输入过长耗 CPU / 请求体膨胀），不套注册规则，
 * 否则老账号若密码超过注册上限就再也登不上了。
 */
export const LOGIN_PASSWORD_MAX = 1024;
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
  if (username.length > LOGIN_USERNAME_MAX || password.length > LOGIN_PASSWORD_MAX) {
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

// ═══ 前端实时校验提示（与上面的服务端规则同源，不重复写正则） ═══

/** 注册页用户名的即时提示；合法返回 null。空串不报错（由 required 负责） */
export function getUsernameIssue(username: string): string | null {
  if (!username) return null;
  if (!/^[a-zA-Z0-9_-]*$/.test(username)) return '只能包含字母、数字、下划线和短横线';
  if (username.length < 2) return '至少 2 个字符';
  if (username.length > 32) return '最多 32 个字符';
  return null;
}

/** 注册页密码的即时提示；合法返回 null。空串不报错 */
export function getPasswordIssue(password: string): string | null {
  if (!password) return null;
  if (password.length < PASSWORD_MIN) return `至少 ${PASSWORD_MIN} 位，还差 ${PASSWORD_MIN - password.length} 位`;
  if (password.length > PASSWORD_MAX) return `最多 ${PASSWORD_MAX} 位`;
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return '需要同时包含字母和数字';
  return null;
}

// ═══ 前端请求结果解读 ═══

export type AuthFailureKind = 'network' | 'server' | 'rejected' | 'rate-limited';
export interface AuthFailure {
  kind: AuthFailureKind;
  message: string;
  retryAfterSec?: number;
}

/**
 * 把一次非 2xx 响应转成给用户看的文案。
 * - 429：用后端 error，并读 Retry-After；后端文案里没带「秒」时补一句「请 N 秒后再试」
 * - 4xx：后端 error 原样显示
 * - 5xx 或响应体不是 JSON：「服务器暂时出错」（带状态码），不冒充成网络错误
 */
export function describeAuthFailure(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
): AuthFailure {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const serverMsg = o && typeof o.error === 'string' && o.error.trim() ? o.error.trim() : null;
  if (status === 429) {
    const n = retryAfterHeader ? Math.ceil(Number(retryAfterHeader)) : NaN;
    const retryAfterSec = Number.isFinite(n) && n > 0 ? n : undefined;
    let message = serverMsg ?? '请求过于频繁';
    if (retryAfterSec && !/秒|分钟/.test(message)) message = `${message}，请 ${retryAfterSec} 秒后再试`;
    return { kind: 'rate-limited', message, retryAfterSec };
  }
  if (status >= 500) {
    return { kind: 'server', message: serverMsg ?? `服务器暂时出错（${status}），请稍后重试` };
  }
  // 4xx 但响应体不是约定的 { error }：多半是网关 / 代理层返回的 HTML，别冒充网络错误
  if (!serverMsg) return { kind: 'server', message: `请求未能完成（${status}），请稍后重试` };
  return { kind: 'rejected', message: serverMsg };
}

export type AuthPostResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: AuthFailure };

/** POST JSON 到鉴权接口：区分网络失败 / 服务端错误 / 业务拒绝；响应体不是 JSON 也不抛 */
export async function postAuthJson<T = Record<string, unknown>>(
  url: string,
  payload: unknown,
): Promise<AuthPostResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, failure: { kind: 'network', message: '网络连接失败，请检查网络后重试' } };
  }
  let body: unknown = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  if (!res.ok) {
    return { ok: false, failure: describeAuthFailure(res.status, body, res.headers.get('Retry-After')) };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, failure: { kind: 'server', message: `服务器响应异常（${res.status}），请稍后重试` } };
  }
  return { ok: true, data: body as T };
}
