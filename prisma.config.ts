import "dotenv/config";
import { defineConfig } from "prisma/config";

// Zeabur PostgreSQL 注入的变量名可能是 POSTGRES_URL / POSTGRES_URI / DATABASE_URL
function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URI ||
    process.env.POSTGRESQL_URL ||
    ""
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
