/**
 * 用户注册 API
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, signToken, setAuthCookie } from '@/lib/auth';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { validateRegisterInput } from '@/lib/auth-shared';


export async function POST(req: Request) {
  try {
    // 防灌库：每个 IP 每小时最多 5 次注册
    const ip = getClientIp(req);
    const ipLimit = await rateLimitAsync(`register:ip:${ip}`, 5, 60 * 60 * 1000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `注册过于频繁，请 ${ipLimit.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: '请求体解析失败' }, { status: 400 });
    }
    const input = validateRegisterInput(body);
    if (!input.ok) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }
    const { username, password, name } = input.value;

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: '该用户名已注册' }, { status: 409 });
    }

    // 创建用户。并发同名注册时 findUnique 检查会双双通过，
    // 落败方撞 @unique 约束（P2002），应返回 409 而不是 500
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          username,
          passwordHash,
          name: name || `用户${username.slice(0, 4)}`,
          role: 'user',
          balanceFen: 0,
        },
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
        return NextResponse.json({ error: '该用户名已注册' }, { status: 409 });
      }
      throw e;
    }

    // 签发 JWT + 设置 Cookie
    const token = await signToken({
      userId: user.id,
      username: user.username,
      role: user.role as 'user' | 'admin',
    });
    await setAuthCookie(token);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        balanceFen: user.balanceFen,
      },
    });
  } catch (error) {
    console.error('注册失败:', error);
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}
