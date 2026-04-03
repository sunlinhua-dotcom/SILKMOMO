/**
 * 管理员初始化 API
 * 首次调用时创建管理员账户
 * Body: { username, password, setupKey }
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, signToken, setAuthCookie } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { username, password, name, setupKey } = await req.json();

    // 验证 setup key（必须在环境变量中配置，不再有默认值）
    const expectedKey = process.env.ADMIN_SETUP_KEY;
    if (!expectedKey) {
      return NextResponse.json({ error: '服务器未配置安装密钥' }, { status: 500 });
    }
    if (setupKey !== expectedKey) {
      return NextResponse.json({ error: '安装密钥错误' }, { status: 403 });
    }

    // 检查是否已有管理员
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (existingAdmin) {
      return NextResponse.json({ error: '管理员已存在，请直接登录' }, { status: 409 });
    }

    // 创建管理员
    const passwordHash = await hashPassword(password);
    const admin = await prisma.user.create({
      data: {
        username,
        passwordHash,
        name: name || '管理员',
        role: 'admin',
        balanceFen: 999900, // 管理员默认 ¥9,999
      },
    });

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
