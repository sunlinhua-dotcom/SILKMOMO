# SILXINE 备份与恢复手册

> 目标:任何单点失效(Zeabur 故障 / 误删 / 库损坏 / 账号丢失)都能把生产数据恢复出来,
> 且符合 3-2-1 原则(≥3 份、≥2 种介质、≥1 份异地)。

## 一、先认清:什么丢得起、什么丢不起

| 数据 | 在哪 | 丢了会怎样 | 备份策略 |
|---|---|---|---|
| **用户 / 资金流水 / 品牌档案 / 生成记录** | Zeabur PostgreSQL | **致命**:账号、余额、对账全没 | 本手册重点,见下 |
| 代码 | GitHub `main` | 可重新部署 | 已天然备份(GitHub) |
| 环境变量/密钥(GEMINI/OPENAI/DEEPSEEK/JWT/ADMIN_SETUP) | 仅 Zeabur | 服务起不来/需重配 | 见 §4,存进密码管理器 |
| **用户生成的图片** | 各用户**浏览器 IndexedDB**(不在服务端!) | 用户换浏览器/清缓存即没 | 服务端**备份不到**,见 §5 |
| 本地素材 `refs/` | 你本机 | 参考资料,非生产 | 跟随你机器的 Time Machine 即可 |

> ⚠️ 关键认知:**备份数据库 ≠ 备份用户的图**。结果图存在用户浏览器里,
> 真要"图也不丢"需要改架构(生成后转存对象存储),见 §5。

## 二、第 0 层:开 Zeabur 原生每日备份(必做,2 分钟,免费)

Zeabur 控制台 → `silkmomo` 项目 → **postgresql** 服务 → **备份(Backup)** 标签 →
打开 **自动备份(Automatic Backup)** → 设一个 UTC 时间(比如 UTC 19:00 = 北京 03:00)。

- 频率:**每天一次**;存在 Zeabur 的 Amazon S3,免费。
- **保留只有 7 天**,过期自动删——所以这层只能扛"最近一周内的误操作",**不能当唯一备份**。
- 恢复:在备份标签下载 `data.sql`,用 `psql` 导入(见 §3)。

## 三、第 1 层:离线长留档(把备份从 Zeabur 拉走 / 独立 pg_dump)

Zeabur 只留 7 天,所以必须把备份**搬到你自己的地方**长期保存。两种做法,按你的情况二选一:

### 做法 A(最省心,推荐):每周下载一份,存进同步盘
每周在 Zeabur 备份标签点一次「下载」,存到 iCloud/Dropbox 里的 `silxine-backups/` 文件夹。
同步盘 = 自动有了异地副本。配合每月归档一份长期留存即可。

### 做法 B(自动化,独立于 Zeabur):本机 pg_dump + 定时
本仓库已带好脚本(已实测跑通:备份→校验→轮转→恢复演练全绿)。

**前提:本机要能连到生产库。** 生产库地址是 Zeabur 内网 `postgresql.zeabur.internal`,
本机打不到。要用本做法,需先在 Zeabur **postgresql 服务 → 网络 → 暴露端口**,
拿到一个公网 `host:port`(⚠️ 公网暴露数据库是风险面,务必保持强密码;不需要时关掉)。

```bash
# 1) 配置(复制模板,填生产公网连接串)
cp .backup.env.example .backup.env
#    编辑 .backup.env:BACKUP_DATABASE_URL=postgresql://root:<pwd>@<公网host>:<port>/zeabur
#    BACKUP_DIR 建议指向 iCloud 下的文件夹(自动异地)
#    GPG_RECIPIENT 建议设置(库里有密码哈希+资金流水,异地存放应加密)

# 2) 手动跑一次
./scripts/backup-db.sh

# 3) 定时(每天 03:30)
#    编辑 scripts/com.silxine.backup.plist 里的 <PATH-TO-REPO>,然后:
cp scripts/com.silxine.backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.silxine.backup.plist
launchctl start com.silxine.backup     # 立刻试跑
```

脚本做了:一致性快照(`pg_dump -Fc` 单事务、zstd 压缩)、**完整性校验**(列不出表就报错)、
sha256 校验和、可选 gpg 加密、可选异地副本、**GFS 轮转**(每日留 7、每周留 4、每月留 12)。

> 不想暴露生产库?那就用「做法 A」+ Zeabur 原生备份;脚本留着对**本地 dev 库**做备份/演练同样有用。

## 四、第 2 层:密钥备份(别只躺在 Zeabur)

`GEMINI_API_KEY`、`OPENAI_IMAGE_API_KEY`、`DEEPSEEK_API_KEY`、`JWT_SECRET`、`ADMIN_SETUP_KEY`、
`DATABASE_URL` 只存在 Zeabur。**把它们的当前值存一份进密码管理器(1Password 等)**,
注明用途与轮换日期。Zeabur 出问题或迁移时,这是重建服务的唯一依据。
(`.env.local` 本机也有一份,但别当唯一副本。)

## 五、(可选)让"用户的图"也不丢——需改架构

现在结果图存浏览器 IndexedDB,服务端无从备份。若客户要求图片可长期留存/跨设备:
把生成成功的图同时上传到对象存储(Zeabur 卷 / S3 / R2),DB 里只存 URL。
这是功能增强(非本次备份范围),需要时单独排期。

## 六、恢复演练(备份只有恢复成功过才算数)

**每月做一次演练**,否则"有备份"是假象:

```bash
# 恢复到一个临时库并自动核对行数(不碰生产)
./scripts/restore-db.sh --drill ~/path/to/silxine-YYYYMMDD-HHMMSS.dump
```

会建临时库、恢复、打印 User/Transaction/BrandProfile/GenerationRecord 行数,跑完提示如何删临时库。

**真要恢复生产**(危险,会覆盖):
```bash
RESTORE_DATABASE_URL='postgresql://...生产...' ./scripts/restore-db.sh ~/path/to/xxx.dump
# 需手动输入大写 YES 确认
```
> 用 Zeabur 下载的 `data.sql` 直接 `psql` 导入时:若想保留当前 DB 密码,
> 先从 `data.sql` 删掉 `CREATE ROLE` / `ALTER ROLE` 语句再导(Zeabur 文档明确提醒)。

## 七、推荐落地组合(给 SILXINE 这个体量)

1. ✅ **开 Zeabur 原生每日备份**(扛近 7 天误操作)——立刻做。
2. ✅ **每周下载一份到 iCloud `silxine-backups/`**(做法 A)+ 每月归档一份——长留档 + 异地。
3. ✅ **密钥存进密码管理器**(§4)。
4. ✅ **每月一次 `--drill` 恢复演练**(§6)。
5. ⏳ 用户量上来后,再考虑做法 B 自动化 + §5 图片转存。

> 这套 = 3 份(Zeabur S3 + iCloud + 每月归档)、2 种介质(云 + 本地同步盘)、1 份异地(iCloud),
> 满足 3-2-1,且每月验证可恢复。对当前体量足够稳,几乎零成本。

---
参考:[Zeabur 备份文档](https://zeabur.com/docs/en-US/data-management/backup) ·
[PostgreSQL 官方备份章节](https://www.postgresql.org/docs/current/backup.html) ·
[pg_dump 自动化备份](https://oneuptime.com/blog/post/2026-01-25-postgresql-automated-backups-pg-dump/view)
