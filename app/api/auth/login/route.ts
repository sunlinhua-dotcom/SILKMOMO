/**
 * 用户登录 API
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyPassword, signToken, setAuthCookie } from '@/lib/auth';
import { rateLimit, isRateLimited, bumpRateLimit, resetRateLimit, getClientIp } from '@/lib/rate-limit';

// 用户不存在时也跑一次 bcrypt 比较，使两条路径耗时一致，防止时序枚举用户名
const DUMMY_HASH = '$2b$12$0PuPsOvMVEoraqsbYQ02Ze4Yz6rcOqDH5.SfzRoC7OfIwIlfyOHEG';

const USER_LOCK_MAX = 5;
const USER_LOCK_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
    }

    // 防暴力破解：每个 IP 每 15 分钟最多 10 次登录尝试，每个用户名 5 次失败
    const ip = getClientIp(req);
    const ipLimit = rateLimit(`login:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `登录尝试过于频繁，请 ${ipLimit.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }
    // 按用户名只统计"失败"尝试：否则攻击者可用 5 次错误密码把任意账号锁死 15 分钟
    const userKey = `login:user:${String(username).toLowerCase()}`;
    const userLimit = isRateLimited(userKey, USER_LOCK_MAX, USER_LOCK_WINDOW_MS);
    if (!userLimit.allowed) {
      return NextResponse.json(
        { error: `该账号暂时被锁定，请 ${userLimit.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }

    // 用户名+密码统一返回相同错误，防止枚举注册用户；
    // 用户不存在时也执行一次等价的 bcrypt 比较，避免响应时延暴露账号是否存在
    const user = await prisma.user.findUnique({ where: { username } });
    const valid = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !valid) {
      bumpRateLimit(userKey, USER_LOCK_WINDOW_MS);
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }
    resetRateLimit(userKey);

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
