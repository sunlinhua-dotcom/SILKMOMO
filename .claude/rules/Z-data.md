---
paths:
  - "prisma/**"
  - "lib/prisma.ts"
  - "prisma.config.ts"
  - "Dockerfile"
  - "next.config.ts"
  - "instrumentation.ts"
  - "lib/retention.ts"
---
# Z 数据层

职责：Prisma schema、数据库连接与适配器选择。

## 文件清单（改这个板块只读这些）
- `prisma/schema.prisma` — 11 个 model + 3 个 enum（含 `RevokedToken`、`RateLimitCounter`，见 A 板块），全库唯一的表结构来源。
- `prisma/migrations/` — 迁移历史。
- `lib/prisma.ts` — 客户端单例与适配器选择；PG 连接池大小读 `PG_POOL_MAX`（默认 10）。
- `prisma.config.ts` — Prisma CLI 配置（`migrate deploy` 用）。
- `lib/retention.ts` — 数据保留清理（启动 10 分钟后首跑、之后每 24 小时；advisory lock 多实例互斥；分批 ≤500 行删除）。策略、环境变量与关闭方法见 `docs/handoff/retention-1008.md`。其它模块用 `registerRetentionTask(name, fn)` 接入额外清理。
- 部署相关（无独立板块，放这里）：`Dockerfile`、`next.config.ts`（CSP 等安全头）、`instrumentation.ts`（启动后台任务：脸库 job 监督 + 计费清扫 + 保留清理）。

## 共享依赖
- 它依赖：无。
- 依赖它的：所有落库的 route 与 lib（`lib/model-face-library`、`lib/model-face-jobs`、`lib/pending-image`、各 `app/api/**`）。schema 改字段前先全仓 grep 该字段名。

## 改动前必读的坑
- **sqlite adapter 只在 `DATABASE_URL` 以 `file:` 开头时启用**，生产是 PostgreSQL。别把只在 sqlite 下成立的行为当成通用行为。
- **自检、CI、验收一律不许跑 `prisma migrate`**。要改表结构就单独开一次有人盯着的迁移，先备份。
- **迁移 `20261008000000_billing_fulfillment_and_indexes` 给 `Transaction` 加了 `fulfilledAt`，并把历史 consume 全部回填 `fulfilledAt = createdAt`**。回填是致命前提：不回填，上线后孤儿清扫会把全部历史消费当「已扣费未出图」再退一遍。以后任何重建/导入 Transaction 数据的操作都要保持这个不变量。回滚 SQL：`docs/handoff/rollback-1008.sql`（先回滚代码再回滚库；列删除对旧代码无影响）。
- **`PG_POOL_MAX`（默认 10）**：多实例 × 池大小不能超过 PG 的 `max_connections`；清扫和 job 监督也占连接。
- **Dockerfile 现在以 `node` 非 root 用户运行**：runner 阶段文件都 `--chown=node:node`，`.next/cache` 要可写；新增运行时要写盘的目录必须在 `USER node` 之前建好并 chown。runner 里没有 devDependencies（`better-sqlite3` 与 sqlite adapter 已在 devDependencies，生产只用 pg）；运行时需要的包别放进 devDependencies。HEALTHCHECK 打 `/api/health`，`HOSTNAME=0.0.0.0` 不能去掉（否则健康检查打不通）。
- **镜像瘦身（T6）：runner 不再带整份 `node_modules`，也不再有 builder 里的 `npm prune`**。runner = Next standalone（自带 tracing 出来的最小 `node_modules`，含 sharp 的 musl 二进制与 `.prisma` 生成物）+ `.next/static` + `public` + 独立的 `/app/prisma-cli/`。`/app/prisma-cli/` 在 builder 里由内联脚本从已按 lock 装好的树里抽出 `prisma`、`dotenv` 的依赖闭包（不联网、版本与 lock 一致），再删类型声明/源码映射/Studio UI 等；里面自带 `prisma/`、`prisma.config.ts`，启动命令是 `(cd prisma-cli && node node_modules/prisma/build/index.js migrate deploy)` 后 `exec node server.js`。因此**迁移文件、`prisma.config.ts` 在运行时只在 `/app/prisma-cli/` 下**，`/app/prisma`、`/app/node_modules/.bin/prisma` 都不存在，别写依赖它们的命令。
- **Prisma 相关包在 `package.json` 里锁精确版本**（`prisma`、`@prisma/client`、`@prisma/adapter-pg`、`@prisma/adapter-better-sqlite3`，无 `^`）：CLI 版本与生成的 client 版本必须一致，升级时四个一起改并同步 lock。builder 里的 CLI 抽取脚本有 `SKIP` 名单与瘦身 `rm`，升 prisma 大版本后构建会在 `validate` / `--version` 那一步红（缺模块），按报错把对应包从 SKIP 里拿掉即可。
- **swc musl 补装守卫（builder 里 `npm ci` 之后那段）必须保留**，见 0906 事故：`npm ci` 会静默漏装 `@next/swc-linux-*-musl`，Next 回退 wasm 后 Turbopack 直接报错。
- **本机验 linux/amd64 镜像**：Mac 是 arm64，Colima 默认 QEMU 跑 x64，`next` 的原生 swc 在 QEMU 下会 segfault，构建卡死；要用 `colima start --vz-rosetta`（Rosetta 速度和兼容性都够）。基础镜像本地 tag `node:20-alpine` 是 arm64，`docker build --platform linux/amd64` 在旧 builder 下仍会取到 arm64，需要先有 amd64 的同版本镜像再换 `FROM`。验证时只连自己起的临时 postgres，绝不连生产库。
- **生产 CSP 不含 `'unsafe-eval'`**（`next.config.ts`，dev 才放，React 调试/HMR 需要）。引入依赖 `eval`/`new Function` 的库会在线上直接白屏，先在 `npm run build && npm start` 下验过。
- **迁移 `20261008100000_auth_revocation_rate_limit` 只新建 `RevokedToken`、`RateLimitCounter` 两张空表 + 索引**，对已有数据零影响；回滚 SQL `docs/handoff/rollback-1008b.sql`（先回滚代码再 DROP）。两张表上线前代码读写它们会报错：吊销检查 fail-open、限流退回内存，但登出写吊销表会失败（响应带 `revokeFailed`），所以**必须先 `migrate deploy` 再上新代码**。
- **保留清理会删数据，改它之前先读 `docs/handoff/retention-1008.md`**：`GenerationRecord` 超 365 天且未评分/无反馈的删；`ModelFaceGenerationJob` 已结束超 30 天且所有 item 计费终态（uncharged/refunded/kept，`charged`、`refund_pending` 不是）的删；`Transaction`、`ModelFace` 永不删。新增 `ModelFaceBillingStatus` 枚举值必须先在 `lib/retention.ts` 里归类（有 schema 守卫测试）。环境变量：`RETENTION_DISABLED=1` 关闭、`RETENTION_DRY_RUN=1` 只统计、`GENERATION_RECORD_RETENTION_DAYS`、`MODEL_FACE_JOB_RETENTION_DAYS`。
- **迁移 `20261008200000_model_face_object_storage` 给 `ModelFace` 加 `imageKey`、`thumbnailKey` 两列并放开 `image` 的 NOT NULL**：只有 ADD COLUMN 与 DROP NOT NULL，对已有行零影响（本地临时库已验证快照 md5 前后一致）。业务说明见 D 板块「脸图存储」。回滚 SQL `docs/handoff/rollback-1008c.sql`，**顺序**：① 若有行的图只在 R2（`image` 为 NULL）先 `model-face-storage-migrate.mjs --to-db --apply` 回迁 → ② 回滚代码（旧代码读 `image`，遇 NULL 会报错）→ ③ 执行 SQL（里面的守卫块在仍有 `image` 为空的行时会报错中止，不会丢数据）→ ④ 删 `_prisma_migrations` 里的记录。**先 `migrate deploy` 再上新代码**（新代码写 `imageKey` 列，列不存在会报错）。
- **对象存储变量**（四必填：`OBJECT_STORAGE_ENDPOINT` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`，可选 `_REGION`）属于运行时配置，写在 Zeabur 服务环境变量里；生产桶 `silkmomo-faces`（私有，R2 令牌限定到该桶、Object Read & Write）。一键配置命令 `scripts/setup-r2-storage.sh`（装成 `silkmomo-r2`）。`aws4fetch`（精确版本锁定）是唯一新增依赖，被 Next 打进服务端 chunk，runner 不需要它出现在 `node_modules`。
- `prisma/dev.db` 是本地库，不要提交、不要当成线上数据。

## 测试与验收
- `npm test`（保留清理：`__tests__/retention.test.mjs`；真库语义：`RETENTION_TEST_DATABASE_URL=<含 scratch/test 的临时库> node --test __tests__/retention-db.test.mjs`，默认跳过）
- 手工验收：`npx prisma validate` 通过；改了 schema 后 `npx prisma generate` 再跑 `npx tsc --noEmit`。
