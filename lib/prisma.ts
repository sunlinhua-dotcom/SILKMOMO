/**
 * Prisma 单例（Prisma v7）
 * 线上：PostgreSQL (pg adapter)
 * 本地开发：SQLite (better-sqlite3 adapter) — 仅当 schema provider 为 sqlite 时
 * Build 阶段：Proxy 占位（避免数据库连接）
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URI ||
    process.env.POSTGRESQL_URL ||
    undefined
  );
}

function createPrismaClient(): PrismaClient {
  const connectionString = getDatabaseUrl();

  if (!connectionString) {
    // Build 阶段或未配置数据库
    console.warn('[Prisma] 数据库 URL 未设置，数据库操作将不可用');
    return createProxyClient();
  }

  // SQLite 本地开发模式
  if (connectionString.startsWith('file:')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
      const adapter = new PrismaBetterSqlite3({ url: connectionString });
      console.log('[Prisma] 使用 SQLite (better-sqlite3):', connectionString);
      return new PrismaClient({ adapter });
    } catch (err) {
      // schema 是 postgresql 时 sqlite adapter 会报错（build 阶段），走 proxy 兜底
      console.warn('[Prisma] SQLite adapter 初始化失败，使用 Proxy 占位:', (err as Error).message?.substring(0, 100));
      return createProxyClient();
    }
  }

  // PostgreSQL 线上模式
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require('@prisma/adapter-pg');
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  console.log('[Prisma] 使用 PostgreSQL');
  return new PrismaClient({ adapter });
}

/** Build / SSG 阶段的 Proxy 占位 Client，运行时调用会报错 */
function createProxyClient(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_, prop) {
      if (typeof prop === 'string' && !['then', 'catch'].includes(prop) && typeof prop !== 'symbol') {
        throw new Error(`数据库未连接：请设置 DATABASE_URL 环境变量`);
      }
      return undefined;
    },
  });
}

/** 当前运行时是否为 PostgreSQL（部分查询特性如 mode: 'insensitive' 仅 PG 支持） */
export const isPostgres = (() => {
  const url = getDatabaseUrl();
  return !!url && !url.startsWith('file:');
})();

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
