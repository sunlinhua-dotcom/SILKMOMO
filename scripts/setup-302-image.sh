#!/usr/bin/env bash
# SILKMOMO · 一键把线上「GPT」出图通道切回 302.ai 官转 gpt-image-2（10-15 切 kie 之前的原通道）
#
# 装成短命令（只需要一次）：
#   ln -sf <本脚本的绝对路径> ~/.local/bin/silkmomo-302
# 之后在任意目录输入：  silkmomo-302
#
# 做的事（每一步先说明，逐个提问，不需要编辑任何命令）：
#   1) 让你粘贴 302.ai 的 API key（输入时不回显）
#   2) 用 GET /v1/models 自检 key 是否有效、能不能用 gpt-image-2（只读，不花钱）
#   3) 用 zeabur variable 写四个变量：OPENAI_IMAGE_API_KEY、OPENAI_IMAGE_PROVIDER=302、
#      OPENAI_IMAGE_MODEL=gpt-image-2、OPENAI_IMAGE_BASE_URL=https://api.302.ai
#      （KIE_API_KEY 保留不删，以后想切回 kie 只要把 OPENAI_IMAGE_PROVIDER 改成 kie 再部署）
#   4) 询问是否立即重新部署，部署完查一次健康接口
#
# 脚本从不打印 key；key 只经 stdin / 环境传给 curl 与 zeabur。
set -uo pipefail

ZEABUR_SERVICE_ID="69cf9a88e701eccde6eb8e48"
ZEABUR_ENV_ID="69cf91d39c2b3309e23e2c4e"
BASE_302="https://api.302.ai"
MODEL_302="gpt-image-2"
HEALTH_URL="https://silkmomo.zeabur.app/api/health"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m通过\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m失败：%s\033[0m\n' "$*" >&2; exit 1; }

TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

command -v curl >/dev/null 2>&1 || die "找不到 curl"
command -v zeabur >/dev/null 2>&1 || die "找不到 zeabur 命令行，请先安装并 zeabur auth login"

# ───── 第 1 步：拿到 key ─────
say "第 1 步：302.ai API key"
info "key 在 302.ai 后台「API 超市 / 使用 API」里复制，以 sk- 开头。"
echo "  下面输入 API key：输入时屏幕不显示任何字符是正常的，粘贴后直接回车。"
read -r -s -p "  粘贴 302.ai API key 后回车：" KEY_302
echo
KEY_302="$(printf '%s' "$KEY_302" | tr -d '[:space:]')"
[ -n "$KEY_302" ] || die "key 不能为空，什么都没写入。"
case "$KEY_302" in
  sk-*) ;;
  *) die "这看起来不像 302.ai 的 key（应以 sk- 开头）。重新运行 silkmomo-302，什么都没写入。" ;;
esac

# ───── 第 2 步：自检（只读，不花钱）─────
say "第 2 步：自检 key"
CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$KEY_302" \
  | curl -sS -o "$TMPDIR_WORK/models.json" -w '%{http_code}' --max-time 30 -K - \
      "${BASE_302}/v1/models" 2>"$TMPDIR_WORK/curl.err" || printf '000')"
case "$CODE" in
  200) ;;
  000) info "curl 报错：$(head -c 200 "$TMPDIR_WORK/curl.err")" >&2
       die "连不上 ${BASE_302}。检查网络 / 代理后重跑。没有写入任何线上变量。" ;;
  401|403) die "key 无效或没有权限（HTTP ${CODE}）。常见原因：复制时多了或少了字符、key 已在 302 后台被删除或禁用。没有写入任何线上变量。" ;;
  *) die "自检返回 HTTP ${CODE}：$(head -c 200 "$TMPDIR_WORK/models.json")。没有写入任何线上变量。" ;;
esac
if grep -q "\"${MODEL_302}\"" "$TMPDIR_WORK/models.json"; then
  ok "key 有效，模型列表里有 ${MODEL_302}"
else
  info "key 有效，但模型列表里没看到 ${MODEL_302}（有的令牌只返回部分模型，不一定有问题）。"
  read -r -p "  仍然继续吗？[y/N] " GO_ON
  [[ "${GO_ON:-N}" =~ ^[Yy]$ ]] || die "已取消，没有写入任何东西。"
fi
info "余额 API key 查不到（302 的余额接口只认后台登录），请在 302 后台确认有余额。"

# ───── 第 3 步：写 Zeabur 环境变量 ─────
say "第 3 步：写到 Zeabur（服务 ${ZEABUR_SERVICE_ID}）"
info "写入后线上「GPT」引擎改回 302 官转 ${MODEL_302}（前端选项、计费、退款都不变）。"
info "kie 的 KIE_API_KEY 保留，以后想切回 kie 只需把 OPENAI_IMAGE_PROVIDER 改成 kie 再部署。"
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
# 先写 key，最后写提供方开关：中途失败时线上仍是原来的 kie，不会半切换
zeabur_set OPENAI_IMAGE_API_KEY "$KEY_302" || die "变量没写成功（见上）。修好后重跑 silkmomo-302 即可（已存在的会被更新）。"
unset KEY_302
zeabur_set OPENAI_IMAGE_BASE_URL "$BASE_302" || die "变量没写成功（见上）。重跑即可。"
zeabur_set OPENAI_IMAGE_MODEL "$MODEL_302" || die "变量没写成功（见上）。重跑即可。"
zeabur_set OPENAI_IMAGE_PROVIDER "302" || die "变量没写成功（见上）。重跑即可。"

# ───── 第 4 步：重新部署 ─────
say "第 4 步：重新部署"
info "变量要重新部署才生效。部署约 3–5 分钟，期间正在出的图可能被打断（会自动退款）。"
read -r -p "  现在就重新部署吗？[y/N] " ANSWER
if [[ ! "${ANSWER:-N}" =~ ^[Yy]$ ]]; then
  info "已跳过。准备好后再运行一次 silkmomo-302，或执行："
  info "    zeabur service redeploy --id ${ZEABUR_SERVICE_ID} --env-id ${ZEABUR_ENV_ID} -y"
  exit 0
fi
# 当前在跑的部署 id（去掉颜色码后第 3 列是状态）；新部署变 RUNNING 才算切换完成，
# 否则旧容器还在回 200，健康检查会误报成功
running_id() {
  zeabur deployment list --service-id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -i=false 2>/dev/null \
    | sed $'s/\x1b\\[[0-9;]*m//g' | awk '$3=="RUNNING"{print $1; exit}'
}
OLD_ID="$(running_id)"
zeabur service redeploy --id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -y -i=false 2>&1 | tail -3
info "等新部署跑起来（最多 10 分钟）……"
NEW_ID=""
for _ in $(seq 1 40); do
  sleep 15
  NEW_ID="$(running_id)"
  [ -n "$NEW_ID" ] && [ "$NEW_ID" != "$OLD_ID" ] && break
  NEW_ID=""
done
[ -n "$NEW_ID" ] || die "10 分钟内没看到新部署跑起来。去 Zeabur 后台看部署日志，或把这段输出发给 Claude。变量已写好，线上可能仍是 kie。"
ok "新部署 ${NEW_ID} 已在运行"
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$HEALTH_URL")" = "200" ]; then
  ok "线上健康检查 200"
  say "全部完成。去首页选「GPT」引擎出一张图验收；有问题把这段输出发给 Claude。"
else
  die "新部署在跑，但健康检查没回 200。把这段输出发给 Claude。"
fi
