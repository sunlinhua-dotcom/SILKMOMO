---
paths:
  - "prisma/**"
  - "lib/prisma.ts"
---
# Z 数据层

职责：Prisma schema、数据库连接与适配器选择。

## 文件清单（改这个板块只读这些）
- `prisma/schema.prisma` — 9 个 model + 3 个 enum，全库唯一的表结构来源。
- `prisma/migrations/` — 迁移历史。
- `lib/prisma.ts` — 客户端单例与适配器选择（88 行）。

## 共享依赖
- 它依赖：无。
- 依赖它的：所有落库的 route 与 lib（`lib/model-face-library`、`lib/model-face-jobs`、`lib/pending-image`、各 `app/api/**`）。schema 改字段前先全仓 grep 该字段名。

## 改动前必读的坑
- **sqlite adapter 只在 `DATABASE_URL` 以 `file:` 开头时启用**，生产是 PostgreSQL。别把只在 sqlite 下成立的行为当成通用行为。
- **自检、CI、验收一律不许跑 `prisma migrate`**。要改表结构就单独开一次有人盯着的迁移，先备份。
- `prisma/dev.db` 是本地库，不要提交、不要当成线上数据。

## 测试与验收
- `npm test`
- 手工验收：`npx prisma validate` 通过；改了 schema 后 `npx prisma generate` 再跑 `npx tsc --noEmit`。
