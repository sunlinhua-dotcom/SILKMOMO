# SILXINE 进度

> 里程碑时间线(新条目加在最上方)。踩坑明细见 [BUGS.md](BUGS.md),过程日志见本地 `LOG.md`。

## 时间线

### 2026-07-19
- **出图尺寸「诚实化」后处理**：新增 `lib/postprocess.ts`，用 Sharp 对生成成功的 PNG 按预设声明尺寸做居中裁切与受限缩放。宽高比偏差 >2% 才裁切，裁切损失 >25% 整张原样保护，放大仅允许 ≤1.35×；任何后处理异常 fail-open，不影响已扣费的成功出图。产品镜次、单张场景、sceneGroup swap/products 三条成功路径已接线，后续 anchor 使用规范化后图像；不计费肖像卡不处理。SSE `result` 仅新增 `width/height`，原字段不变。
  - **资金边界**：三条路径的 `deductBalance` 成功到 inner try 之间均无 `await`；normalize 只在上游 `result.success && result.data` 之后、原 inner try 内执行，扣费/退款分支未变。
  - **验证**：15 个产品/场景预设矩阵通过，含 `ins_3_4 1024×1536 → 1080×1440`、`ins_vertical → 1080×1350`、`google_banner 16:9 输入因 >25% 面积损失原样保留`、非法 base64 fail-open；`tsc/build/lint` 通过（lint 0 error、12 条既有 `<img>` warning）。本地 4605 真实端到端：最终依赖状态下 Gemini 28s，额外 GPT low 49s，两者落盘 PNG 与 SSE payload 均为 `1080×1440`。

### 2026-07-07
- **「组图·换装」换脸稳定性修复 + 同景换品模式落地**：针对真人穿拍产品图会把产品图模特脸带入新模特的问题，完成 P0/P1/P2 全链路修复。Prompt 明确产品图中的任何人物都不是身份参考，只保留服装面料/颜色/图案/版型；GPT edit 参考图顺序改为 `scene-base → anchor → product → accessory`，anchor role 明确为唯一身份参考。sceneGroup 首批生成前新增不计费 Gemini 肖像卡 anchor bootstrap，并通过 SSE `anchor` 事件写入 IndexedDB `type='anchor'`；失败静默回退首张成功图作锚。任务页扩展 sceneGroup+OpenAI ≤3 分块并跨块传 anchor。`/lookbook` 新增模式切换：「换装 · N景1品」保留现有流程，「同景换品 · 1景N品」支持单张场景图 + 最多 8 个产品组（每组 1-4 张 + 可选组名），写入 `sceneGroupMode='products'` 与 `groupIndex`，任务页按产品组序号重做/补齐。`analyzeLookbookGroup` 增加真人穿拍检测并在主品上传区提示补充平铺/白底图更稳。
  - **资金与存储约束**：不新增付费点；肖像卡和服装分析仍在扣费前；sceneGroup `swap/products` 两种模式共用逐张 `checkBalance→deductBalance→inner try→成功/失败/断连` 骨架，`deductBalance` 成功后到 inner try 之间无 `await`。Dexie 不 bump 版本，`SilkMomoDB`、`silkmomo_*`、`silkmomo_token` 均未改名。
  - **验证**：`npx tsc --noEmit` 通过；`npm run build` 通过（仅既有 CSS `@property` warning）；`npm run lint` 通过，0 error（保留既有 `<img>` warning）。未做真实出图打样，视觉效果需用户用客户产品图验证。

### 2026-07-02
- **「组图·换装」重构为独立入口 /lookbook**（承接 07-01 组图功能）：按用户「两个完全独立的入口」的架构，把组图从「场景图模块里的子 toggle」提成与产品图工作台平级的**独立路由** `app/lookbook/page.tsx`(LookbookStudio)。经**联网调研 + 3 代理设计 + 对抗式审查**定稿：独立路由让 A/B 的 state 编译期隔离、互不污染（业界对「不共享输入/画布的两种工作方式」的标准做法）。首页顶部新增 `WorkspaceSwitcher` 双卡入口。B 工作台流程：一进来直接上传整组 lookbook → 自动识别(骨架加载) → 按品类**动态每类一个上传框**(主品不限张) → 换新模特/尺寸 → 生成，写同一 SilkMomoDB(moduleType=scene, sceneGroup=true) 跳 /task/[id]，复用已建好的组图 SSE 内核（零改）。
  - 新增 `components/WorkspaceSwitcher.tsx`、`components/LookbookGarmentSlots.tsx`；`app/page.tsx` 删净所有 sceneGroup 代码 + 接入 WorkspaceSwitcher；`components/SceneShotModule.tsx` 回退为纯单张场景。
  - 对抗审查抓出并修：lookbook 上限对齐后端 **20**、主品图**合计≤8**(否则任务页超限 400 静默失败)、B 引擎默认 **GPT edit**(只有 edit 能冻结场景)、canGenerate 必含「≥1 件主品且落库 type=product」(任务页硬门控)、自动识别指纹只在成功后写(失败可自动重试)。
  - **验证**：tsc/eslint/build 全绿；预览浏览器(带登录态)实时点验通过——首页双卡入口、/lookbook 独立工作台直达(无产品门控)、上传 lookbook→N进N出→自动识别→动态品类槽(合计x/8)、A 回归单张正常、无 console error。真实出图打样(冻结+换脸质量)仍需用户用真实图验收。未提交未推送。

### 2026-07-01
- **场景图「组图·换装」新功能**(需求 new0701 V3):场景图模块从"生成单张"升级为"上传 N 张 lookbook → 生成 N 张"。每张冻结原场景+姿势，只把服装换成用户主品、并换成同一个全新匿名模特(规避原图真人五官侵权)；附件默认保留(未上传替换时)；尺寸用户可选；张数动态无写死(软上限 20，张数多靠"生成剩余"分批续跑)。
  - **后端**:`/api/generate/stream` 场景分支新增 `if(sceneGroup)` 的 N 循环，完全复用产品图分支的逐张 `checkBalance→deductBalance→失败/异常/断开退款→recordGeneration` 资金骨架(每张 65 分原子扣减/失败退款)；每张独立(某张失败不整批中止)；首张成功图作 anchor 锚定新模特、重做/补齐时由客户端带上已有结果图作 anchor 保证全组同一新人。默认走 GPT edit(`/v1/images/edits`，`sceneAsEditBase` 把 refs[i] 当底图)保留场景/姿势，Gemini 为可选回退。结果用 **1-based** `shotIndex`(参考图序号 1..N)承载，复用对比旧版/还原/单张重做/剩余补齐。
  - **分析**:`lib/ai-assistant.analyzeLookbookGroup` 多图识别主品(衣/裤/裙) vs 附件(包/首饰/项链)，`/api/ai/analyze` 支持 `images[]` 组图分支(扣一次 aiAnalysisPricePerCallFen，失败退款)。
  - **前端**:`SceneShotModule` 加"单张场景图/组图·换装"模式切换、lookbook 上传(最多 20 张)、识别品类动态槽位、可选替换附件、换新模特说明；`page.tsx` 落库 `sceneGroup`/`sceneGroupCategories`、成本按 N×65。`lib/db.ts` Project 加两个可选字段(无 Dexie 版本迁移)。
  - **验证**:5 路设计 + 4 维对抗式代码审查(资金安全/循环边界/端到端契约/回归)修 3 处(analyze 按钮标价误述 ¥0.02→¥0.35、组图重做/补齐漏传 anchor 会换成第二个人、analyzeGroup stale 竞态)；tsc/eslint/build 全绿；预览浏览器登录态实时点验通过(模式切换、lookbook 3/20、`已上传 3 张→将生成 3 张`、`/api/ai/analyze` 组图 200、标价 ¥0.35)。**真实图的生成效果打样(冻结+换脸质量)需用户用真实产品/lookbook 图自行验收**。

### 2026-06-13
- **AI 聊天切换 DeepSeek**:`/api/ai/chat` 主通道改为 api.deepseek.com `deepseek-v4-pro`(OpenAI 兼容协议 + json_object 结构化输出),新增 `DEEPSEEK_API_KEY`/`DEEPSEEK_CHAT_MODEL` 环境变量,未配置时自动回退 Gemini Lite 零中断;本地端到端实测 3s 响应、参数提取准确、计费按真实模型归因。产品图分析/质量评分保持 Gemini Lite(需视觉)。
- **品牌更名 SILXINE**:全部用户可见文案/标题/OG/SEO 从 SILKMOMO 改为客户正式名 SILXINE;全新品牌视觉——丝绸缎带 "S" SVG 标识(内联组件 + favicon icon.svg + logo.svg)、OG 分享图与 iOS 图标按 silxine.com 官网基因重绘(Newsreader 衬线/墨 #2C2825/米白 #F5EFE7/金棕)。内部存储键(silkmomo_*、SilkMomoDB、cookie)与仓库名保留代号并加防误改注释;下载文件名改为 silxine-*。旧品牌资产归档 refs/archive。

### 2026-06-12
- **线上"生图卡住"根因解决**:生产 `GEMINI_API_KEY` 为失效/限速令牌(实测 100-150s/张,撞 120s 超时),更换为正常令牌后 Gemini 19 秒出图。管理员账号浏览器端到端实测通过(登录→上传→生成→出图→计费正确)。
- **GPT 图像通道独立令牌**:新增 `OPENAI_IMAGE_API_KEY` 支持(`1c6df5e`),独立令牌默认模型 `gpt-image-2`;线上已配置并实测出图(152-235s/张,GPT 通道本身速度,非故障)。生成记录按真实上游模型名归因(`4faa9ba`)。
- **JWT_SECRET** 更换为强随机值(原值为占位的 change-me)。
- **仓库目录重构**:文档归入 `docs/`,本地素材归入 `refs/`(gitignore),脚本归入 `scripts/`,清理根目录约 90MB 重复/散落文件;README/CONTEXT 重写。

### 2026-06-11
- **全代码库 bug 审计与修复**(5 路并行审查,约 40 项,`daf6bc5` + `47a0829`):资金正确性(原子扣费、失败退款、退款日志、统计净额化)、参数断链(自定义尺寸全链路、聊天体型/肤色、stale closure、重做备份)、任务生命周期(processing 卡死恢复、取消语义、余额不足可见)、客户端数据层(图库迁 IndexedDB、迁移互斥、多账号 fail-closed)、认证安全(时序枚举、失败计数限流、XFF 取尾、proxy 请求头注入、API 401 JSON)。lint 0 error、tsc、build 通过,本地浏览器冒烟 + 线上 SSE 探测验证。
- 部署到 Zeabur 并验证新版标记(未登录/过期 JWT 调 `/api/*` 返回 401 JSON)。

### 2026-06-09
- 代码推送 `origin/main`(部署提交 `43164b3` → `dcd7146`)。
- Zeabur 生产管理员 `admin` 密码重置,线上登录验证通过。
- 修复登录/注册后本地工作区清理卡住("登录中...")问题。
- 完成 `silxine.com` 线上电商站点外部审计(改进项见 BUGS.md 未决事项)。

### 2026-05-30
- 浏览器逐项巡检:修复样式包图片污染任务、跨账号本地数据残留、注册密码提示不一致、Next 16 middleware 迁移与 lint 阻断项。
- 登录态全模块生图矩阵:产品图/场景图 × Gemini/GPT Image 2 全部真实生成;修复场景"氛围静物"不生效与 GPT 扣费模型名误记。

### Phase 2-4(早期)
- Phase 2:产品图/场景图模块拆分、风格锁定、批量输出。
- Phase 3:注册登录、计费流水、账单页、管理后台与管理员初始化。
- Phase 4:品牌 DNA 记忆、生成反馈、AI 分析辅助。
- 本地开发端口统一为 `4605`。

## 进行中 / 下一步
- UI/UX 优化清单待排期(2026-06-12 审查产出,见 BUGS.md「未决事项 · UI/UX」)。
- `silxine.com` 电商站点改进项待排期:商品重量配置、About 首屏空白、售卖路径文案、商品图 alt、H1 层级、第三方脚本错误复核。
- 非阻断 lint warning:若干 `<img>` 可换 `next/image`。
- 线上测试残留可清理:任务 task 1-4、探测账号 `probe-test-0611`。
