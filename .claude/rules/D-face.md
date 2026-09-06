---
paths:
  - "lib/model-face-*.ts"
  - "lib/prompts/face-anchor.ts"
  - "app/api/model-face/**"
  - "app/api/model-faces/**"
  - "components/ModelFaceLibraryPanel.tsx"
---
# D 脸库与身份锚

职责：模特脸库的增删改查、派生身份锚图的生成与复用、跨图换脸的一致性。

## 文件清单（改这个板块只读这些）
- `lib/model-face-library.ts` — 脸库 CRUD。
- `lib/model-face-jobs.ts` — 锚图生成任务（478 行，最重的一个）。
- `lib/model-face-job-runner.ts` / `-operations.ts` / `-policy.ts` — 任务执行、操作与策略。
- `lib/model-face-image.ts` — 脸图存取。
- `lib/model-face-billing.ts` / `-billing-core.ts` — 脸库相关计费（跨 F 板块）。
- `lib/prompts/face-anchor.ts` — 派生锚图提示词与 `MODEL_FACE_SPECS`。
- `app/api/model-faces/route.ts`、`app/api/model-faces/[id]/route.ts`、`app/api/model-face/route.ts`、`app/api/model-face/jobs/[id]/route.ts`
- `components/ModelFaceLibraryPanel.tsx`

## 共享依赖
- 它依赖：`lib/prisma`(Z)、`lib/auth`(A)、`lib/billing`(F)、`lib/image-backends`(B)、`lib/prompts/face-anchor`(G)。
- 依赖它的：`app/api/generate/stream/route.ts`、`app/lookbook/page.tsx`。改 `model-face-library` 的导出签名前先 grep 这两处。

## 改动前必读的坑
- **单样本 ΔRGB 波动可达 3 倍，不能凭一张图下结论**。任何肤色 / 一致性结论至少要三组对照才算数。
- **`gemini-3-pro-image` 当锚会把成图带偏白**。默认锚模型是 `gemini-3.1-flash-image-preview`（环境变量 `DERIVED_ANCHOR_MODEL`），不要"升级"到 pro。
- **肤色指令看起来重复，但不能删**。删过，成图立刻偏色。
- 脸图属于用户隐私素材，调试时不要把图落到仓库里，放 `verify/`。

## 测试与验收
- `npm run test:face`
- 手工验收：`/lookbook` 的脸库面板建一张脸，跑一次带脸的生成，看三张成图里是不是同一个人。
