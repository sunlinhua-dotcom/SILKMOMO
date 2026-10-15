#!/usr/bin/env bash
# SILKMOMO · 一键把线上「GPT」出图通道切到 kie.ai GPT-Image-2.5 Flare
#
# 装成短命令（只需要一次）：
#   ln -sf <本脚本的绝对路径> ~/.local/bin/silkmomo-kie
# 之后在任意目录输入：  silkmomo-kie
#
# 做的事（每一步先说明，逐个提问，不需要编辑任何命令）：
#   1) 取 kie.ai API key：本机 ~/.config/kie/api_key 存在就问你用不用，否则让你粘贴（输入时不回显）
#   2) 用 GET /api/v1/chat/credit 自检 key 是否有效并显示余额（只读，不花 credits）
#   3) 用 zeabur variable 把 KIE_API_KEY 写到线上服务（配了它，GPT 通道就自动改走 kie；不用动别的变量）
#   4) 询问是否立即重新部署（变量要重新部署才生效）
#
# 回滚：在 Zeabur 加变量 OPENAI_IMAGE_PROVIDER=302（或删掉 KIE_API_KEY）后重新部署，立刻回到 302。
# 脚本从不打印 key；key 只经 stdin / 环境传给 curl 与 zeabur。
set -uo pipefail

# ───── 能沿软链接找到自己（~/.local/bin/silkmomo-kie -> 仓库里的脚本）─────
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ZEABUR_SERVICE_ID="69cf9a88e701eccde6eb8e48"
ZEABUR_ENV_ID="69cf91d39c2b3309e23e2c4e"
KIE_BASE="${KIE_BASE_URL:-https://api.kie.ai}"
KEYFILE="$HOME/.config/kie/api_key"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m通过\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m失败：%s\033[0m\n' "$*" >&2; exit 1; }

TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

command -v curl >/dev/null 2>&1 || die "找不到 curl"
command -v zeabur >/dev/null 2>&1 || die "找不到 zeabur 命令行，请先安装并 zeabur auth login"

# ───── 第 1 步：拿到 key ─────
say "第 1 步：kie.ai API key"
KIE_KEY=""
if [ -s "$KEYFILE" ]; then
  info "本机已有 kie key（${KEYFILE}）。"
  read -r -p "  用本机已有的 kie key 吗？[Y/n] " USE_LOCAL
  if [[ ! "${USE_LOCAL:-Y}" =~ ^[Nn]$ ]]; then
    KIE_KEY="$(tr -d '[:space:]' < "$KEYFILE")"
  fi
fi
if [ -z "$KIE_KEY" ]; then
  info "key 在 https://kie.ai/api-key 创建或复制。"
  echo "  下面输入 API key：输入时屏幕不显示任何字符是正常的，粘贴后直接回车。"
  read -r -s -p "  粘贴 kie.ai API key 后回车：" KIE_KEY
  echo
  KIE_KEY="$(printf '%s' "$KIE_KEY" | tr -d '[:space:]')"
fi
[ -n "$KIE_KEY" ] || die "key 不能为空"
case "$KIE_KEY" in
  sk-*|Bearer*|*" "*) die "这看起来不像 kie.ai 的 key（kie 的 key 是一串 32 位左右的十六进制）。重新运行 silkmomo-kie，什么都没写入。" ;;
esac

# ───── 第 2 步：自检（只读，不花 credits）─────
say "第 2 步：自检 key 并查看余额"
CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$KIE_KEY" \
  | curl -sS -o "$TMPDIR_WORK/credit.json" -w '%{http_code}' --max-time 30 -K - \
      -A "$UA" "${KIE_BASE}/api/v1/chat/credit" 2>"$TMPDIR_WORK/curl.err" || printf '000')"
if [ "$CODE" = "000" ]; then
  info "curl 报错：$(head -c 200 "$TMPDIR_WORK/curl.err")" >&2
  die "连不上 ${KIE_BASE}。检查网络；如果开了代理，确认 api.kie.ai 能走代理。没有写入任何线上变量。"
fi
BODY_CODE="$(grep -o '"code" *: *[0-9]*' "$TMPDIR_WORK/credit.json" 2>/dev/null | head -1 | grep -o '[0-9]*$')"
if [ "$CODE" != "200" ] || [ "${BODY_CODE:-}" != "200" ]; then
  case "${BODY_CODE:-$CODE}" in
    401|403) die "key 无效或没有权限（HTTP ${CODE}）。常见原因：复制时多了/少了字符、key 已在后台被删除。没有写入任何线上变量。" ;;
    *)       die "自检返回 HTTP ${CODE} / code ${BODY_CODE:-?}。没有写入任何线上变量。" ;;
  esac
fi
BALANCE="$(grep -o '"data" *: *[0-9.]*' "$TMPDIR_WORK/credit.json" | head -1 | grep -o '[0-9.]*$')"
ok "key 有效，当前余额 ${BALANCE:-未知} credits"
if [ -n "${BALANCE:-}" ] && awk -v b="$BALANCE" 'BEGIN{exit !(b < 100)}'; then
  info "提醒：余额低于 100 credits。2K 一张 10 credits（1K 6、4K 16），很快会用完；先去 https://kie.ai 充值更稳。"
fi

# ───── 第 3 步：写 Zeabur 环境变量 ─────
say "第 3 步：把 KIE_API_KEY 写到 Zeabur（服务 ${ZEABUR_SERVICE_ID}）"
info "写入后，线上 GPT 通道会改走 kie.ai GPT-Image-2.5 Flare（前端「GPT」引擎选项、计费、退款都不变）。"
read -r -p "  确认写入吗？[y/N] " GO
[[ "${GO:-N}" =~ ^[Yy]$ ]] || { info "已取消，没有写入任何东西。"; exit 0; }

zeabur_set() { # <变量名> <值>：已存在就更新，不存在就创建；绝不打印值
  local name="$1" value="$2"
  if zeabur variable update --id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -k "${name}=${value}" -y -i=false >"$TMPDIR_WORK/zb.out" 2>&1; then
    ok "${name} 已更新"; return 0
  fi
  if zeabur variable create --id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -k "${name}=${value}" -y -i=false >"$TMPDIR_WORK/zb.out" 2>&1; then
    ok "${name} 已创建"; return 0
  fi
  printf '\n\033[31m写入 %s 失败。\033[0m zeabur 输出（已隐去变量值）：\n' "$name" >&2
  local out; out="$(cat "$TMPDIR_WORK/zb.out")"
  printf '%s\n' "${out//"$value"/***}" | head -8 >&2
  info "常见原因：zeabur 未登录（先 zeabur auth login）、没有该服务的权限。" >&2
  return 1
}
zeabur_set KIE_API_KEY "$KIE_KEY" || die "变量没写成功（见上）。修好后重新运行 silkmomo-kie 即可（已存在的会被更新，不会重复）。"

# ───── 第 4 步：重新部署 ─────
say "第 4 步：重新部署"
cat <<EOF
  变量写好了，但已运行的服务要重新部署才会读到。
  部署后线上第一次出图前，建议自己在 / 首页选「GPT」引擎出一张图验收。
  回滚：Zeabur 里加变量 OPENAI_IMAGE_PROVIDER=302（或删掉 KIE_API_KEY）并重新部署。
  仓库位置：${REPO_DIR}
EOF
read -r -p "  现在就重新部署吗？[y/N] " ANSWER
if [[ "${ANSWER:-N}" =~ ^[Yy]$ ]]; then
  if zeabur service redeploy --id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -y -i=false 2>&1 | tail -5; then
    ok "已发起重新部署，去 Zeabur 后台看构建日志"
  fi
else
  info "已跳过。准备好后可手动执行："
  info "    zeabur service redeploy --id ${ZEABUR_SERVICE_ID} --env-id ${ZEABUR_ENV_ID} -y"
fi

say "全部完成。"
