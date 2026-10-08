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

# typescript（约 19 MB）是 standalone tracing 因 next.config.ts 带进来的，运行时不用：
# standalone 的 server.js 已把 next 配置内联，不会在运行时再编译 next.config.ts。
# 必须在 builder 里删：镜像是分层的，runner 里再 rm 只加一层白名单，体积一字节都不会少。
RUN rm -rf .next/standalone/node_modules/typescript

# ===== 抽出 prisma CLI 的最小依赖闭包 =====
# 容器启动时只需要 `prisma migrate deploy`。Next standalone 自带的 node_modules 只含运行服务所需的（tracing 产物），
# 所以不再把整份 node_modules 带进 runner。这里从 builder 已按 package-lock 装好的树里，
# 沿 dependencies / optionalDependencies 把 prisma 与 dotenv（prisma.config.ts 要用）的闭包原样拷出来，
# 版本与锁文件完全一致，不联网、不重新解析。
# SKIP：migrate deploy 加载不到的重依赖（Studio 前端 react / chart.js、prisma dev 本地服务 hono、mysql2 等）。
# 注意 @prisma/studio-core 与 @prisma/dev 不能整包跳过：prisma/build/index.js 顶层就 require 它们的一部分子路径，
# 所以保留包本身，只在后面的瘦身步骤里删掉其 UI / pglite。
# 注意：Dockerfile 会先吃掉续行符，所以内联脚本里不能有 // 注释、每句必须有分号。
RUN mkdir -p /prisma-cli/node_modules \
 && node -e ' \
const fs = require("fs"), path = require("path"); \
const ROOT = "/app", OUT = "/prisma-cli/node_modules"; \
const SKIP = new Set(["mysql2", "react", "react-dom", "chart.js", "hono", "csstype", "ajv", \
  "@electric-sql/pglite", "@electric-sql/pglite-socket", "@electric-sql/pglite-tools", \
  "@prisma/query-plan-executor", "@prisma/streams-local"]); \
const seen = new Set(); \
function find(name, from) { \
  for (let d = from; ; d = path.dirname(d)) { \
    const c = path.join(d, "node_modules", name); \
    if (fs.existsSync(path.join(c, "package.json"))) return c; \
    if (path.dirname(d) === d) return null; \
  } \
} \
function walk(name, from) { \
  if (SKIP.has(name)) return; \
  const dir = find(name, from); \
  if (!dir) { console.log("not installed (optional?):", name); return; } \
  if (seen.has(dir)) return; \
  seen.add(dir); \
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); \
  for (const n of Object.keys(Object.assign({}, pj.dependencies, pj.optionalDependencies))) walk(n, dir); \
} \
walk("prisma", ROOT); walk("dotenv", ROOT); \
for (const dir of seen) { \
  const rel = path.relative(path.join(ROOT, "node_modules"), dir); \
  if (rel.includes("node_modules" + path.sep)) continue; \
  fs.cpSync(dir, path.join(OUT, rel), { recursive: true }); \
} \
console.log("prisma-cli packages:", seen.size); \
' \
 && cp -r prisma prisma.config.ts /prisma-cli/ \
 && cd /prisma-cli/node_modules \
 && find . \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' \) -type f -delete \
 && rm -rf effect/src effect/dist/dts effect/dist/esm \
           @prisma/studio-core/dist/ui @prisma/dev/node_modules \
           @prisma/dev/dist/runtime-assets \
           @prisma/studio-core/dist/data/mysql-core @prisma/studio-core/dist/data/pglite \
           @prisma/studio-core/dist/data/sqlite-core @prisma/studio-core/dist/data/sqljs \
           prisma/build/studio.js prisma/build/studio.css \
 && find @prisma/dev/dist -maxdepth 1 -type f ! -name state.cjs -delete \
 && find prisma/build -name 'query_compiler_*' ! -name '*postgresql*' -type f -delete \
 && cd /prisma-cli \
 && du -sh node_modules \
 && DATABASE_URL=postgresql://u:p@127.0.0.1:5432/x node node_modules/prisma/build/index.js validate \
 && node node_modules/prisma/build/index.js --version

# ===== 生产阶段 =====
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

# 复制 standalone 输出（--chown：直接以 node 身份落盘，避免再 chown -R 一遍把 node_modules 在层里存两份）
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# prisma CLI 独立放在 /app/prisma-cli（自带 node_modules、迁移文件和 prisma.config.ts），
# 与服务自己的 node_modules 互不干扰，避免两套版本在同一棵树里相互覆盖。
COPY --from=builder --chown=node:node /prisma-cli ./prisma-cli

# .next/cache（图片优化等运行时缓存）必须可写；/app 本身也归 node
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache && chown node:node /app

USER node

EXPOSE 8080

# 健康检查：/api/health 返回 200 健康、503 不健康；busybox wget 遇非 2xx 即非零退出
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1

# 先在 prisma-cli 目录里 migrate deploy（配置文件与 schema 都在那里），再回到 /app 起服务。
# exec 让 node 直接成为主进程，能收到 SIGTERM 优雅退出。
# HOSTNAME=0.0.0.0：Docker 会把 HOSTNAME 设成容器 ID，standalone server.js 会据此只绑容器 IP，
# 导致 127.0.0.1 的健康检查打不通。
CMD ["sh", "-c", "export DATABASE_URL=${DATABASE_URL:-${POSTGRES_URL:-${POSTGRES_URI:-$POSTGRESQL_URL}}} && (cd prisma-cli && node node_modules/prisma/build/index.js migrate deploy) && export PORT=${PORT:-8080} HOSTNAME=0.0.0.0 && exec node server.js"]
