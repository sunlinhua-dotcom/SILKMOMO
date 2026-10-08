// proxy 测试用的 lib/token-revocation 替身：吊销集合放在 globalThis，测试里直接增删。
// 真实实现需要 prisma / 数据库，proxy 的「吊销 → 401 / 跳登录」行为在这里用替身验证。
export async function isTokenRevoked(jti) {
  if (!jti) return false;
  if (globalThis.__stubRevocationShouldThrow) throw new Error('stub db error');
  return globalThis.__stubRevokedJtis?.has(jti) === true;
}
