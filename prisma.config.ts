import "dotenv/config";
import { defineConfig } from "prisma/config";

// 自动判断数据库类型
function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URI ||
    process.env.POSTGRESQL_URL ||
    "file:./data/silkmomo.db"  // 本地 fallback
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: getDatabaseUrl(),
  },
});
