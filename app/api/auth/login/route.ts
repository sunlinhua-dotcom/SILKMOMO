/**
 * 用户登录 API
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyPassword, signToken, setAuthCookie } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
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
