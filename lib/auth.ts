/**
 * SILKMOMO 认证工具
 * jose（Edge Runtime 兼容）+ bcryptjs
 */
import { SignJWT, jwtVerify } from 'jose';
import { hash, compare } from 'bcryptjs';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'silkmomo-fallback-secret'
);
const TOKEN_NAME = 'silkmomo_token';
const TOKEN_EXPIRES = '7d'; // 7 天

export interface AuthPayload {
  userId: string;
  username: string;
  role: 'user' | 'admin';
}

// ═══ JWT 签发 ═══
export async function signToken(payload: AuthPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRES)
    .sign(JWT_SECRET);
}

// ═══ JWT 验证 ═══
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as AuthPayload;
  } catch {
    return null;
  }
}

// ═══ 密码哈希 ═══
export async function hashPassword(password: string): Promise<string> {
  return await hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return await compare(password, hashedPassword);
}

// ═══ Cookie 操作 ═══
export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(TOKEN_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 天
  });
}

export async function getAuthCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(TOKEN_NAME)?.value;
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_NAME);
}

// ═══ 获取当前用户 ═══
export async function getCurrentUser(): Promise<AuthPayload | null> {
  const token = await getAuthCookie();
  if (!token) return null;
  return await verifyToken(token);
}
