#!/usr/bin/env bash
# 短影片（recut）後端主機設定與自我檢查。在 VM 上以執行後端的帳號（PM2 那個帳號）執行，不需要 sudo。
#
# 做的事（可重複執行，已完成的步驟會略過）：
#   1. 檢查 Node.js、ffmpeg／ffprobe、python3
#   2. 在 ~/recut-runtime 建語音辨識用的 Python 虛擬環境（faster-whisper，PyAV 限制在 19 版以前）
#   3. 下載 faster-whisper small 模型（只有第一次需要連 Hugging Face；之後後端以離線模式讀取）
#   4. 依後端 .env 的 UPLOAD_DIR 與模型設定，產生 recut runtime JSON
#   5. 用模型實際辨識一段測試音，確認語音辨識能跑
#   6. 選項：--apply-env 把 RECUT_RUNTIME_CONFIG_PATH 與 SHORT_SCRIPT_AUTOMATION_ENABLED=true 寫進 backend/.env（先備份）
#           --restart   重啟 PM2 的 focusflow-backend 並讀 /health 的 runtime.recut
#           --probe-gemini 執行 npm run diagnose:gemini -- --probe（送一次約 10 個 token 的生成請求）
#
# 不會印出、讀取或寫入任何金鑰；.env 只追加上述兩行（已存在就不動）。
#
# 用法：
#   bash tools/recut/setup-vm.sh                       # 只準備與檢查，不改 .env、不重啟
#   bash tools/recut/setup-vm.sh --apply-env --restart --probe-gemini
#
# 可用環境變數覆寫：FOCUSFLOW_ROOT（預設 /opt/focusflow）、RECUT_HOME（預設 ~/recut-runtime）、
# RECUT_ASR_MODEL_REPO（預設 Systran/faster-whisper-small）、BACKEND_PORT（預設讀 .env 的 PORT，否則 4000）、PM2_APP（預設 focusflow-backend）。

set -euo pipefail

FOCUSFLOW_ROOT="${FOCUSFLOW_ROOT:-/opt/focusflow}"
RECUT_HOME="${RECUT_HOME:-$HOME/recut-runtime}"
MODEL_REPO="${RECUT_ASR_MODEL_REPO:-Systran/faster-whisper-small}"
PM2_APP="${PM2_APP:-focusflow-backend}"
BACKEND_DIR="$FOCUSFLOW_ROOT/backend"
ENV_FILE="$BACKEND_DIR/.env"
VENV="$RECUT_HOME/asr-venv"
MODEL_DIR="$RECUT_HOME/models/$(basename "$MODEL_REPO")"
WORKSPACE="$RECUT_HOME/workspaces"
RUNTIME_JSON="$RECUT_HOME/recut-runtime.json"
TRANSCRIBER="$FOCUSFLOW_ROOT/short_render/src/align/transcribe_words.py"

APPLY_ENV=0; RESTART=0; PROBE_GEMINI=0
for arg in "$@"; do
  case "$arg" in
    --apply-env) APPLY_ENV=1 ;;
    --restart) RESTART=1 ;;
    --probe-gemini) PROBE_GEMINI=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "未知選項：$arg（用 --help 看說明）" >&2; exit 2 ;;
  esac
done

ok() { printf '  [OK]  %s\n' "$1"; }
warn() { printf '  [注意] %s\n' "$1"; }
fail() { printf '  [失敗] %s\n' "$1" >&2; exit 1; }
step() { printf '\n== %s\n' "$1"; }

# 讀 .env 的單一設定值（不讀金鑰類設定，只讀這裡需要的名稱）。
env_value() {
  local name="$1"
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${name}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

step "1. 檢查基本工具"
[ -d "$BACKEND_DIR" ] || fail "找不到 $BACKEND_DIR（用 FOCUSFLOW_ROOT 指定專案位置）"
[ -f "$TRANSCRIBER" ] || fail "找不到 $TRANSCRIBER（專案版本太舊？先部署最新的 main）"
command -v node >/dev/null || fail "沒有 node"
ok "node $(node -v)"
FFMPEG="$(command -v ffmpeg || true)"; FFPROBE="$(command -v ffprobe || true)"
[ -n "$FFMPEG" ] && [ -n "$FFPROBE" ] || fail "沒有 ffmpeg 或 ffprobe（請系統管理員安裝）"
FFMPEG="$(readlink -f "$FFMPEG")"; FFPROBE="$(readlink -f "$FFPROBE")"
ok "ffmpeg $FFMPEG"
command -v python3 >/dev/null || fail "沒有 python3"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || fail "python3 需要 3.9 以上（目前 $(python3 -V)）"
python3 -c 'import venv' 2>/dev/null || fail "python3 沒有 venv 模組（RHEL 系請安裝 python3-venv 或對應套件）"
ok "$(python3 -V)"
if [ -d "$FOCUSFLOW_ROOT/short_render/node_modules/@iconify-json/fluent-emoji-flat" ]; then ok "short_render 施工單模組套件已安裝"
else warn "short_render 套件尚未安裝；部署流程會安裝，或手動在 $FOCUSFLOW_ROOT/short_render 執行 npm ci --omit=dev --ignore-scripts"; fi

step "2. 語音辨識 Python 環境（$VENV）"
mkdir -p "$RECUT_HOME" "$WORKSPACE" "$(dirname "$MODEL_DIR")"
if [ ! -x "$VENV/bin/python" ]; then python3 -m venv "$VENV"; ok "建立虛擬環境"; else ok "虛擬環境已存在"; fi
"$VENV/bin/python" -m pip install --quiet --upgrade pip >/dev/null
# 與 STT_Whisper/requirements.txt 一致：faster-whisper 1.2.x 搭配 PyAV 19 會開檔失敗。
"$VENV/bin/python" -m pip install --quiet "faster-whisper>=1.1.0" "av>=11,<19" "huggingface_hub"
ok "faster-whisper $("$VENV/bin/python" -c 'import faster_whisper; print(faster_whisper.__version__)')、PyAV $("$VENV/bin/python" -c 'import av; print(av.__version__)')"

step "3. 語音辨識模型（$MODEL_DIR）"
if [ -f "$MODEL_DIR/model.bin" ]; then ok "模型已存在"
else
  "$VENV/bin/python" - "$MODEL_REPO" "$MODEL_DIR" <<'PY'
import sys
from huggingface_hub import snapshot_download
snapshot_download(sys.argv[1], local_dir=sys.argv[2])
PY
  [ -f "$MODEL_DIR/model.bin" ] || fail "模型下載失敗（主機能連到 huggingface.co 嗎？也可以在別台下載後複製到 $MODEL_DIR）"
  ok "模型下載完成"
fi

step "4. recut runtime JSON（$RUNTIME_JSON）"
UPLOAD_DIR_VALUE="$(env_value UPLOAD_DIR)"; UPLOAD_DIR_VALUE="${UPLOAD_DIR_VALUE:-uploads}"
case "$UPLOAD_DIR_VALUE" in /*) UPLOAD_ROOT="$UPLOAD_DIR_VALUE" ;; *) UPLOAD_ROOT="$BACKEND_DIR/$UPLOAD_DIR_VALUE" ;; esac
UPLOAD_ROOT="$(readlink -f "$UPLOAD_ROOT" || echo "$UPLOAD_ROOT")"
[ -d "$UPLOAD_ROOT" ] || fail "原片目錄 $UPLOAD_ROOT 不存在（核對 .env 的 UPLOAD_DIR）"
MODEL_ID="$(env_value RECUT_GEMINI_MODEL)"; MODEL_ID="${MODEL_ID:-$(env_value GEMINI_CHAT_MODEL)}"; MODEL_ID="${MODEL_ID:-gemini-3.5-flash}"
node - "$RUNTIME_JSON" "$WORKSPACE" "$UPLOAD_ROOT" "$FFMPEG" "$FFPROBE" "$VENV/bin/python" "$TRANSCRIBER" "$MODEL_DIR" "$MODEL_ID" <<'NODE'
const fs = require('node:fs');
const [file, workspaceRoot, allowedRoot, ffmpeg, ffprobe, python, transcriber, asrModel, model] = process.argv.slice(2);
const config = { schemaVersion: 1, modelCallsEnabled: true, geminiApiKeyEnv: 'GEMINI_API_KEY', allowedGeminiModels: [model],
  maxOutputTokens: 8192, thinkingLevel: /^gemini-[34](?:\.|-)/.test(model) ? 'LOW' : undefined, codeCardsEnabled: false, workspaceRoot,
  media: { allowedRoot, ffmpeg, ffprobe, python, transcriber, asrModel } };
if (!config.thinkingLevel) delete config.thinkingLevel;
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o640 });
NODE
ok "允許的模型：$MODEL_ID；原片目錄：$UPLOAD_ROOT"

step "5. 實際跑一次語音辨識（離線模式）"
TEST_DIR="$(mktemp -d "$WORKSPACE/selftest-XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
"$FFMPEG" -v error -y -f lavfi -i "sine=frequency=440:duration=3" -ac 1 -ar 16000 "$TEST_DIR/tone.wav"
env -i PATH="$PATH" PYTHONUTF8=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  "$VENV/bin/python" -I "$TRANSCRIBER" "$TEST_DIR/tone.wav" "$TEST_DIR/words.json" "$MODEL_DIR" >/dev/null 2>"$TEST_DIR/err.txt" \
  || { tail -n 5 "$TEST_DIR/err.txt" >&2; fail "語音辨識程式執行失敗（上面是錯誤的最後幾行）"; }
[ -f "$TEST_DIR/words.json" ] || fail "語音辨識沒有輸出結果"
ok "語音辨識可以執行（測試音沒有人聲，辨識結果為空是正常的）"

step "6. 後端設定（$ENV_FILE）"
append_env() {
  local name="$1" value="$2"
  if grep -qE "^${name}=" "$ENV_FILE"; then
    if [ "$(env_value "$name")" = "$value" ]; then ok "$name 已設定"; else warn "$name 已有不同的值，未修改；請手動改成 $value"; fi
  else printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"; ok "已加入 $name"; fi
}
if [ "$APPLY_ENV" = 1 ]; then
  [ -f "$ENV_FILE" ] || fail "找不到 $ENV_FILE"
  cp -p "$ENV_FILE" "$ENV_FILE.bak-recut-$(date +%Y%m%d%H%M%S)"
  ok "已備份 .env"
  append_env RECUT_RUNTIME_CONFIG_PATH "$RUNTIME_JSON"
  append_env SHORT_SCRIPT_AUTOMATION_ENABLED true
else
  echo "  未加 --apply-env：請在 .env 確認有這兩行"
  echo "    RECUT_RUNTIME_CONFIG_PATH=$RUNTIME_JSON"
  echo "    SHORT_SCRIPT_AUTOMATION_ENABLED=true"
fi
# 只檢查是否存在，不讀值。
for name in GEMINI_API_KEY YOUTUBE_API_KEY YOUTUBE_CLIENT_ID YOUTUBE_CLIENT_SECRET YOUTUBE_REFRESH_TOKEN; do
  if [ -f "$ENV_FILE" ] && grep -qE "^${name}=.+" "$ENV_FILE"; then ok "$name 已設定"; else warn "$name 沒有設定（見 docs/10_Operations/deployment/短影片上線步驟.md）"; fi
done
[ "$(env_value YOUTUBE_UPLOAD_ENABLED)" = "true" ] && ok "YOUTUBE_UPLOAD_ENABLED=true" || warn "YOUTUBE_UPLOAD_ENABLED 不是 true：成品不會上傳 YouTube，教師無法核准"

if [ "$RESTART" = 1 ]; then
  step "7. 重啟後端並讀 /health"
  command -v pm2 >/dev/null || fail "沒有 pm2"
  pm2 restart "$PM2_APP" --update-env >/dev/null
  PORT="${BACKEND_PORT:-$(env_value PORT)}"; PORT="${PORT:-4000}"
  for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" -o "$TEST_DIR/health.json" 2>/dev/null && break; sleep 2; done
  [ -s "$TEST_DIR/health.json" ] || fail "讀不到 http://127.0.0.1:$PORT/health（pm2 logs $PM2_APP 看啟動錯誤）"
  if node - "$TEST_DIR/health.json" <<'NODE'
const runtime = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8')).data.runtime;
const show = (label, value) => console.log(`  ${label}：${JSON.stringify(value)}`);
show('recut', runtime.recut);
show('shortsSync.enabled', runtime.shortsSync?.enabled);
show('youtubeUpload.uploadEnabled', runtime.youtubeUpload?.uploadEnabled);
if (!runtime.recut?.ready) { console.log('  [注意] recut 尚未就緒：依 hostStatus／missing 對照上線步驟文件的「部署後驗證」。'); process.exitCode = 1; }
else console.log('  [OK]  recut 已就緒');
NODE
  then :; else warn "recut 尚未就緒"; fi
fi

if [ "$PROBE_GEMINI" = 1 ]; then
  step "8. Gemini 診斷"
  (cd "$BACKEND_DIR" && npm run --silent diagnose:gemini -- --probe) || warn "Gemini 生成請求失敗，處理方式見上方說明"
fi

printf '\n完成。渲染 worker 另外用 tools/recut/setup-worker.sh 設定。\n'
