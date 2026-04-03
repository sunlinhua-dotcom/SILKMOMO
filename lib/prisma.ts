/**
 * Prisma 单例（Prisma v7 + PostgreSQL adapter）
 * 延迟初始化 + 兼容 Zeabur 多种 PostgreSQL 变量名
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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
    // Build 阶段没有数据库 URL，返回 Proxy 占位
    console.warn('[Prisma] 数据库 URL 未设置，数据库操作将不可用');
    return new Proxy({} as PrismaClient, {
      get(_, prop) {
        if (typeof prop === 'string' && !['then', 'catch'].includes(prop) && typeof prop !== 'symbol') {
          throw new Error(`数据库未连接：请设置 DATABASE_URL 环境变量`);
        }
        return undefined;
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
