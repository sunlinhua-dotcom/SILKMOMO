# SILXINE 踩坑与待办

> 使用约定:新问题记入「未决事项」;修复后移入「已修复归档」对应日期下,一句话写清"症状 → 根因 → 修法"。

---

## 一、未决事项

### UI/UX 优化清单(2026-06-12 审查产出,按优先级)

**P1 建议优先**
1. 移动端双底栏重叠:`app/page.tsx` 快速生成栏与 `components/AIChatBox.tsx` AI 底栏均为 `fixed bottom-0 z-50`,Step≥2 时同时渲染,快速生成栏盖住 AI 聊天入口。建议快速生成栏上移避让,或聊天栏收为浮球(待真机验证后改)。
2. 原生 `alert/confirm` 共 12+ 处(`app/page.tsx`、`app/brand/page.tsx`、TaskList 删除确认等),不可样式化且与品牌视觉脱节。建议统一轻量 Toast + 确认 Dialog。

**P2 打磨**
3. `transition-all` 多处(`app/page.tsx:366,387,559,652,904,977`、`app/brand/page.tsx:163,182`、`app/register/page.tsx:94,109,125`):规范要求只动画 transform/opacity;尤其 `lg:pl-72 transition-all` 整列容器动画有性能隐患。
4. 中文排版基线缺失:`app/globals.css` 无 `word-break: keep-all` / `text-wrap: balance`;金额与数字未统一 `tabular-nums + white-space: nowrap`,窄屏有数字断行/孤字风险。
5. 画廊/缩略图 `<img>` 未声明宽高与懒加载:`ResultGallery`、`StylePackManager`、`ImageLibraryPicker`、`ImageLightbox`;建议 `loading="lazy"` + 固定宽高比占位(对应现存 lint warning)。
6. 任务列表 N+1:`components/TaskList.tsx` 全量加载 projects 后逐个 count images;任务数到几百时明显变慢,建议批量统计。
7. 步骤指示器(上传/参数/生成)移动端点击目标过小(text-[10px]);且 step/module 状态不进 URL,刷新即丢。

**P3 可选**
8. 充值弹窗套餐卡硬编码 `{yuan, times}` 数组(`app/page.tsx`),与 `RECHARGE_PACKAGES` 重复定义,易再次不一致,应引用常量。
9. 选择卡片 hover 对比度偏低(浅金描边),hover 态可加深;键盘 `:focus-visible` 全局样式已有 ✓。
10. 空状态/按钮文案统一二人称 + 明确下一步动作(多数已达标)。

**已达标项(审查确认,无需动)**:`:focus-visible` 全局焦点环、`prefers-reduced-motion`、登录/注册 autocomplete 全套(含 current-password,审查初稿误报缺失)、图标 `aria-hidden` 普遍覆盖、移动端 `safe-area-inset`、SSE 心跳保活、`outline-none` 处均有 focus 替代样式。

### 线上电商站点 silxine.com(2026-06-09 审计,Shopify 后台操作,不在本仓库)
1. `silxine-long-sleeve-set` 变体重量疑似配错:`.json` 显示 `weight_unit: lb, weight: 250.0`(短袖套装为 250 g),正式售卖前需修正,否则运费异常。
2. `/pages/about` 桌面端正文被推到约一屏半以后,首屏大面积空白,需查模板顶部间距。
3. 正式商品 `available:false` 但页面同时出现 `$15 reserves your spot` 与 `Sold out` 混合信号,交易动作应收敛到 `Batch No. 1 Reservation`。
4. 商品图 `alt` 大面积为空(预约页 13 处、短袖页 9 处、长袖页 8 处),影响 SEO 与可访问性。
5. 首页两个 H1、`Shipping & Returns` 重复 H1,标题层级需整理。
6. 控制台第三方脚本加载失败、`sf_private_access_tokens` 401、privacy banner `Uncaught (in promise)`,需在真实用户环境复核。

### 其它
- GPT 图像通道(apiyi `gpt-image-2` / `gpt-image-2-all`)单张 150-235s 属上游速度,非故障;批量(5 张)可能撞 SSE 路由 300s 上限,大批量建议用 Gemini,或后续给 GPT 通道提高超时/并发。
- 线上测试残留可清理:任务 task 1-4(2026-06-12 端到端测试产生)、探测账号 `probe-test-0611`(余额 0)及其一条"余额不足"失败记录。
- Zeabur 环境变量遗留项 `PASSWORD`、`NEXT_PUBLIC_API_URL` 代码均未读取,可删可留。

---

## 二、已修复归档

### 2026-06-12(UI/UX P1 快修)
- 生成预估时间与引擎无关:统一按 15s/张估算,GPT 实测 150-235s/张,出现"预计剩余 17 秒"实跑 4 分钟。修复:任务页预估与"响应较慢"阈值按引擎区分(openai 180s/张、阈值 300s),EngineSelector 两种形态都标注「约 30 秒/张 / 约 3 分钟/张」。
- 剪贴板复制未 await/catch,权限拒绝时仍提示"已复制"。修复:失败时提示手动添加微信号。
- 审查清单第 7 条(登录密码框缺 current-password)为误报,实际已配置,已从未决移除。

### 2026-06-12(线上生图卡住根因 + GPT 独立令牌)
- 线上"生图总是卡住"根因:生产 `GEMINI_API_KEY` 为限速/后失效令牌(实测同参数 100-150s/张,本地正常令牌 19-36s),撞代码 120s 超时反复重试。更换令牌后 Gemini 19s 出图。教训:**两个环境的 key 不一致时,先各自实测上游再查代码**。
- 我方给错过一次完整 key(凭记忆拼写),导致一轮 401「无效的令牌」:**密钥必须从配置文件原样读取复制,绝不手敲**。
- proxy 对未登录/过期 JWT 的 `/api/*` 请求 307 重定向到登录页,fetch 静默跟随拿回 HTML 200,SSE 客户端当成"空流"(无 done 事件)→ 任务卡 processing。修复:API 路径返回 401 JSON,客户端对 401/非 event-stream 响应报"登录已过期"。
- 生成记录模型名硬编码,不反映真实调用模型。修复:`BackendResult.model` 返回真实模型名,记录如实归因(`4faa9ba`)。
- GPT 通道支持独立令牌 `OPENAI_IMAGE_API_KEY`(独立计费/额度),该类令牌只支持 `gpt-image-2`(无 `-all`),模型默认随 key 切换(`1c6df5e`)。
- Zeabur 改环境变量后**必须重启/重新部署**才生效(容器启动时读入);带连字符的变量名(如 `gpt-image-2`)不符合 POSIX,读取不可靠,一律用大写下划线。

### 2026-06-11(全代码库审计,约 40 项,5 路并行审查;主修复 `daf6bc5`)

**资金正确性**
- `deductBalance`/`deductCustom`"先查后扣"无行锁,生产 PG 并发可双花/负余额(本地 SQLite 单写掩盖)。改 `updateMany` 条件原子扣减。
- 任务页生成入口防重入依赖异步 state,双击可并行两条 SSE 双倍扣费。加同步 ref 锁。
- `/api/ai/analyze` 上游失败照扣 ¥0.35:改 `ok` 标志,失败自动退款;未配置时扣费前短路。
- `refundBalance` 失败完全静默,退款失败的钱无痕蒸发。函数内部 `console.error` 留对账痕迹。
- OpenAI url 兜底下载不校验 `ok`/content-type/超时,HTML 错误页可能被当成功图片收费。补全校验。
- `getAdminStats` 消费不扣退款致营收虚高;"今日"按 UTC 切。净额化 + Asia/Shanghai。
- 充值套餐文案按旧单价虚标次数(50/101/254/508 → 实际 46/92/230/461)。改由定价推导。

**参数断链(付费出错图)**
- 自定义尺寸全链路不生效(场景宽高不落库、请求不传、服务端 'custom' 硬编码 3:4、`sizeToAspectRatio` 缺 4:3 且零调用)。全链路贯通。
- 任务页 AI 聊天设置的体型/肤色从不进生成请求。补 effective 逻辑并持久化。
- `AIChatBox` `setTimeout` 捕获旧闭包,聊天改参数后仍按旧 state 生成。latest-callback ref 修复。
- 聊天触发整任务重做不备份旧结果,同 shotIndex 新旧堆积、zip 同名覆盖丢图。改走备份路径;zip 重名追加 id。
- 无模特镜次(面料特写)也附 anchor"使用相同模特",指令自相矛盾。按 `shot.hasModel` 过滤。
- AI 分析 inlineData 硬编码 `image/jpeg` 而前端压缩产物是 WebP。透传真实 mimeType。

**任务生命周期**
- 生成中刷新/关页后任务永久卡 processing 且无任何按钮。`loadTaskData` 检测孤儿 processing 按产出回退。
- 中途余额不足任务标"已完成"但 fatal 信息不可见。持久化 lastError 并渲染琥珀提示 + 补生成入口。
- 用户取消被标 failed+"生成失败(catch)"。区分 AbortError 按实际产出回写。
- 单图重做成功误触发"试生成完成"横幅。显式 `isTrial` 标志。
- 生成中对实时画廊"保留新版/还原旧版"静默无效。合并 liveImages 查找。

**客户端数据层**
- 图库 dataUrl+base64 双份全图存 localStorage,2-3 张即爆 5MB 配额静默丢图。迁移 IndexedDB(Dexie v4)自动搬运;补丁 `47a0829` 修迁移"先删源后确认写入"丢数据风险。
- `migrateLegacyStylePackImages` 无互斥/事务,双跑复制双份图且每次 O(N²) 重扫。互斥 + 事务 + 完成标记。
- `hasLocalWorkspaceData` 不查 localStorage 且异常 fail-open,新账号可能继承旧账号图库。补查并 fail-closed。
- `useProductAnalysis` 无请求序号,旧响应覆盖新结果;换首图不重新分析。请求序号 + 首图指纹。
- 品牌记忆回填覆盖加载完成前的手动选择。只回填一次且跳过 touched 字段。
- 风格包跨模块取消清错槽位,包图残留参与生成。记录应用槽位。
- 时光机快照缺 engine/skuType/sceneHasModel/outputSize。补字段(向后兼容)。
- 首页步骤条"上传"按钮被 effect 立即弹回。只在 0→N 上传瞬间推进。

**组件与 API 健壮性**
- ImageUploader file input 不重置 value,删除后重选同一文件无反应。读取后重置(先复制 FileList)。
- 任务列表查询层截断 20 条无分页,第 21 条起 UI 不可达;筛选缺"待生成"。全量 + 分页 + 补筛选。
- 品牌设置"重置为默认值"只改本地表单不保存。重置后立即 PUT。
- transactions 分页无校验、feedback rating 任意值入库且 P2025→500、by-task 放过小数。clamp/白名单/isInteger/404。
- `/api/generate/stream` 参考图无上限。加张数/体积/MIME 防线。
- 场景分支先扣费后 AI 分析,分析挂死资金悬置;三处 AI fetch 无超时。调序 + 30s 超时。
- 上游 key 拼 URL,base 配错时 TypeError 透传含 key 的 URL。错误信息统一脱敏。

**认证与安全**
- 登录 bcrypt 时序侧信道。固定哑哈希对齐耗时。
- 按用户名限流统计所有尝试,5 次错密码锁死任意账号 15 分钟。只计失败、成功清零。
- `getClientIp` 取 XFF 第一段可伪造。改取反代追加的最后一段。
- 限流清理用调用方窗口统一 cutoff,误删长窗口桶。按各桶窗口淘汰。
- proxy 把用户身份写到「响应」头(下游读不到且泄露浏览器)。改请求头注入 + 剥离伪造头。
- 注册 check-then-create 竞态 500。捕获 P2002→409。
- admin setupKey `!==` 时序泄漏。sha256 + `timingSafeEqual`。
- 管理后台用户搜索 PG 大小写敏感漏搜。按运行库加 `mode: 'insensitive'`。
- BrandProfile 无唯一约束,并发首访建多条默认档案。findFirst 固定 `orderBy createdAt asc`。

**其它**
- 根目录 shell 引号事故空目录 `dev.db"DATABASE_URL="file:.`,已删。
- 清理两个未使用类型导入(lint warning)。

### 2026-06-09 ~ 更早(历史)
- 登录/注册后清理旧账号工作区用 `db.delete()` 整库删除,被其它标签页阻塞致"登录中..."卡死。改当前连接清空业务表 + 6s 超时 + 明确报错。
- Zeabur Web Terminal 对 `read -s` 交互不稳,敏感值可能回显终端历史;生产密码轮换走编码传参/平台密钥界面。
- 样式包图片复用 `projectId = packId` 与任务 ID 撞号,任务详情误显"场景参考"。`stylePackId` + 固定归属 + 旧数据迁移修复。
- 多账号共用浏览器时新账号看到旧账号本地数据。登录/注册/退出做本地工作区归属同步。
- 注册页"至少 6 位"与后端"至少 8 位"不一致。统一 8 位。
- Next 16.1.6 `middleware` 约定废弃。迁移为 `proxy.ts`。
- `npm run lint` 误扫 `.claude/worktrees/.next` 与种子脚本。补全局忽略。
- 场景图"氛围静物"开关不持久化不传服务端。新增 `sceneHasModel` 全链路贯通。
- GPT 生图扣费流水固定写 Gemini 模型名。`deductBalance` 接收真实 `apiModel`。
- 移动端 Header 过高/步骤文字隐藏/最近项目位置不合理等早期 UX 问题(已修复)。
- 早期任务详情页调用废弃生成函数、管理员初始化硬编码 fallback 密钥(已修复)。
- 上游渠道曾出现 503 不可用;仓库内严禁记录完整密钥。
