---
paths:
  - "lib/billing.ts"
  - "lib/billing-constants.ts"
  - "lib/generation-billing-core.ts"
  - "lib/billing-reconcile.ts"
  - "instrumentation.ts"
  - "lib/model-face-billing*.ts"
  - "lib/generation-idempotency.ts"
  - "lib/admin-recharge-core.ts"
  - "app/billing/**"
  - "app/api/billing/**"
---
# F 计费

职责：积分预扣、失败退款、幂等控制与交易流水。

## 文件清单（改这个板块只读这些）
- `lib/billing.ts` — 扣费 / 退款 / 余额（285 行）。
- `lib/billing-constants.ts` — 单价与档位常量。
- `lib/generation-billing-core.ts` — 出图计费核心。
- `lib/model-face-billing.ts` / `-billing-core.ts` — 脸库计费。
- `lib/generation-idempotency.ts` — 幂等键与时间窗常量（`GENERATION_IN_FLIGHT_WINDOW_MS`、`GENERATION_ORPHAN_AGE_MS`=20 分钟）。
- `lib/billing-reconcile.ts` — 孤儿扣费清扫：`fulfilledAt` 为空且超过 20 分钟的出图 consume 走幂等退款；`instrumentation.ts` 启动时每 5 分钟跑一次。纯逻辑 `reconcileGenerationBilling` 无运行时依赖，可被 node:test 直接加载。
- `lib/admin-recharge-core.ts` — 管理员充值的幂等核心（纯逻辑）：`rechargeWithIdempotency`、请求体校验 `parseAdminRechargeBody`；`lib/billing.ts` 的 `rechargeBalance` 是薄封装。
- `app/api/billing/transactions/route.ts`、`app/billing/page.tsx`

## 共享依赖
- 它依赖：`lib/prisma`(Z)。
- 依赖它的：`app/api/generate/stream/route.ts`(B)、`lib/model-face-jobs.ts`(D)、`app/api/ai/*`(H)、`app/api/admin/*`(J)。改导出签名前先 `grep -rn "from '@/lib/billing'" app lib`。

## 改动前必读的坑
- **扣费必须原子**：预扣和落库在同一个事务里，不许拆成两步。
- **失败必须退款**：任何出图失败路径都要走到退款，新增失败分支时先确认退款也覆盖到了。
- **幂等键不能动**：改了会让重试变成重复扣费。
- **`Transaction.fulfilledAt` 是履约标记**：出图类 consume 在「结果已写入 pending / 已推给客户端」时写入；幂等命中（同键重放）看到已履约，永不再生成（堵住了「同 runId 重放免费出图」）。
- **新增 consume 路径若是出图类，必须写 `fulfilledAt`**，否则 20 分钟后清扫会把它当孤儿误退款，用户白拿一次图。脸库计费（`<id>:charge` 键）与 AI 助手（无键）不走这个语义，别照抄。
- **孤儿清扫退款前必须查 pending 与成功的 `GenerationRecord`**：只看 `fulfilledAt` 为空会误退「已交付但标记没写上」的单子；改清扫判据时这两个查询不能省。退款本身走现有幂等路径（先认领流水再入账），多实例同时清扫不会重复退。
- **管理员充值服务端幂等**：请求带 `requestId`（UUID）时 `Transaction.idempotencyKey = admin-recharge:<requestId>`，加余额 + 写流水在同一事务里，命中唯一约束（P2002）不再加钱，回第一次的结果并带 `duplicate: true`（HTTP 200）；同 requestId 换用户/金额回 409；非法格式 400；不带 requestId 的老请求保持旧行为但打告警。前端每次「用户 + 金额」意图生成一个 requestId，重试复用。改动后跑 `node --test __tests__/admin-recharge.test.mjs`。
- **`Transaction` 永不被保留清理删除**（账务，见 Z 板块的 retention）。
- 任何改动都必须跑 `npm run test:billing`，这套测试是防赔钱的。

## 测试与验收
- `npm run test:billing`（含 `generation-billing-replay.test.mjs`：重放、交付后不退款、孤儿清扫）
- 手工验收：`/billing` 看流水；故意让一次生成失败，余额应该回到原值。
