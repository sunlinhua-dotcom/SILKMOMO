## [2026-07-19 08:05] 大参考图超时三层防御加固

### 需求摘要
- 将前端参考图压缩的 800KiB 目标改为严格输出后置条件，并为 legacy 路径增加同等硬兜底。
- 在 `lib/image-backends.ts` 的 Gemini 与 302 上游发送路径前统一归一化所有参考图（含 anchor/肖像卡），同时保持出图后处理、入参限制、计费/退款、Dexie 与 SSE 契约不变。
- 明确不实现“超时后自动压缩重试”。

### 实施计划
- 先读取项目连续性文件、实验报告与相关代码，定位前端现代/legacy 压缩路径及服务端全部参考图上行点。
- 先在 `refs/e2e/` 编写服务端归一化失败测试并确认 RED，再实现最小生产改动并确认 GREEN。
- 完成 TypeScript、build、lint、服务端归一化脚本和一次真实 Gemini 端到端探针。

### 已知风险或待确认点
- 上游生成耗时和瞬时拥塞不可控；真实探针只验证一次当前链路，不推断长期稳定性。
- 前端浏览器 Canvas/编码路径若无法在 Node 环境运行，将按要求明确标记为未运行时验证并给出边界分析。
- 全程禁止 git 操作、禁止打印密钥或环境变量，不安装新依赖。

### 本次完成的工作
- 前端现代与 legacy 压缩路径统一为严格 `≤800KiB`：不透明图按 JPEG 质量序列压缩，最低质量仍超标时循环降分辨率；透明像素存在时保留 PNG 并仅通过 PNG 压缩与降分辨率收口。
- 新增服务端参考图归一化 helper：长边 `≤1920px`、输出 `≤800KiB`、默认剥离元数据、不透明输出 JPEG、透明输出 PNG；失败单图原样回退且不抛错。
- `generateImage()` 在 Gemini/302 分发前顺序归一化 product/model/background/scene/accessory/anchor 全部参考图；已有上游重试复用已归一化输入，没有新增超时后压缩重试。
- 新增服务端归一化测试脚本与一次真实 Gemini 大参考图探针脚本，均位于 `refs/e2e/`。

### 关键决策与技术要点
- 实验报告实测 12/12 成功，只能排除测试范围内体积/格式/像素的确定性主效应；上游瞬时拥塞或特定编码属性仍为推断，不写成已定位根因。
- Sharp 官方行为核对：`fit: inside + withoutEnlargement` 用于尺寸上限；重新编码默认剥离元数据；透明性通过 `metadata.hasAlpha + stats.isOpaque` 判断。
- 保留 `app/api/generate/stream/route.ts` 的 `MAX_IMAGE_BASE64_LENGTH = 11_000_000`，不改计费、退款、Dexie、存储键或 SSE 事件形状。

### 修改的核心文件
- `lib/image-compressor.ts`：前端严格 800KiB 后置条件、透明检测、质量/分辨率双循环。
- `components/ImageUploader.tsx`：上传调用点增加 800KiB 最终断言。
- `lib/reference-image-normalizer.ts`：服务端独立归一化实现。
- `lib/image-backends.ts`：两条生成上游分发前统一归一化全部参考图与 anchor。
- `refs/e2e/ref-image-normalization.mjs`：4 类归一化回归脚本。
- `refs/e2e/ref-timeout-gemini-probe.mjs`：真实 Gemini 大参考图 SSE 探针。

### 验证结果
- TDD RED：归一化 API 缺失时脚本以 `ERR_ASSERTION` 退出 1；GREEN 与最终复跑均为 4/4 PASS。
- `npx tsc --noEmit`：最终退出 0。
- `npm run build`：退出 0；仅既有 CSS `@property` warning。
- `npm run lint`：退出 0，0 error、12 条既有 `<img>` warning。
- 归一化最终样本：大 JPEG `3,809,780B / 3000x2000 → 774,137B / 1920x1280 / JPEG`；透明 PNG `17,312,459B / 2400x1800 → 654,172B / 525x394 / PNG`；小 JPEG保持 `1024x768`；非法输入原样回退。
- 真实 Gemini：fixture `3,680,324B / 3000x3000`，服务端上行前归一化为 `421,759B / 1920x1920 / JPEG`，27 秒收到 result + done，`success=1 failed=0`。
- 前端浏览器 Canvas 路径未做运行时实测；完成静态分支审查、tsc、build 与 lint。

### 偏离与遗留风险
- `next dev` 因本机 Watchpack `EMFILE: too many open files` 连续误重启，真实探针改用同一端口的已构建 `next start`；探针完成后已停止服务并确认 4605 无监听。
- 服务端按需求在单图归一化失败时回退原图，因此损坏/Sharp 不支持的合法 MIME 输入仍可能以原大小上行；这是可用性优先的显式降级风险。
- 本轮单次真实探针证明当前 Gemini 链路成功，不代表上游长期无拥塞。
