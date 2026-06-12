# SILXINE 项目上下文(AI 会话入口)

> 产品名 SILXINE(silxine.com);仓库与内部存储键沿用代号 SILKMOMO,严禁重命名存储键/库名/cookie 名。

## 项目目标
- 面向丝绸 / 服饰品牌的 AI 生图工作台,支持产品图、场景图、品牌风格记忆、批量输出、计费与管理后台。

## 架构与目录
- `app/`:Next.js App Router 页面、API Route。
- `components/`:上传、参数选择、图库、任务列表、反馈、后台面板等前端组件。
- `lib/`:认证、计费、Prisma、AI prompt、生图后端、品牌记忆、本地图库等业务逻辑。
- `prisma/`:schema 与迁移;生产 PostgreSQL,本地可用 SQLite 适配器。
- `scripts/`:一次性脚本(如 seed-brand.js)。
- `docs/`:进度(PROGRESS.md)、踩坑(BUGS.md)、本地日志(LOG.md,不入库)、需求 PDF、商务文件(business/,不入库)。
- `refs/`:本地素材库(品牌案例 zip、产品照、样例输出、归档数据库),整个目录不入库。
- 完整结构与开发约定见 `README.md`。

## 关键运行命令
- 开发服务:`npm run dev`,默认端口 `4605`。
- 构建检查:`npm run build`;Lint:`npm run lint`;类型:`npx tsc --noEmit`。

## 关键约束
- 对外回复和应用默认文案使用简体中文。
- 本地桌面 Web 端口保持在 `46xx` 命名空间,本项目为 `4605`。
- 不提交 `.env*`、API Key、令牌或数据库连接密钥;文档中密钥一律脱敏。
- 新依赖安装前核对版本、镜像源与兼容性。
- 大文件素材放 `refs/`,商务文件放 `docs/business/`,不要散落根目录。

## 文档写作约定
- 里程碑/阶段性结果 → 追加到 `docs/PROGRESS.md`。
- 新踩的坑与修复 → 追加到 `docs/BUGS.md`(未决放上方,修复后移入归档)。
- 过程性会话日志 → 追加到 `docs/LOG.md`(本地文件,不入库)。

## 当前阶段状态(2026-06-12)
- Phase 2/3/4 功能完成;2026-06-11 完成全代码库约 40 项 bug 审计修复并部署上线。
- 线上"生图卡住"根因已解决:更换失效/限速的 `GEMINI_API_KEY`,修复中断卡 processing、过期 JWT 当空 SSE 流等问题。
- GPT 图像通道已支持独立令牌 `OPENAI_IMAGE_API_KEY`(见 README 环境变量表;线上已配置,模型 `gpt-image-2`,~3 分钟/张属正常速度)。
- 两引擎已在生产端到端验证出图(Gemini 19s / GPT 152-235s)。
- AI 聊天助手主通道为 DeepSeek `deepseek-v4-pro`(`DEEPSEEK_API_KEY`,未配则回退 Gemini Lite);产品图分析/质量评分仍走 Gemini Lite(需要视觉能力)。
- 待办与已知问题见 `docs/BUGS.md` 未决事项一节。
