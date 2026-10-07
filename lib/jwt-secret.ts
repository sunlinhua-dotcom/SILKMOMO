// Edge-runtime safe — no node-only imports

/** 已知的示例值 / 弱值（统一小写比较）。.env.example 历史版本里的两个示例值也在其中。 */
const KNOWN_WEAK_SECRETS = new Set([
  'silkmomo-jwt-secret-change-me-in-production-2026',
  'silkmomo-admin-setup-2026',
  'silkmomo-dev-only-insecure-fallback',
  'secret',
  'jwt_secret',
  'jwt-secret',
  'changeme',
  'change-me',
  'password',
  '12345678',
  'your_secret_here',
]);

/** 命中任一片段即视为占位符 / 示例值 */
const WEAK_FRAGMENTS = ['change-me', 'changeme', 'please-generate', 'your_secret', 'your-secret', 'insecure', 'example'];

export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * 判断 JWT 密钥是否过弱：长度 < 32、命中已知示例值 / 占位符片段、或全是同一个字符。
 * 纯函数，不打印、不返回密钥内容。
 */
export function isWeakJwtSecret(secret: string | undefined | null): boolean {
  if (!secret) return true;
  if (secret.length < JWT_SECRET_MIN_LENGTH) return true;
  const lower = secret.toLowerCase();
  if (KNOWN_WEAK_SECRETS.has(lower)) return true;
  if (WEAK_FRAGMENTS.some(f => lower.includes(f))) return true;
  if (/^(.)\1+$/.test(secret)) return true;
  return false;
}

let weakWarned = false;

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // build 阶段（next build 在没有 runtime env 时也会评估模块）容忍缺失，
    // 真正运行（next start / dev）时再硬性要求
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
    if (process.env.NODE_ENV === 'production' && !isBuildPhase) {
      throw new Error('[security] JWT_SECRET environment variable must be set in production');
    }
    if (typeof console !== 'undefined') {
      console.warn('[auth] JWT_SECRET not set — using insecure dev fallback. NEVER deploy without setting JWT_SECRET.');
    }
    return new TextEncoder().encode('silkmomo-dev-only-insecure-fallback');
  }

  // 弱密钥只告警、不抛错（线上密钥强度无法核实，抛错可能让服务起不来）。
  // 每个进程只打一次；日志里绝不出现密钥本身。
  if (!weakWarned && isWeakJwtSecret(secret) && typeof console !== 'undefined') {
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
    if (!isBuildPhase) {
      weakWarned = true;
      console.error(
        '\n!!!!!!!! [安全告警] JWT_SECRET 过弱 !!!!!!!!\n' +
        `当前 JWT_SECRET 长度不足 ${JWT_SECRET_MIN_LENGTH} 位，或仍是示例 / 占位值。\n` +
        '任何人都可能伪造登录凭证（包括管理员）。请立即更换：\n' +
        '  openssl rand -base64 48\n' +
        '把输出填进环境变量 JWT_SECRET 后重启（更换后所有用户需重新登录）。\n'
      );
    }
  }
  return new TextEncoder().encode(secret);
}
