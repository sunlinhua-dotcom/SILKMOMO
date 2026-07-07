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
- **线上必须配 `OPENAI_IMAGE_API_KEY` 才能用 GPT 通道**(否则 GPT 全失败,见已修复归档 06-26):代码无独立令牌时默认调 `gpt-image-2-all`,而客户提供的 GPT 令牌(apiyi `image2Enterprise` 计划)`/v1/models` 只暴露 `gpt-image-1 / gpt-image-1-mini / gpt-image-1.5 / gpt-image-2`,**没有 `gpt-image-2-all`** → 503「no available channels」。把该令牌设为 `OPENAI_IMAGE_API_KEY`,代码会自动切到它支持的 `gpt-image-2`。本地已实测 `gpt-image-2` 出图正常(75-120s/张)。**改 Zeabur 环境变量后必须重启/重新部署才生效。**
- GPT 图像通道单张 75-235s 属上游速度,非故障;**多张批量在单个 SSE 请求里串行跑,N 张 ≈ N×~120-200s**,大批量建议用 Gemini(路由预算已放宽到 800s,够「分析 + 1-2 张 GPT」)。
- 线上测试残留可清理:任务 task 1-4(2026-06-12 端到端测试产生)、探测账号 `probe-test-0611`(余额 0)及其一条"余额不足"失败记录。
- Zeabur 环境变量遗留项 `PASSWORD`、`NEXT_PUBLIC_API_URL` 代码均未读取,可删可留。

---

## 二、已修复归档

### 2026-07-07(组图真人穿拍产品图污染新模特身份 → Prompt + anchor + 分块 + 新模式修复)
- **症状**:`/lookbook`「组图·换装」在客户产品图是真人穿拍时，生成的新模特脸经常被产品参考图里的模特脸带偏；首张失败锚还会污染整批。
- **根因**:① `buildSceneGroupPrompt` 只要求不抄 scene-base 人脸，没明确产品图里的人不是身份参考；② GPT edit sceneAsEditBase 参考图顺序把 anchor 放最后，1 张 anchor 抗不过多张产品真人脸；③ 首批第 1 张没有稳定 anchor，首张一旦被带偏会污染后续。
- **修法**:Prompt 同时忽略 scene-base 与 product 人脸，产品图只作服装参考；sceneAsEditBase 顺序改为 scene-base → anchor → product → accessory；sceneGroup 首批扣费前不计费生成 Gemini 虚构模特肖像卡并通过 SSE `anchor` 落库，失败回退首张成功图；任务页 sceneGroup+OpenAI 按 ≤3 分块并跨块优先传 anchor；新增「同景换品 · 1景N品」模式复用同一 anchor 机制。
- **验证**:`npx tsc --noEmit`、`npm run build`、`npm run lint` 均通过；未做真实出图打样。

### 2026-07-01(GPT 一次生成 >5 张:单请求过长第 5 张必挂 → 分块生成，先稳）
- **症状**:GPT(openai)串行生成,一次 5 张(默认镜次 [1,2,3,4,9])到第 5 张必失败。
- **根因**:5 张 GPT 串在**同一个 SSE 请求**里,每张上游 ~3 分钟 → 单请求 ≈ 15 分钟,超过路由预算(maxDuration 800s)与 Zeabur 网关的单连接总时长上限(25s 心跳只防空闲、防不住总时长),第 4–5 张之间被掐断。客户端 fetch 无超时、每张 OpenAI 超时各 280s 不累计,都不是元凶——是整个请求跑太久。
- **修法(先稳,不并发)**:把「一个任务的 N 张」与「一个 HTTP 请求」解耦——产品图 + openai 且镜次 >3 时,`handleStartGeneration` 内部把镜次切成**每块 ≤3 张的连续请求**(每块 ≤ ~9 分钟,稳在预算内),`done` 不再每块定稿、改到全部块跑完后统一定稿,进度用 `doneSoFar` 偏移 + `grandTotal` 分母跨块累计。为保持整组模特一致,给 `/api/generate/stream` 加**客户端可传的 `anchorImage`**:首块产出的"有模特"图作为锚点回传给后续块。gemini(每张 ~25s)与场景图仍单请求,行为不变。
- **验证(clone 内真机)**:5 张 GPT(gpt-image-2)跑成 **两个请求 [1,2,3]+[4,9]**(349s + 230s,各自远低于预算),**5/5 出图**,anchor 从块 1 shot#1 传到块 2;`tsc` 通过、`eslint` 0 error。
- **附:对抗式复审又修了 3 处分块引入的回归**:① 前块 fatal(余额不足)不再向后续块发请求(加 `fatalStop`);② 进度条不再在每个后续块开头从 ~60% 回跳到 8%(analyzing 相位只在首块 `chunkIdx===0` 进入);③ 恰在两块之间取消now正确显示"已取消"而非"已完成"(块间 abort 置 `wasCancelled` + 跳过统一定稿)。
- **后快(未做,可选)**:锚定完成后把后续块用 2–3 有限并发跑以缩短总时长——需先探明该 GPT 令牌真实并发上限,不支持则维持串行。
- **环境备注**:本次因项目卷 `/Volumes/ProjectsAPFS/SILKMOMO` 被 macOS 收回读权限(Claude 宿主进程无该外置卷访问,普通终端正常),改在 `~/silxine-work` 全新 clone 里开发+验证+推送(生产从 GitHub main 部署,不依赖本地路径)。

### 2026-06-30(同类排查:必需 UI 被瞬时状态门控的死胡同,共修 4 处）
- 用多代理专项审计扫「必需 UI 被 step/showAdvanced/trialDone/errorMessage 等门控、某进入路径留下坏组合」的同类问题(7 候选确认 4):
  1. [medium] 时光机回放**产品图**快照:恢复了 selectedShots 但没 `setShowAdvanced` → 镜次既不可见、「快速生成」又只用默认镜次,"按相同参数重做"落空。修复:回放带镜次的产品图快照时一并展开高级区并 `setStep(3)`(与场景按钮/AI/折叠开关一致)。已验证:回放 `[1,4]` 快照 → Step3 展开、镜次 1/4 选中、按钮「生成 2 张」。
  2. [low] 步骤指示器点「3 生成」:只 `setStep(3)` 不展开高级 → step=3 但 advancedShown=false,Step3 不渲染,指示器高亮却无内容。修复:该分支一并 `setShowAdvanced(true)`。
  3. [medium] 任务页「生成剩余」面板门控在内存态 `trialDone`(刷新即丢、DB 不存)→ reload 一个「已完成但只出了部分镜次」的任务后,所有续生成入口消失,只剩会降级重做的「调整参数」。修复:改用持久化的 `project.status==='completed' && images<getShotCount()` 作主条件(trialDone 作同会话兜底)。已验证:reload task5(1/5)后「生成剩余 4 张」正常出现。
  4. [low] 同上连带:amber 错误块里的「补生成剩余」按钮与上面面板重复,且其门控 `errorMessage` 在取消/reload 后可能为空。修复:去掉重复按钮(续生成统一由 #3 面板提供),amber 块只留错误信息展示。reload 续生成入口由 #3 一并恢复。
- 验证:`tsc` 通过、`eslint` 0 error、浏览器逐条验证、无 console 报错。

### 2026-06-30(场景图工作区整块消失 — 折叠改动的二次回归）
- **症状**:用户进入场景图模式后,下方场景工作区(场景参考图上传框等)整块空白消失(只剩页脚)。
- **根因**:场景图的必需控件(场景参考图等)都在 Step 3,渲染条件是 `step>=3 && showAdvanced`;而本轮「折叠」改动把展开/收起入口在场景模式下隐藏了。于是任何让 `showAdvanced` 停在 false 的进入路径——尤其**时光机「快速重做」回放场景快照**(`handleReplay` 只 `setStep(2)`、从不 `setShowAdvanced(true)`)——都会让场景模式既渲染不出 Step 3、又没有入口展开 = 工作区空白且无法恢复。
- **修法**:引入派生值 `advancedShown = showAdvanced || activeModule === 'scene'`,统一驱动「隐藏 Step2 重复控件」与「渲染 Step3」。场景图视为「高级区永远展开」(其工作区是必需项、非可选),与「是否点过折叠」无关;Step3 渲染条件改为 `step >= 2 && advancedShown`。这样无论从按钮、AI、还是时光机回放进入场景模式,工作区都稳定显示,且不会和 Step2 控件重复。产品图行为不变(仍用 showAdvanced 控制折叠)。
- **验证**:浏览器复现——注入场景快照→上传产品图→点「快速重做」回放→Step3 场景参考图工作区正常显示,引擎/模特选择器各仅一套、无模特快选重复;产品图模式折叠/展开、快速生成按钮、切换均正常;`tsc` 通过、无 console 报错。
- **教训**:把"必需工作区"塞进"可折叠的高级区"、再按模式隐藏折叠入口,等于给某些进入路径留了死胡同。必需 UI 的可见性应由"模式/数据"驱动,不要依赖某个可被隐藏的开关。

### 2026-06-26(Gemini 超时尾巴 + 多代理代码审计 11 项小 bug）
- **Gemini「响应 JSON 解析失败」尾巴**:`lib/image-backends.ts` 连上后读 body(`await response.text()`)被同一超时 signal abort,旧代码当成「JSON 解析失败」且不重试。修复:body 读取单独 try——Gemini 识别为超时并重试一次,GPT 如实报超时(不重试,策略一致);GPT/Gemini 解析失败文案统一脱敏。
- **多代理审计**(9 区并行审查 + 对抗式验证,36 候选→确认 12,修 11、暂缓 1):
  1. [medium] `auth/login`:IP 限流用 `rateLimit`(连成功登录也计数)且成功不重置 → 共享出口 IP(NAT/CGNAT)下 10 次正常登录就把整段 IP 锁死。改为 `isRateLimited` 只查 + 仅失败 `bumpRateLimit`(与用户名限流一致)。
  2. [low] `ai/chat`:DeepSeek/Gemini 返回 200 但 content 为空时照扣费不退款 → 加空回复退款守卫。
  3. [low] `ai/chat`:有 `{}` 但 JSON 非法(截断/未引号 enum/尾逗号)落到空 catch、白扣费 → catch 内退款。
  4. [low] `brand` PUT:`req.json()` 未包 try/catch,坏体抛 500(应 400);非数组 colorPalette 入库污染 → 加解析守卫 + 丢弃非法 colorPalette。
  5. [medium] `generate/stream`:选「自定义尺寸」却缺/非法宽高时静默回退占位 3:4,横版被当竖图且无报错 → 缺合法宽高直接 400。
  6. [medium] `generate/stream`:出图成功但客户端断开时,既记一条 success 又记一条 disconnect 失败 → 合并为单条(按是否交付定 success),产品图与场景图两分支都改。
  7. [low] `app/page` Step3 生成按钮:余额不足且参数不全时被 disable,充值入口点不动 → 仅「余额够但参数不全」才禁用。
  8. [low] `app/page`:AI 触发的快速生成跳过余额校验,余额不足也建注定失败的任务 → 与可见按钮一致,余额不足转充值弹窗。
  9. [medium] `task/[id]` 单图重做:`handleStartGeneration` 因 startLock/abort 提前 return 时,旧图已被降级为 backup → 永久丢图。`handleRegenerate` 守卫补 startLock/abortController 检查。
  10. [medium] `image-library`:去重指纹只取 base64 前 100 字符,同源/同模板图被误判重复静默丢弃 → 改 体积+尺寸+长度+尾 64 字符 组合指纹。
  11. [medium] `image-compressor`:<200KB 跳过压缩时不缩放,高压缩比的超大像素原图原分辨率流向下游 → 像素超 MAX_DIMENSION 仍走缩放路径。
- **暂缓(非正确性 bug,纯效率)**:客户端断开时未取消正在进行的上游生成调用(整张跑完才退款,省不下上游 token)。需把 `req.signal` 透传进 image-backends 的 fetch(`AbortSignal.any`),改动较大,后续单独做。
- 验证:`tsc` 通过、`eslint` 0 error;API 层 10 项断言全过(brand 坏体→400、自定义尺寸缺宽高→400、登录限流重构后正常登录/错密码行为不变)。
- **回归复审(多代理 review 本次 diff,8 候选确认 3 回归,全部已修)**:
  1. [medium] `task/[id]` 失败镜次「重新生成这张」按钮误用 `disabled={generating}`,而该 amber 块整体只在 `generating` 时渲染 → 永远灰着、生成一结束就 unmount = 死按钮。修复:该块改回纯信息展示(同一条 SSE 流跑着本就无法中途单张重试);单张重试由生成结束后的「补生成剩余」与失败态「重试这张」(已验证可点)承担。
  2. [low] `app/page` AI 场景动作无条件 `setStep(3)`,0 产品图时会提前渲染空的 Step2/3。修复:仅当已有产品图才 `setStep(3)`;上传完成的副作用按模式推进(场景→Step3、产品→Step2),保证场景流不卡死(已浏览器验证:切场景图→Step3+场景参考图上传框正常)。
  3. [low] `image-compressor` <200KB 大像素 GIF 被新缩放守卫送进 canvas → 拍平成静态首帧且改写 mimeType。修复:守卫加 `file.type !== 'image/gif'` 例外,动图 GIF 原样放行。

### 2026-06-26(GPT Image 2 一直失败:根因 = 模型不在该令牌计划内)
- **症状**:GPT Image 2 生图持续失败——线上报「网络连接失败(超时 180s)已自动退款」,用客户给的 GPT 令牌本地复现则是秒级「OpenAI API 失败 (503):...no available channels for model **gpt-image-2-all**...」。
- **根因(实测确认)**:无独立令牌时 `lib/image-backends.ts` 默认调 **`gpt-image-2-all`**;但客户 GPT 令牌(apiyi `image2Enterprise` 计划)`GET /v1/models` 只暴露 `gpt-image-1 / gpt-image-1-mini / gpt-image-1.5 / **gpt-image-2**`,**根本没有 `-all` 变体** → apiyi 直接 503「该计费模式下此模型无可用通道」。同款 3 图请求换成 `gpt-image-2` 立即 200 出图(75-120s)。(对照:我本地另一把主令牌 `sk-ACN…` 能跑 `-all`,所以代码一直"看起来没问题",问题只在换了这把只支持 `gpt-image-2` 的令牌时暴露。)
- **修法**:① 主修——把该令牌设为 **`OPENAI_IMAGE_API_KEY`**,`image-backends` 检测到独立令牌即自动切模型为 `gpt-image-2`(该计划支持的),与生图主令牌解耦;② 顺带加固 GPT 超时 180s→**280s**(覆盖上游正常上限 235s,抽成 `OPENAI_TIMEOUT_MS`)、**超时不再自动重试**(只重试非超时的瞬时网络错误)、SSE 路由 `maxDuration` 300s→**800s**;③ 任务页给「失败镜次」加 **「重试这张 / 重新生成这张」** 单张重生按钮(复用既有 `handleStartGeneration([shotIndex])`,部分失败/整体失败两处错误区都加)。
- **验证**:本地配 `OPENAI_IMAGE_API_KEY` 后经 `/api/generate/stream` 真实出 GPT 图成功(`status→status→result→done` 109s,扣 65 分,归因 **`gpt-image-2`**);临时强制回 `gpt-image-2-all` 在 App 内复现了同样的 503,并确认失败镜次旁出现「重试这张」按钮;`tsc` 通过、`eslint` 0 error。
- **仍需线上动作**:在 Zeabur 给 silkmomo 服务加环境变量 `OPENAI_IMAGE_API_KEY=<该 GPT 令牌>`(**不要**再设 `OPENAI_IMAGE_MODEL`,留空让代码自动选 `gpt-image-2`),**重启/重新部署**生效;并把本次代码改动 push 到 `main` 触发部署。生成本身串行(单 SSE 流 + 防双击锁),无需改并行逻辑。

### 2026-06-24(全流程端到端回归 + 修复)
- 全流程浏览器/API 回归:认证、品牌、计费、管理后台、AI 分析/聊天、生图(Gemini 产品+场景、GPT 产品)、反馈、记录全部跑通;含真实出图(本地令牌 Gemini 26-53s/张,扣费精确 65 分/张,失败/断开自动退款,GPT 通道归因 `gpt-image-2-all`)。53 项 API 断言 + 完整 UI 生图(上传→分析→选镜次→任务页 SSE→画廊→续生成)。
- 页脚年份不一致:`app/tasks/page.tsx` 页脚为「© 2025」,而首页 `app/page.tsx`、任务页 `app/task/[id]/page.tsx` 均为「© 2026」。修复:统一为 2026。
- `refs/`(本地素材库,gitignore)未被 eslint 忽略,临时 E2E 脚本产生无谓告警。修复:`eslint.config.mjs` globalIgnores 增加 `refs/**`。lint 现仅剩既有 `<img>` LCP 告警(P2-5),0 error;`tsc --noEmit` 通过。
- 复核非 bug:`/logo-preview` 首屏截图疑似空白,实为 SVG 加载时序(`naturalWidth` 此刻为 0),稍后渲染正常,golden-S logo 与字标均正确;`/_next/image` 对 SVG 返回 400 属 Next 默认行为,next/image 直出原图不受影响。

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
