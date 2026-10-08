#!/usr/bin/env bash
# SILKMOMO · 一键配置 Cloudflare R2 模特脸存储
#
# 装成短命令（只需要一次）：
#   ln -sf <本脚本的绝对路径> ~/.local/bin/silkmomo-r2
# 之后在任意目录输入：  silkmomo-r2
#
# 做的事（每一步都会先说明，逐个提问，不需要编辑任何命令）：
#   1) 用 wrangler 检查 Cloudflare 登录，创建私有桶 silkmomo-faces（已存在就跳过）
#   2) 指引你在 Cloudflare 后台创建 R2 API 令牌，然后逐个询问 Access Key ID 和 Secret Access Key
#   3) 用这组密钥对桶做一次 PUT / GET / DELETE 自检，失败会说清哪一步错，不往下走
#   4) 用 zeabur variable 把 5 个 OBJECT_STORAGE_* 环境变量写到线上服务
#   5) 询问是否立即重新部署，并给出（默认不跑的）迁移命令
#
# 隐藏参数：--selftest-only   只跑第 3 步，从环境变量 SELFTEST_ENDPOINT / SELFTEST_BUCKET /
#                             SELFTEST_KEY_ID / SELFTEST_SECRET / SELFTEST_REGION 取值（本地用 S3 模拟器验证脚本用）
set -uo pipefail

# ───── 能沿软链接找到自己（~/.local/bin/silkmomo-r2 -> 仓库里的脚本）─────
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUCKET="silkmomo-faces"
ZEABUR_SERVICE_ID="69cf9a88e701eccde6eb8e48"
ZEABUR_ENV_ID="69cf91d39c2b3309e23e2c4e"
REGION="auto"
WRANGLER=(npx -y wrangler@4)

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m通过\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m失败：%s\033[0m\n' "$*" >&2; exit 1; }
strip_ansi() { sed $'s/\x1b\\[[0-9;]*m//g'; }

TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

# ───── 第 3 步：用 curl 的 SigV4 对桶做 PUT / GET / DELETE 自检 ─────
# 密钥通过 stdin 喂给 curl（-K -），不会出现在进程列表里。
EMPTY_SHA="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

s3_call() { # 用法：s3_call <方法> <对象 key> [上传文件]  → 打印 HTTP 状态码；响应体在 $TMPDIR_WORK/resp
  local method="$1" key="$2" file="${3:-}" sha="$EMPTY_SHA"
  local url="${ST_ENDPOINT}/${ST_BUCKET}/${key}"
  local args=(-sS -o "$TMPDIR_WORK/resp" -w '%{http_code}' --max-time 30 -K - --aws-sigv4 "aws:amz:${ST_REGION}:s3" -X "$method")
  if [ -n "$file" ]; then
    sha="$(shasum -a 256 "$file" | awk '{print $1}')"
    args+=(--data-binary "@${file}" -H "Content-Type: text/plain")
  fi
  args+=(-H "x-amz-content-sha256: ${sha}" "$url")
  printf 'user = "%s:%s"\n' "$ST_KEY_ID" "$ST_SECRET" | curl "${args[@]}" 2>"$TMPDIR_WORK/curl.err" || printf '000'
}

explain_http() { # <步骤> <状态码>
  local step="$1" code="$2" body=""
  [ -s "$TMPDIR_WORK/resp" ] && body="$(grep -o '<Code>[^<]*</Code>' "$TMPDIR_WORK/resp" | head -1 | sed 's/<[^>]*>//g')"
  printf '\n\033[31m自检失败：%s 返回 HTTP %s%s\033[0m\n' "$step" "$code" "${body:+（$body）}" >&2
  case "$code" in
    000) info "连不上 R2：检查网络；如果开了代理，确认 *.r2.cloudflarestorage.com 能直连或走代理。curl 报错：$(head -c 200 "$TMPDIR_WORK/curl.err")" >&2 ;;
    403) info "鉴权失败。常见原因：1) Access Key ID 或 Secret 抄错/多了空格；2) 令牌权限不是『Object Read & Write』；" >&2
         info "3) 令牌限定的桶不是 $ST_BUCKET；4) 令牌已过期或被吊销。可回后台重新创建一个令牌再来。" >&2 ;;
    404) info "找不到桶或路径。常见原因：Account ID 不对（endpoint 里的那一串）、桶名不是 $ST_BUCKET。" >&2 ;;
    *)   info "常见原因：Account ID 不对、令牌没限定到该桶、系统时间偏差过大（签名带时间戳，差超过 15 分钟会被拒）。" >&2 ;;
  esac
}

run_selftest() {
  local stamp key payload code
  stamp="$(date +%s)-$$"
  key="self-test/${stamp}.txt"
  payload="$TMPDIR_WORK/payload.txt"
  printf 'silkmomo r2 self-test %s' "$stamp" > "$payload"

  say "第 3 步：用这组密钥对桶 ${ST_BUCKET} 做 PUT / GET / DELETE 自检"
  code="$(s3_call PUT "$key" "$payload")"
  [[ "$code" =~ ^2 ]] || { explain_http "上传（PUT）" "$code"; return 1; }
  ok "PUT 上传"

  code="$(s3_call GET "$key")"
  [[ "$code" =~ ^2 ]] || { explain_http "读取（GET）" "$code"; return 1; }
  cmp -s "$TMPDIR_WORK/resp" "$payload" || { printf '\n\033[31m自检失败：GET 回来的内容和上传的不一致\033[0m\n' >&2; return 1; }
  ok "GET 读取，内容一致"

  code="$(s3_call DELETE "$key")"
  [[ "$code" =~ ^2 ]] || { explain_http "删除（DELETE）" "$code"; return 1; }
  ok "DELETE 删除"

  code="$(s3_call GET "$key")"
  if [ "$code" = "404" ]; then ok "删除后再读 = 404（符合预期）"; else
    printf '  提示：删除后再读返回 %s（预期 404），不影响使用\n' "$code"; fi
  return 0
}

if [ "${1:-}" = "--selftest-only" ]; then
  ST_ENDPOINT="${SELFTEST_ENDPOINT:?缺 SELFTEST_ENDPOINT}"; ST_BUCKET="${SELFTEST_BUCKET:?缺 SELFTEST_BUCKET}"
  ST_KEY_ID="${SELFTEST_KEY_ID:?缺 SELFTEST_KEY_ID}"; ST_SECRET="${SELFTEST_SECRET:?缺 SELFTEST_SECRET}"
  ST_REGION="${SELFTEST_REGION:-auto}"
  run_selftest && exit 0 || exit 1
fi

# ───── 第 1 步：Cloudflare 登录与桶 ─────
say "第 1 步：检查 Cloudflare 登录并创建私有桶 ${BUCKET}"
command -v npx >/dev/null 2>&1 || die "找不到 npx，请先安装 Node.js"
command -v zeabur >/dev/null 2>&1 || die "找不到 zeabur 命令行，请先安装并 zeabur auth login"

WHOAMI="$("${WRANGLER[@]}" whoami </dev/null 2>&1 | strip_ansi)"
if ! printf '%s' "$WHOAMI" | grep -q "You are logged in"; then
  info "wrangler 还没有登录 Cloudflare。请先运行下面这条（会打开浏览器让你授权），然后重新运行 silkmomo-r2："
  info "    npx -y wrangler@4 login"
  exit 1
fi
ok "wrangler 已登录"

ACCOUNT_IDS="$(printf '%s' "$WHOAMI" | grep -oE '[0-9a-f]{32}' | sort -u)"
ACCOUNT_COUNT="$(printf '%s\n' "$ACCOUNT_IDS" | grep -c .)"
if [ "$ACCOUNT_COUNT" = "1" ]; then
  ACCOUNT_ID="$ACCOUNT_IDS"
  info "Cloudflare Account ID：$ACCOUNT_ID（自动识别）"
else
  info "这个登录下有多个账号，请从下面选一个粘贴 Account ID："
  printf '%s\n' "$ACCOUNT_IDS" | sed 's/^/    /'
  read -r -p "  Account ID：" ACCOUNT_ID
  printf '%s' "$ACCOUNT_ID" | grep -qE '^[0-9a-f]{32}$' || die "Account ID 应是 32 位小写十六进制"
fi

BUCKETS="$("${WRANGLER[@]}" r2 bucket list </dev/null 2>&1 | strip_ansi)" || true
if printf '%s' "$BUCKETS" | grep -qE "^name:[[:space:]]+${BUCKET}[[:space:]]*$"; then
  ok "桶 ${BUCKET} 已存在，跳过创建"
elif printf '%s' "$BUCKETS" | grep -qE '^name:|Listing buckets'; then
  info "创建私有桶 ${BUCKET}（默认不开公开访问，也不要去开）……"
  "${WRANGLER[@]}" r2 bucket create "$BUCKET" </dev/null 2>&1 | strip_ansi | tail -5
  "${WRANGLER[@]}" r2 bucket list </dev/null 2>&1 | strip_ansi | grep -qE "^name:[[:space:]]+${BUCKET}[[:space:]]*$" \
    || die "桶创建后没有在列表里看到 ${BUCKET}。如果是首次使用 R2，需要先在 Cloudflare 后台 R2 页面点一下开通（可能要绑定付款方式，免费额度 10GB）。"
  ok "桶 ${BUCKET} 已创建"
else
  printf '%s\n' "$BUCKETS" | tail -8
  die "列桶失败。如果是首次使用 R2，需要先在 Cloudflare 后台 R2 页面开通。"
fi

# ───── 第 2 步：R2 API 令牌 ─────
say "第 2 步：在 Cloudflare 后台创建 R2 API 令牌"
cat <<EOF
  1) 打开：https://dash.cloudflare.com/${ACCOUNT_ID}/r2/api-tokens
     （或：Cloudflare 后台 → R2 对象存储 → 右侧『Manage R2 API Tokens / 管理 API 令牌』）
  2) 点『Create API token / 创建 API 令牌』
  3) 权限选『Object Read & Write / 对象读和写』
  4) 『指定存储桶』选 ${BUCKET}（不要选『所有存储桶』），有效期可选『永久』
  5) 点创建。页面只会显示一次 Access Key ID 和 Secret Access Key —— 先别关页面，下面马上要用
  （页面里还有一个 Token value 和 jurisdiction 地址，这里都用不到）
EOF
echo
read -r -p "  粘贴 Access Key ID 后回车：" ST_KEY_ID
[ -n "$ST_KEY_ID" ] || die "Access Key ID 不能为空"
echo "  下面输入 Secret Access Key：输入时屏幕不显示任何字符是正常的，粘贴后直接回车。"
read -r -s -p "  粘贴 Secret Access Key 后回车：" ST_SECRET
echo
[ -n "$ST_SECRET" ] || die "Secret Access Key 不能为空"
ST_KEY_ID="$(printf '%s' "$ST_KEY_ID" | tr -d '[:space:]')"
ST_SECRET="$(printf '%s' "$ST_SECRET" | tr -d '[:space:]')"

ST_ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
ST_BUCKET="$BUCKET"
ST_REGION="$REGION"

# ───── 第 3 步 ─────
run_selftest || die "自检没通过，已停止，没有写任何线上变量。按上面的提示检查后重新运行 silkmomo-r2。"

# ───── 第 4 步：写 Zeabur 环境变量 ─────
say "第 4 步：把 5 个环境变量写到 Zeabur（服务 ${ZEABUR_SERVICE_ID}）"
zeabur_set() { # <变量名> <值>：已存在就更新，不存在就创建；绝不打印值
  local name="$1" value="$2"
  if zeabur variable update --id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -k "${name}=${value}" -y -i=false >"$TMPDIR_WORK/zb.out" 2>&1; then
    ok "$name 已更新"; return 0
  fi
  if zeabur variable create --id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -k "${name}=${value}" -y -i=false >"$TMPDIR_WORK/zb.out" 2>&1; then
    ok "$name 已创建"; return 0
  fi
  printf '\n\033[31m写入 %s 失败。\033[0m zeabur 输出（已隐去变量值）：\n' "$name" >&2
  local out; out="$(cat "$TMPDIR_WORK/zb.out")"
  printf '%s\n' "${out//"$value"/***}" | head -8 >&2
  info "常见原因：zeabur 未登录（先 zeabur auth login）、没有该服务的权限。" >&2
  return 1
}
FAILED=0
zeabur_set OBJECT_STORAGE_ENDPOINT "$ST_ENDPOINT" || FAILED=1
zeabur_set OBJECT_STORAGE_BUCKET "$ST_BUCKET" || FAILED=1
zeabur_set OBJECT_STORAGE_ACCESS_KEY_ID "$ST_KEY_ID" || FAILED=1
zeabur_set OBJECT_STORAGE_SECRET_ACCESS_KEY "$ST_SECRET" || FAILED=1
zeabur_set OBJECT_STORAGE_REGION "$ST_REGION" || FAILED=1
[ "$FAILED" = 0 ] || die "有变量没写成功（见上）。修好后重新运行 silkmomo-r2 即可（已写入的会被更新，不会重复）。"

# ───── 第 5 步：重新部署与迁移 ─────
say "第 5 步：重新部署"
cat <<EOF
  变量写好了，但已运行的服务要重新部署才会读到。
  重要顺序：本次发布包含数据库迁移 20261008200000（新增两列，对已有数据零影响），
            容器启动时会自动执行；这也是新代码需要的，所以『部署新代码』这一步必须做。
  提醒：启用 R2 之后『不要随便关』——新生成的脸图只在 R2 里，删掉这 5 个变量会让这些脸读不出来
        （接口返回 503，不会崩；补回变量即恢复）。要关必须先用迁移脚本 --to-db 把图回迁到数据库。
EOF
read -r -p "  现在就重新部署吗？[y/N] " ANSWER
if [[ "$ANSWER" =~ ^[Yy]$ ]]; then
  if zeabur service redeploy --id "$ZEABUR_SERVICE_ID" --env-id "$ZEABUR_ENV_ID" -y -i=false 2>&1 | tail -5; then
    ok "已发起重新部署，去 Zeabur 后台看构建日志"
  fi
else
  info "已跳过。准备好后可手动执行："
  info "    zeabur service redeploy --id ${ZEABUR_SERVICE_ID} --env-id ${ZEABUR_ENV_ID} -y"
fi

say "可选：把线上已有的脸图也搬进 R2（默认不跑）"
cat <<EOF
  新生成的脸会直接进 R2；老的脸还在数据库里，照常可用。想把老图也搬走（给数据库瘦身），
  等新版本部署成功、迁移已应用后，在本机仓库 ${REPO_DIR} 里：
    1) 先 dry-run（只统计，不改任何数据）：
         DATABASE_URL='<Zeabur 里 PostgreSQL 的外网连接串>' \\
         OBJECT_STORAGE_ENDPOINT='${ST_ENDPOINT}' OBJECT_STORAGE_BUCKET='${ST_BUCKET}' \\
         OBJECT_STORAGE_ACCESS_KEY_ID='<上面的 Access Key ID>' OBJECT_STORAGE_SECRET_ACCESS_KEY='<上面的 Secret>' \\
         node scripts/model-face-storage-migrate.mjs --to-r2
    2) 数字没问题再加 --apply 真正执行（可随时中断、重跑；每行上传后回读校验才清库）
  需要 Node 22.18 以上。反向回迁用 --to-db。
EOF
read -r -p "  要把这 5 个变量存成本机文件 ~/.silkmomo-r2.env（仅自己可读），方便以后跑迁移脚本吗？[y/N] " SAVE
if [[ "$SAVE" =~ ^[Yy]$ ]]; then
  ENVFILE="$HOME/.silkmomo-r2.env"
  ( umask 077
    {
      printf 'OBJECT_STORAGE_ENDPOINT=%s\n' "$ST_ENDPOINT"
      printf 'OBJECT_STORAGE_BUCKET=%s\n' "$ST_BUCKET"
      printf 'OBJECT_STORAGE_ACCESS_KEY_ID=%s\n' "$ST_KEY_ID"
      printf 'OBJECT_STORAGE_SECRET_ACCESS_KEY=%s\n' "$ST_SECRET"
      printf 'OBJECT_STORAGE_REGION=%s\n' "$ST_REGION"
    } > "$ENVFILE" )
  chmod 600 "$ENVFILE"
  ok "已写入 $ENVFILE。以后跑迁移：DATABASE_URL='...' node --env-file=$ENVFILE scripts/model-face-storage-migrate.mjs --to-r2"
fi
say "全部完成。"
