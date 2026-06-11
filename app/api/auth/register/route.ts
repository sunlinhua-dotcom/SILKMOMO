/**
 * 用户注册 API
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, signToken, setAuthCookie } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;
const PASSWORD_MIN = 8;

export async function POST(req: Request) {
  try {
    // 防灌库：每个 IP 每小时最多 5 次注册
    const ip = getClientIp(req);
    const ipLimit = rateLimit(`register:ip:${ip}`, 5, 60 * 60 * 1000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `注册过于频繁，请 ${ipLimit.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }

    const { username, password, name } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码为必填项' }, { status: 400 });
    }

    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        { error: '用户名只能包含字母、数字、下划线和短横线，长度 2-32' },
        { status: 400 }
      );
    }

    if (password.length < PASSWORD_MIN) {
      return NextResponse.json({ error: `密码至少 ${PASSWORD_MIN} 位` }, { status: 400 });
    }

    // 起码包含一个字母 + 一个数字（弱强度门槛）
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return NextResponse.json(
        { error: '密码需要同时包含字母和数字' },
        { status: 400 }
      );
    }

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
