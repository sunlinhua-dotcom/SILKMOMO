FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ===== 生产阶段 =====
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# 复制 standalone 输出
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 复制 Prisma 迁移文件
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json

# 从 builder 直接复制完整 node_modules（确保 prisma CLI 可用）
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 8080

CMD ["sh", "-c", "export DATABASE_URL=${DATABASE_URL:-${POSTGRES_URL:-${POSTGRES_URI:-$POSTGRESQL_URL}}} && ./node_modules/.bin/prisma migrate deploy && PORT=${PORT:-8080} node server.js"]
