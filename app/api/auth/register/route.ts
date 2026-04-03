/**
 * 用户注册 API
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, signToken, setAuthCookie } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { username, password, name } = await req.json();

    // 验证
    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码为必填项' }, { status: 400 });
    }

    if (username.length < 2) {
      return NextResponse.json({ error: '用户名至少2个字符' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
    }

    // 检查用户名是否已注册
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: '该用户名已注册' }, { status: 409 });
    }

    // 创建用户
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        name: name || `用户${username.slice(0, 4)}`,
        role: 'user',
        balanceFen: 0,
      },
    });

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
