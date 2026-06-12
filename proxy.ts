/**
 * SILXINE 路由保护代理
 * - 公开页面：/login, /register
 * - 受保护页面：/, /tasks, /task/*, /billing
 * - 管理员页面：/admin/*
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from './lib/jwt-secret';

const JWT_SECRET = getJwtSecret();
// 品牌已更名 SILXINE;cookie 名保持不变,改名会强制所有用户掉登录
const TOKEN_NAME = 'silkmomo_token';

// 不需要认证的路径
const PUBLIC_PATHS = ['/login', '/register', '/logo-preview'];
const API_PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/admin/setup'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 静态资源和公共 API 直接放行
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.') ||
    API_PUBLIC_PATHS.some(p => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  // 公开页面放行
  if (PUBLIC_PATHS.some(p => pathname === p)) {
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
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
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
    const response = NextResponse.redirect(new URL('/login', req.url));
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
