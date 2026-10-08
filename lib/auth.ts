/**
 * SILXINE 认证工具
 * jose（Edge Runtime 兼容）+ bcryptjs
 */
import { SignJWT, jwtVerify } from 'jose';
import { hash, compare } from 'bcryptjs';
import { cookies } from 'next/headers';
import { getJwtSecret } from './jwt-secret';
import { isTokenRevoked, revokeToken } from './token-revocation';

const JWT_SECRET = getJwtSecret();
const TOKEN_NAME = 'silkmomo_token';
const TOKEN_EXPIRES = '7d'; // 7 天

export interface AuthPayload {
  userId: string;
  username: string;
  role: 'user' | 'admin';
  /** JWT id：登出时按它吊销。上线本功能前签发的老 token 没有该字段，继续有效到自然过期。 */
  jti?: string;
  /** 过期时间（秒级时间戳，jose 校验后在 payload 里） */
  exp?: number;
}

// ═══ JWT 签发 ═══
export async function signToken(payload: Pick<AuthPayload, 'userId' | 'username' | 'role'>): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(crypto.randomUUID()) // 每枚令牌唯一，登出时据此吊销
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRES)
    .sign(JWT_SECRET);
}

// ═══ JWT 验证 ═══
// 签名 / 过期通过后再查吊销表（登出即失效）。老 token 没有 jti，不查库，直接放行。
// 吊销表查询失败时 fail-open（不把全站用户踢下线），取舍见 lib/token-revocation-core.ts 文件头。
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (await isTokenRevoked(payload.jti, payload.exp)) return null;
    return payload as unknown as AuthPayload;
  } catch {
    return null;
  }
}

/**
 * 登出：吊销当前请求 cookie 里的 token（幂等），调用方随后清 cookie。
 * 返回 revoked=true 表示「这枚 token 已确定记入吊销表（或本来就在）」；
 * 无 token / token 已过期 / 老 token 无 jti 时无需吊销，返回 revoked=false 且 error=false；
 * 写库失败返回 error=true（本实例缓存已标记吊销，但其他实例要等库恢复后重新登出才会生效）。
 */
export async function revokeCurrentToken(): Promise<{ revoked: boolean; error: boolean }> {
  const token = await getAuthCookie();
  if (!token) return { revoked: false, error: false };
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWT_SECRET));
  } catch {
    return { revoked: false, error: false }; // 签名无效或已过期：本来就不能用，无需吊销
  }
  if (!payload.jti || typeof payload.userId !== 'string' || typeof payload.exp !== 'number') {
    return { revoked: false, error: false }; // 老 token 没有 jti，无从吊销，靠自然过期
  }
  try {
    await revokeToken(payload.jti, payload.userId, payload.exp);
    return { revoked: true, error: false };
  } catch (err) {
    console.error('[auth] 登出时写入吊销表失败：', err instanceof Error ? err.message : err);
    return { revoked: false, error: true };
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

// ═══ admin 二次校验：JWT 中的 role 可能已被降级，重新查 DB 确认 ═══
import prisma from './prisma';
export async function requireAdmin(): Promise<AuthPayload | null> {
  const auth = await getCurrentUser();
  if (!auth) return null;
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { role: true },
  });
  if (!user || user.role !== 'admin') return null;
  return auth;
}
