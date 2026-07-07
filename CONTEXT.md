# SILXINE 项目上下文 + 历史对话归档

> 产品名 **SILXINE**(silxine.com);仓库与内部存储键沿用代号 **SILKMOMO**,严禁重命名存储键 / 库名 / cookie 名(改名会丢用户本地数据、掉登录)。
>
> 本文档两部分:**第一部分** 是程序结构与协作约定(AI 会话入口);**第二部分** 是本项目全部历史 Claude 会话的归纳。
> 由 AI 于 2026-06-30 汇总;对话归档数据来源见 [§7 归档说明](#7-归档说明数据来源与口径)。

---

## 1. 项目速览

- **一句话**:面向丝绸 / 服饰品牌的 AI 生图工作台 —— 上传产品图,一键生成电商产品图组与生活方式场景图,内置品牌风格记忆、批量输出、按次计费与管理后台。
- **线上环境**:https://silkmomo.digirepub.com (Zeabur,推送 `main` 自动部署)。
- **技术栈**:Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4;服务端 PostgreSQL + Prisma 7;客户端 Dexie / IndexedDB + localStorage;认证用 jose JWT (HttpOnly Cookie) + bcryptjs;上游 AI 走 apiyi 网关(Gemini 系列 + GPT Image 系列)。
- **生图引擎**:Gemini Flash Image(快,约 15~30 秒 / 张,默认)/ GPT Image 2(慢,约 75~235 秒 / 张,面料质感强)。
- **AI 聊天助手**:主通道 DeepSeek `deepseek-v4-pro`(未配 `DEEPSEEK_API_KEY` 时自动回退 Gemini Lite);产品图分析 / 质量评分仍走 Gemini Lite(需视觉)。

### 关键运行命令
- 开发服务:`npm run dev`,默认端口 `4605`。
- 构建检查:`npm run build`;Lint:`npm run lint`;类型:`npx tsc --noEmit`。

### 关键约束(防止代码长歪)
- 新页面 / 接口放 `app/`,可复用 UI 放 `components/`,纯逻辑放 `lib/`;**`lib/` 内不得 import `components/`**。
- 品牌展示一律用 **SILXINE**;`silkmomo_*` 存储键、`SilkMomoDB` 库名、`silkmomo_token` cookie 名是历史代号,**严禁改名**。
- 涉及扣费的代码必须保证:**原子扣减、失败退款、退款失败留日志**。
- 服务端密钥只通过环境变量读取,严禁写进代码或文档;错误信息外发前脱敏。
- 本地端口固定 `4605`;对外文案使用简体中文;大文件素材放 `refs/`(已 gitignore)。

### 文档写作约定
- 里程碑 / 阶段性结果 → 追加到 `docs/PROGRESS.md`。
- 新踩的坑与修复 → 追加到 `docs/BUGS.md`(未决放上方,修复后移入归档)。
- 过程性会话日志 → 追加到 `docs/LOG.md`(本地文件,不入库)。

---

## 2. 程序结构总览

SILXINE 整体分两条数据线:**服务端** 用 PostgreSQL + Prisma 存用户、计费流水、品牌档案、生成记录(本地开发可走 SQLite 适配器);**客户端** 用 Dexie / IndexedDB 存任务与图片、localStorage 存时光机快照。认证走 jose 签发的 JWT(HttpOnly Cookie `silkmomo_token`)+ bcryptjs,路由保护在根目录 `proxy.ts`(Next.js middleware)里完成,区分公开页 / 受保护页 / 管理员页,并把用户身份注入请求头给下游 handler。

核心业务是生图:前端在 `app/page.tsx` 组装参数后 POST 到 `/api/generate/stream`(SSE 流式接口),该接口逐张「检查余额 → 原子扣费 → 调上游生图 → 失败 / 断连自动退款 → 记录到 Postgres」,上游通过 `lib/image-backends.ts` 双通道(Gemini / GPT)统一走 apiyi 网关。

### 目录结构

| 目录 | 职责 | 关键文件 |
|---|---|---|
| `app/` | App Router 页面 | `page.tsx`(主工作台,约 1,125 行,参数组装与 SSE 生图发起)、`task/[id]/page.tsx`(任务详情,约 1,531 行,SSE 生成 / 重做 / 对比备份)、`tasks/page.tsx`、`billing/page.tsx`、`brand/page.tsx`、`admin/page.tsx`、`admin/failures/page.tsx`、`login` / `register` / `logo-preview`、`layout.tsx` / `globals.css` / `icon.svg` |
| `app/api/` | 服务端接口 | 见下方 [API 路由](#api-路由16-条) |
| `app/actions/` | Server Actions(基本废弃) | `generate.ts` —— 旧生图 Action,因资金安全 bug 改为返回失败提示的 stub,改走 SSE 接口 |
| `components/` | 可复用 UI(25 个) | `ImageUploader`、`ProductShotModule` / `SceneShotModule`、`EngineSelector`、`ModelSelector` / `ModelQuickPicker` / `BodyTypeSelector` / `SkinToneSelector` / `StyleSelector`、`ResultGallery`、`BatchOutputMatrix`、`TaskList`、`AIChatBox`、`FeedbackWidget`、`ImageLibraryPicker` / `ImageLightbox`、`TimeMachine`、`StylePackManager`、`RecentProjectsStrip` / `UserNav` / `Logo` / `PromptEditor`、`ModelIcons` / `StyleIcons` / `FailureHistoryPanel` |
| `lib/` | 纯业务逻辑(17 个) | `api.ts`(prompt 构建)、`image-backends.ts`(双通道生图,超时 / 重试 / 模型归因)、`billing.ts` + `billing-constants.ts`(原子扣费 / 退款 / 充值)、`auth.ts` + `jwt-secret.ts`、`prisma.ts`、`db.ts`(Dexie `SilkMomoDB`,4 版迁移)、`image-library.ts`、`image-compressor.ts`、`client-session.ts`、`brand-memory.ts`、`generation-record.ts`、`ai-assistant.ts`、`models.ts`、`styles.ts`、`rate-limit.ts` |
| `hooks/` | React hooks | `useBrandMemory.ts`、`useProductAnalysis.ts` |
| `prisma/` | 数据库 schema 与迁移 | `schema.prisma`(5 张表)、`migrations/`(3 个迁移) |
| `scripts/` | 运维脚本 | `backup-db.sh` / `restore-db.sh`、`com.silxine.backup.plist`(launchd 定时)、`seed-brand.js` |
| 根目录 | 配置与中间件 | `proxy.ts`(路由保护 + JWT 校验 + API 返 401 JSON 防 SSE 卡死 + 注入身份头)、`next.config.ts`、`Dockerfile`、`README.md`、`docs/`、`refs/`(不入库) |

### 数据模型(`prisma/schema.prisma`,5 张表)
- **User** —— 用户名登录、bcrypt 密码哈希、角色(user / admin)、余额(`balanceFen` 分),关联交易 / 品牌档案 / 生成记录。
- **Transaction** —— 交易流水(Ledger 模式):`type`(recharge / consume / refund / bonus)、`amountFen`(正入账负扣费)、交易后余额快照,关联 `userId` / `projectId`。
- **BrandProfile** —— 品牌 DNA 记忆:模特 / 体型 / 肤色偏好、光影 / 背景 / 调色板、prompt 后缀、默认模块 / 比例 / 引擎,按 `userId` 归属。
- **GenerationRecord** —— 生成记录 + 反馈:模块 / 镜次 / promptHash / 参数快照、成功与否、API 耗时、错误信息、用户评分 / 标签 / 是否下载,关联 `userId` 与前端 `taskId`。
- **SystemConfig** —— 系统配置键值表;schema 已定义但当前代码未实际引用,属预留。

### API 路由(16 条)
- `POST /api/generate/stream` —— **核心 SSE 流式生图**:逐张检查余额 / 原子扣费 / 调上游 / 失败或断连退款 / 记录(约 657 行,资金安全主路径)。
- `POST /api/auth/login`(时序防枚举 + 用户与 IP 锁定)、`POST /api/auth/register`(IP 每小时限流)、`POST /api/auth/logout`、`GET /api/auth/me`。
- `POST /api/ai/analyze`(Flash Lite 产品图分析,按次扣费)、`POST /api/ai/chat`(DeepSeek 主 / Gemini Lite 回退,可返回参数联动动作)。
- `GET /api/billing/transactions`(消费流水分页)、`GET|PUT /api/brand`(品牌档案)。
- `POST /api/generation/feedback`、`GET /api/generation/by-task/[taskId]`。
- `POST /api/admin/setup`(常量时间校验 `ADMIN_SETUP_KEY`)、`GET /api/admin/stats|users|analytics|failures`(均走 `requireAdmin`)。

### 数据存储
- **PostgreSQL**(线上,pg 适配器)/ **SQLite**(本地,`DATABASE_URL` 以 `file:` 开头时启用,better-sqlite3)—— 同 schema 五张表。
- **IndexedDB / Dexie**(库名 `SilkMomoDB`,不可改):`projects`(任务)/ `images`(结果与备份)/ `stylePacks` / `libraryImages`。
- **localStorage**:`silkmomo_time_machine`(时光机快照,仅 64px 缩略图)、`silkmomo_image_library`(旧图库,已迁 IndexedDB)、`silkmomo_active_username`、`luxury_pack_init`。
- **Cookie**:`silkmomo_token`(HttpOnly JWT,7 天,不可改名)。
- **进程内内存**:rate-limit 限流桶(重启即清空)。

### 环境变量(脱敏)
| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | 数据库连接串(`file:` 开头走 SQLite,否则 PostgreSQL;兼容 `POSTGRES_URL` 等别名) |
| `GEMINI_API_KEY` | ✅ | apiyi 主令牌:Gemini 生图 + AI 分析 / 聊天回退 |
| `JWT_SECRET` | ✅ | JWT 签名密钥(生产强制设置) |
| `ADMIN_SETUP_KEY` | ✅ | 管理员初始化接口安装密钥 |
| `OPENAI_IMAGE_API_KEY` | 可选 | GPT 图像通道独立令牌(不配回退主令牌) |
| `OPENAI_IMAGE_MODEL` | 可选 | GPT 模型名(独立令牌默认 `gpt-image-2`,否则 `gpt-image-2-all`) |
| `IMAGE_BACKEND` | 可选 | 默认引擎(`gemini` / `openai`) |
| `GEMINI_BASE_URL` | 可选 | 上游网关地址(默认 `api.apiyi.com`) |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_CHAT_MODEL` / `DEEPSEEK_BASE_URL` | 可选 | AI 聊天主通道(默认模型 `deepseek-v4-pro`,默认地址 `api.deepseek.com`) |
| `PORT` | 可选 | 生产启动端口(默认 4605) |

---

## 3. 历史对话归档

本项目共有 **7 次** Claude Code 会话(转录存于 `~/.claude/projects/-Volumes-ProjectsAPFS-SILKMOMO/`)。下表按时间正序;详情见各小节。

| # | 日期 | 主题 | 产出 / 状态 |
|---|---|---|---|
| [3.1](#31-2026-05-19--拒绝去除-ai-水印-来源凭证) | 2026-05-19 | 去除 AI 水印 / C2PA 来源凭证以规避平台 AI 标识 | 三次拒绝,无代码改动 |
| [3.2](#32-2026-05-27--逐行审计修-5-类数据丢失-吞钱-断流-bug) | 2026-05-27 | 逐行审计 + 修 5 类数据丢失 / 吞钱 / 断流 bug | 本地修复 + 静态验证,未提交 |
| [3.3](#33-2026-05-28--对-gemini-改的-ui-做高强度-code-review-修-15-bug) | 2026-05-28 | 对 Gemini 改的 UI 做高强度 Code Review | 审出并修 15 个 bug,未提交 |
| [3.4](#34-2026-05-28--排查线上生图卡死未定位根因) | 2026-05-28~29 | 排查线上生图「一直转圈」卡死 | 代码侧排查无果,停在等现场信息 |
| [3.5](#35-2026-06-11--全量除虫上线--慢-key-根因--更名-silxine--deepseek) | 2026-06-11~12 | 全量除虫上线 + 卡死根因(慢 key)+ 更名 + DeepSeek | 约 40 项 bug 上线,根因解决,品牌更名 |
| [3.6](#36-2026-06-23--全流程回归--修-gpt-image-2--进度条上线) | 2026-06-23~27 | 全流程端到端回归 + 修 GPT Image 2 + 进度条 | 多批修复推上线,最新 `188bf93` |
| [3.7](#37-2026-06-28--把所有对话归纳进-contextmd本次任务) | 2026-06-28~30 | 把所有对话归纳进 context.MD(本任务) | 见本文件 |

---

### 3.1 2026-05-19 — 拒绝去除 AI 水印 / 来源凭证

**用户目标**:让生成图发布后不被识别为「AI 生成」,要求去掉 Gemini 的 SynthID 不可见水印和 GPT Image 2 PNG 元数据里的 C2PA 来源凭证,并联网搜 GitHub 找「最优解」。

**经过**:约 5 分钟的纯对话(3 轮提问 / 3 轮回复,全程未调用任何工具)。助手三次拒绝:
1. 以国内《人工智能生成合成内容标识办法》(2025-09 生效)要求显式 + 隐式标识为由拒绝,给出合法替代方向。
2. 用户称非中国用户、不在国内发布;助手指出这不是地域合规问题而是 **与模型提供方的合同(TOS)** 问题 —— 剥离 C2PA 违反 OpenAI 政策、规避 SynthID 违反 Google Gemini API TOS,后果是封号 / 封 key。
3. 用户称不能换模型;助手拒绝搜索或提供任何 stripping / washing / 对抗扰动方案,定性为内容来源欺骗,并指出平台识别已不只依赖水印(还靠判别模型 + 账号历史 + 图像统计特征)。

**结论**:无代码改动。用户核心诉求未被满足。助手建议的合法路线 —— 明示 AI 标签、AI 草图 → 打样实拍替换、改用无强制水印且 TOS 允许的自托管开源模型(FLUX.1 / SDXL / Qwen-Image)。

---

### 3.2 2026-05-27 — 逐行审计,修 5 类数据丢失 / 吞钱 / 断流 bug

**用户目标**:对整个项目做系统性代码审查,逐行读代码、聚焦用户实际会遇到的功能 bug,然后修复;附带一份 5 大项 UX 优化计划。

**做了什么**:
- 先做快速审计,按严重性报告 11 项问题(Gemini API Key 提交进 Git、扣费非原子、`recordGeneration` 错误静默、分页无上界、admin/failures 未二次校验、内存限流可被多实例突破、SSE 无心跳僵尸连接等)。
- 应「逐行看」要求精读 18 个核心文件(约 4,327 行),定位并修复 6 类用户可见 bug:
  - **#1/#2/#3 数据丢失** —— 重做 / 调参时先 `db.images.delete()` 旧图,SSE 中途失败导致旧图永久丢失。改为打 `result_backup` 标记而非物理删除,成功确认 / 失败还原。
  - **#4 批量矩阵** —— 笛卡尔积无上限(可达 225 项、约 1.7GB 写 IndexedDB)。加 `MAX_BATCH=20` + 成本预估 + 余额检查 + 确认框。
  - **#5 Server Action 吞钱** —— 确认 `generateImageAction` 为死代码后重写为抛错 stub;删 `lib/api.ts` 约 175 行死函数。
  - **#23 stream 客户端断开** —— 加 `req.signal` abort 监听 + 25 秒心跳。
  - **#8 快速生成 stale state** —— `handleGenerate` 改接受 `shotsOverride` 参数。
- 额外删除 `stream/route.ts` 中被 `lib/image-backends` 替代的内联实现约 200 行。

**结论**:6 类 bug 本地修复完成,净减约 290 行。验证:`tsc` 退出 0、`build` 成功(27 路由)、`eslint` 0 error(仅余 5 个既有 `<img>` 警告)。**仅静态验证,未提交 / 未上线 / 未做运行时验证。**

**遗留**:首轮审计的多项问题本次未修(Gemini Key 仍在 Git 历史需轮换、扣费非原子、admin/failures 未二次校验、缺索引等)。

---

### 3.3 2026-05-28 — 对 Gemini 改的 UI 做高强度 Code Review,修 15 bug

**用户目标**:前一天让 Gemini 优化了 UI/UE,本次要求对全站做 `--effort high` 的 Code Review 找出残留问题,审出后全部修复。

**做了什么**:用 code-review skill 对 14 个未提交文件、2,642 行 diff 做高强度审查(5 个 finder agent 并行 + 去重验证),确认 15 个真实 bug 并全修:
- **#1 customPrompt 丢失** —— `app/page.tsx` 创建任务与批量分支都漏写 `customPrompt`,首页意境提示词首次生成时全丢。两处补上。
- **#2 双击丢图** —— `handleRegenerate` 双击因通配匹配 + `db.images.delete` 删掉刚建的备份。加 `regenLockRef` 双击守卫 + 匹配跳过自身。
- **#3 备份匹配不对称** —— 通配三元在 undefined 时退化为 true。新增严格匹配 helper `backupMatchesImage`,三处统一。
- **#4/#5/#9 扣费 / 退款** —— mid-shot 断开已扣费不退款、扣费后异常静默吃钱、四条路径漏 `recordGeneration`。统一用 inner try/catch 兜底退款 + 观测。
- **#6 stale closure** —— `handleStartGeneration` 用旧 `project`/`inputImages`,改为从 DB 重取 fresh 值。
- **#7/#8 按钮逻辑** —— `isBalanceSufficient` 默认 true 改 false;Step 3 生成按钮余额不足时绕过 `canGenerate`,disabled 收紧。
- 另修 components 类:触屏删除按钮常显、有备份时仍允许重做、风格映射、未用的 `useRouter` 等。
- **#10 中途打断后端** 不做(`generateImage` 缺 abort signal,属更大 refactor),只补客户端断开后退款。

**结论**:15 个 bug 全修。`tsc` + `build` 通过,遗留 eslint 告警经核实均为历史问题。**转录中无 commit / push,应视为未提交、未上线。**

---

### 3.4 2026-05-28 — 排查线上生图卡死(未定位根因)

**用户目标**:线上生图卡死(一直转圈不出图),排查修复。(会话开头还先问了一句「登录密码是多少」,助手拒答 —— 隐私红线。)

**做了什么**:发现工作区约 900 行未提交改动,重点锁定 `stream/route.ts`(约 449 行 diff)。通读后端流式接口确认逻辑完整(有 120s/180s 超时、25s 心跳、断开检测);并行读前端读流侧 + `lib/api.ts` / `image-backends.ts` / `db.ts`,未发现死循环或丢 await。代码侧排查无果后,通过 AskUserQuestion 索要线上现场信息。

**结论**:**未找到根因,未改任何代码。** 已排除「后端缺超时 / 心跳」「前端读流明显 bug」。会话停在等待用户提供现场信号。(此根因后在 [3.5](#35-2026-06-11--全量除虫上线--慢-key-根因--更名-silxine--deepseek) 中查明为「生产 Gemini key 又慢又失效」。)

---

### 3.5 2026-06-11 — 全量除虫上线 + 慢 key 根因 + 更名 SILXINE + DeepSeek

> 本项目体量最大的一次会话(89 轮用户提问 / 约 22MB 转录),完成多项里程碑并真实上线。

**用户目标**:把全部 bug 检查修好;排查线上「生图总卡住」真因并修复上线;用浏览器以 admin 跑通线上全流程;再做目录 / 文档梳理、修 UI、更名 SILXINE 换 logo、AI 聊天换 DeepSeek、建立备份机制。

**做了什么(关键里程碑)**:
- **全量审计**:5 路并行审查代理扫全库,确认约 40 个真实 bug 全修,覆盖 33 个源文件(约 +1,103/-372 行),`tsc` / `eslint` 0 error / `build` 通过,真实浏览器冒烟验证。
  - 资金正确性:扣费改 **原子条件扣减**(防生产 Postgres 并发双花)、生成按钮同步锁防双击双倍扣费、分析失败不照扣、OpenAI 兜底不把 HTML 错误页当成功计费、营收统计纳入退款按本地日切。
  - 参数断链:自定义尺寸全链路打通(此前无论选什么都按 3:4 生成)、聊天体型 / 肤色接入、修首页聊天 stale closure、zip 同名覆盖丢图。
  - 任务生命周期:刷新 / 锁屏 / 断网后任务永久卡「生成中」改为页面加载自动恢复;图库从 localStorage 迁 IndexedDB(账号隔离 + 先写成功才删源)。
  - 安全:登录时序枚举(哑哈希对齐)、错误密码只计失败(防锁死任意账号)、限流取 XFF 尾段防伪造、proxy 改请求头注入防身份泄露。
- **跨版本新 bug**:登录态过期后发起生成,proxy 把 API 请求 307 重定向到登录页,前端把 HTML 当空 SSE 流卡死。改为 API 路径返 **401 JSON**,前端明确报「登录已过期」。
- **上线**:提交 `daf6bc5`(40 项修复 + 401 根因)、`47a0829`(图库先写后删)、`d1adc51`(文档);线上探测确认 307→401 已生效。
- **「生图卡住」真凶**:通过 Zeabur 后台逐项核对 + 背靠背实测,确认 **生产 `GEMINI_API_KEY` 比本地 key 慢约 3 倍(100~150s vs 35s),骑在代码 120s 超时线上反复超时 → 中止 → 重试 → 失败**。主修复(换 key)交用户,辅助修复(调超时)由助手做。换 key 后线上实测 **Gemini 19 秒出图、GPT Image 2 约 235 秒出图,失败自动退款、零卡死、计费正确**。
- **GPT 独立令牌**:接入 `OPENAI_IMAGE_API_KEY`(缺失回退主 key),适配模型名 `gpt-image-2`,修真实模型名归因 bug,线上验证出图(`1c6df5e` / `4faa9ba`)。
- **目录 / 文档重构**(`918dc6e`):删 67MB 重复 zip、`git mv` 保留历史、README 从脚手架模板重写为真实说明、UI/UX 审查清单沉淀进 `docs/BUGS.md`。
- **UI 修复**:定位「按钮大小不一」根因为 `.btn-primary` 裸 CSS 压过 Tailwind v4 cascade layer,移入 `@layer components`;按引擎区分预估时间;修首页顶部导航压住 AI 边栏(`482125d` / `9a2f7c6`)。
- **品牌更名 SILKMOMO → SILXINE**:所有用户可见文案 / SEO / OG / iOS 图标 / 下载文件名更名,用 SVG 做丝绸缎带书法 S 标识;**刻意保留 `SilkMomoDB` 库名 / `silkmomo_*` 键 / cookie / 旧域名并加防误改注释**。
- **AI 聊天切 DeepSeek v4-pro**:本地 + 线上端到端实测,流水归因正确、扣费 ¥0.35 不变,未配 key 时回退 Gemini Lite。
- **备份机制**:`backup-db.sh`(pg_dump -Fc + zstd + sha256 + GFS 轮转)、`restore-db.sh --drill`、launchd plist、`docs/BACKUP.md`,本地实测备份 → 校验 → 恢复 → 行数核对全绿。

**关键决策**:拒绝对「零 bug」拍胸脯,把确信度分「真跑过 / 仅审查 + 编译 / 确实没测到」三档;坚持安全红线 —— 即便用户授权且有 Stop hook,也不代输入登录密码 / API key。

**遗留**:线上正式备份待用户在 Zeabur 开启 + 异地留档;用户生成图存浏览器 IndexedDB,服务端备份覆盖不到(需改架构转存对象存储);GPT 约 235 秒 / 张接近 180s 超时线,批量建议用 Gemini;`docs/BUGS.md` 未决 UI 项(移动端双底栏重叠、alert/confirm 待换 Toast 等);线上测试残留(task 1-4、probe-test-0611);GitHub 仓库名 / 域名仍为 SILKMOMO 待单独处理。

---

### 3.6 2026-06-23 — 全流程回归 + 修 GPT Image 2 + 进度条上线

**用户目标**:用浏览器自动化 + 直接 API 把每条流程(含真实生图)端到端跑通,修到没 bug;排查线上 GPT Image 2 一直失败的原因并彻底修好(含单张失败可重试);修首页「更多选项」展开收不回去且选项重复;加实时生成进度条;最后做多代理审计与回归复审后推上线。

**做了什么**:
- **全流程回归**:浏览器控制(Claude_Preview)+ 直接 API / Node 脚本,把认证、品牌档案、计费、管理后台、AI 分析 / 聊天、生图(Gemini 产品图 / 场景图、GPT 产品图)逐条端到端跑通,含真实出图。API 层断言全过(认证 14 项 + 核心 25 项 = 53 项绿),扣费精确(生图 65 分 / 张,分析 / 聊天 35 分 / 次),余额不足 / 失败 / 断开均正确自动退款。(本地注册被 localhost 共享 IP 限流挡住 —— 判定为正常行为,测试侧用不同 X-Forwarded-For 绕过。)
- **GPT Image 2 失败根因**:用户提供线上 key 后实测确认 —— 该 key 套餐(apiyi image2Enterprise)只支持 `gpt-image-1` / `-mini` / `-1.5` / `gpt-image-2`,**没有代码默认调用的 `gpt-image-2-all`**,故秒回 503「no available channels」。主修 = 配置:把该 key 设为 `OPENAI_IMAGE_API_KEY`(代码检测到独立令牌自动切 `gpt-image-2`),本地 App 真实出图验证(109s、扣 65 分),并更新 `.env.example`。
- **超时加固**:`lib/image-backends.ts` 超时 180s→280s、抽常量、超时不再自动重试;`stream/route.ts` `maxDuration` 300s→800s。
- **单张重试**:给失败镜次加「重试这张」按钮(复用既有 `handleStartGeneration([shotIndex])`),临时强制 `gpt-image-2-all` 复现 503 截图确认。确认生成本就是串行(一条 SSE 流逐张 await + 防双击锁),无需改造。
- **首页 UI**:「更多选项」从永远展开改为真正可折叠;展开后隐藏 Step2 / Step3 重复的引擎 / 模特 / 快速生成控件。
- **进度条**:单张长任务(GPT 一张 2~3 分钟、上游不返中途进度)改为按已耗时 / 预计时间匀速爬升(8%→48%→95% 封顶等出图,多张按镜次里程碑取较大值不倒退)。
- **Gemini 超时尾巴**:读响应体被同一 abort 超时会误报「JSON 解析失败」且不重试,改为 body 读取单独 try —— Gemini 识别为超时重试一次,GPT 如实报超时。
- **多代理审计**:9 区域并行 + 对抗式验证,36 候选确认 12 真 bug、剔 24 误报,修其中 11 条(登录 IP 限流把成功也计数致共享 NAT 锁死、自定义尺寸缺宽高静默按 3:4、断开时 success+fail 双记录、图库去重指纹只取前 100 字符、<200KB 大像素图不缩放、ai/chat 空回复不退款、brand 坏体返 500 应 400 等),暂缓 1 条(客户端断开取消上游调用,纯效率)。
- **回归复审**:subagent 审本次 diff,8 候选确认 3 处自引入回归并修(「重新生成这张」死按钮、AI 切场景图无条件 `setStep(3)` 致空面板、压缩器缩放守卫把 GIF 拍成静态)。

**结论**:全部改动分多次提交并推上线 —— `610ef15`(GPT 独立令牌 + 超时加固)、`300993b`(首页折叠去重)、`4c12fe5`(进度条爬升)、`376c71a`(Gemini 尾巴 + 11 项审计)、`188bf93`(回归复审修 3 处)。本地与 origin/main 同步、工作区干净,线上最新 `188bf93`,各批修复记入 `docs/BUGS.md`。

**遗留**:暂缓项「客户端断开取消上游调用」(需透传 AbortSignal);用户截图曾曝光全部线上密钥,建议轮换(助手未代操作)。

---

### 3.7 2026-06-28 — 把所有对话归纳进 context.MD(本任务)

**用户目标**:检查项目整体程序结构,并把本项目内进行过的所有 Claude 对话(不只当前这次)全部归纳进一个 context.MD。

**做了什么**:扫描项目结构,定位到 7 份会话转录(最大约 22MB);写抽取脚本 `extract.py`(过滤工具结果 / 系统噪声,提取干净用户提问)与 `narrate.py`(构建用户提问 + 助手关键结论的交错叙事转录),为 7 份会话各生成叙事素材;再用 Workflow 并行派 9 个代理(7 个逐会话总结 + 1 个结构地图 + 1 个里程碑时间线),最后综合写入本文件。

**结论**:即本文件。早期一段曾中断在「构建叙事转录」步骤,后续续作完成逐会话总结与结构梳理并落盘。

---

## 4. 里程碑时间线(综合 git + docs)

- **2026-02-06** — 项目雏形(基于 Create Next App):首版 Logo 与全站 metadata、模特 / 体型选择、调参重生、性感体型 Prompt 调优。
- **2026-04-03** — 上线工程攻坚:SQLite → PostgreSQL(Zeabur 零配置)、自定义多阶段 Dockerfile 绕过 Zeabur npm update bug、Prisma 延迟初始化、端口与 migrate 修通。
- **2026-04-13** — 修复 SSE 跨 chunk 事件类型丢失导致生图始终失败的核心缺陷。
- **2026-05-02** — 深度审计整改:3 路径 P0 安全 / 计费 / UX 修复;抽共享组件、扁平化分支。
- **2026-05-03** — 全功能 E2E 真机测试:修 8 个问题 + 任务重命名 / 搜索 + 安全加固,合并 PR #1。
- **2026-05-07** — 双通道生图大版本:Gemini / GPT Image 2 双引擎 + 全链路引擎选择 UI;品牌设置页 `/brand`;`stream` 接 `recordGeneration`(Postgres 持久化每次成败);失败可见(历史尝试折叠面板 + 管理员失败监控页)。
- **2026-05-30** — 浏览器逐项巡检:修样式包图片污染、跨账号本地数据残留、Next 16 middleware 迁移;登录态全模块生图矩阵全部真实生成。
- **2026-06-09** — 部署到 origin/main(→ `dcd7146`);线上 admin 密码重置登录验证;修登录 / 注册后本地工作区清理卡住;完成 silxine.com 线上电商站外部审计。
- **2026-06-11** — 全代码库 bug 审计:5 路并行约 40 项(`daf6bc5` + `47a0829`);线上验证未登录调 `/api/*` 返 401 JSON。
- **2026-06-12** — 线上「生图卡住」根因解决(换正常 Gemini 令牌后 19 秒出图);GPT 独立令牌 `OPENAI_IMAGE_API_KEY`;生成记录按真实上游模型名归因;仓库目录重构(清理约 90MB);UI 一致性快修。
- **2026-06-13** — AI 聊天切 DeepSeek `deepseek-v4-pro`(3 秒响应,自动回退 Gemini Lite);品牌更名 SILXINE + 全新品牌视觉;新增数据库备份机制。
- **2026-06-24** — 全流程端到端回归 + 修复(53 项 API 断言 + 完整 UI 生图);统一页脚年份 2026;eslint 忽略 `refs/**`。
- **2026-06-26** — GPT Image 2 持续失败根因定位(客户令牌计划内无 `gpt-image-2-all` 变体 → 503,改用独立令牌切 `gpt-image-2`)+ 超时 / 单张重试加固;修 Gemini 超时尾巴 + 多代理审计 11 项;回归复审再修 3 处(最新 `188bf93`)。

---

## 5. 当前状态(截至 2026-06-30)

- **产品形态**:丝绸 / 服饰电商 AI 生图平台,正式品牌名 SILXINE(内部代号与存储键仍保留 SILKMOMO),Next.js 16 + Prisma + PostgreSQL,部署 Zeabur,本地端口 4605。
- **生图能力**:双引擎 Gemini 与 GPT Image 2,覆盖产品图 / 场景图,全链路引擎选择 UI;每次生成成败与错误信息持久化到 Postgres,按真实上游模型名计费归因。
- **回归状态**:已通过最近一轮(2026-06-24)全流程端到端回归 —— 认证、品牌、计费、管理后台、AI 分析 / 聊天、生图、反馈、记录全部跑通,含真实出图与精确扣费 / 失败退款。
- **AI 聊天**:主通道 DeepSeek `deepseek-v4-pro`,未配置时自动回退 Gemini Lite 零中断。
- **资金正确性**:原子扣费、失败自动退款、退款日志对账、统计净额化、并发防双花已系统加固。
- **代码质量**:`tsc` 通过、`eslint` 0 error(仅余若干可换 `next/image` 的 `<img>` 非阻断 warning);已建立数据库备份机制。
- **版本**:最新 `188bf93`,共 59 次提交,均在 `main` 分支,工作区干净。

---

## 6. 已知问题 / 待办

- **GPT 通道运维**:线上必须配置 `OPENAI_IMAGE_API_KEY` 才能用 GPT(否则默认调用客户令牌不支持的 `gpt-image-2-all` → 503),且改 Zeabur 环境变量后必须重启 / 重新部署才生效。
- **GPT 单张耗时** 75~235 秒属上游速度,非故障;批量在单个 SSE 请求内串行,N 张约 N×120~200 秒,大批量建议用 Gemini。
- **效率项暂缓**(非正确性 bug):客户端断开时未取消正在进行的上游生成调用,整张跑完才退款;需把 `req.signal` 透传进 `image-backends` 的 fetch。
- **UI/UX 优化清单**(2026-06-12 审查产出):P1 含移动端双底栏重叠、12+ 处原生 alert/confirm 待换轻量 Toast + Dialog;P2 含 `transition-all` 性能、**中文排版基线缺失**(无 keep-all / balance、金额数字未统一 tabular-nums + nowrap)、画廊 `<img>` 未声明宽高与懒加载、TaskList N+1、步骤指示器点击目标过小;P3 充值套餐硬编码、hover 对比度等。
- **线上电商站 silxine.com**(Shopify 后台,不在本仓库):变体重量单位疑似配错、`/pages/about` 桌面端首屏空白、预约页混合信号、商品图 alt 大面积为空、多个 H1 层级混乱。
- **线上测试残留可清理**:task 1-4(端到端测试产生)、探测账号 probe-test-0611(余额 0)。
- **安全 / 运维**:用户截图曾曝光全部线上密钥(JWT_SECRET、数据库密码、多把 API key),建议轮换;Zeabur 遗留环境变量 `PASSWORD`、`NEXT_PUBLIC_API_URL` 代码均未读取,可删;线上正式备份(Zeabur 每日 + 异地留档)与每月 `restore --drill` 演练待用户执行;用户生成图存浏览器 IndexedDB,服务端备份覆盖不到。

---

## 7. 归档说明(数据来源与口径)

- **数据来源**:本项目 `~/.claude/projects/-Volumes-ProjectsAPFS-SILKMOMO/` 下的 **7 份 Claude Code 会话转录(`.jsonl`)**,即在本机用 Claude Code 对本仓库进行的全部会话。
- **关于「Claude Desktop / claude.ai 桌面端」对话**:该应用的聊天记录存于 Anthropic 服务端,本机 `~/Library/Application Support/Claude/` 只有 Electron 缓存(Cookie / IndexedDB 等),**没有可读取的本地对话转录**,因此无法纳入本归档。若另有 claude.ai 上的相关会话,需在该端导出后补充。
- **可信度口径**:每节区分「已真实验证 / 仅代码审查 + 编译 / 未验证」;凡「未提交 / 未上线」均已注明。会话编号与转录文件对应关系见各小节标题旁的日期 + [§3 总表](#3-历史对话归档)。
