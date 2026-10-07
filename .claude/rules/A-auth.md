---
paths:
  - "lib/auth.ts"
  - "lib/jwt-secret.ts"
  - "lib/auth-shared.ts"
  - "lib/rate-limit.ts"
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
- `lib/rate-limit.ts` — 登录等敏感接口的限流（含用户名+IP 登录锁定键 `loginLockKey`）。
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
- **`proxy.ts` 的公共 API 是精确匹配**（`lib/auth-shared.ts` 的 `PUBLIC_API_PATHS`，仅 login / register / admin/setup / health）。别改回前缀匹配，否则 `/api/auth/me` 之类会被连带放行；新增免鉴权端点必须显式加进数组并补测试。
- **登录锁定键是「用户名 + IP」**，不是单维度：只按用户名会让攻击者锁死任意账号，只按 IP 挡不住分布式撞库。别简化成一维。
- **登录密码上限 `LOGIN_PASSWORD_MAX`=1024，注册 `PASSWORD_MIN`–`PASSWORD_MAX`=8–128，两者故意不同**：登录要兼容历史上设过更长/更短密码的老账号，同时限制 bcrypt 输入防 DoS；别统一成 8–128，会把老用户锁在门外。

## 测试与验收
- `node --test __tests__/auth-hardening.test.mjs`（路径分类、next 参数、长度上限、锁定键）；全量 `npm test`。
- 手工验收：未登录访问 `/lookbook` 应 302/307 到 `/login`；未登录 `GET /api/model-faces` 应 401/403。
