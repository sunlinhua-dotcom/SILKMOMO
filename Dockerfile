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

# 剪掉 devDependencies：runner 只需要 prisma CLI / dotenv（migrate deploy）等生产依赖。
# prisma generate 的产物在 node_modules/.prisma，npm prune 不会动它（dot 目录）。
RUN npm prune --omit=dev --no-audit --no-fund

# ===== 生产阶段 =====
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# 复制 standalone 输出（--chown：直接以 node 身份落盘，避免再 chown -R 一遍把 node_modules 在层里存两份）
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# 复制 Prisma 迁移文件
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/package.json ./package.json

# 剪过的生产 node_modules（含 prisma CLI，migrate deploy 必须可用）
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# .next/cache（图片优化等运行时缓存）必须可写；/app 本身也归 node
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache && chown node:node /app

USER node

EXPOSE 8080

# 健康检查：/api/health 返回 200 健康、503 不健康；busybox wget 遇非 2xx 即非零退出
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1

# exec 让 node 直接成为主进程，能收到 SIGTERM 优雅退出。
# HOSTNAME=0.0.0.0：Docker 会把 HOSTNAME 设成容器 ID，standalone server.js 会据此只绑容器 IP，
# 导致 127.0.0.1 的健康检查打不通。
CMD ["sh", "-c", "export DATABASE_URL=${DATABASE_URL:-${POSTGRES_URL:-${POSTGRES_URI:-$POSTGRESQL_URL}}} && ./node_modules/.bin/prisma migrate deploy && export PORT=${PORT:-8080} HOSTNAME=0.0.0.0 && exec node server.js"]
