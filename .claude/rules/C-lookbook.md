---
paths:
  - "app/lookbook/**"
  - "lib/prompts/group.ts"
  - "components/LookbookGarmentSlots.tsx"
  - "components/BatchOutputMatrix.tsx"
---
# C 组图换装

职责：Lookbook 组图、同景换品、批量分块出图与结果矩阵展示。

## 文件清单（改这个板块只读这些）
- `app/lookbook/page.tsx` — 组图页（1100 行）。脸库面板段有路标；`MODEL_FACE_*` 常量在文件头部。
- `components/ModelFaceLibraryPanel.tsx` — 从上面这页抽出来的脸库面板（属 D 板块，但只被这里用）。
- `components/LookbookGarmentSlots.tsx` — 多件衣服的槽位。
- `components/BatchOutputMatrix.tsx` — 批量结果矩阵。
- `lib/prompts/group.ts` — 组图提示词 builder。
- `app/api/generate/stream/route.ts` 的组图分支段（按路标取段，不要整读）。

## 共享依赖
- 它依赖：`lib/db`(I)、`lib/models`、`lib/prompts/group`(G)、脸库 API(D)。
- 依赖它的：无（页面是叶子）。

## 改动前必读的坑
- **约束不是越多越好**。历史上删掉多余的光照口径之后，脸颈 ΔRGB 从 31.9 降到 7.05。往提示词里加约束前先想清楚是不是在和已有约束打架。
- **局部合成必须留接缝处理**，直接贴回去会有明显边界。
- **客户端看门狗超时必须大于服务端超时**。0731 事故就是看门狗比服务端短，把正常的 SSE 误杀了。改任何超时常量都要两边一起核对（见 E 板块）。

## 测试与验收
- `npm run test:lookbook`
- 手工验收：`/lookbook` 上传多件衣服跑一次组图，看分块是否都回来、同景换品的人是否还是同一个人。
