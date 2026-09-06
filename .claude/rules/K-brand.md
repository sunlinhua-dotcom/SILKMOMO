---
paths:
  - "lib/brand-memory.ts"
  - "app/brand/**"
  - "app/api/brand/route.ts"
---
# K 品牌记忆

职责：品牌调性档案的读写，以及在出图时把它注入提示词。

## 文件清单（改这个板块只读这些）
- `lib/brand-memory.ts` — 档案结构与读写（148 行）。
- `app/api/brand/route.ts` — 端点。
- `app/brand/page.tsx` — 编辑页。

## 共享依赖
- 它依赖：`lib/auth`(A)、`lib/prisma`(Z)。
- 依赖它的：`app/api/generate/stream/route.ts`(B)——注入点在主路由里，改档案字段要同步看那边怎么拼进提示词。

## 改动前必读的坑
- 品牌档案最后是拼进提示词的，字段改名 / 改语气等于改提示词，属于 G 板块的影响面，改完人工出图验一次。
- 档案可能为空，注入处必须能接受缺省。

## 测试与验收
- `npm test`
- 手工验收：`/brand` 填一段调性，出一张图看是否体现；清空后不应报错。
