/**
 * 用户登录 API
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyPassword, signToken, setAuthCookie } from '@/lib/auth';
import {
  isRateLimited, bumpRateLimit, resetRateLimit, rateLimitByKey, getClientIp, loginLockKey,
} from '@/lib/rate-limit';
import { validateLoginInput } from '@/lib/auth-shared';

// 用户不存在时也跑一次 bcrypt 比较，使两条路径耗时一致，防止时序枚举用户名
const DUMMY_HASH = '$2b$12$0PuPsOvMVEoraqsbYQ02Ze4Yz6rcOqDH5.SfzRoC7OfIwIlfyOHEG';

// 「用户名+IP」维度的失败锁定：只锁这个 IP 对这个账号的尝试，
// 攻击者无法靠在自己 IP 上连错 5 次把真正的 admin 锁 15 分钟
const USER_IP_LOCK_MAX = 5;
const USER_IP_LOCK_WINDOW_MS = 15 * 60 * 1000;
// 按 IP 的总失败次数（跨用户名），防止同一 IP 轮着试不同账号
const IP_LOCK_MAX = 10;
const IP_LOCK_WINDOW_MS = 15 * 60 * 1000;
// 按 IP 的总请求频率（成功失败都计），挡 bcrypt 耗 CPU 的洪泛
const IP_RATE_MAX = 30;
const IP_RATE_WINDOW_MS = 60 * 1000;

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: '请求体解析失败' }, { status: 400 });
    }
    const input = validateLoginInput(body);
    if (!input.ok) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }
    const { username, password } = input.value;

    // 防暴力破解。IP 取值见 lib/rate-limit.ts 的 extractClientIp（Zeabur 反代下取 XFF 从右数第 1 段）。
    // 失败锁定只统计「失败」尝试：IP 失败桶用 isRateLimited（只查不计），
    // 否则成功登录也会消耗配额，共享出口 IP（公司 / 家庭 NAT）下正常用户会被一起挡住。
    const ip = getClientIp(req);

    const rate = rateLimitByKey('login-rate', ip, IP_RATE_MAX, IP_RATE_WINDOW_MS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `请求过于频繁，请 ${rate.retryAfterSec} 秒后再试` },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      );
    }

    const ipKey = `login:ip:${ip}`;
    const ipLimit = isRateLimited(ipKey, IP_LOCK_MAX, IP_LOCK_WINDOW_MS);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `登录尝试过于频繁，请 ${ipLimit.retryAfterSec} 秒后再试` },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } }
      );
    }
    const userKey = loginLockKey(username, ip);
    const userLimit = isRateLimited(userKey, USER_IP_LOCK_MAX, USER_IP_LOCK_WINDOW_MS);
    if (!userLimit.allowed) {
      return NextResponse.json(
        { error: `该账号暂时无法从当前网络登录，请 ${userLimit.retryAfterSec} 秒后再试` },
        { status: 429, headers: { 'Retry-After': String(userLimit.retryAfterSec) } }
      );
    }

    // 用户名+密码统一返回相同错误，防止枚举注册用户；
    // 用户不存在时也执行一次等价的 bcrypt 比较，避免响应时延暴露账号是否存在
    const user = await prisma.user.findUnique({ where: { username } });
    const valid = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !valid) {
      bumpRateLimit(userKey, USER_IP_LOCK_WINDOW_MS);
      bumpRateLimit(ipKey, IP_LOCK_WINDOW_MS); // 只对失败计数
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
