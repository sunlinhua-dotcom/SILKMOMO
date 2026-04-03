# =========================================
# SILKMOMO - Zeabur 生产 Dockerfile
# Next.js Standalone + Prisma SQLite
# =========================================

# 阶段 1：依赖安装 & 构建
FROM node:20-alpine AS builder

WORKDIR /app

# 安装必要的构建工具（better-sqlite3 需要 python3 和 make）
RUN apk add --no-cache python3 make g++

# 复制 package 文件并安装依赖
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile

# 复制所有源码
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 构建 Next.js（standalone 模式）
RUN npm run build

# =========================================
# 阶段 2：最小化生产镜像
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# 安装 better-sqlite3 运行时依赖
RUN apk add --no-cache libc6-compat

# 从构建阶段复制必要文件
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/@prisma/adapter-better-sqlite3 ./node_modules/@prisma/adapter-better-sqlite3

# 创建数据库目录（持久卷挂载点）
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 8080

# 启动：先执行迁移，再启动服务
CMD ["sh", "-c", "npx prisma migrate deploy --schema=/app/prisma/schema.prisma && PORT=8080 node server.js"]
