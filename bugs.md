# SILKMOMO 踩坑记录

## 已知历史问题
- 移动端布局曾出现 Header 过高、步骤文字隐藏、最近项目位置不合理等 UX 问题，已有修复记录。
- 早期任务详情页曾调用废弃生成函数并忽略 Phase 2 参数，已有修复记录。
- 管理员初始化曾存在硬编码 fallback 密钥风险，已有修复记录。
- API Key / 上游渠道曾出现 503 不可用，需要避免在仓库中记录完整密钥。

## 本轮新发现
- 样式包图片复用了 `images.projectId = packId`，当默认样式包 ID 与新建任务 ID 相同，会在任务详情页错误显示“场景参考”。已通过 `stylePackId`、固定 `STYLE_PACK_IMAGE_PROJECT_ID`、旧数据迁移和新任务图片槽清理修复。
- 多账号共用同一个浏览器 IndexedDB / localStorage 时，新账号可能看到旧账号的本地任务、图库或时光机缓存。已新增本地工作区归属同步，登录 / 注册 / 退出时清理隔离。
- 注册页提示“至少 6 位”与后端校验“至少 8 位”不一致。已统一为 8 位并补充表单自动填充属性。
- Next 16.1.6 开发服务提示 `middleware` 文件约定已废弃。已迁移为 `proxy.ts`。
- `npm run lint` 原先扫描 `.claude/worktrees/.next` 和种子脚本导致阻断。已补充 ESLint 全局忽略，并修复当前源码 lint error。
- 场景图“氛围静物”按钮此前没有持久化，也没有传给服务端，实际仍按有模特生成。已新增 `sceneHasModel` 字段并贯通首页创建、任务页生成、SSE API、prompt 构建和结果图 `hasModel` 写入。
- GPT Image 2 生图成功后，扣费交易流水曾固定写成 Gemini 模型名，导致账单 / 后台统计模型归因不准。已让 `deductBalance` 接收并记录真实 `apiModel`。
