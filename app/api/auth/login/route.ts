/**
 * 用户登录 API
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyPassword, signToken, setAuthCookie } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
    }

    // 防暴力破解：每个 IP 每 15 分钟最多 10 次登录尝试，每个用户名 5 次
    const ip = getClientIp(req);
    const ipLimit = rateLimit(`login:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `登录尝试过于频繁，请 ${ipLimit.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }
    const userLimit = rateLimit(`login:user:${username.toLowerCase()}`, 5, 15 * 60 * 1000);
    if (!userLimit.allowed) {
      return NextResponse.json(
        { error: `该账号暂时被锁定，请 ${userLimit.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }

    // 用户名+密码统一返回相同错误，防止枚举注册用户
    const user = await prisma.user.findUnique({ where: { username } });
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    // 签发 JWT
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
        role: user.role,
        balanceFen: user.balanceFen,
      },
    });
  } catch (error) {
    console.error('登录失败:', error);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}
