---
paths:
  - "lib/ai-assistant.ts"
  - "app/api/ai/**"
  - "components/AIChatBox.tsx"
---
# H AI 助手

职责：对话式的改图建议与图片分析。

## 文件清单（改这个板块只读这些）
- `lib/ai-assistant.ts` — 助手主逻辑与提示词（565 行）。
- `app/api/ai/chat/route.ts` — 对话端点。
- `app/api/ai/analyze/route.ts` — 图片分析端点。
- `components/AIChatBox.tsx` — 前端聊天框。

## 共享依赖
- 它依赖：`lib/auth`(A)、`lib/billing`(F)。
- 依赖它的：无。

## 改动前必读的坑
- 两个端点都要扣费，新增分支别漏了扣费和失败退款。
- 助手里的提示词不受 G 板块的快照测试保护，改了没人拦你，自己人工验一遍。

## 测试与验收
- `npm test`（`__tests__/face-analysis.test.mjs` 覆盖分析部分）。
- 手工验收：工作台打开聊天框问一句，看是否有回复、余额是否只扣一次。
