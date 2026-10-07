---
paths:
  - "lib/db.ts"
  - "lib/client-session.ts"
  - "lib/image-compressor.ts"
  - "lib/recent-tasks.ts"
  - "lib/image-library.ts"
  - "components/ImageUploader.tsx"
  - "components/ImageLibraryPicker.tsx"
  - "components/RecentProjectsStrip.tsx"
  - "components/StylePackManager.tsx"
---
# I 客户端存储与上传

职责：浏览器侧的 IndexedDB 图库、本地会话状态、图片压缩与上传。

## 文件清单（改这个板块只读这些）
- `lib/db.ts` — Dexie / IndexedDB 定义（255 行），库名 `SilkMomoDB`。
- `lib/client-session.ts` — localStorage 里的会话状态，键前缀 `silkmomo_*`。
- `lib/image-library.ts` — 本地图库读写。
- `lib/image-compressor.ts` — 上传前压缩。
- `lib/recent-tasks.ts` — 最近任务查询（`loadRecentTasks` + `useRecentTasks`，图片数只数 `type='result'`），首页最近项目条与任务列表共用，替代各处重复查询。
- `components/ImageUploader.tsx`、`components/ImageLibraryPicker.tsx`（上传失败/超限/存储已满有明确提示，图库计数不再整库读 base64）
- `components/RecentProjectsStrip.tsx`、`components/StylePackManager.tsx` — 读写本地项目 / 风格包的 UI。

## 共享依赖
- 它依赖：无（纯客户端）。
- 依赖它的：`app/page.tsx`、`app/task/[id]/page.tsx`、`app/lookbook/page.tsx`、`components/TaskList.tsx`、`components/StylePackManager.tsx`、`components/RecentProjectsStrip.tsx`。

## 改动前必读的坑
- **IndexedDB 库名 `SilkMomoDB` 和 localStorage 键前缀 `silkmomo_*` 永远不许改名**，改了等于把老用户本地的图和设置全丢掉。
- 加字段要走 Dexie 的版本升级，不要直接改表结构定义。
- **图库计数、列表别整库 `toArray()` 读 base64**：只数 count 或只读不含图片数据的行（Project 行很小），否则图多的老用户会卡死。
- 压缩参数会影响 B 板块的参考图超时防御，两边一起看。

## 测试与验收
- `node --test __tests__/client-storage.test.mjs`；全量 `npm test`
- 手工验收：上传一张图、刷新页面，图还在；换个浏览器标签页开同一账号，本地图库互不影响是正常的。
