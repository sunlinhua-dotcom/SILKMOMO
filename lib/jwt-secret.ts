// Edge-runtime safe — no node-only imports
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
  return new TextEncoder().encode(secret);
}
