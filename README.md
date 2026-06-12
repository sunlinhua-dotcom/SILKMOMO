# SILXINE

> 产品名 **SILXINE**(客户正式品牌,silxine.com)。仓库名与内部存储键沿用早期代号 SILKMOMO——改库名/键名会丢用户本地数据,详见代码内注释。

面向丝绸 / 服饰品牌的 AI 生图工作台:上传产品图,一键生成电商产品图组与生活方式场景图,内置品牌风格记忆、批量输出、按次计费与管理后台。

- **线上环境**: https://silkmomo.digirepub.com (Zeabur,推送 `main` 自动部署)
- **生图引擎**: Gemini Flash Image(快,~30 秒/张,默认)/ GPT Image 2(慢,~3 分钟/张,面料质感强)

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16 (App Router) + React 19 + TypeScript |
| 样式 | Tailwind CSS 4 |
| 服务端数据 | PostgreSQL + Prisma 7(用户/计费流水/品牌档案/生成记录) |
| 客户端数据 | Dexie (IndexedDB,任务与图片)+ localStorage(时光机快照) |
| 认证 | jose JWT(HttpOnly Cookie)+ bcryptjs |
| 上游 AI | apiyi 网关(Gemini 系列 + GPT Image 系列) |

## 快速开始

```bash
npm install
npm run dev        # http://localhost:4605
npm run build      # 生产构建检查
npm run lint       # ESLint
```

本地需要 `.env` / `.env.local`(不入库),最少配置:

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串(`file:` 开头则走 SQLite 适配器) |
| `GEMINI_API_KEY` | ✅ | apiyi 主令牌(Gemini 生图 + AI 分析/聊天) |
| `JWT_SECRET` | ✅ | JWT 签名密钥(生产用强随机值) |
| `ADMIN_SETUP_KEY` | ✅ | 管理员初始化接口的安装密钥 |
| `OPENAI_IMAGE_API_KEY` | 可选 | GPT 图像通道独立令牌(不配则回退主令牌) |
| `OPENAI_IMAGE_MODEL` | 可选 | GPT 模型名(独立令牌默认 `gpt-image-2`,否则 `gpt-image-2-all`) |
| `DEEPSEEK_API_KEY` | 可选 | AI 聊天助手主通道(api.deepseek.com);不配则聊天回退 Gemini Lite |
| `DEEPSEEK_CHAT_MODEL` | 可选 | 聊天模型,默认 `deepseek-v4-pro` |
| `GEMINI_BASE_URL` | 可选 | 上游网关地址(默认 `https://api.apiyi.com`) |
| `IMAGE_BACKEND` | 可选 | 默认引擎 `gemini` / `openai` |

参考 `.env.example`。

## 目录结构

```
app/                 Next.js 页面 + API 路由(App Router)
  api/               认证 / 生图 SSE / 计费 / 品牌 / 管理后台接口
  task/[id]/         任务详情页(SSE 生成、重做、对比备份)
components/          前端组件(上传、参数选择、画廊、任务列表、AI 聊天…)
lib/                 业务逻辑(计费、认证、生图后端、品牌记忆、Dexie、限流…)
hooks/               React hooks
prisma/              schema 与迁移
public/              静态资源
scripts/             一次性脚本(seed-brand.js 等)
proxy.ts             路由保护(Next.js proxy/middleware,登录态与 401 处理)
docs/                项目文档(见下)
refs/                本地素材库(品牌案例、产品照、样例输出;不入库)
```

**约定(防止代码长歪)**:

- 新页面/接口放 `app/`,可复用 UI 放 `components/`,纯逻辑放 `lib/`;`lib/` 内不得 import `components/`。
- 品牌展示一律用 **SILXINE**;`silkmomo_*` 存储键、`SilkMomoDB` 库名、cookie 名是历史代号,**严禁改名**(会丢用户数据/掉登录)。
- 服务端密钥只通过环境变量读取,严禁写进代码或文档;错误信息外发前脱敏。
- 涉及扣费的代码必须保证:原子扣减、失败退款、退款失败留日志。
- 本地端口固定 `4605`;对外文案使用简体中文。
- 大文件素材放 `refs/`(已 gitignore),不要散落根目录。

## 文档导航

| 文件 | 内容 |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | AI 协作会话入口:约束、命令、当前状态 |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | 里程碑与进度时间线 |
| [`docs/BUGS.md`](docs/BUGS.md) | 踩坑记录:未决事项 + 已修复归档 |
| [`docs/BACKUP.md`](docs/BACKUP.md) | 备份与恢复手册(Zeabur 原生 + pg_dump 脚本 + 恢复演练) |
| `docs/LOG.md` | 本地工作日志(追加式,不入库) |
| `docs/SILKMOMO_开发需求.pdf` | 原始开发需求 |
| `docs/business/` | 报价/合同等商务文件(不入库) |

## 部署

推送到 GitHub `main` 即触发 Zeabur 自动构建部署。环境变量在 Zeabur 控制台 silkmomo 服务下维护;改动环境变量后需重启/重新部署才生效。
