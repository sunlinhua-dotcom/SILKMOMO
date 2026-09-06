---
paths:
  - "lib/prompts/**"
  - "lib/api.ts"
  - "__tests__/prompt-snapshot.test.mjs"
  - "__tests__/fixtures/prompt-snapshot.json"
---
# G 提示词

职责：四个提示词 builder 与模特脸规格常量，是出图效果的唯一文本来源。

## 文件清单（改这个板块只读这些）
- `lib/prompts/product.ts` — `buildProductShotPrompt`
- `lib/prompts/scene.ts` — `buildSceneShotPrompt`
- `lib/prompts/group.ts` — `buildSceneGroupPrompt`
- `lib/prompts/face-anchor.ts` — `buildDerivedAnchorPortraitPrompt` 与 `MODEL_FACE_SPECS`
- `lib/prompts/shared.ts` — 四个 builder 共用的小工具
- `lib/api.ts` — **只是 re-export 桶**，为了让老的 `from '@/lib/api'` 一行不改。不要往里加新逻辑。

## 共享依赖
- 它依赖：无（纯函数，不碰 IO）。
- 依赖它的：`app/api/generate/stream/route.ts`(B)、`app/task/[id]/page.tsx`(E)、`lib/model-face-jobs.ts`(D)。

## 改动前必读的坑
- **四个 builder 的输出受快照测试保护**，任何字节变化都会让 `npm run test:prompts` 变红。这是设计意图，不是测试坏了。
- 确属有意改提示词时：先跑一次看红在哪，确认差异就是你想要的，再更新 `__tests__/fixtures/prompt-snapshot.json`，并在 commit message 里写清改了哪条规则、为什么。
- 历史：#4 提示词的五条规则已经用真图验证通过，不要凭感觉回退。
- 提示词是纯文本，改一个字就是一次线上效果变更，不存在"小改动"。

## 测试与验收
- `npm run test:prompts`
- 手工验收：同一组输入改前改后各出一次图，肉眼比对；单张图不算数（见 D 板块的三组对照）。
