/**
 * 健康检查：不鉴权，只做一次 SELECT 1 探测数据库连通性。
 * 不返回任何内部细节（版本、错误原文、连接串）。
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error('[health] 数据库探测失败:', error);
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
