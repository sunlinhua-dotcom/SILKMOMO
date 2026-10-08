/**
 * 登出 API
 * 先把当前令牌的 jti 记入吊销表（幂等，重复登出不报错），再清 cookie——
 * 这样即使旧 cookie 被别处留存，7 天内也无法再用。
 * 吊销表写入失败时 cookie 仍然清掉（用户的登出动作不能失败），但响应里带 revokeFailed: true 如实告知。
 */
import { NextResponse } from 'next/server';
import { clearAuthCookie, revokeCurrentToken } from '@/lib/auth';

export async function POST() {
  const { error } = await revokeCurrentToken();
  await clearAuthCookie();
  return NextResponse.json(error ? { success: true, revokeFailed: true } : { success: true });
}
