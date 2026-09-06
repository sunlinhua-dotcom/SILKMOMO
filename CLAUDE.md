# SILKMOMO · 板块地图与协作规则

本文件是本仓库的**唯一常驻规则入口**。开工先在下表定位板块，再只读该板块规则文件里列出的清单，不要整仓扫描——这条约定就是本次重构的目的：改一个板块不牵动其他板块，也不烧无谓的 token。

## 板块索引

| 板块 | 一句话职责 | 规则文件 | 入口文件 | 测试命令 |
| --- | --- | --- | --- | --- |
| A 鉴权 | 登录注册、JWT 签发校验、请求头注入 | `.claude/rules/A-auth.md` | `lib/auth.ts`、`proxy.ts`、`app/api/auth/*` | `npm test` |
| B 主出图 | 单图生成主链路与出图后端通道 | `.claude/rules/B-generate.md` | `app/api/generate/stream/route.ts`、`lib/image-backends.ts` | `npm run test:image` |
| C 组图换装 | Lookbook 组图、同景换品、批量分块 | `.claude/rules/C-lookbook.md` | `app/lookbook/page.tsx`、`lib/prompts/group.ts` | `npm run test:lookbook` |
| D 脸库与身份锚 | 模特脸库 CRUD、派生身份锚、换脸一致性 | `.claude/rules/D-face.md` | `lib/model-face-*.ts`、`app/api/model-faces/route.ts` | `npm run test:face` |
| E 交付与补拉 | SSE 交付、pending 入库、断线补拉与看门狗 | `.claude/rules/E-delivery.md` | `lib/pending-*.ts`、`app/task/[id]/page.tsx` | `npm run test:delivery` |
| F 计费 | 积分预扣、失败退款、幂等与流水 | `.claude/rules/F-billing.md` | `lib/billing.ts`、`lib/generation-billing-core.ts` | `npm run test:billing` |
| G 提示词 | 四个提示词 builder 与模特脸规格常量 | `.claude/rules/G-prompts.md` | `lib/prompts/*.ts`（`lib/api.ts` 是 re-export 桶） | `npm run test:prompts` |
| H AI 助手 | 对话式改图建议、图片分析 | `.claude/rules/H-assistant.md` | `lib/ai-assistant.ts`、`app/api/ai/*` | `npm test` |
| I 客户端存储与上传 | IndexedDB 图库、本地会话、图片压缩上传 | `.claude/rules/I-client-storage.md` | `lib/db.ts`、`lib/image-compressor.ts`、`components/ImageUploader.tsx` | `npm test` |
| J 管理后台 | 用户与统计、失败与 pending 运维视图 | `.claude/rules/J-admin.md` | `app/admin/*`、`app/api/admin/*` | `npm test` |
| K 品牌记忆 | 品牌调性档案的读写与注入 | `.claude/rules/K-brand.md` | `lib/brand-memory.ts`、`app/api/brand/route.ts` | `npm test` |
| Z 数据层 | Prisma schema、连接与适配器 | `.claude/rules/Z-data.md` | `prisma/schema.prisma`、`lib/prisma.ts` | `npm test` |

## 硬约束（长期有效）

- **分层**：新页面放 `app/`，UI 组件放 `components/`，逻辑放 `lib/`；`lib/` 不得 import `components/`。
- **三个名字永远不许改**：localStorage 键前缀 `silkmomo_*`、IndexedDB 库名 `SilkMomoDB`、登录 token 的 cookie 键 `silkmomo_token`。改了等于让所有老用户丢数据、掉登录。
- **计费**：扣费必须原子，失败必须退款，幂等键不能动。
- **密钥只走环境变量**，不进代码、不进日志、不进提交。
- **本地端口固定 `4605`**；被占用时用 `PORT=4699` 起临时实例，不要改默认值。
- **大素材放 `refs/`**，不要塞进 `public/` 或组件里。
- **生产出图通道**：主图走 302.ai 的 `gpt-image-2`；派生身份锚走 apiyi 的 `gemini-3.1-flash-image-preview`。换通道要先看 B / D 两个板块的坑清单。

## 规则文件怎么用（实测口径）

`.claude/rules/*.md` 带 `paths:` 前置元数据，**按路径触发注入**：会话开始时不加载（那时自动进上下文的只有本文件）；当 Read / Edit 到匹配某份规则 `paths` 的文件时，那份规则才自动进入上下文。0906 实测：Read `lib/prompts/face-anchor.ts` 三行，`D-face.md` 与 `G-prompts.md` 两份同时注入。

所以流程是：**读本文件 → 按上表定板块 → 直接打开该板块的文件，对应规则随之而来**。不要为「保险」手动把 12 份规则全读进来，也不要顺手读不相关板块的文件——那会把别的板块的规则一并拉进上下文。

每份规则顶部的 `paths:` 既是给人看的范围提示，也是注入开关：glob 必须覆盖该板块「文件清单」里列的文件，漏一个就等于改那个文件时规则不生效。

（早先版本在这里写「rules 不会被自动注入」，是因为用 `claude -p` 直接问「加载了哪些 rules」时并没有读过任何匹配文件，测法不对，结论已作废。）

## 工作协议（省 token）

1. **先定板块**：照上表找到板块，只读它规则文件里的「文件清单」，不要顺着 import 一路读下去。
2. **巨文件按路标取段**：`app/api/generate/stream/route.ts`、`app/task/[id]/page.tsx`、`app/lookbook/page.tsx`、`app/page.tsx` 都加了 `// ===== [板块] 名称 · 开始/结束 =====` 路标。先 `grep -n "===== \[" <文件>` 拿到行号，再 `sed -n 'a,bp'` 只取需要的段，不要整读。
3. **测试按板块跑**：默认只跑该板块的 `npm run test:<板块>`；只有改动跨板块或动了共享依赖才跑 `npm test`。
4. **主线程不 Read 图片**；所有验证素材、实验产物一律放 `verify/`（已 gitignore），不要落在仓库根。
5. **交接、报告、复盘类文档放 `docs/handoff/`**，根目录只留项目本体。
6. **改提示词必须先跑 `npm run test:prompts`**：四个 builder 的输出受快照保护，任何字节变化都会红。确属有意变更时才更新 `__tests__/fixtures/prompt-snapshot.json`，并在 commit message 里写清改了哪条规则、为什么。

## 目录约定

`docs/handoff/` 存历史交接与复盘文档（含已归档的 `CONTEXT-archived-0906.md`），只读不执行；`verify/` 存各次实验的脚本、对照图与测量结果，已 gitignore，只在本机留档；`refs/e2e/` 是打真实付费 API 的探针脚本，**自检、CI、验收一律不许跑**，只有用户明确要求时才手工执行；`__tests__/` 是 `node --test` 的纯本地单测，不联网、不写库，随时可跑。
