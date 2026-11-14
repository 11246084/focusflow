#!/usr/bin/env bash
# 短影片渲染 worker 設定與啟動（Linux）。可以在 VM 本機（加 --vm）或另一台機器執行，不需要 sudo。
#
# 做的事（可重複執行，已完成的步驟會略過）：
#   1. 檢查 Node.js 22、ffmpeg／ffprobe、專案的 short_render，並安裝 short_render 的完整套件（含渲染用的 HyperFrames）
#   2. 下載 chrome-headless-shell（或用 BROWSER_PATH 指定已安裝的）
#   3. 下載 Noto Sans TC 可變字型（或用 FONT_FILE 指定）
#   4. 取得 worker 金鑰：以管理員帳號登入後台 API 建立（密碼只在終端機輸入、不顯示、不寫檔），
#      金鑰存在 ~/recut-worker/worker.env（權限 600）；已存在就沿用
#   5. 產生 worker 設定檔，先用 --once 試領一次工作確認連得上
#   6. 以 PM2 常駐（名稱 focusflow-recut-worker）
#
# 用法：
#   bash tools/recut/setup-worker.sh --vm                               # 在 VM 本機，後端 http://127.0.0.1:4000
#   BACKEND_URL=https://focusflow.ntub.edu.tw bash tools/recut/setup-worker.sh   # 另一台機器（非本機必須 HTTPS）
#
# 可用環境變數覆寫：FOCUSFLOW_ROOT（預設 /opt/focusflow）、WORKER_HOME（預設 ~/recut-worker）、BACKEND_URL、
# BROWSER_PATH、FONT_FILE、WORKER_NAME（預設主機名稱）、PM2_WORKER（預設 focusflow-recut-worker）、ADMIN_EMAIL。

set -euo pipefail

FOCUSFLOW_ROOT="${FOCUSFLOW_ROOT:-/opt/focusflow}"
WORKER_HOME="${WORKER_HOME:-$HOME/recut-worker}"
PM2_WORKER="${PM2_WORKER:-focusflow-recut-worker}"
WORKER_NAME="${WORKER_NAME:-$(hostname)}"
SHORT_RENDER="$FOCUSFLOW_ROOT/short_render"
KEY_FILE="$WORKER_HOME/worker.env"
CONFIG_FILE="$WORKER_HOME/recut-worker.cjs"
FONT_URL='https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf'

ON_VM=0
for arg in "$@"; do
  case "$arg" in
    --vm) ON_VM=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知選項：$arg（用 --help 看說明）" >&2; exit 2 ;;
  esac
done
BACKEND_URL="${BACKEND_URL:-$([ "$ON_VM" = 1 ] && echo 'http://127.0.0.1:4000' || echo '')}"

ok() { printf '  [OK]  %s\n' "$1"; }
warn() { printf '  [注意] %s\n' "$1"; }
fail() { printf '  [失敗] %s\n' "$1" >&2; exit 1; }
step() { printf '\n== %s\n' "$1"; }

[ -n "$BACKEND_URL" ] || fail "請設定 BACKEND_URL（另一台機器）或加 --vm（VM 本機）"
case "$BACKEND_URL" in http://127.0.0.1*|http://localhost*|https://*) ;; *) fail "BACKEND_URL 非本機時必須是 https://" ;; esac

step "1. 基本工具與 short_render 套件"
[ -d "$SHORT_RENDER" ] || fail "找不到 $SHORT_RENDER（用 FOCUSFLOW_ROOT 指定專案位置）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" = 22 ] || [ "$NODE_MAJOR" = 24 ] || fail "需要 Node.js 22（或 24），目前 $(node -v 2>/dev/null || echo 沒有)"
ok "node $(node -v)"
FFMPEG="$(command -v ffmpeg || true)"; FFPROBE="$(command -v ffprobe || true)"
[ -n "$FFMPEG" ] && [ -n "$FFPROBE" ] || fail "沒有 ffmpeg 或 ffprobe"
FFMPEG="$(readlink -f "$FFMPEG")"; FFPROBE="$(readlink -f "$FFPROBE")"
ok "ffmpeg $FFMPEG"
mkdir -p "$WORKER_HOME/jobs" "$WORKER_HOME/fonts" "$WORKER_HOME/browsers"
chmod 700 "$WORKER_HOME"
(cd "$SHORT_RENDER" && npm ci --no-audit --no-fund >/dev/null)
ok "short_render 套件已安裝"

step "2. chrome-headless-shell"
if [ -n "${BROWSER_PATH:-}" ]; then BROWSER="$BROWSER_PATH"
else
  BROWSER="$(find "$WORKER_HOME/browsers" -type f -name chrome-headless-shell -perm -u+x 2>/dev/null | head -n 1)"
  if [ -z "$BROWSER" ]; then
    (cd "$WORKER_HOME/browsers" && npx --yes @puppeteer/browsers@2.10.5 install chrome-headless-shell@stable --path "$WORKER_HOME/browsers" >/dev/null)
    BROWSER="$(find "$WORKER_HOME/browsers" -type f -name chrome-headless-shell -perm -u+x | head -n 1)"
  fi
fi
[ -x "${BROWSER:-}" ] || fail "找不到可執行的 chrome-headless-shell（可用 BROWSER_PATH 指定）"
"$BROWSER" --version >/dev/null 2>&1 || fail "chrome-headless-shell 無法啟動（Linux 可能缺系統套件，見 $(dirname "$BROWSER")/deb.deps）"
ok "$BROWSER"

step "3. Noto Sans TC 字型"
FONT="${FONT_FILE:-$WORKER_HOME/fonts/NotoSansTC-VF.ttf}"
if [ ! -s "$FONT" ]; then curl -fsSL -o "$FONT" "$FONT_URL" || fail "字型下載失敗（可用 FONT_FILE 指定已有的 NotoSansTC 可變字型 .ttf）"; fi
head -c 4 "$FONT" | od -An -tx1 | grep -q '00 01 00 00' || fail "$FONT 不是 TrueType 字型"
ok "$FONT"

trap 'rm -f "$KEY_FILE.tmp"' EXIT
step "4. worker 金鑰"
if [ -s "$KEY_FILE" ] && grep -q '^RECUT_WORKER_KEY=rw_' "$KEY_FILE"; then ok "沿用 $KEY_FILE"
else
  ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  [ -n "$ADMIN_EMAIL" ] || read -r -p "  管理員 Email：" ADMIN_EMAIL
  read -r -s -p "  管理員密碼（不會顯示）：" ADMIN_PASSWORD; echo
  umask 077
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" BACKEND_URL="$BACKEND_URL" WORKER_NAME="$WORKER_NAME" node > "$KEY_FILE.tmp" <<'NODE'
(async () => {
  const base = `${process.env.BACKEND_URL.replace(/\/$/, '')}/api/v1`;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'admin' }) });
  const session = await login.json().catch(() => ({}));
  if (!login.ok || !session?.data?.token) { console.error(`  [失敗] 管理員登入失敗（HTTP ${login.status} ${session?.error?.code || ''}）`); process.exit(1); }
  const made = await fetch(`${base}/admin/recut-workers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.data.token}` },
    body: JSON.stringify({ name: process.env.WORKER_NAME }) });
  const worker = await made.json().catch(() => ({}));
  if (!made.ok || !/^rw_/.test(worker?.data?.key || '')) { console.error(`  [失敗] 建立 worker 金鑰失敗（HTTP ${made.status} ${worker?.error?.code || ''}）`); process.exit(1); }
  console.log(`RECUT_WORKER_KEY=${worker.data.key}`);
})().catch(() => { console.error('  [失敗] 連不到後端'); process.exit(1); });
NODE
  unset ADMIN_PASSWORD
  mv "$KEY_FILE.tmp" "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  ok "已建立金鑰並存到 $KEY_FILE（後台只會顯示這一次）"
fi

step "5. worker 設定與連線測試"
node - "$CONFIG_FILE" "$BACKEND_URL" "$WORKER_HOME/jobs" "$BROWSER" "$FONT" "$FFMPEG" "$FFPROBE" "$ON_VM" <<'NODE'
const fs = require('node:fs');
const [file, backendUrl, workRoot, browserExecutable, fontFile, ffmpeg, ffprobe, onVm] = process.argv.slice(2);
const vm = onVm === '1';
fs.writeFileSync(file, `// 由 tools/recut/setup-worker.sh 產生；金鑰不在這裡，由環境變數 RECUT_WORKER_KEY 提供。
module.exports = {
  backendUrl: ${JSON.stringify(backendUrl)},
  getWorkerKey: async () => process.env.RECUT_WORKER_KEY,
  workRoot: ${JSON.stringify(workRoot)},
  browserExecutable: ${JSON.stringify(browserExecutable)},
  fontFile: ${JSON.stringify(fontFile)},
  ffmpeg: ${JSON.stringify(ffmpeg)}, ffprobe: ${JSON.stringify(ffprobe)},
  hostKind: ${JSON.stringify(vm ? 'vm' : 'desktop')},${vm ? '\n  enableVmRender: true,' : ''}
};
`, { mode: 0o600 });
NODE
ok "$CONFIG_FILE"
set -a; . "$KEY_FILE"; set +a
ONCE="$(cd "$SHORT_RENDER" && timeout 1800 node bin/recut-worker.js --config "$CONFIG_FILE" --once 2>&1 | tail -n 1)"
case "$ONCE" in
  *'"status":"idle"'*) ok "連線正常，目前沒有等待渲染的工作" ;;
  *'"status":"succeeded"'*) ok "連線正常，已完成一支等待中的渲染：$ONCE" ;;
  *) fail "worker 測試失敗：$ONCE" ;;
esac

step "6. 以 PM2 常駐"
command -v pm2 >/dev/null || fail "沒有 pm2（npm install -g pm2）"
pm2 delete "$PM2_WORKER" >/dev/null 2>&1 || true
(cd "$SHORT_RENDER" && pm2 start bin/recut-worker.js --name "$PM2_WORKER" --time -- --config "$CONFIG_FILE" >/dev/null)
pm2 save >/dev/null
unset RECUT_WORKER_KEY
ok "已啟動 $PM2_WORKER；用 pm2 logs $PM2_WORKER 看狀態（每 10 秒輪詢一次）"
