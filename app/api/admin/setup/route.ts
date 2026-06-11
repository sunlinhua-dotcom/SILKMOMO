/**
 * 管理员初始化 API
 * 首次调用时创建管理员账户
 * Body: { username, password, setupKey }
 */
import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';
import { hashPassword, signToken, setAuthCookie } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

// 常量时间比较（先哈希再比较，同时避免长度泄露）
function safeKeyCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function POST(req: Request) {
  try {
    // 防 setup key 暴力破解
    const ip = getClientIp(req);
    const ipLimit = rateLimit(`admin-setup:${ip}`, 5, 60 * 60 * 1000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: `请 ${ipLimit.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }

    const { username, password, name, setupKey } = await req.json();

    const expectedKey = process.env.ADMIN_SETUP_KEY;
    if (!expectedKey) {
      return NextResponse.json({ error: '服务器未配置安装密钥' }, { status: 500 });
    }
    if (typeof setupKey !== 'string' || !safeKeyCompare(setupKey, expectedKey)) {
      return NextResponse.json({ error: '安装密钥错误' }, { status: 403 });
    }

    if (!username || !password || password.length < 8) {
      return NextResponse.json(
        { error: '用户名必填，密码至少 8 位' },
        { status: 400 }
      );
    }

    // 把 admin 创建包在一个事务里，配合 SERIALIZABLE 隔离避免并发双 admin
    let admin;
    try {
      admin = await prisma.$transaction(async (tx) => {
        const existingAdmin = await tx.user.findFirst({ where: { role: 'admin' } });
        if (existingAdmin) {
          throw new Error('ADMIN_EXISTS');
        }
        const passwordHash = await hashPassword(password);
        return await tx.user.create({
          data: {
            username,
            passwordHash,
            name: name || '管理员',
            role: 'admin',
            balanceFen: 999900,
          },
        });
      }, { isolationLevel: 'Serializable' });
    } catch (e) {
      if (e instanceof Error && e.message === 'ADMIN_EXISTS') {
        return NextResponse.json({ error: '管理员已存在，请直接登录' }, { status: 409 });
      }
      throw e;
    }

    // 签发 JWT
    const token = await signToken({
      userId: admin.id,
      username: admin.username,
      role: 'admin',
    });
    await setAuthCookie(token);

    return NextResponse.json({
      success: true,
      message: '管理员创建成功',
      user: { id: admin.id, username: admin.username, name: admin.name, role: admin.role },
    });
  } catch (error) {
    console.error('管理员初始化失败:', error);
    return NextResponse.json({ error: '初始化失败' }, { status: 500 });
  }
}
