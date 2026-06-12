#!/usr/bin/env bash
#
# SILXINE 数据库恢复 / 恢复演练脚本
# ------------------------------------------------------------------
# 把一个备份文件恢复到「目标库」。强烈建议先恢复到一个临时 scratch 库
# 做演练(--drill),确认能跑通、行数对得上,再恢复到生产。
#
# 用法:
#   演练(推荐,恢复到本地临时库并打印行数核对):
#     ./scripts/restore-db.sh --drill ~/silxine-backups/silxine-YYYYMMDD-HHMMSS.dump
#   正式恢复到指定库(危险,会覆盖!):
#     RESTORE_DATABASE_URL='postgresql://...' ./scripts/restore-db.sh ~/silxine-backups/xxx.dump
# ------------------------------------------------------------------
set -euo pipefail

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

DRILL=0
[ "${1:-}" = "--drill" ] && { DRILL=1; shift; }
FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || die "请提供备份文件路径"

# gpg 加密的先解密到临时文件
TMP=""
if [[ "$FILE" == *.gpg ]]; then
  command -v gpg >/dev/null || die "需要 gpg 解密"
  TMP="$(mktemp).dump"; gpg --yes --batch --decrypt --output "$TMP" "$FILE" || die "解密失败"
  FILE="$TMP"
fi
cleanup() { [ -n "$TMP" ] && rm -f "$TMP"; }
trap cleanup EXIT

if [ "$DRILL" = 1 ]; then
  SCRATCH="silxine_restore_drill_$(date +%s)"
  ADMIN_URL="${DRILL_ADMIN_URL:-postgresql://$(whoami)@localhost:5432/postgres}"
  log "▶ 演练:创建临时库 $SCRATCH"
  psql "$ADMIN_URL" -c "CREATE DATABASE $SCRATCH;" >/dev/null || die "无法创建临时库(本地 PG 没在跑?)"
  TARGET="${ADMIN_URL%/*}/$SCRATCH"
  log "▶ 恢复中…"
  pg_restore --dbname="$TARGET" --no-owner --clean --if-exists --exit-on-error "$FILE" 2>/dev/null \
    || log "⚠ pg_restore 有非致命告警(常见于 --clean 首次无对象),继续核对…"
  log "── 行数核对(恢复后的临时库)──"
  psql "$TARGET" -tAc "
    SELECT 'User      '||count(*) FROM \"User\"
    UNION ALL SELECT 'Transaction '||count(*) FROM \"Transaction\"
    UNION ALL SELECT 'BrandProfile '||count(*) FROM \"BrandProfile\"
    UNION ALL SELECT 'GenerationRecord '||count(*) FROM \"GenerationRecord\";" 2>/dev/null \
    || log "⚠ 行数查询失败(表名/结构对不上?)"
  log "✓ 演练完成。确认数据无误后可手动删除临时库:"
  log "    psql \"$ADMIN_URL\" -c 'DROP DATABASE $SCRATCH;'"
  exit 0
fi

# ── 正式恢复(危险)──
[ -n "${RESTORE_DATABASE_URL:-}" ] || die "正式恢复需设 RESTORE_DATABASE_URL(避免误覆盖)"
log "⚠ 即将把备份恢复到目标库,这会 *覆盖* 现有数据。"
log "  目标:${RESTORE_DATABASE_URL%%@*}@***"
printf '  确认请输入大写 YES:'; read -r ans
[ "$ans" = "YES" ] || die "已取消"
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --clean --if-exists --exit-on-error "$FILE"
log "✅ 恢复完成。"
