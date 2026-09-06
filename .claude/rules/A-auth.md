---
paths:
  - "lib/auth.ts"
  - "lib/jwt-secret.ts"
  - "lib/rate-limit.ts"
  - "proxy.ts"
  - "app/api/auth/**"
  - "app/login/**"
  - "app/register/**"
---
# A 鉴权

职责：登录 / 注册 / 登出、JWT 签发与校验、把身份信息注入下游请求头。

## 文件清单（改这个板块只读这些）
- `lib/auth.ts` — 密码哈希、JWT 签发校验、从请求里取当前用户。
- `lib/jwt-secret.ts` — 密钥来源，只从环境变量读。
- `lib/rate-limit.ts` — 登录等敏感接口的限流。
- `proxy.ts` — Next 中间件：校验 cookie 里的 token，注入 `x-user-id` / `x-user-role` / `x-username`，未登录的页面重定向到 `/login`。
- `app/api/auth/login|logout|register|me/route.ts` — 四个端点。
- `app/login/page.tsx`、`app/register/page.tsx` — 表单页。

## 共享依赖
- 它依赖：`lib/prisma`（用户表）、`lib/jwt-secret`。
- 依赖它的：几乎所有 `app/api/**/route.ts` 都 import `lib/auth`（22 个文件）。改导出签名前先 `grep -rn "from '@/lib/auth'" app lib`。

## 改动前必读的坑
- **cookie 键 `silkmomo_token` 不许改名**，改了所有在线用户立刻掉登录。
- 页面鉴权靠 `proxy.ts` 重定向，API 鉴权靠各 route 自己调 `lib/auth`；只改一边会留下绕过口子。
- 密钥只走环境变量，不要写进代码或日志。

## 测试与验收
- `npm test`（本板块无独立套件，鉴权断言散在各套件里）。
- 手工验收：未登录访问 `/lookbook` 应 302/307 到 `/login`；未登录 `GET /api/model-faces` 应 401/403。
