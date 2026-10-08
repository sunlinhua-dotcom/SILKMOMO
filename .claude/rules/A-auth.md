---
paths:
  - "lib/auth.ts"
  - "lib/jwt-secret.ts"
  - "lib/auth-shared.ts"
  - "lib/rate-limit.ts"
  - "lib/rate-limit-store.ts"
  - "lib/token-revocation.ts"
  - "lib/token-revocation-core.ts"
  - "proxy.ts"
  - "app/api/auth/**"
  - "app/api/health/**"
  - "app/login/**"
  - "app/register/**"
  - "components/AuthShell.tsx"
---
# A 鉴权

职责：登录 / 注册 / 登出、JWT 签发与校验、把身份信息注入下游请求头。

## 文件清单（改这个板块只读这些）
- `lib/auth.ts` — 密码哈希、JWT 签发校验、从请求里取当前用户。
- `lib/jwt-secret.ts` — 密钥来源，只从环境变量读。
- `lib/auth-shared.ts` — 鉴权纯函数（无 node/next 依赖，Edge 与浏览器都能 import）：proxy 路径分类、登录后 `next` 参数校验、登录/注册入参校验与长度常量。
- `lib/rate-limit.ts` — 限流。同步版（`rateLimit` 等）是进程内内存实现，仅作 DB 出错时的回退；**登录 / 注册 / AI 聊天与分析走 `*Async` 持久化版**（含用户名+IP 登录锁定键 `loginLockKey`）。
- `lib/rate-limit-store.ts` — 持久化限流存储（表 `RateLimitCounter`，一条原子 `INSERT … ON CONFLICT DO UPDATE … RETURNING`，固定窗口，用数据库时钟）；导出 `purgeExpiredRateLimitCounters(now)`。
- `lib/token-revocation-core.ts`（纯逻辑 + 进程内缓存，可被 node:test 直接加载）/ `lib/token-revocation.ts`（接 prisma，表 `RevokedToken`）— 登出吊销；导出 `isTokenRevoked`、`revokeToken`、`purgeExpiredRevokedTokens(now)`。
- `proxy.ts` — Next 中间件：校验 cookie 里的 token，注入 `x-user-id` / `x-user-role` / `x-username`，未登录的页面重定向到 `/login`。
- `app/api/auth/login|logout|register|me/route.ts` — 四个端点。
- `app/login/page.tsx`、`app/register/page.tsx` — 表单页；`app/login|register/layout.tsx` 只放页面元数据；`components/AuthShell.tsx` 是两页共用的外壳（归属 U，但只服务这两页）。
- `app/api/health/route.ts` — 免鉴权健康检查，只做 `SELECT 1`，不回内部细节；Dockerfile 的 HEALTHCHECK 依赖它。

## 共享依赖
- 它依赖：`lib/prisma`（用户表）、`lib/jwt-secret`。
- 依赖它的：几乎所有 `app/api/**/route.ts` 都 import `lib/auth`（22 个文件）。改导出签名前先 `grep -rn "from '@/lib/auth'" app lib`。

## 改动前必读的坑
- **cookie 键 `silkmomo_token` 不许改名**，改了所有在线用户立刻掉登录。
- 页面鉴权靠 `proxy.ts` 重定向，API 鉴权靠各 route 自己调 `lib/auth`；只改一边会留下绕过口子。
- 密钥只走环境变量，不要写进代码或日志。
- **登出 = 吊销 JWT**：新签发的 token 带 `jti`；`/api/auth/logout` 把 jti 写进 `RevokedToken`（幂等）再清 cookie。检查点在 `proxy.ts`（Next 16 的 proxy 跑在 Node.js 运行时，能访问 Prisma；页面 + API 都先过它）和 `lib/auth.ts` 的 `verifyToken`（route 二次校验）；缓存：已吊销缓存到令牌过期，未吊销最多 30 秒，缓存挂在 `globalThis` 上让 proxy 与 route 两个 bundle 共享，所以本实例登出立即生效，别的实例最迟 30 秒。**不带 jti 的老 token 不查库、继续有效到自然过期**——别“修”成强制要求 jti，会把上线前登录的所有人踢下线。
- **吊销检查查库失败时 fail-open**（放行并按分钟节流打日志）：数据库抖动不能让全站 401；代价是库挂的那段时间里已登出的令牌可能被放行。别改成 fail-closed。登出写库失败时仍清 cookie，响应带 `revokeFailed: true`。
- **`/api/auth/logout` 在 proxy 里永远放行**（不走 `PUBLIC_API_PATHS`，`classifyPath` 仍判 protected）：令牌已吊销 / 过期 / 无 cookie 时重复登出（两个标签页先后点退出）否则会被挡成 401，客户端 UserNav 会误报“退出登录失败”。路由自己校验 cookie，幂等。
- **proxy 的“已登录访问 /login 跳回 /”分支也必须检查吊销**，否则被吊销的 cookie 会造成 `/login → / → /login` 死循环。
- **限流是固定窗口、持久化（多实例共享）**，DB 出错自动退回内存并按 60 秒节流告警。库里的 key 是 `scope:sha256前32位`，不存明文用户名 / IP。`admin/setup` 也已改用 `rateLimitAsync`。
- **`lib/generation-concurrency.ts` 的“每人同时最多 N 条生成”是进程内信号量，单实例假设**，故意不落库（名额随 stream 释放，落库后进程被杀会留下永不释放的名额）；多实例时上限是“每实例每人”。
- `purgeExpiredRevokedTokens` / `purgeExpiredRateLimitCounters` 是清理函数，已由 `lib/retention-tasks.ts` 经 `registerRetentionTask` 接入每日保留清理（`instrumentation.ts` 先注册再启动调度）。
- **`proxy.ts` 的公共 API 是精确匹配**（`lib/auth-shared.ts` 的 `PUBLIC_API_PATHS`，仅 login / register / admin/setup / health）。别改回前缀匹配，否则 `/api/auth/me` 之类会被连带放行；新增免鉴权端点必须显式加进数组并补测试。
- **登录锁定键是「用户名 + IP」**，不是单维度：只按用户名会让攻击者锁死任意账号，只按 IP 挡不住分布式撞库。别简化成一维。
- **登录密码上限 `LOGIN_PASSWORD_MAX`=1024，注册 `PASSWORD_MIN`–`PASSWORD_MAX`=8–128，两者故意不同**：登录要兼容历史上设过更长/更短密码的老账号，同时限制 bcrypt 输入防 DoS；别统一成 8–128，会把老用户锁在门外。

## 测试与验收
- `node --test __tests__/auth-hardening.test.mjs`（路径分类、next 参数、长度上限、锁定键）；`__tests__/token-revocation*.test.mjs`（吊销缓存 / fail-open / 幂等 / 清理；真实 proxy.ts 的 401 与跳登录）；`__tests__/rate-limit-persistent.test.mjs`（固定窗口、重置、DB 出错回退内存）；全量 `npm test`。
- 手工验收：未登录访问 `/lookbook` 应 302/307 到 `/login`；未登录 `GET /api/model-faces` 应 401/403。
