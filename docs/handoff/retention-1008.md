# 数据保留清理与管理员充值幂等（1008）

实现：`lib/retention.ts`（清理）、`lib/admin-recharge-core.ts`（充值幂等），启动入口 `instrumentation.ts`。
测试：`__tests__/retention.test.mjs`、`__tests__/admin-recharge.test.mjs`（纯本地，随 `npm test`）；
`__tests__/retention-db.test.mjs` 打真实 PostgreSQL，默认跳过。

## 一、数据保留策略

| 数据 | 策略 |
| --- | --- |
| `GenerationRecord` | 删除 `createdAt` 早于 `GENERATION_RECORD_RETENTION_DAYS`（默认 **365**）天，**且** `rating = 0`、`feedback` 为空、`feedbackTags` 为 `[]` 的行。有用户评价或文字反馈/标签的永久保留。 |
| `ModelFaceGenerationJob` | 删除 `status` 为 `completed`/`failed`、`finishedAt` 早于 `MODEL_FACE_JOB_RETENTION_DAYS`（默认 **30**）天，**且**其所有 item 的 `billingStatus` 都是终态（`uncharged` / `refunded` / `kept`）的 job；item 随 job 级联删除。 |
| `Transaction` | **永不删除**（账务）。 |
| `ModelFace` | **永不删除**（用户资产）。item→face 的外键是 `ON DELETE SET NULL`，且方向是 item 指向 face，删 job/item 不会碰脸图。 |
| `PendingImage` | 已有 TTL（`lib/pending-image.ts`，由计费清扫调用），本任务不重复处理。 |

细节：

- 边界是严格小于：恰好等于保留天数的行不删，早 1 毫秒的才删。
- `charged` 与 `refund_pending` **不是**终态：`refund_pending` 是明确的待退款；`charged` 在 job 已结束时会被退款扫描（`retryPendingModelFaceRefunds`）重新接管。只要 job 下有一条这样的 item，整个 job 保留。`finishedAt` 为空的 job（含 `running`/`queued`）也不删。
- 删除前后各带一遍保留条件（先列 id，再按 `id IN (...) AND 保留条件` 删），防止列出与删除之间用户刚好评了分、或 job 又出现了待退款 item。
- 与 `lib/billing-reconcile.ts` 的关系：孤儿对账的 `hasSuccessRecord` 只查「扣费后 20 分钟窗口内」的成功 `GenerationRecord`，365 天保留期远大于该窗口，互不影响。若把 `GENERATION_RECORD_RETENTION_DAYS` 调得很小，务必先回看那里。
- 副作用：`getQualityAnalytics`（后台质量分析）统计的是现存 `GenerationRecord`，超过 365 天且未评分的历史成功/失败计数不再出现在统计里；评分/反馈数据不受影响。

## 二、运行方式

- 启动 10 分钟后首跑，之后每 24 小时一次（进程内定时器，`unref`，不阻止进程退出）。
- 多实例：用 PostgreSQL advisory lock 互斥，键 `7300100801`。用的是事务级 `pg_try_advisory_xact_lock`，不是会话级 `pg_try_advisory_lock`——Prisma 走连接池，会话级锁和解锁不保证落在同一条连接，会泄漏成永久锁；事务级锁随「租约事务」结束（含进程被杀、连接断开）自动释放。租约事务只持锁、不做删除，每批前做一次 `SELECT 1` 心跳，租约丢失则中止本轮。抢不到锁的实例打一行 `skipped_lock_held` 后跳过。
- 分批：每批 ≤ 500 行，批间停顿 50ms 让出事件循环；单轮最长 50 分钟，到点停止，剩下的留给下一轮。
- 日志：每轮一行汇总，形如 `[retention] done {"dryRun":false,"generationRecord":123,"modelFaceJob":4,"durationMs":812}`；启动时一行 `[retention] scheduled {...}`。某个任务出错只记入汇总的 `errors`，不影响其它任务。
- 其它模块接入：`registerRetentionTask(name, fn)`（`lib/retention.ts`）。`fn(ctx)` 自己分批，用 `ctx.dryRun` 判断是否只统计，返回删除（dry-run 为将删除）行数；同名注册会覆盖。注册表挂在 `globalThis` 上，instrumentation 与路由是不同 bundle 也共享。

## 三、环境变量与关闭方法

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `RETENTION_DISABLED=1` | 完全关闭（不调度、不删除）。**紧急刹车用这个**，重启生效。 | 关 |
| `RETENTION_DRY_RUN=1` | 只统计不删除，日志里 `dryRun:true`、数字是「将删除」行数。上线前建议先开一天看数字。 | 关 |
| `GENERATION_RECORD_RETENTION_DAYS` | `GenerationRecord` 保留天数（≥1 的整数，非法值回退默认并告警） | 365 |
| `MODEL_FACE_JOB_RETENTION_DAYS` | 脸库任务保留天数（同上） | 30 |
| `RETENTION_FIRST_RUN_DELAY_MS` / `RETENTION_INTERVAL_MS` | 仅联调验证用，缩短首跑延时 / 间隔；生产保持默认 | 600000 / 86400000 |

建议上线顺序：先带 `RETENTION_DRY_RUN=1` 部署，观察一轮汇总日志的数字符合预期，再去掉该变量。

## 四、管理员充值幂等

- 前端（`app/admin/page.tsx`）每次「用户 + 金额」意图生成一个 `requestId`（`crypto.randomUUID()`，非安全上下文回退到 `getRandomValues`）；同一意图的重试（超时/网络错误后再点确认）复用同一个；成功、关闭弹窗、换用户或金额后换新的。
- 服务端（`POST /api/admin/users`）把 `admin-recharge:<requestId>` 写进 `Transaction.idempotencyKey`（@unique）。加余额 + 写流水在同一个事务里；事务内先查键，命中直接回第一次的结果；并发时唯一索引决出胜者，败者事务整体回滚（余额增量一并丢弃）。响应：`{ success: true, balanceAfter, duplicate: true }`，HTTP 200，`balanceAfter` 是第一次入账后的余额快照。
- `requestId` 格式非法 → 400；同一个 `requestId` 对应的旧流水属于另一个用户或另一个金额 → 409（`conflict: true`），不会悄悄返回成功。
- 没带 `requestId` 的老请求行为同旧版（不幂等），但打 `[admin-recharge] 请求未带 requestId` 告警。看到这条告警说明还有调用方没升级。
- 回滚：幂等键只是 `Transaction.idempotencyKey` 的一个取值前缀，不涉及表结构；回退代码后遗留的流水行无副作用。

## 五、验证记录

见本次提交说明与回报：单测（`npm test`）、真库测试（临时库 `silkmomo_scratch_t3`，验完删除）、本地生产构建（端口 4713）手测充值重放与启动日志。
