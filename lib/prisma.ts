/**
 * Prisma 单例（Prisma v7 + PostgreSQL adapter）
 * 延迟初始化：仅在首次调用数据库操作时才创建连接
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Build 阶段没有 DATABASE_URL，返回一个 proxy 占位
    // 运行时如果真的调用数据库操作才会报错
    console.warn('[Prisma] DATABASE_URL 未设置，数据库操作将不可用');
    return new Proxy({} as PrismaClient, {
      get(_, prop) {
        if (typeof prop === 'string' && !['then', 'catch', Symbol.toPrimitive].includes(prop)) {
          throw new Error(`数据库未连接：DATABASE_URL 环境变量未设置`);
        }
        return undefined;
      },
    });
  }

  // 动态 import pg 避免 build 时报错
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
