# 1008 大改总览（分支 feat/overhaul-1008，基线 07daced）

范围：115 个文件、+10211 / -4855，共 16 个提交。UI 底座用法见 `ui-kit-1008.md`，数据库回滚 SQL 见 `rollback-1008.sql`。

## 按板块的改动（改了什么 / 为什么）

**A 鉴权**
- `lib/auth-shared.ts`（新）把路径分类、`next` 参数校验、入参校验抽成无依赖纯函数 / 让 Edge 与单测都能用。
- `proxy.ts` 公共 API 改精确匹配 / 前缀匹配会连带放行 `/api/auth/me` 等。
- 登录锁定改为用户名 + IP 双维、登录密码上限 1024 与注册 8–128 分开 / 防锁死别人账号又兼容老账号。
- 新增 `/api/health`（只 `SELECT 1`）/ 给容器健康检查用。登录后回到原页面、错误分类可读。

**B 主出图**
- `lib/generation-concurrency.ts`（新）每人在途流上限（默认 3）与请求体上限（64MiB）/ 防单用户占满通道、防恶意大体。
- 上游错误原文脱敏，只进 detail 与日志 / 避免泄露通道细节。参考图并发归一化 + LRU / 提速。
- 删死代码 `app/actions/generate.ts`、`lib/styles.ts`。

**C 组图换装**：准备失败可见并回滚本地项目；再出 3 张先确认费用并防连点；尺寸校验；脸库操作 40px 可达 / 防误扣费与卡死。

**D 脸库**：仅 UI 可达性调整（40px 点击区），无逻辑变更。

**E 交付与补拉**
- 任务页拆出 `components/task/*`（计时器独立 / 不再每秒整页重渲染）；每个花钱按钮标价、autostart 只跑一次、AI 重做先确认、真实预计时长。
- 补拉同镜次已有结果时比对内容 / 之前会误删用户新付费的图。
- 任务列表触屏常显操作、Enter 不误跳转、加载失败与空态分开、删除先确认。

**F 计费**
- `Transaction.fulfilledAt` 履约标记 / 堵住同 runId 重放免费出图，交付后不再误退款。
- `lib/billing-reconcile.ts`（新）孤儿扣费每 5 分钟清扫，退款前查 pending 与成功记录 / 进程在扣费后被杀时钱不悬空。
- 余额三态、计费规则说明、流水正负号。

**G 提示词**：无变更（快照测试未动）。

**H AI 助手**：输入法选词回车不再误发、AI 错误可见、触发先确认费用。

**I 客户端存储**：`lib/recent-tasks.ts`（新）统一最近任务查询；上传失败 / 超限 / 存储已满明确提示；图库计数不再整库读 base64；图库弹层键盘可达。

**J 管理后台**：充值弹窗错误可见、金额与套餐同源、防双击；用户分页与搜索防抖；失败页总数与引擎派生。

**K 品牌记忆**：品牌档案读失败时禁止保存 / 防把空档案覆盖真数据。

**U 共享 UI 底座（本轮新开板块）**：设计 token 与对比度修正、`components/ui/*`（Modal / ConfirmDialog / Toast / PageHeader）、`app/providers.tsx`、`useRadioGroup`、`useBalance`、`lib/contact`、`lib/format-time`；单选组 radiogroup 方向键、多选 aria-pressed、灯箱翻页与焦点归还。新开理由：这批文件被所有页面共用且此前无规则覆盖。删除 `FeedbackWidget` / `PromptEditor` / `StyleSelector` / `app/logo-preview`。

**Z 数据与部署**
- 迁移 `20261008000000_billing_fulfillment_and_indexes`：加 `fulfilledAt`、回填历史 consume、调整索引；`PG_POOL_MAX` 可配。
- Dockerfile：剪 dev 依赖、以非 root `node` 运行、`exec node` 做主进程收 SIGTERM、加 HEALTHCHECK；CSP 收紧，生产不再有 `unsafe-eval`。

## 提交号（新 → 旧）
```
7352899 ux(task)       每个花钱按钮标价、autostart 只跑一次、AI 重做先确认、真实预计时长、计时器拆小组件；修补拉误删新付费图
1691a3a ux(lookbook)   准备失败可见且回滚、再出 3 张先确认费用并防连点、尺寸校验、脸库操作 40px
704db12 fix(billing)!  堵住同 runId 重放免费出图；交付后不再误退款；孤儿扣费自动对账
875018b ux(tasks)      任务操作触屏常显、Enter 不误跳转、加载失败与空态分开、删除先确认
d691661 a11y(selectors) 单选组 radiogroup + 方向键、多选 aria-pressed；风格包弹窗改 Modal
9cb8da3 ux(upload)     上传失败 / 超限 / 存储已满提示；图库计数不整库读 base64
58c1701 ux(home)       快速生成直接开跑、余额三态、防重复建任务、AI 触发先确认费用
5a7b06a ux(gallery)    结果图操作触屏常显、灯箱翻页 / 滑动 / 焦点归还；打包库按需加载
09b5d60 ux(auth)       登录后回原页面、错误分类可读、注册规则常驻、新用户充值引导
224a032 ux(chat,nav)   输入法回车不误发、AI 错误可见、底栏让位 CTA；导航余额共享
0ec552f ux(admin)      充值弹窗错误可见、金额与套餐同源、防双击；用户分页与搜索防抖
bb8dac9 ux(billing,brand) 余额三态、计费规则说明、流水正负号；品牌读失败禁止保存
0e9165f build          镜像剪 dev 依赖、非 root、健康检查；CSP 收紧
3128f5e perf(image)    参考图并发归一化 + LRU、上游错误脱敏、删死代码
f202531 ui             设计 token、对比度修正与共享组件底座
c746315 security       鉴权与 API 加固
```

## 部署：镜像与健康检查（T6）

**镜像瘦身**：runner 阶段不再带整份生产 `node_modules`。现在只有 Next standalone（自带 tracing 出的最小 `node_modules`，含 sharp 的 `linuxmusl-x64` 二进制）、`.next/static`、`public`，加一个独立的 `/app/prisma-cli/`（只含 `prisma migrate deploy` 需要的依赖闭包、迁移文件和 `prisma.config.ts`）。`linux/amd64` 实测镜像占用：改前 1.37 GB（压缩后内容约 298 MB），改后 356 MB（压缩后内容约 84 MB）。目标 300MB 量级里基础镜像 `node:20-alpine` 自己就占约 193MB，剩下的 163MB 是服务本体（约 40MB）和 prisma CLI（约 70MB，其中仅 `schema-engine` 二进制就有 21MB）。

**Prisma 版本锁定**：`package.json` 里 `prisma`、`@prisma/client`、`@prisma/adapter-pg`、`@prisma/adapter-better-sqlite3` 都改为精确版本（无 `^`），`package-lock.json` 解析版本不变（7.6.0 / 7.6.0 / 7.6.0 / 7.7.0）。runner 里的 CLI 就是 lock 里的这一份，不会在构建时联网重新解析。

**部署前后要注意**：
- 容器里不再有 `/app/prisma`、`/app/node_modules/.bin/prisma`。需要在线上容器手动跑迁移时：`cd /app/prisma-cli && node node_modules/prisma/build/index.js migrate deploy`。
- 启动流程不变：先 `migrate deploy`，成功后 `exec node server.js`，以非 root `node` 运行，`docker stop` 能在 1 秒内优雅退出（收到 SIGTERM，退出码 0）。
- 迁移 `20261008000000_billing_fulfillment_and_indexes` 在空库上随容器启动自动应用成功（见回报里的验证记录）。

**Zeabur 健康检查（联网查文档，2026-10-08）**：
- Zeabur 官方《Health Checks》文档**没有**提到会读取 Dockerfile 的 `HEALTHCHECK`，也没写可以用 `zbpack.json` 或其它仓库内配置文件设置健康检查；按文档理解，文档对 Dockerfile 的 `HEALTHCHECK` 是否生效没有说明，不要指望它决定是否切流量。
- Zeabur 默认是 **TCP 端口探测**（间隔 10 秒、超时 5 秒、连续失败 3 次判不健康）。新部署通过探测才会切流量，不通过则旧部署继续服务。对本应用，端口一监听就算通过，**此时数据库迁移已完成**（迁移在 `node server.js` 之前），所以默认 TCP 探测已经能保证“迁移失败 = 新版本不上线”。
- 想让 Zeabur 探 `/api/health`（同时确认数据库可连），只能在控制台配，仓库里无法配置：服务 → **Settings（设置）** → **Health Check（健康检查）** 栏 → 路径填 `/api/health` → 保存后重新部署。接口返回 2xx 视为健康（本应用库不通时返回 503）。应用已按 Zeabur 要求监听 `0.0.0.0:$PORT`（`HOSTNAME=0.0.0.0`，PORT 缺省 8080）。
- 取舍：HTTP 探测把“数据库偶发不通”也算成不健康，可能让一次短暂的库抖动延长发布时间；没有强需求可以保持默认 TCP 探测。
- 文档：<https://zeabur.com/docs/en-US/operations/monitoring/health-checks>（中文版 <https://zeabur.com/docs/zh-CN/operations/monitoring/health-checks>）。

## 回滚方式
1. **代码**：回到基线 `07daced`（部署该 commit 或在主干上 revert 本分支合并提交）。**先回滚代码，再回滚数据库。**
2. **数据库**：执行 `docs/handoff/rollback-1008.sql`（一个事务：恢复被删索引、删除新增索引、`DROP COLUMN "fulfilledAt"`），然后按文件头注释删除 `_prisma_migrations` 里 `20261008000000_billing_fulfillment_and_indexes` 这条记录，否则以后 `migrate deploy` 会误以为已应用。
3. **为什么这个顺序、为什么安全**：旧代码不读写 `fulfilledAt`，该列留着对旧代码无影响，所以代码回滚后库可以晚点再回滚，甚至不回滚。反过来先删列再跑新代码会直接报错。若只想保留履约标记，只执行 SQL 的索引部分即可。
4. **再次前滚**：重新部署新代码时 `migrate deploy` 会重跑迁移并再次回填 `fulfilledAt = createdAt`，回滚期间产生的 consume 也会被当作已履约。
5. 回滚会放回「同 runId 重放可免费出图」「孤儿扣费不清扫」的旧行为，仅在新版本出现无法热修的问题时使用。
