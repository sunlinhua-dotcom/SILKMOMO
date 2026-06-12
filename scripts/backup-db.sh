#!/usr/bin/env bash
#
# SILXINE 数据库备份脚本
# ------------------------------------------------------------------
# 对一个可达的 PostgreSQL 做一致性快照(pg_dump 自定义格式 -Fc,
# 内置压缩、可并行恢复),做完整性校验、sha256 校验和、GFS 轮转,
# 可选 gpg 加密与离线副本。任何一步失败都以非零退出码结束并写日志。
#
# 用法:
#   1) 复制 .backup.env.example → .backup.env,填好 BACKUP_DATABASE_URL
#   2) ./scripts/backup-db.sh           # 跑一次
#   3) 用 launchd / cron 定时(见 docs/BACKUP.md)
#
# 重要:生产库地址是 Zeabur 内网 postgresql.zeabur.internal,本机打不到。
#   本机备份的对象通常是:① 本地 dev 库(测试脚本/演练用);
#   ② Zeabur 上「暴露端口」后的生产公网地址(见 docs/BACKUP.md 安全提示)。
#   生产的"自动"备份请优先用 Zeabur 原生每日备份。
# ------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 配置(可被 .backup.env 覆盖)──
[ -f "$ROOT_DIR/.backup.env" ] && set -a && . "$ROOT_DIR/.backup.env" && set +a

# 待备份库;未设则回退到项目 .env 的 DATABASE_URL(通常是本地 dev 库)
if [ -z "${BACKUP_DATABASE_URL:-}" ]; then
  if [ -f "$ROOT_DIR/.env" ]; then
    BACKUP_DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
  fi
fi
BACKUP_DIR="${BACKUP_DIR:-$HOME/silxine-backups}"        # 本地备份目录(应在 iCloud/同步盘下=离线副本)
OFFSITE_DIR="${OFFSITE_DIR:-}"                            # 可选:再 cp 一份到这里(第三份/异地)
GPG_RECIPIENT="${GPG_RECIPIENT:-}"                        # 可选:gpg 公钥收件人,设了就加密
KEEP_DAILY="${KEEP_DAILY:-7}"                            # 保留最近 N 份每日
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"                          # 保留 N 份每周(周一)
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"                       # 保留 N 份每月(1 号)

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

command -v pg_dump   >/dev/null || die "未找到 pg_dump(brew install libpq 或 postgresql)"
command -v pg_restore >/dev/null || die "未找到 pg_restore"
[ -n "${BACKUP_DATABASE_URL:-}" ] || die "未配置 BACKUP_DATABASE_URL(见 .backup.env.example)"

# 清掉 Prisma 专用的 ?schema= 参数(libpq/pg_dump 不认),保留 sslmode 等其它参数
BACKUP_DATABASE_URL="$(printf '%s' "$BACKUP_DATABASE_URL" \
  | sed -E 's/([?&])schema=[^&]*/\1/; s/[?&]+$//; s/\?&/?/')"

mkdir -p "$BACKUP_DIR" "$BACKUP_DIR/logs"
LOGFILE="$BACKUP_DIR/logs/backup-$(date +%Y%m).log"
exec > >(tee -a "$LOGFILE") 2>&1

STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="$BACKUP_DIR/silxine-$STAMP.dump"

log "▶ 开始备份 → $DUMP"

# ── 一致性快照:-Fc 自定义格式(单事务快照,自带压缩,支持 pg_restore 并行) ──
if ! pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --compress=zstd --no-owner --file="$DUMP" 2>>"$LOGFILE"; then
  rm -f "$DUMP"
  die "pg_dump 失败(连不上库?见日志 $LOGFILE)"
fi

# ── 完整性校验:能列出 TOC 才算有效备份 ──
TABLES="$(pg_restore --list "$DUMP" 2>/dev/null | grep -c 'TABLE DATA' || true)"
[ "$TABLES" -ge 1 ] || die "备份校验失败:dump 内无任何表数据(TABLE DATA=0)"
SIZE="$(du -h "$DUMP" | cut -f1)"
log "✓ 快照完成:$SIZE,含 $TABLES 张表的数据"

# ── 可选加密(money ledger + 密码哈希,异地存放建议加密)──
FINAL="$DUMP"
if [ -n "$GPG_RECIPIENT" ]; then
  gpg --yes --batch --encrypt --recipient "$GPG_RECIPIENT" --output "$DUMP.gpg" "$DUMP" \
    || die "gpg 加密失败(收件人 $GPG_RECIPIENT 公钥已导入?)"
  rm -f "$DUMP"; FINAL="$DUMP.gpg"
  log "✓ 已加密 → $(basename "$FINAL")"
fi

# ── 校验和(防静默损坏)──
( cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$FINAL")" >> checksums.txt )
log "✓ 已记录 sha256"

# ── 第三份/异地副本 ──
if [ -n "$OFFSITE_DIR" ]; then
  mkdir -p "$OFFSITE_DIR" && cp -p "$FINAL" "$OFFSITE_DIR/" \
    && log "✓ 已复制到异地:$OFFSITE_DIR" || log "⚠ 异地复制失败(不阻断主备份)"
fi

# ── GFS 轮转:每日保留 N 份;每周(周一)与每月(1 号)的多保留 ──
prune() {
  ls -1t "$BACKUP_DIR"/silxine-*.dump* 2>/dev/null | while read -r f; do
    d="$(basename "$f" | sed -E 's/silxine-([0-9]{8})-.*/\1/')"
    dow="$(date -j -f %Y%m%d "$d" +%u 2>/dev/null || echo 0)"   # 1=周一
    dom="$(echo "$d" | sed 's/.*\(..\)$/\1/')"
    echo "$f|$d|$dow|$dom"
  done
}
keep_set="$(mktemp)"; trap 'rm -f "$keep_set"' EXIT
prune | head -n "$KEEP_DAILY" | cut -d'|' -f1 >> "$keep_set"                              # 最近 N 份
prune | awk -F'|' '$3==1' | head -n "$KEEP_WEEKLY" | cut -d'|' -f1 >> "$keep_set"          # 周一
prune | awk -F'|' '$4=="01"' | head -n "$KEEP_MONTHLY" | cut -d'|' -f1 >> "$keep_set"      # 每月 1 号
removed=0
for f in "$BACKUP_DIR"/silxine-*.dump*; do
  [ -e "$f" ] || continue
  grep -qxF "$f" "$keep_set" || { rm -f "$f"; removed=$((removed+1)); }
done
[ "$removed" -gt 0 ] && log "✓ 轮转:清理 $removed 份过期备份" || true

REMAIN="$(ls -1 "$BACKUP_DIR"/silxine-*.dump* 2>/dev/null | wc -l | tr -d ' ')"
log "✅ 备份完成。本地现存 $REMAIN 份。"
