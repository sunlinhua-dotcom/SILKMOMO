---
paths:
  - "app/layout.tsx"
  - "app/providers.tsx"
  - "app/globals.css"
  - "app/error.tsx"
  - "app/global-error.tsx"
  - "app/not-found.tsx"
  - "components/ui/**"
  - "components/ContactAdmin.tsx"
  - "components/UserNav.tsx"
  - "components/Logo.tsx"
  - "components/ImageLightbox.tsx"
  - "components/ResultGallery.tsx"
  - "components/TimeMachine.tsx"
  - "components/WorkspaceSwitcher.tsx"
  - "components/*Selector.tsx"
  - "components/ModelQuickPicker.tsx"
  - "components/ModelIcons.tsx"
  - "components/StyleIcons.tsx"
  - "components/ProductShotModule.tsx"
  - "components/SceneShotModule.tsx"
  - "components/useRadioGroup.ts"
  - "hooks/useBalance.ts"
  - "hooks/useBrandMemory.ts"
  - "hooks/useProductAnalysis.ts"
  - "hooks/useLeaveGuard.ts"
  - "lib/leave-guard.ts"
  - "__tests__/leave-guard.test.mjs"
  - "lib/contact.ts"
  - "lib/format-time.ts"
  - "lib/models.ts"
  - "__tests__/format-time.test.mjs"
---
# U 共享 UI 底座

职责：跨页面复用的 UI 基础设施——设计 token、全局 Provider、弹窗/确认/提示组件、选择器、导航、结果画廊与灯箱，以及它们依赖的小工具。不含任何业务计费/出图逻辑。

## 为什么单开一个板块
本轮大改新增了 `components/ui/*`、`app/providers.tsx`、`useRadioGroup`、`useBalance`、`lib/contact`、`lib/format-time` 等十几个文件，被 A–K 几乎所有页面共同依赖；此前它们（连同 `UserNav`、各 `*Selector`、`ResultGallery` 等老组件）不属于任何板块，改它们时没有任何规则注入。并入某个业务板块会让「改一个弹窗」拉进无关的计费/出图规则，所以独立成板。

## 文件清单（改这个板块只读这些）
- `app/globals.css` — 设计 token（`@theme static`）、全局排版/焦点/减少动效规则。token 与使用说明见 `docs/handoff/ui-kit-1008.md`。
- `app/layout.tsx`、`app/providers.tsx` — 根布局 + 全局 Provider（Toast 在外、Confirm 在内），页面直接用 hook，不要再包。
- `app/error.tsx`、`app/global-error.tsx`、`app/not-found.tsx` — 错误/404 兜底页。
- `components/ui/{Modal,ConfirmDialog,Toast,PageHeader}.tsx` — 弹窗（焦点陷阱、Esc、焦点归还）、确认对话框、轻提示、页头。
- `components/useRadioGroup.ts` + 各 `*Selector.tsx` — 单选组 `radiogroup` 方向键、多选 `aria-pressed`、40px 点击区。
- `components/ResultGallery.tsx`、`ImageLightbox.tsx`、`TimeMachine.tsx`、`UserNav.tsx`、`WorkspaceSwitcher.tsx`、`ContactAdmin.tsx`、`Logo.tsx`、`ModelQuickPicker.tsx`、`ProductShotModule.tsx`、`SceneShotModule.tsx`、`ModelIcons.tsx`、`StyleIcons.tsx`。
- `hooks/useBalance.ts` — 余额共享 store（模块级单例，状态 loading / ready / error / unauthenticated，聚焦刷新节流 30s），导航与各页共用；`hooks/useBrandMemory.ts`、`useProductAnalysis.ts`。
- `hooks/useLeaveGuard.ts` + `lib/leave-guard.ts` — 「进行中离开拦截」：`useLeaveGuard(active, message)` 在 active 时拦刷新/关闭（beforeunload）、同源站内链接（document 捕获阶段 + `ConfirmDialog`，确认后 `router.push`）、浏览器后退（pushState 哨兵 + popstate）；active 结束/卸载时清监听并 `history.back()` 掉哨兵，不留多余历史记录。链接过滤规则是纯函数 `decideLeaveGuardLink`（有单测）。目前接入：任务页（出图中，文案见任务页 `LEAVE_GENERATING_MESSAGE`）、组图页（仅「提交中」：写浏览器存储 + 建任务，期间服务端尚无生成请求、不扣费；成功后先 `flushSync` 撤拦截再整页跳转，避免对预期跳转弹原生确认）。
- `lib/contact.ts` — 管理员联系方式常量 `ADMIN_WECHAT`（原先硬编码在首页充值弹窗）；`lib/format-time.ts` — 相对时间文案 `formatRelativeTime`（任务列表/流水等共用，原先各处重复）。
- `lib/models.ts` — 预设模特与体型/肤色参数配置（前后端共用）。

## 共享依赖
- 它依赖：无业务板块（`useBalance` 只经 HTTP 读 `/api/auth/me`）。
- 依赖它的：几乎所有页面。改导出签名/props 前先 `grep -rn "components/ui/\|useBalance\|format-time" app components`。
- `lib/` 不得 import `components/`（CLAUDE.md 分层约束）。

## 改动前必读的坑
- **品牌金 `brand`（#C9A87C）仅装饰**，白字放上去只有 2.24:1；文字/按钮用 `brand-strong`。改色前对照 ui-kit 的对比度表。
- **固定底栏的页面要设 `--mobile-cta-h`**，否则 Toast/弹窗会被底栏盖住。
- **余额是三态**，别把「读取失败」渲染成 0 或「余额不足」——会诱导用户误充值/误放弃。
- **花钱按钮必须标价**，涉及扣费的操作先走 `ConfirmDialog`（UI 约定，与 F 板块的服务端扣费互补）。
- **离开拦截的确认文案必须对照服务端真实行为写**：客户端断开后，`app/api/generate/stream/route.ts` 会让当前这一张照常跑完并写入 pending（已扣费、回来补拉），但还没开始的镜次停止、不扣费。别写成「全部都会继续生成」或「已扣费的图会丢」。
- Modal 的 `closeOnOverlay`、焦点陷阱、键盘 Esc 是无障碍约定，别在业务页里自己再写一个遮罩。

## 测试与验收
- `node --test __tests__/format-time.test.mjs __tests__/leave-guard.test.mjs`；其余靠 `npx tsc --noEmit` + `npm run lint` + 手机宽度（390px）实机看。
- 手工验收：弹窗 Tab 不逃出、Esc 关闭、关闭后焦点回到触发按钮；选择器方向键可切换。
