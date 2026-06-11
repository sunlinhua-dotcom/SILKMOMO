# SILKMOMO 踩坑记录

## 已知历史问题
- 移动端布局曾出现 Header 过高、步骤文字隐藏、最近项目位置不合理等 UX 问题，已有修复记录。
- 早期任务详情页曾调用废弃生成函数并忽略 Phase 2 参数，已有修复记录。
- 管理员初始化曾存在硬编码 fallback 密钥风险，已有修复记录。
- API Key / 上游渠道曾出现 503 不可用，需要避免在仓库中记录完整密钥。

## 本轮新发现
- 2026-06-09 线上电商站点审计：`silxine.com/products/silxine-long-sleeve-set` 的变体重量疑似配置错误。Shopify `.json` 显示 `weight_unit: lb`、`weight: 250.0`，`.js` 显示 `weight: 113398`；短袖套装为 250 g。后续正式售卖前需要在 Shopify 后台修正，否则可能导致运费异常。
- 2026-06-09 线上电商站点审计：`/pages/about` HTML 有正文，但桌面浏览器截图显示正文被推到约一屏半以后，首屏是大面积空白；需要检查 About 页面模板顶部间距或 section padding。
- 2026-06-09 线上电商站点审计：当前正式商品页短袖/长袖均为 `available:false`，但页面仍出现 `$15 reserves your spot` 和正式商品 `Sold out` 混合信号；应明确将交易动作收敛到 `Batch No. 1 Reservation`。
- 2026-06-09 线上电商站点审计：商品图在 Shopify JSON 中 `alt:null`，浏览器检测预约页 13 处空 alt、短袖页 9 处、长袖页 8 处；影响图片 SEO 与可访问性。
- 2026-06-09 线上电商站点审计：首页存在两个 H1，`Shipping & Returns` 也出现重复 H1；内容页需要整理标题层级。
- 2026-06-09 线上电商站点审计：控制台有第三方脚本加载失败、`sf_private_access_tokens` 401、Shopify privacy banner `Uncaught (in promise)`；需在真实用户地区和浏览器环境复核是否影响追踪、弹窗或隐私横幅。
- 样式包图片复用了 `images.projectId = packId`，当默认样式包 ID 与新建任务 ID 相同，会在任务详情页错误显示“场景参考”。已通过 `stylePackId`、固定 `STYLE_PACK_IMAGE_PROJECT_ID`、旧数据迁移和新任务图片槽清理修复。
- 多账号共用同一个浏览器 IndexedDB / localStorage 时，新账号可能看到旧账号的本地任务、图库或时光机缓存。已新增本地工作区归属同步，登录 / 注册 / 退出时清理隔离。
- 注册页提示“至少 6 位”与后端校验“至少 8 位”不一致。已统一为 8 位并补充表单自动填充属性。
- Next 16.1.6 开发服务提示 `middleware` 文件约定已废弃。已迁移为 `proxy.ts`。
- `npm run lint` 原先扫描 `.claude/worktrees/.next` 和种子脚本导致阻断。已补充 ESLint 全局忽略，并修复当前源码 lint error。
- 场景图“氛围静物”按钮此前没有持久化，也没有传给服务端，实际仍按有模特生成。已新增 `sceneHasModel` 字段并贯通首页创建、任务页生成、SSE API、prompt 构建和结果图 `hasModel` 写入。
- GPT Image 2 生图成功后，扣费交易流水曾固定写成 Gemini 模型名，导致账单 / 后台统计模型归因不准。已让 `deductBalance` 接收并记录真实 `apiModel`。
- Zeabur Web Terminal 对 `read -s` 的交互输入不稳定，敏感值可能被当作 shell 命令回显到当前终端历史。后续生产密码轮换应优先使用编码传参、临时环境变量或平台密钥界面，并避免在终端中直接输入明文。
- 登录 / 注册成功后如果需要清理旧账号本地工作区，原实现使用 `db.delete()` 删除整个 IndexedDB；该操作可能被其它标签页或旧连接阻塞，导致页面一直停在 `登录中...`。已改为在当前 Dexie 连接中清空业务表，并增加 6 秒超时与明确错误提示。

## 2026-06-11 全量代码审计（5 路并行审查，约 40 项，已全部修复）

### 资金正确性
- `deductBalance`/`deductCustom` 是"先查再扣"两步，普通 SELECT 不加行锁，生产 PG 下并发请求可双花、把余额扣成负数（SQLite 单写者掩盖了该问题）。已改为 `updateMany` 条件原子扣减（`balanceFen >= cost` 不命中即余额不足）。
- 任务页 `handleStartGeneration` 的防重入依赖异步 state，guard 后还有两次 IndexedDB await 才置位，双击"全部生成/先试1张/重试"会并行跑两条 SSE 流双倍扣费。已加同步 ref 锁（`startLockRef`/`regenParamsLockRef`）。
- `/api/ai/analyze` 失败照样扣 ¥0.35：`analyzeProductImage` 吞掉所有失败返回空结果，路由无法区分。已让其返回 `ok` 标志，失败自动退款；服务未配置时扣费前短路。
- `refundBalance` 失败完全静默（所有调用点都不检查返回值），退款失败的钱无痕蒸发。已在函数内部 `console.error` 留对账痕迹。
- OpenAI 通道 url 兜底下载不校验 `imgRes.ok`/content-type/超时，过期 URL 返回的 HTML 错误页会被当成功图片交付且不退款，还可能污染 anchor。已补全三项校验。
- `getAdminStats` 消费统计不扣退款（失败生成=扣费+退款两条流水），营收虚高；"今日"按容器 UTC 切。已净额化 + 按 Asia/Shanghai 切日。
- 充值套餐文案按旧单价虚标约 10% 次数（50/101/254/508 → 实际 46/92/230/461）。已改为从当前定价推导。

### 参数断链（付费出错图）
- 自定义尺寸全链路不生效：场景模块宽高不落库、请求体不传宽高、服务端 'custom' 硬编码 3:4、`sizeToAspectRatio` 零调用且缺 4:3 分支。已全链路贯通（落库→请求→服务端换算→UI 显示真实宽高）。
- 任务页 AI 聊天设置的体型/肤色从未进入生成请求（只有 model/engine 有 effective 覆盖逻辑）。已补 `effectiveBodyType/SkinTone` 并持久化。
- `AIChatBox` 的 `setTimeout(() => onTriggerGenerate(), 500)` 捕获旧闭包，聊天改参数后触发的生成用的是改之前的 state。已用 latest-callback ref 修复。
- 聊天触发整任务重做不备份旧结果，同 shotIndex 新旧图堆积，zip 下载同名覆盖丢图。已改走 `handleRegenerateWithNewParams` 备份路径；zip 重名追加图片 id 兜底。
- 镜次 9（无模特面料特写）也被附上 anchor 参考图，"使用相同模特"与"不得出现人物"指令打架。已按 `shot.hasModel` 过滤 anchor 的传入与锚定。
- AI 分析 inlineData 硬编码 `image/jpeg`，但前端压缩产物默认 WebP，上游按错误 MIME 解码失败。已透传真实 mimeType。

### 任务生命周期
- 生成中刷新/关闭页面后任务永久卡在 processing，该状态没有任何操作按钮（死任务）。已在 `loadTaskData` 检测孤儿 processing 并按已有产出回退为 completed/pending。
- 中途余额不足时任务标"已完成"，fatal 错误信息在 UI 任何地方都看不到。已持久化 lastError 并在已完成任务上渲染琥珀色提示条 + "补生成剩余"入口。
- 用户主动取消被持久化为 failed + "生成失败（catch）"。已区分 AbortError：按实际产出回写 completed/pending，不写失败原因。
- 单图重做成功会误触发"试生成完成"横幅（用 length===1 推断）。已改为显式 `isTrial` 标志。
- 生成进行中对实时画廊的"保留新版/还原旧版"静默无效（只查 images 不查 liveImages）。已合并两个来源。

### 客户端数据层
- 图库把完整压缩图存两遍（dataUrl+base64）进 localStorage，单条约 2MB 字符，存 2-3 张必爆 5MB 配额且静默丢图。已迁移到 IndexedDB（Dexie v4 `libraryImages` 表），首次访问自动搬运旧数据；账号切换清理已覆盖新表。
- `migrateLegacyStylePackImages` 无并发互斥且不在事务里，双跑会把风格包图片复制成双份；还被每次全量重跑（O(N²)）。已加模块级互斥 + Dexie 事务 + 完成标记。
- `hasLocalWorkspaceData` 不检查 localStorage 残留且异常时 fail-open，边缘场景新账号仍可能继承旧账号图库/时光机。已补 localStorage 检查并改为 fail-closed。
- `useProductAnalysis` 无请求序号，快速删图换图时旧响应覆盖新结果；换首图不重新分析（一直显示上一件衣服的描述）。已加请求序号 + 首图指纹跟踪。
- 品牌记忆回填无条件覆盖用户在 /api/brand 加载完成前的手动选择。已只回填一次且跳过 touched 字段。
- 风格包跨模块取消选中清错槽位（按当前 activeModule 清，而不是当初应用到的槽位），包图残留继续参与生成。已记录应用槽位。
- 时光机快照缺 engine/skuType/sceneHasModel/outputSize，"相同参数重做"还原不完整。已补字段（旧快照向后兼容）。
- 首页步骤条"上传"按钮是死控件：setStep(1) 被 effect 立即弹回。已改为只在 0→N 上传瞬间推进。

### 组件与 API 健壮性
- ImageUploader 三个 file input 从不重置 value，删除图片后重选同一文件无反应。已在读取后重置（先复制 FileList 再重置，防部分浏览器活引用被清空）。
- 任务列表在查询层截断 20 条且无分页，第 21 条起的任务从 UI 永久不可达，搜索/筛选只作用于截断子集；状态筛选缺"待生成"。已全量加载 + "加载更多"分页 + 补 pending 筛选。
- 品牌设置"重置为默认值"只重置本地表单不保存，与确认文案"会清空品牌偏好"不符。已重置后立即 PUT。
- `/api/billing/transactions` 分页参数无校验（NaN/负数→500，超大 pageSize 可拉全表）；feedback rating 任意值入库污染质量统计、P2025 返回 500；by-task 的 `Number.isFinite` 放过 1.5 → Prisma 500。已分别 clamp / 白名单 / `Number.isInteger` / P2025→404。
- `/api/generate/stream` 对参考图无任何上限校验，已登录用户可 POST 几百 MB JSON 整体进内存。已加各槽位张数、单图体积、MIME 白名单防线。
- 场景图分支"先扣费后 AI 分析"，分析上游挂死时资金悬置最长 5 分钟。已调整为先分析后扣费（与产品图分支一致），并给 ai-assistant/chat 的三处 fetch 补 30s 超时。
- Gemini/AI 通道的 API key 拼在 URL query，base URL 配错时 fetch 的 TypeError 会把含 key 的完整 URL 透传到 SSE error 事件和日志。已对错误信息统一脱敏。

### 认证与安全
- 登录存在 bcrypt 时序侧信道（用户不存在时不跑 compare，响应时延可枚举账号）。已用固定哑哈希对齐两条路径耗时。
- 按用户名限流统计所有尝试（含恶意失败），5 次错误密码即可把任意账号锁死 15 分钟（定向 DoS）。已改为只计失败、登录成功清零。
- `getClientIp` 取 XFF 第一段（客户端任意伪造），注册/admin-setup 的纯 IP 限流可被无限绕过。已改取反代追加的最后一段。
- 限流清理用调用方窗口做统一 cutoff，短窗口调用会误删仍在长窗口内的桶。已按各桶自己的窗口淘汰。
- proxy.ts 把用户身份写到「响应」头而非「请求」头：下游读不到（功能失效），还把 userId/role 泄露给浏览器。已改为请求头注入 + 剥离入站同名头。
- 注册 check-then-create 竞态时落败方撞唯一约束返回 500。已捕获 P2002 返回 409。
- admin setupKey 用 `!==` 比较存在时序泄漏。已改 sha256 + `timingSafeEqual`。
- 管理后台用户搜索在 PG 下大小写敏感会漏搜（SQLite 不敏感，两环境行为不一致）。已按运行时数据库条件加 `mode: 'insensitive'`。
- BrandProfile 无 (userId,isDefault) 唯一约束，并发首次访问可建多条默认档案且读写分裂。已对所有 findFirst 固定 `orderBy createdAt asc` 保证读写命中同一条。

### 其它
- 仓库根目录存在 shell 引号事故产生的空垃圾目录 `dev.db"DATABASE_URL="file:.`（未被 git 跟踪），已删除。
- 清理 BodyTypeSelector/SkinToneSelector 两个未使用类型导入（lint warning）。

## 2026-06-11 线上"生图卡住"排查
- 本地 apiyi key 四项真实测试全部通过：/v1/models 鉴权 200、Lite 分析 2.6s、Gemini 生图 28.8s 成功出图、GPT Image 2 edits 62.6s 成功出图（gpt 通道单张天然就要 60s+，多镜次批量会很慢但不是故障）。
- 线上探测（注册 0 余额账号 probe-test-0611 直调 SSE）：线上服务器 → apiyi 分析调用 3s、生产 PG <1s、SSE 事件逐条实时到达（Zeabur 不缓冲流）。线上 key / 上游 / 数据库 / 流式通道全部健康。
- 根因判定：线上跑的是 GitHub `dcd7146` 旧代码，不含本地未提交的全部修复。旧版的"生成中断后任务永久卡 processing 且无任何操作按钮"与用户感知的"生图总是卡住"完全吻合（刷新/锁屏/切后台一次即触发，且永不恢复）。
- 探测中新发现（两个版本都有）：proxy 对未登录/过期 JWT 的 `/api/*` 请求做 307 重定向到 /login，fetch 静默跟随拿回 HTML 200，SSE 客户端把它当"空流"（无 done 事件）→ 任务卡 processing。JWT 7 天过期后必现。已修复：API 路径返回 401 JSON（页面仍重定向），客户端对 401 / 非 text/event-stream 响应抛出"登录已过期"明确报错。
- 探测残留：线上多了测试账号 probe-test-0611（余额 0）和一条 taskId=1 的"余额不足"失败记录，可在管理后台删除或忽略。
- 自查补漏：图库 localStorage→IndexedDB 迁移的首版实现"先删源后确认写入"——bulkPut 失败被吞掉后仍会删 localStorage，导致图库丢失。已改为先写成功再删源，写失败保留源数据下次重试（47a0829）。
