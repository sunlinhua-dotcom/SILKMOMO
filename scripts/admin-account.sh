#!/usr/bin/env bash
# silkmomo-admin：忘了管理员密码时用。逐条提问，二选一：
#   1) 重置某个已有管理员的密码（推荐）
#   2) 新建一个管理员账号
# 密码只在本机用 bcryptjs（cost 12，与 lib/auth.ts 一致）哈希，线上数据库只收到哈希；脚本不打印密码。
# 线上写库经 `zeabur service exec` 在 postgresql 服务容器里跑 psql，本机不需要数据库连接串。
#
# 安装成短命令：ln -sf /Volumes/ProjectsAPFS/SILKMOMO/scripts/admin-account.sh ~/.local/bin/silkmomo-admin
# 本地测试：SILKMOMO_ADMIN_PSQL="psql -d <临时库>" silkmomo-admin（不连 Zeabur）
set -uo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
ROOT_DIR="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"

PG_SERVICE_ID="${PG_SERVICE_ID:-69cf9956c5d57fa53f0665b2}"
ZEABUR_ENV_ID="${ZEABUR_ENV_ID:-69cf91d39c2b3309e23e2c4e}"
LOCAL_PSQL="${SILKMOMO_ADMIN_PSQL:-}"
LOGIN_URL="https://silkmomo.zeabur.app/login"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m通过\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m失败：%s\033[0m\n' "$*" >&2; exit 1; }

# 跑一条 SQL，输出无表头、竖线分隔
run_sql() {
  local sql="$1" out rc
  if [ -n "$LOCAL_PSQL" ]; then
    # shellcheck disable=SC2086
    out="$($LOCAL_PSQL -X -q -v ON_ERROR_STOP=1 -At -c "$sql" 2>&1)"; rc=$?
  else
    # 容器里用它自己的 POSTGRES_* 变量连本机库（密码不经过本机）；-w 永不交互等密码，
    # 否则认证不过时 psql 会挂住，Zeabur 那头表现为 504 超时。
    # zeabur exec 出错时退出码仍可能是 0，所以还要按输出判断；504 / 超时自动重试。
    local attempt
    for attempt in 1 2 3; do
      # shellcheck disable=SC2016  # $1 / $POSTGRES_* 要在容器里展开
      out="$(zeabur service exec --id "$PG_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -i=false -- \
        sh -c 'PGPASSWORD="${POSTGRES_PASSWORD:-${PASSWORD:-}}" PGCONNECT_TIMEOUT=10 psql -X -q -w -h 127.0.0.1 -U "${POSTGRES_USER:-${POSTGRES_USERNAME:-root}}" -d "${POSTGRES_DB:-${POSTGRES_DATABASE:-zeabur}}" -v ON_ERROR_STOP=1 -At -c "$1"' _ "$sql" 2>&1)"; rc=$?
      out="$(printf '%s\n' "$out" | grep -vE '^\s*(INFO|WARN)\b|A new version of Zeabur CLI|github.com/zeabur/cli/releases' || true)"
      if printf '%s' "$out" | grep -qE '(^|\s)ERROR\b|execute command failed|psql: error|FATAL:|could not connect'; then
        rc=1
      fi
      [ "$rc" -eq 0 ] && break
      printf '%s' "$out" | grep -qiE '504|timeout|timed out|EOF|connection reset' || break
      [ "$attempt" -lt 3 ] && { info "Zeabur 那头超时，3 秒后重试（${attempt}/3）……" >&2; sleep 3; }
    done
  fi
  printf '%s' "$out"
  return $rc
}

command -v node >/dev/null 2>&1 || die "找不到 node，请先安装 Node.js"
[ -d "$ROOT_DIR/node_modules/bcryptjs" ] || die "找不到 $ROOT_DIR/node_modules/bcryptjs，先在仓库里 npm ci"
if [ -z "$LOCAL_PSQL" ]; then
  command -v zeabur >/dev/null 2>&1 || die "找不到 zeabur 命令行，请先安装并 zeabur auth login"
fi

# ───── 第 1 步：列出线上已有的管理员 ─────
say "第 1 步：查线上已有的管理员账号"
ADMINS="$(run_sql 'SELECT username, name, to_char("createdAt", '"'"'YYYY-MM-DD'"'"') FROM "User" WHERE role = '"'"'admin'"'"' ORDER BY "createdAt";')" \
  || die "查询失败：$(printf '%s' "$ADMINS" | tail -3)
  常见原因：zeabur 未登录（先 zeabur auth login）、网络抖动（直接重跑即可）。"
if [ -z "$ADMINS" ]; then
  info "线上目前没有管理员账号。"
else
  info "线上现有管理员（用户名 | 昵称 | 创建日期）："
  printf '%s\n' "$ADMINS" | sed 's/^/    /'
fi

# ───── 第 2 步：选择操作 ─────
say "第 2 步：要做什么？"
info "1) 重置上面某个管理员的密码（推荐：你只是忘了密码，账号和余额都不变）"
info "2) 新建一个管理员账号"
read -r -p "  输入 1 或 2 后回车：" CHOICE
case "$CHOICE" in
  1) [ -n "$ADMINS" ] || die "线上没有管理员可重置，请重跑并选 2"; MODE=reset ;;
  2) MODE=create ;;
  *) die "只能输入 1 或 2" ;;
esac

# ───── 第 3 步：用户名 ─────
say "第 3 步：用户名"
if [ "$MODE" = reset ]; then
  read -r -p "  要重置哪个管理员？输入上面列出的用户名后回车：" USERNAME
  USERNAME="$(printf '%s' "$USERNAME" | tr -d '[:space:]')"
  printf '%s\n' "$ADMINS" | cut -d'|' -f1 | grep -qxF -- "$USERNAME" || die "「${USERNAME}」不在上面的管理员列表里（区分大小写）"
else
  read -r -p "  新管理员的用户名（2–32 位字母、数字、_ 或 -）：" USERNAME
  USERNAME="$(printf '%s' "$USERNAME" | tr -d '[:space:]')"
  [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]{2,32}$ ]] || die "用户名只能是 2–32 位字母、数字、_ 或 -"
  EXISTS="$(run_sql "SELECT count(*) FROM \"User\" WHERE username = '${USERNAME}';")" || die "查询失败：$EXISTS"
  [ "$EXISTS" = "0" ] || die "用户名「${USERNAME}」已被占用，换一个重跑即可"
fi
ok "用户名：${USERNAME}"

# ───── 第 4 步：新密码 ─────
say "第 4 步：设置新密码（8–128 位）"
info "输入时屏幕不显示任何字符是正常的，输完直接回车。"
read -r -s -p "  新密码：" PW1; echo
read -r -s -p "  再输一遍：" PW2; echo
[ "$PW1" = "$PW2" ] || die "两次输入不一致，重跑即可（什么都没改）"
[ "${#PW1}" -ge 8 ] && [ "${#PW1}" -le 128 ] || die "密码长度要在 8–128 位之间（现在是 ${#PW1} 位）"

HASH="$(cd "$ROOT_DIR" && PW="$PW1" node -e 'process.stdout.write(require("bcryptjs").hashSync(process.env.PW, 12))')" || die "本机生成密码哈希失败"
unset PW1 PW2
[[ "$HASH" =~ ^\$2[aby]\$12\$[./A-Za-z0-9]{53}$ ]] || die "生成的哈希格式不对，已停止（什么都没改）"
ok "密码已在本机加密（线上只收到加密后的结果）"

# ───── 第 5 步：确认并写入 ─────
say "第 5 步：确认写入线上"
if [ "$MODE" = reset ]; then
  info "将把管理员「${USERNAME}」的密码改成你刚输入的新密码；账号、余额、历史记录都不变。"
else
  info "将新建管理员「${USERNAME}」（昵称「管理员」，余额 ¥0）。"
fi
read -r -p "  确认吗？[y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || die "已取消，什么都没改"

if [ "$MODE" = reset ]; then
  SQL="UPDATE \"User\" SET \"passwordHash\" = '${HASH}', \"updatedAt\" = now() WHERE username = '${USERNAME}' AND role = 'admin' RETURNING username;"
else
  NEW_ID="$(node -e 'process.stdout.write("c" + require("crypto").randomBytes(12).toString("hex"))')"
  SQL="INSERT INTO \"User\" (id, username, \"passwordHash\", name, role, \"balanceFen\", \"createdAt\", \"updatedAt\") VALUES ('${NEW_ID}', '${USERNAME}', '${HASH}', '管理员', 'admin', 0, now(), now()) RETURNING username;"
fi
RESULT="$(run_sql "$SQL")" || die "写入失败：$(printf '%s' "$RESULT" | tail -3)"
[ "$(printf "%s\n" "$RESULT" | head -1)" = "$USERNAME" ] || die "写入后没有拿到预期结果（返回：${RESULT:-空}），请把这段输出发给 Claude"
unset HASH SQL

ok "已完成"
say "现在去登录：${LOGIN_URL}"
info "用户名：${USERNAME}，密码：刚才输入的新密码。"
info "如果之前连续输错过 5 次密码，这个账号在你这台电脑上会被锁 15 分钟，等一会儿再试。"
