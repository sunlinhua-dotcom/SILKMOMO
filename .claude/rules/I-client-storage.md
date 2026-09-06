---
paths:
  - "lib/db.ts"
  - "lib/client-session.ts"
  - "lib/image-compressor.ts"
  - "lib/image-library.ts"
  - "components/ImageUploader.tsx"
  - "components/ImageLibraryPicker.tsx"
---
# I 客户端存储与上传

职责：浏览器侧的 IndexedDB 图库、本地会话状态、图片压缩与上传。

## 文件清单（改这个板块只读这些）
- `lib/db.ts` — Dexie / IndexedDB 定义（255 行），库名 `SilkMomoDB`。
- `lib/client-session.ts` — localStorage 里的会话状态，键前缀 `silkmomo_*`。
- `lib/image-library.ts` — 本地图库读写。
- `lib/image-compressor.ts` — 上传前压缩。
- `components/ImageUploader.tsx`、`components/ImageLibraryPicker.tsx`

## 共享依赖
- 它依赖：无（纯客户端）。
- 依赖它的：`app/page.tsx`、`app/task/[id]/page.tsx`、`app/lookbook/page.tsx`、`components/TaskList.tsx`、`components/StylePackManager.tsx`、`components/RecentProjectsStrip.tsx`。

## 改动前必读的坑
- **IndexedDB 库名 `SilkMomoDB` 和 localStorage 键前缀 `silkmomo_*` 永远不许改名**，改了等于把老用户本地的图和设置全丢掉。
- 加字段要走 Dexie 的版本升级，不要直接改表结构定义。
- 压缩参数会影响 B 板块的参考图超时防御，两边一起看。

## 测试与验收
- `npm test`
- 手工验收：上传一张图、刷新页面，图还在；换个浏览器标签页开同一账号，本地图库互不影响是正常的。
