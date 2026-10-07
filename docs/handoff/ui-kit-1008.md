# UI 底座（1008）使用说明

Provider 已在 `app/layout.tsx` 全局挂载（`app/providers.tsx`：Toast 在外、Confirm 在内），页面里直接用 hook 即可，不用再包。

## 设计 token（`app/globals.css` 顶部 `@theme static`）
既可写 `var(--color-xxx)`，也可用工具类（`bg-brand-strong`、`text-muted`、`border-danger`…）。
| token | 值 | 用途 |
|---|---|---|
| `brand` | #C9A87C | 品牌金，**仅装饰**（边框、图标、大色块）。白字放它上面只有 2.24:1，别用 |
| `brand-strong` | #8C6D3A | 白字按钮底、浅底上的品牌色文字。白底 4.81:1 / 奶油底 4.55:1 |
| `brand-soft` | #F6EEE1 | 选中态 / 提示条浅底 |
| `ink` | #2C2420 | 主文字（= `text`） |
| `text-secondary` | #6B5A4A | 次级文字，白底 6.59:1 |
| `muted` | #7D6B58 | 弱化文字（= `text-muted`），白底 5.10:1，奶油底 4.82:1 |
| `surface` / `background` (= `cream`) | #FFF / #FBF8F4 | 卡片底 / 页面底 |
| `border` / `border-light` | #EAE4DB / #F3EDE5 | 边框 |
| `danger` `success` `warning` | #B91C1C / #15803D / #A16207 | 状态色，对白底均 ≥4.9:1；各有 `-soft` 浅底版本 |
| `overlay` | rgba(44,36,32,.5) | 弹窗遮罩 |
| 旧名保留 | `primary` `secondary` `accent` `accent-light` `accent-dark` `rose` `text` | 沿用不变（`accent` 同属装饰色） |
| 变量 | `--mobile-cta-h`（默认 0px）、`--z-modal`(100)、`--z-toast`(120)、`--shadow-*`、`--font-serif/--font-sans` | 页面有固定底栏时把 `--mobile-cta-h` 设为底栏高度 |

其它全局行为：标题 `text-wrap: balance`，p/li/label 等 `word-break: keep-all`（溢出才强拆）；数字 / 金额加 `.num`（nowrap + 等宽数字）；`:focus-visible` 为 2px 深金描边；`prefers-reduced-motion` 下动画 / 平滑滚动关闭；`btn-primary` 渐变已加深（白字 ≥4.8:1）。字体改为 next/font 自托管（Cormorant + Montserrat，回退 PingFang SC / Microsoft YaHei）。

## 组件
```tsx
import { Modal } from '@/components/ui/Modal';
<Modal open={open} onClose={() => setOpen(false)} title="充值" size="md"   // sm | md | lg
       footer={<button className="...">知道了</button>}
       closeOnOverlay={false} initialFocusRef={inputRef}>
  内容…
</Modal>
```
`role=dialog aria-modal`、Esc 关闭、Tab 焦点陷阱、关闭后焦点归还、滚动锁（可叠加）、portal 到 body；<640px 为底部抽屉并避让 safe-area。正文里给某元素加 `data-autofocus` 可指定初始焦点。

```tsx
import { useConfirm } from '@/components/ui/ConfirmDialog';
const confirm = useConfirm();
if (!(await confirm({ title: '删除这张图？', message: '删除后无法恢复', danger: true, confirmText: '删除' }))) return;
```
Esc / 点遮罩 / 取消都返回 `false`。`danger` 时确认钮变红且默认聚焦「取消」。无 Provider 时退化为 `window.confirm`。

```tsx
import { useToast } from '@/components/ui/Toast';
const toast = useToast();           // 引用稳定，可放进 useEffect 依赖
toast.success('已保存'); toast.error('生成失败，请重试'); toast.info('已加入队列');
```
4 秒自动消失，最多同屏 4 条，`aria-live="polite"`；手机贴顶、桌面靠右上，不挡底部 CTA。

```tsx
import { PageHeader } from '@/components/ui/PageHeader';
<PageHeader title="账户 & 账单" backHref="/" actions={<span className="num">¥12.30</span>} />
```
返回 + Logo + 标题（样式同 billing 顶栏，`max-w-4xl`）。是服务端组件，可直接用在任何页面。

```tsx
import { ContactAdmin } from '@/components/ContactAdmin';
import { ADMIN_WECHAT } from '@/lib/contact';       // 'silkmomo-concierge'
<ContactAdmin variant="card" note="余额不足，请联系管理员充值" />   // variant: inline(默认) | card
```
显示微信号 + 一键复制，结果走 toast，剪贴板不可用时有降级。

## 余额 hook
```tsx
import { useBalance, refreshBalance } from '@/hooks/useBalance';
const { balanceFen, status, user, refresh } = useBalance();
// status: 'loading' | 'ready' | 'error' | 'unauthenticated'（/api/auth/me 返回 401）
// balanceFen 单位分；user = { id, username, name, role, balanceFen, createdAt }
await refreshBalance();   // 扣费 / 出图结束 / 登录成功后调用；并发调用共用同一个请求
```
模块级单一 store，所有组件共享；窗口 focus 时 30 秒节流自动刷新；已有数据时刷新失败保留旧值，只有从未成功过才进 `error`。

## 时间
```ts
import { formatRelativeTime } from '@/lib/format-time';
formatRelativeTime(task.createdAt)   // 刚刚 / N分钟前 / N小时前 / N天前 / M月D日；无效输入返回 ''
```
单测：`node --test __tests__/format-time.test.mjs`。

## 路由 metadata
billing / brand / lookbook / tasks / task/[id] / login / register / admin 各有一个只导出 `metadata.title`（`xxx · SILXINE`）的 `layout.tsx`，页面本身是 client 组件所以不能自己导出 metadata。

## 兜底页
`app/error.tsx`（显示 `error.digest` 错误编号）、`app/not-found.tsx`、`app/global-error.tsx`（根 layout 出错时用，全部内联样式，不依赖 CSS / 字体）。
