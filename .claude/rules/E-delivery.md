---
paths:
  - "lib/pending-*.ts"
  - "lib/generation-recovery.ts"
  - "lib/sse-backpressure.ts"
  - "lib/generation-idempotency.ts"
  - "app/task/**"
  - "app/tasks/**"
  - "components/task/**"
  - "components/TaskList.tsx"
  - "hooks/useTaskGeneration.ts"
  - "lib/task-page-helpers.ts"
  - "app/api/generation/pending/**"
  - "app/api/generation/by-task/**"
  - "app/api/generation/feedback/**"
  - "lib/billing-reconcile.ts"
---
# E 交付与补拉

职责：SSE 把结果交付到前端、pending 图片入库、断线后的补拉与客户端看门狗。

## 文件清单（改这个板块只读这些）
- `lib/pending-image.ts` — pending 图片入库与取出。
- `lib/pending-delivery-core.ts` — 交付状态机核心。
- `lib/pending-fetch.ts` — 客户端补拉。
- `lib/generation-recovery.ts` — 断线恢复。
- `lib/sse-backpressure.ts` — SSE 背压。
- `lib/generation-idempotency.ts` — 重试幂等键。
- `app/task/[id]/page.tsx` — 任务页壳（约 580 行）：只留页面状态、`loadTaskData`、费用/余额口径、autostart 与各组件的拼装，**不再有大段业务**。
- `hooks/useTaskGeneration.ts` — 生成控制器（从页面原样搬出，约 1300 行）：SSE 流式生成 `handleStartGeneration`（全量/试生成/剩余/单图重做统一入口）、取消、调整参数重做、单张重做、保留/还原新旧版本、AI 触发整任务重做、断线自动补齐。**按路标取段**：`grep -n "===== \[" hooks/useTaskGeneration.ts`（`[E] SSE 流式生成` 段内再按「分块生成 / 读取 SSE 流 / 统一定稿」注释定位）。各类同步锁 ref（`startLockRef` 等）都在这里。
- `lib/pending-recovery.ts` — 看门狗常量（`STALL_BYTES_MS` / `STALL_EVENT_MS`）与补拉 `recoverPendingImages`（带 `[E] 看门狗与补拉` 路标）、锚图压缩 `toCompressedAnchor`、`fetchPendingImage` / `releasePendingImage`。
- `lib/task-page-helpers.ts` — 任务页纯函数/类型：错误文案、`backupMatchesImage`、`buildProductGroupsFromImages`、`parseSelectedShots`、`formatYuan` 等。
- `hooks/useLeaveGuard.ts` + `lib/leave-guard.ts` — 生成中离开拦截（归 U，任务页接入）。
- `app/tasks/page.tsx` + `components/TaskList.tsx` — 任务列表（数据来自 I 板块的 `lib/recent-tasks.ts`）。
- `lib/billing-reconcile.ts` — 孤儿扣费清扫（归 F，交叉提及：它与 pending 交付共用「是否已交付」的判据，同时顺带清理过期 pending 交接图）。
- `app/api/generation/by-task/[taskId]/route.ts`、`app/api/generation/feedback/route.ts`
- `app/api/generation/pending/route.ts`、`app/api/generation/pending/[id]/route.ts`

## 共享依赖
- 它依赖：`lib/prisma`(Z)、`lib/auth`(A)。
- 依赖它的：`app/api/generate/stream/route.ts`(B)、`app/api/admin/pending-deliveries/route.ts`(J)。

## 改动前必读的坑
- **09-04 事故的三个根因已经修好，别改回去**：① enqueue 不等于对端收到，必须等确认；② 断线重连后必须主动拉 pending；③ 重试必须带幂等键。
- **客户端看门狗常量（`STALL_BYTES_MS` 等）改小之前，必须同步核对服务端超时**（`maxDuration` 与各阶段超时）。客户端比服务端短就会误杀正常连接。
- SSE 只推 id，图片由客户端另外 GET；不要为了"省一次请求"把 base64 塞回 SSE。
- **pending 已落库即视为交付，不退款**：出图结果一旦写入 pending，即使 SSE 后面断了、客户端没收到，也算服务端履约（`Transaction.fulfilledAt` 随之写入，见 F）；用户靠补拉取图。别在「后续步骤失败」的分支里把已落 pending 的镜次退款，否则用户既拿到图又拿回钱。
- **客户端补拉遇到同镜次已有结果时必须比对内容，不能直接删/覆盖**：用户可能已为这个镜次付费重出了新图，旧补拉不能把新付费图误删（7352899 修过）。比对不一致时保留较新的，并让用户可见。
- **用户遇到「连接中断」的正确处理是刷新页面，不是重新点生成**——重试会重复扣费也重复占通道。

## 测试与验收
- `npm run test:delivery`（任务页 `components/task/**` 的纯 UI 改动另跑 `npm run build` 或 `npx tsc --noEmit` 即可）
- 手工验收：生成中途断网再恢复，任务页应自己把图补回来，不需要重新生成。
