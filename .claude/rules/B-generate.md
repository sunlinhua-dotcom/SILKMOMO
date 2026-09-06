---
paths:
  - "app/api/generate/stream/route.ts"
  - "app/actions/generate.ts"
  - "lib/image-backends.ts"
  - "lib/postprocess.ts"
  - "lib/reference-image-normalizer.ts"
  - "lib/generation-record.ts"
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
- `app/page.tsx` — 主工作台，产品图 / 场景图切换段有路标。

## 共享依赖
- 它依赖：`lib/auth`、`lib/billing`(F)、`lib/prompts/*`(G)、`lib/model-face-library`(D)、`lib/pending-image`(E)、`lib/brand-memory`(K)、`lib/models`。
- 依赖它的：前端 `app/page.tsx` / `app/task/[id]/page.tsx` 通过 SSE 消费，没有代码级 import。

## 改动前必读的坑
- **GPT 通道「不通」多半不是令牌分组问题**。历史根因是客户端缺 SSE 停滞检测（已修）+ `gpt-image-2-all` 是逆向通道。止血手段是设 `OPENAI_IMAGE_MODEL=gpt-image-2`，不要再去翻令牌分组。
- **`.env.local` 里同名变量重复时 dotenv 先到先得**，后面那条不生效；排查环境变量先 `grep -n` 数一下出现几次。
- **参考图超时有三层防御**（尺寸诚实化 + `sharp` 原生依赖 + 超时兜底），改上传体积 / 压缩逻辑前先把这一层看完，否则会把防御拆掉。
- 生产主图通道是 302.ai 的 `gpt-image-2`，换通道要连着 D 板块的锚图通道一起评估。

## 测试与验收
- `npm run test:image`
- 手工验收：`/` 首页发起一次产品图生成，看 SSE 是否持续有字节、结果是否落到任务页。
