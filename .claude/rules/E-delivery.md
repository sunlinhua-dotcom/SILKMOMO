---
paths:
  - "lib/pending-*.ts"
  - "lib/generation-recovery.ts"
  - "lib/sse-backpressure.ts"
  - "lib/generation-idempotency.ts"
  - "app/task/**"
  - "app/api/generation/pending/**"
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
- `app/task/[id]/page.tsx` — 任务页（2400+ 行）。**按路标取段**：看门狗与补拉段在文件前部（约 110–160 行），三块结果 UI 各自成段。
- `app/api/generation/pending/route.ts`、`app/api/generation/pending/[id]/route.ts`

## 共享依赖
- 它依赖：`lib/prisma`(Z)、`lib/auth`(A)。
- 依赖它的：`app/api/generate/stream/route.ts`(B)、`app/api/admin/pending-deliveries/route.ts`(J)。

## 改动前必读的坑
- **09-04 事故的三个根因已经修好，别改回去**：① enqueue 不等于对端收到，必须等确认；② 断线重连后必须主动拉 pending；③ 重试必须带幂等键。
- **客户端看门狗常量（`STALL_BYTES_MS` 等）改小之前，必须同步核对服务端超时**（`maxDuration` 与各阶段超时）。客户端比服务端短就会误杀正常连接。
- SSE 只推 id，图片由客户端另外 GET；不要为了"省一次请求"把 base64 塞回 SSE。
- **用户遇到「连接中断」的正确处理是刷新页面，不是重新点生成**——重试会重复扣费也重复占通道。

## 测试与验收
- `npm run test:delivery`
- 手工验收：生成中途断网再恢复，任务页应自己把图补回来，不需要重新生成。
