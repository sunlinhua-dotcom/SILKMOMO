/**
 * SILKMOMO 路由保护中间件
 * - 公开页面：/login, /register
 * - 受保护页面：/, /tasks, /task/*, /billing
 * - 管理员页面：/admin/*
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'silkmomo-fallback-secret'
);
const TOKEN_NAME = 'silkmomo_token';

// 不需要认证的路径
const PUBLIC_PATHS = ['/login', '/register', '/logo-preview'];
const API_PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/admin/setup'];

export async function middleware(req: NextRequest) {
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

  // 检查 JWT
  const token = req.cookies.get(TOKEN_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const role = payload.role as string;

    // 管理员页面权限检查
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
      if (role !== 'admin') {
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    // 将用户信息注入 header（Server Components 可读取）
    const response = NextResponse.next();
    response.headers.set('x-user-id', payload.userId as string);
    response.headers.set('x-user-role', role);
    response.headers.set('x-user-username', payload.username as string);
    return response;
  } catch {
    // token 无效 → 跳转登录
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
