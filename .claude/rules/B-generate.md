---
paths:
  - "app/api/generate/stream/route.ts"
  - "lib/image-backends.ts"
  - "lib/kie-image.ts"
  - "scripts/setup-kie-image.sh"
  - "lib/postprocess.ts"
  - "lib/reference-image-normalizer.ts"
  - "lib/generation-record.ts"
  - "lib/generation-concurrency.ts"
  - "app/page.tsx"
---
# B 主出图

职责：单图（产品图 / 场景图）生成主链路，以及对各出图后端通道的调用与容错。

## 文件清单（改这个板块只读这些）
- `app/api/generate/stream/route.ts` — 1500+ 行的 SSE 主路由，**按路标取段**：`grep -n "===== \[" app/api/generate/stream/route.ts`，产品图分支和组图分支各自成段。
- `lib/image-backends.ts` — 各家出图通道的封装与选择（含 GPT 通道的 302 / kie 提供方选择、错误分类、余额不足识别）。
- `lib/kie-image.ts` — kie.ai GPT-Image-2.5 Flare 客户端（上传 → createTask → 轮询 → 下载；纯逻辑、不 import 项目内模块，可被 node:test 直接加载）。
- `scripts/setup-kie-image.sh` — 用户一键配置命令（装成 `silkmomo-kie`）：自检 key、写 Zeabur 变量、可选重新部署。
- `lib/reference-image-normalizer.ts` — 参考图尺寸诚实化 / 压缩，依赖原生 `sharp`。
- `lib/postprocess.ts` — 出图后处理。
- `lib/generation-record.ts` — 生成记录落库。
- `lib/generation-concurrency.ts` — 出图入口护栏：每人在途 SSE 流上限 + 请求体上限（纯逻辑，可被 node:test 直接加载）。
- `app/page.tsx` — 主工作台，产品图 / 场景图切换段有路标。

## 共享依赖
- 它依赖：`lib/auth`、`lib/billing`(F)、`lib/prompts/*`(G)、`lib/model-face-library`(D)、`lib/pending-image`(E)、`lib/brand-memory`(K)、`lib/models`。
- 依赖它的：前端 `app/page.tsx` / `app/task/[id]/page.tsx` 通过 SSE 消费，没有代码级 import。

## 改动前必读的坑
- **GPT 通道「不通」多半不是令牌分组问题**。历史根因是客户端缺 SSE 停滞检测（已修）+ `gpt-image-2-all` 是逆向通道。止血手段是设 `OPENAI_IMAGE_MODEL=gpt-image-2`，不要再去翻令牌分组。
- **`.env.local` 里同名变量重复时 dotenv 先到先得**，后面那条不生效；排查环境变量先 `grep -n` 数一下出现几次。
- **参考图超时有三层防御**（尺寸诚实化 + `sharp` 原生依赖 + 超时兜底），改上传体积 / 压缩逻辑前先把这一层看完，否则会把防御拆掉。
- **每人在途生成上限 `GENERATION_MAX_CONCURRENT_PER_USER`（默认 3）与请求体上限 `GENERATION_MAX_BODY_BYTES`（默认 64MiB）**：3 = 客户端最大并发 2 + 看门狗 abort 后服务端残留的 1 条；64MiB 是按 lookbook 组图 swap 模式最大合法负载（约 57MiB）留余量算的。名额在流开始时占、stream 的 `finally` 里必须释放，新增提前 return 的分支要确认没漏释放；进程内计数，多实例是「每实例每人」。
- **上游错误原文只进 `detail` / 服务端日志，不下发给用户**（见 `lib/image-backends.ts` 的脱敏）；前端展示的是分类后的中文提示。新增通道或错误分支别把 `response.text()` 直接塞进 SSE error。
- **Gemini 原生协议的密钥一律走请求头 `x-goog-api-key`，不许再拼 `?key=`**（URL 会随 fetch 异常、中转站日志外泄）；OpenAI 兼容协议走 `Authorization: Bearer`。1008 已用 apiyi 零成本探针实测：生图模型与 Lite 模型「正确密钥放请求头 + 非法请求体」得 400（鉴权通过），「错误密钥放请求头」得 401，说明中转站认请求头。`__tests__/upstream-auth.test.mjs` 守着这条（含源码扫描）。
- **上游地址环境变量**：`GEMINI_BASE_URL`（Gemini 生图，不带 `/v1beta`，默认 `https://api.apiyi.com`）、`OPENAI_IMAGE_BASE_URL`（GPT 生图，默认随令牌：独立令牌 `https://api.302.ai`，否则同 Gemini）、`AI_ASSISTANT_BASE_URL`（分析/对话回退，**带 `/v1beta`**，默认 `https://api.apiyi.com/v1beta`）。都不设就与线上现状完全一致。
- 已删除 `app/actions/generate.ts`（死代码），不要恢复。
- **同 runId 整次重放（所有目标镜次的幂等键都已 consume）不得有任何上游调用**：产品图 `productFullReplay`、单张场景图 `preflightBalance === null`、组图 `groupFullReplay`，都复用同一个 `isFullGenerationReplay`。新加生图前置的上游调用要挂在这些判据下；`__tests__/generation-billing-replay.test.mjs` 有源码断言。
- 生产主图通道：配了 `KIE_API_KEY` 时是 kie.ai GPT-Image-2.0（10-16 起；10-15 至 10-16 是 2.5 Flare）；没配（或 `OPENAI_IMAGE_PROVIDER=302`）回落 302.ai 的 `gpt-image-2`。换通道要连着 D 板块的锚图通道一起评估。

## GPT 通道的 kie.ai 提供方（1015，302 余额耗尽后切换）
- **提供方选择**（`lib/kie-image.ts` 的 `resolveOpenAIProvider`，进程启动时定一次，改变量要重新部署）：`OPENAI_IMAGE_PROVIDER` 显式写 `302` / `kie` 时照办；没写时 **配了 `KIE_API_KEY` 就用 kie**，没配就是 302 且行为与改造前完全一致。显式 `kie` 却没 key 会报 config 错（不会悄悄回落去打余额耗尽的 302）。**回滚 = Zeabur 加 `OPENAI_IMAGE_PROVIDER=302`（或删 `KIE_API_KEY`）后重新部署。**
- **变量**：`KIE_API_KEY`（必需）；可选 `KIE_IMAGE_MODEL_I2I`（默认 `gpt-image-2-image-to-image`）/ `KIE_IMAGE_MODEL_T2I`（默认 `gpt-image-2-text-to-image`）/ `KIE_IMAGE_RESOLUTION`（`1K|2K|4K`，**设了 = 全局覆盖画质档**，不设则按画质档映射）/ `KIE_BASE_URL`（默认 `https://api.kie.ai`）/ `KIE_UPLOAD_URL`（默认 `https://kieai.redpandaai.co/api/file-base64-upload`，完整地址）/ `KIE_POLL_INTERVAL_MS`（默认 2500）。一键配置命令 `silkmomo-kie`（`scripts/setup-kie-image.sh`）只写 `KIE_API_KEY`。
- **对外接口不变**：backend 名仍是 `openai`、前端「GPT」引擎选项、`generateImage` 入参出参、计费 / 幂等 / 交接缓冲 / 看门狗都没动。有参考图 → i2i（最多 16 张 `input_urls`，顺序与 302 的 `image[]` 一致，prompt 沿用「参考图角色」标注）；没有参考图（脸库候选脸）→ t2i。`BackendResult.model` 与生成记录里的上游模型名是 kie 的真实模型 id；脸库计费归因用 `resolveApiModel('openai', { textOnly: true })`。
- **画幅映射**：项目的 `1:1 / 3:4 / 4:3 / 9:16 / 16:9` 原样传；其它比例取最接近的 kie 允许值（`mapAspectToKie`）；非 1K 时不会选 `27:16 / 16:27 / 9:8 / 8:9`（这四个 kie 只有 1K）。**画质档映射分辨率**（`GenerationQuality`：`low` 草稿 / `medium` 标准 / `high` 高清 → `1K / 2K / 4K`，对应 kie 6 / 10 / 16 credits；`resolveKieResolution`）：`KIE_IMAGE_RESOLUTION` 设了合法值则作为全局覆盖、无视画质档；没有 quality 的调用和脸库候选脸（`medium`）都是 2K；点名只支持 1K 的四个比例时分辨率降到 1K（`resolveKieSize`）。4K 耗时按 2K 的 2 倍估约 80s，仍在 360s 预算内；4K 原图交付前仍会被 `normalizeGeneratedImage` 缩到声明尺寸（自定义尺寸宽高缺失时不缩，会是原始 4K，注意 pending/SSE 体积）。`maskImage` 被忽略（出图路由从不传它）。出图尺寸诚实化（`normalizeGeneratedImage` 按声明尺寸裁切 / 缩放）在 kie 之后照常生效。
- **超时**：kie 总预算（上传 + 建任务 + 轮询 + 下载）= `min(调用方 timeoutMs ?? 360s, OPENAI_TIMEOUT_MS=360s)`，**永远不超过 GPT 服务端单张上限**，所以 E 板块「客户端看门狗必须大于服务端超时」的约束不变（单测 + `scene-follow-swap.test.mjs` 守着）。轮询间隔 2.5s，单次请求 15s，轮询偶发网络 / 5xx / 429 / 422 容忍连续 6 次；超时不重试。`BackendInput.signal` 取消后立刻停止轮询；**出图路由故意不传 signal**——客户端断线后结果仍要落 pending 供重连取走。
- **错误映射**：沿用 `errorKind / httpStatus / detail`；原文只进脱敏后的 `detail` / 日志。新增 `errorKind: 'upstream_quota'`（上游余额不足）：302 的 HTTP 401 + `err_code -10004`「Insufficient account balance」、kie 的 `code/HTTP 402` 或余额字样，统一给用户「出图服务暂时不可用，请稍后重试」（路由追加「（已自动退款）」），不说鉴权失败；服务端日志打 `[upstream-quota]`，**看到它就是该去 kie / 302 充值了**。kie 任务 `state=fail`：审核类归 `moderation`，余额类归 `upstream_quota`，其余「出图服务生成失败」。
- **坑（都已在 `kie-image.ts` 处理，别拆）**：① 所有请求带浏览器 UA，否则 Cloudflare 403 error code 1010；② 上传域名是 `kieai.redpandaai.co`，文档写的 `api.kie.ai` 上传地址 404；③ `resultJson` 是 JSON 字符串，要二次 parse；④ 结果图在临时 CDN（约 3 天失效），必须当场下载成字节，且下载请求**不带 Authorization**；⑤ `aspect_ratio` 实际必填；⑥ **createTask 非幂等、没有 idempotency key**：请求发出后失败（超时 / 5xx / 断连）**不重投**，只在 DNS / 连接阶段失败或 429（被拒收）时重试一次，否则会重复建单重复扣 credits；⑦ 上传文件名必须随机（UUID）——同名可能在 kie 临时空间互相覆盖，把别的用户的参考图串过来；⑧ 参考图会以公网临时 URL 在 kie 保留约 3 天（隐私面，含脸库 / 场景图）；⑨ 异步任务制：进程在轮询中被杀 = 任务已建单、可能已扣 credits 但结果丢了（用户这边由孤儿清扫退款）；⑩ kie 1K 下 Flare 只出约 1360×768，2K 实际像素以真出图为准（3:4 2K：2.5 是 1776×2368，2.0 是 1536×2048），别凭记忆算裁切。
- **为什么默认 2.0 不用 2.5（10-16 客户投诉「画面斑驳」）**：用客户原单的提示词与 7 张参考图在 kie 上对照，2.5 Flare / Sunburst 的皮肤（额头、脸颊、下巴）有色块状斑点、缎面短裤高光发脏起皱，按交付尺寸看就能看出；2.0 皮肤均匀、面料高光干净，与 302 时期一致。我们自己的后处理（裁到 2:3 + Lanczos 缩到 1024×1536 + PNG 无损）对三者相同，不是原因。kie 的 `recordInfo.model` 只是回显请求，不能证明没换模型；能作旁证的是 2.0 与 2.5 出图尺寸、耗时、观感都明显不同。要再试 2.5，用 `KIE_IMAGE_MODEL_*` 覆盖并先做同单对照。证据 `verify/blotch-1016/`（本机，不入库）。
- **测试**：`__tests__/image-backends.test.mjs`（provider 选择、比例映射、resultJson、余额不足、轮询超时、取消、不重投）；端到端用 mock kie（带调用计数与鉴权 / UA / 参数断言）+ 临时库，不花钱。

## 测试与验收
- `npm run test:image`；护栏逻辑见 `__tests__/generation-billing-replay.test.mjs` 与 `lib/generation-concurrency.ts` 注释
- 手工验收：`/` 首页发起一次产品图生成，看 SSE 是否持续有字节、结果是否落到任务页。
