---
paths:
  - "lib/model-face-*.ts"
  - "lib/prompts/face-anchor.ts"
  - "app/api/model-face/**"
  - "app/api/model-faces/**"
  - "components/ModelFaceLibraryPanel.tsx"
  - "lib/object-storage.ts"
  - "scripts/model-face-storage-migrate.mjs"
  - "scripts/setup-r2-storage.sh"
---
# D 脸库与身份锚

职责：模特脸库的增删改查、派生身份锚图的生成与复用、跨图换脸的一致性。

## 文件清单（改这个板块只读这些）
- `lib/model-face-library.ts` — 脸库 CRUD。
- `lib/model-face-jobs.ts` — 锚图生成任务（478 行，最重的一个）。
- `lib/model-face-job-runner.ts` / `-operations.ts` / `-policy.ts` — 任务执行、操作与策略。
- `lib/model-face-image.ts` — 脸图规范化（sharp：原图 q88 JPEG + 256px 缩略图）。
- `lib/object-storage.ts` — S3 兼容对象存储客户端（aws4fetch 签名，PUT/GET/DELETE，超时 + 重试 2 次 + 错误脱敏）。纯逻辑、不 import `@/`，可被 node:test 直接加载。
- `lib/model-face-storage.ts` — 脸图放哪儿的决策（key 命名、上传失败清理、读取优先 key、删除尽力而为），同样不碰 prisma。数据库读写在 `model-face-library.ts`。
- `scripts/model-face-storage-migrate.mjs` — 库 ⇄ 对象存储搬家脚本；`scripts/setup-r2-storage.sh` — 用户一键配置命令（装成 `silkmomo-r2`）。
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
- **派生身份锚走 Gemini 协议**（`lib/image-backends.ts` 的 `DERIVED_ANCHOR_MODEL`），密钥在请求头 `x-goog-api-key`；脸库候选脸走 OpenAI 兼容的 `/v1/images/generations`（Bearer）。上游地址变量见 B 板块（`GEMINI_BASE_URL` / `OPENAI_IMAGE_BASE_URL`）。
- **脸库面板里每个会扣费的入口都要先确认并标价**：「再出 3 张」的确认在 `app/lookbook/page.tsx` 的 `submitFaceJob`，「继续生成」的确认在面板内；继续时只有 `billingStatus === 'uncharged'` 的条目才会扣费（单价取任务自带 `costFen`），金额别按剩余条数硬乘。

## 脸图存储：数据库 or Cloudflare R2（1008 批次 C，可开关、可回滚）
- **开关 = 四个环境变量**：`OBJECT_STORAGE_ENDPOINT`、`OBJECT_STORAGE_BUCKET`、`OBJECT_STORAGE_ACCESS_KEY_ID`、`OBJECT_STORAGE_SECRET_ACCESS_KEY`（可选 `OBJECT_STORAGE_REGION`，默认 `auto`）。缺任何一个 = 未启用，行为与改造前完全一致（继续把 base64 存进 `ModelFace.image/thumbnail`）。endpoint 不是合法 http(s) 地址也视为未启用。
- **启用后的写入**：新脸的原图与缩略图传到 `model-faces/<userId>/<faceId>/{image,thumb}.jpg`，库里只存 `imageKey`/`thumbnailKey`，`image`/`thumbnail` 置 NULL。faceId 提前生成（key 里要带它），上传在数据库事务之外做，事务失败时 `discardUnstoredModelFaceImages` 会清掉刚传的对象（先查行是否真的不存在，提交结果不明时宁可留孤儿）。
- **上传失败回退存库**：任一对象传不上去，已传的清掉，这张脸按老办法存库，只记一条「回退存库」警告，**生成不失败、不退款、不丢图**。所以看到库里新增行 `image` 非空不等于存储没开——先看日志有没有那条警告（多半是 R2 令牌权限、桶名或网络）。
- **读取优先 key**：`getModelFaceImage` / `getModelFaceThumbnail` / `getRandomFavoriteModelFace` 都经 `readModelFaceBytes`；任何新增的读 `ModelFace.image` 的地方必须走同一入口，别直接 `select image`（R2 行里它是 NULL）。接口契约不变：原图仍是 JSON `{image(base64), mimeType}`，缩略图仍是二进制 JPEG；鉴权在 where 里按 `userId`，**不开放桶的公共访问，不给直链**。列表里 R2 行的 `thumbnail` 为 null，前端自动回退到 `?variant=thumbnail`。
- **启用后不要随便关**：关掉（或删掉某个变量）后，已经在 R2 的 key 行读不出来：原图/缩略图接口返回 **503**（`reason: not-configured`，不崩），组图取御用脸时降级为「无御用脸」继续出图并记警告，新脸则回到存库。补回变量立即恢复。要真正退出 R2，先 `node scripts/model-face-storage-migrate.mjs --to-db --apply` 把图回迁进库，再去掉变量。
- **删除尽力而为**：`deleteModelFace` 先删库行再删对象，对象删失败（含存储未配置）只记日志、留孤儿，不阻断；对象已不存在按成功处理。删用户会级联删 ModelFace 行，但**不会**删 R2 对象（目前没有删用户的功能）。保留清理从不删 ModelFace，不受影响。
- **迁移脚本**：`node scripts/model-face-storage-migrate.mjs --to-r2|--to-db [--apply] [--batch N] [--concurrency N] [--limit N] [--purge-objects]`；需要 `DATABASE_URL` 和 `OBJECT_STORAGE_*`，Node >= 22.18（直接加载 `lib/*.ts`）。默认 dry-run 只做 SELECT 统计；`--apply` 才执行。`--to-r2` 每行：上传 → 回读比对长度与 SHA-256 → 才清 `image/thumbnail`；`--to-db` 每行：取回 → 事务里写回并比对长度与 md5 → 才清 key；选行条件天然排除已迁移的行，所以中断后直接重跑即可续上；单行失败只记录，退出码 2。`--to-db` 默认保留 R2 对象，`--purge-objects` 才删。
- **踩过的坑**：给 `fetch` 传 aws4fetch 签出来的 `Request` 对象，undici 会把 body 当流、走 chunked、不带 Content-Length，S3/R2 回 `411 MissingContentLength`——单测里的假 fetch 发现不了，e2e 才暴露。现在只取签好的 url 与头，body 仍以 Buffer 传（单测用「PUT body 必须是字节数组」守着）。aws4fetch 被 Next 打进了服务端 chunk（不在 `.next/standalone/node_modules` 里），standalone 直接跑 e2e 已验证可用，Dockerfile 不用改。
- 本地 e2e 参考做法：S3 模拟器（Docker Hub 上 `minio/minio` 已下架，用的是 `zenko/cloudserver`，`S3BACKEND=mem`，会校验 SigV4）+ 临时库 + mock 上游，standalone 构建起服务；覆盖启用 / 关闭 / 存储不可达三种模式与迁移往返。

## 测试与验收
- `npm run test:face`（含 `model-face-storage.test.mjs`、`model-face-storage-migrate.test.mjs`；对象存储客户端单测 `__tests__/object-storage.test.mjs` 随 `npm test` 跑）
- 手工验收：`/lookbook` 的脸库面板建一张脸，跑一次带脸的生成，看三张成图里是不是同一个人。
