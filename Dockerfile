FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Turbopack 必须有原生 swc 绑定才能跑 next build。npm 对 optional 依赖安装失败会静默跳过
# （不报 warn），0906 线上构建就是这么挂的：musl 绑定没落地 → Next 回退 wasm →
# turbo.createProject is not supported by the wasm bindings。
# 缺了就按 next 的精确版本补装；补不上就在这一层失败，别拖到 npm run build 报一个看不懂的错。
RUN SWC="@next/swc-linux-$(node -p process.arch)-musl" \
 && NEXT_VER="$(node -p "require('next/package.json').version")" \
 && (node -e "require('$SWC')" 2>/dev/null \
     || npm install --no-save --no-audit --no-fund --libc=musl "$SWC@$NEXT_VER") \
 && node -e "require('$SWC'); console.log('native swc ok: $SWC@$NEXT_VER')"

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
