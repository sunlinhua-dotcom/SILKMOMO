---
paths:
  - "app/api/generate/stream/route.ts"
  - "lib/image-backends.ts"
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
- `lib/image-backends.ts` — 各家出图通道的封装与选择（590 行）。
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
- 生产主图通道是 302.ai 的 `gpt-image-2`，换通道要连着 D 板块的锚图通道一起评估。

## 测试与验收
- `npm run test:image`；护栏逻辑见 `__tests__/generation-billing-replay.test.mjs` 与 `lib/generation-concurrency.ts` 注释
- 手工验收：`/` 首页发起一次产品图生成，看 SSE 是否持续有字节、结果是否落到任务页。
