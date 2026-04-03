FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 构建 Next.js (standalone 输出)
RUN npm run build

# ===== 生产阶段 =====
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# 复制 standalone 输出
COPY --from=builder /app/.next/standalone ./

# 复制 static 文件 (standalone 不自带)
COPY --from=builder /app/.next/static ./.next/static

# 复制 public 目录 (standalone 不自带)
COPY --from=builder /app/public ./public

# 复制 Prisma 相关文件 (migrate deploy 需要)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json

# 安装 prisma CLI + 运行时依赖
RUN npm install prisma @prisma/client @prisma/adapter-pg pg dotenv --no-save

EXPOSE 8080

# 启动：迁移数据库 + 运行 standalone server
CMD ["sh", "-c", "export DATABASE_URL=${DATABASE_URL:-${POSTGRES_URL:-${POSTGRES_URI:-$POSTGRESQL_URL}}} && npx prisma migrate deploy && PORT=${PORT:-8080} node server.js"]
