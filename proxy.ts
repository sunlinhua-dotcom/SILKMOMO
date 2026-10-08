/**
 * SILXINE 路由保护代理
 * - 公开页面：/login, /register（已登录访问会重定向到 /）
 * - 公开 API：/api/auth/login|register、/api/admin/setup、/api/health
 * - 未登录访问页面重定向到 /login?next=<原路径>
 * - 受保护页面：/, /tasks, /task/*, /billing
 * - 管理员页面：/admin/*
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from './lib/jwt-secret';
import { classifyPath, buildLoginRedirectPath } from './lib/auth-shared';
// Next 16 的 proxy 固定跑在 Node.js 运行时（不是 Edge），可以访问 Prisma，所以吊销检查放在这里：
// 页面和 API 都先过 proxy，被登出的令牌在入口就挡掉。
import { isTokenRevoked } from './lib/token-revocation';

const JWT_SECRET = getJwtSecret();
// 品牌已更名 SILXINE;cookie 名保持不变,改名会强制所有用户掉登录
const TOKEN_NAME = 'silkmomo_token';

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 路径分类见 lib/auth-shared.ts：静态资源只认 /_next/、favicon、icon.svg 和白名单扩展名，
  // 不再因为路径里带 "." 就放行；公共 API 为精确匹配（含 /api/health）。
  const kind = classifyPath(pathname);
  if (kind === 'asset' || kind === 'public-api') {
    return NextResponse.next();
  }

  // 公开页面（/login、/register）：已登录用户直接回首页，未登录放行
  if (kind === 'public-page') {
    const existing = req.cookies.get(TOKEN_NAME)?.value;
    if (existing) {
      try {
        const { payload } = await jwtVerify(existing, JWT_SECRET);
        // 已登出（被吊销）的令牌不算已登录，否则 /login -> / -> /login 会死循环
        if (!(await isTokenRevoked(payload.jti, payload.exp))) {
          return NextResponse.redirect(new URL('/', req.url));
        }
      } catch {
        // token 无效：当作未登录，放行到登录 / 注册页
      }
    }
    return NextResponse.next();
  }

  // 登出永远放行，不要求当前令牌有效：它只会清 cookie 并吊销一枚已验签的令牌，不授予任何权限。
  // 否则令牌已被吊销 / 已过期 / cookie 已没了的情况下（例如两个标签页先后点退出），
  // 第二次登出会被下面的鉴权挡成 401，客户端误报“退出登录失败”。路由自己校验 cookie，重复登出幂等。
  if (pathname === '/api/auth/logout') {
    return NextResponse.next();
  }

  // API 路由的认证失败必须返回 401 JSON，不能重定向：
  // fetch 会静默跟随 307 到 /login 拿回 HTML 200，
  // SSE 客户端把它当成"空流"（无 done 事件），任务永远卡在 processing
  const isApiPath = pathname.startsWith('/api/');

  // 检查 JWT
  const token = req.cookies.get(TOKEN_NAME)?.value;
  if (!token) {
    if (isApiPath) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    return NextResponse.redirect(new URL(buildLoginRedirectPath(pathname, search), req.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    // 已被登出吊销：与过期 token 同样处理（API 401、页面跳登录并清 cookie）。
    // 老 token（无 jti）直接通过；查库失败 fail-open，取舍见 lib/token-revocation-core.ts。
    if (await isTokenRevoked(payload.jti, payload.exp)) {
      throw new Error('token revoked');
    }
    const role = payload.role as string;

    // 管理员页面权限检查
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
      if (role !== 'admin') {
        if (isApiPath) {
          return NextResponse.json({ error: '无权访问' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    // 将用户信息注入「请求」header（Server Components / Route Handler 可读取）。
    // 注意：不能写到 NextResponse.next() 的响应头上 —— 那只会把
    // userId/role 泄露给浏览器，下游 handler 根本读不到。
    // 同时先删除入站同名头，防止客户端伪造。
    const requestHeaders = new Headers(req.headers);
    requestHeaders.delete('x-user-id');
    requestHeaders.delete('x-user-role');
    requestHeaders.delete('x-user-username');
    requestHeaders.set('x-user-id', payload.userId as string);
    requestHeaders.set('x-user-role', role);
    requestHeaders.set('x-user-username', encodeURIComponent(payload.username as string));
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    // token 无效/过期：API 返回 401 JSON，页面跳转登录
    if (isApiPath) {
      const response = NextResponse.json({ error: '登录已过期，请重新登录' }, { status: 401 });
      response.cookies.delete(TOKEN_NAME);
      return response;
    }
    const response = NextResponse.redirect(new URL(buildLoginRedirectPath(pathname, search), req.url));
    response.cookies.delete(TOKEN_NAME);
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
