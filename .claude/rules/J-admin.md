---
paths:
  - "app/admin/**"
  - "app/api/admin/**"
  - "components/FailureHistoryPanel.tsx"
---
# J 管理后台

职责：用户管理、用量统计、失败与 pending 交付的运维视图。

## 文件清单（改这个板块只读这些）
- `app/admin/page.tsx` — 后台首页。
- `app/admin/failures/`、`app/admin/pending-deliveries/` — 两个运维视图。
- `app/api/admin/users|stats|analytics|failures|pending-deliveries|setup/route.ts`
- `components/FailureHistoryPanel.tsx`
- `app/admin/layout.tsx` — 后台外层布局（页面元数据）。

- 充值接口 `POST /api/admin/users` 现在要求（新前端必带）`requestId`（UUID，`crypto.randomUUID()`），服务端据此幂等；弹窗里「同一用户 + 同一金额」的重试复用同一个 requestId，成功/关闭弹窗后清掉。响应可能带 `duplicate: true`（重复提交，未再加钱，此时 `balanceAfter` 是第一次入账后的快照，前端会重拉列表）。

## 共享依赖
- 它依赖：`lib/auth`(A)、`lib/prisma`(Z)、`lib/billing`(F)、`lib/pending-image`(E)。
- 依赖它的：无。

## 改动前必读的坑
- 每个 admin 端点都要单独校验 role，别指望 `proxy.ts` 挡住 API。
- `app/api/admin/setup/route.ts` 是初始化端点，动它之前先确认线上已经不再需要。
- 统计口径改了会让历史数字对不上，改之前先想清楚是不是真的算错了。

## 测试与验收
- `npm test`（充值幂等：`__tests__/admin-recharge.test.mjs`）
- 手工验收：用管理员账号打开 `/admin`，三个视图都能出数据；普通账号访问应被拒。
