/**
 * 令牌吊销：接 prisma 的实现（逻辑与缓存见 token-revocation-core.ts）。
 * 调用方：proxy.ts（页面 + API 的统一入口，Next 16 的 proxy 跑在 Node.js 运行时，可访问 Prisma）、
 * lib/auth.ts 的 verifyToken（route handler 二次校验）、app/api/auth/logout。
 */
import prisma from './prisma';
import {
  createRevocationChecker,
  purgeExpiredFromStore,
  type RevocationChecker,
  type RevocationStore,
} from './token-revocation-core.ts';

const prismaStore: RevocationStore = {
  async isRevoked(jti) {
    const row = await prisma.revokedToken.findUnique({ where: { jti }, select: { jti: true } });
    return row !== null;
  },
  async revoke(jti, userId, expiresAt) {
    // skipDuplicates → INSERT ... ON CONFLICT DO NOTHING：重复登出幂等，不报唯一键冲突
    await prisma.revokedToken.createMany({ data: [{ jti, userId, expiresAt }], skipDuplicates: true });
  },
  async purgeBatch(before, limit) {
    const rows = await prisma.revokedToken.findMany({
      where: { expiresAt: { lt: before } },
      select: { jti: true },
      take: limit,
    });
    if (rows.length === 0) return 0;
    const res = await prisma.revokedToken.deleteMany({ where: { jti: { in: rows.map(r => r.jti) } } });
    return res.count;
  },
};

// 挂 globalThis：Next 里 proxy 与 route handler 是不同的 bundle，各自 import 本模块会各有一份模块级变量。
// 共用一份缓存，登出路由写入的「已吊销」才能被同进程的 proxy 立即看到。
const globalForRevocation = globalThis as unknown as { __silkmomoRevocation?: RevocationChecker };
const checker: RevocationChecker =
  globalForRevocation.__silkmomoRevocation ?? createRevocationChecker(prismaStore);
globalForRevocation.__silkmomoRevocation = checker;

/** 令牌是否已被吊销；查库失败 fail-open（取舍见 token-revocation-core.ts 文件头） */
export function isTokenRevoked(jti: string | undefined | null, expSec?: number): Promise<boolean> {
  return checker.isRevoked(jti, expSec);
}

/** 吊销令牌（幂等）。写库失败会抛出，但本实例缓存已生效。 */
export function revokeToken(jti: string, userId: string, expSec: number): Promise<void> {
  return checker.revoke(jti, userId, expSec);
}

/**
 * 清理过期的吊销记录（expiresAt < now），分批删除，返回删除总数。
 * 由 lib/retention-tasks.ts 接入每日保留清理。
 */
export function purgeExpiredRevokedTokens(now: Date = new Date(), batchSize?: number): Promise<number> {
  return purgeExpiredFromStore(prismaStore, now, batchSize);
}

/** 统计已过期（将被 purgeExpiredRevokedTokens 删除）的吊销记录数，只读；供保留清理 dry-run 使用。 */
export function countExpiredRevokedTokens(now: Date = new Date()): Promise<number> {
  return prisma.revokedToken.count({ where: { expiresAt: { lt: now } } });
}
