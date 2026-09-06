---
paths:
  - "lib/billing.ts"
  - "lib/billing-constants.ts"
  - "lib/generation-billing-core.ts"
  - "lib/model-face-billing*.ts"
  - "lib/generation-idempotency.ts"
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
- `lib/generation-idempotency.ts` — 幂等键。
- `app/api/billing/transactions/route.ts`、`app/billing/page.tsx`

## 共享依赖
- 它依赖：`lib/prisma`(Z)。
- 依赖它的：`app/api/generate/stream/route.ts`(B)、`lib/model-face-jobs.ts`(D)、`app/api/ai/*`(H)、`app/api/admin/*`(J)。改导出签名前先 `grep -rn "from '@/lib/billing'" app lib`。

## 改动前必读的坑
- **扣费必须原子**：预扣和落库在同一个事务里，不许拆成两步。
- **失败必须退款**：任何出图失败路径都要走到退款，新增失败分支时先确认退款也覆盖到了。
- **幂等键不能动**：改了会让重试变成重复扣费。
- 任何改动都必须跑 `npm run test:billing`，这套测试是防赔钱的。

## 测试与验收
- `npm run test:billing`
- 手工验收：`/billing` 看流水；故意让一次生成失败，余额应该回到原值。
