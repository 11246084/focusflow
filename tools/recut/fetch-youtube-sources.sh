#!/usr/bin/env bash
# 過渡工具（2026-11-19）：VM 上沒有原片的課程影片，用 yt-dlp 從 YouTube 取回，讓 recut 能剪原音。
# 在 VM 上以平常登入的帳號執行；讀不到 backend/.env 時會自動改用 sudo 執行 node（可能要輸入密碼）。
#
# 做的事（可重複執行，原片已在的影片會略過）：
#   1. 沒有 yt-dlp 就下載到 ~/.local/bin（不需要 root）
#   2. 檢查 node、ffmpeg、ffprobe
#   3. 列出兩門課（AI入門基礎課、影片處理工具 - OpenCV）缺原片的影片
#   4. 加 --write 才下載、比對長度並更新 Atlas 的 Video.filePath；不重跑語音辨識
#   每次的結果存到 ~/recut-runtime/logs/fetch-youtube-sources-<時間>.json（含更新前的 filePath）
#
# 用法：
#   bash tools/recut/fetch-youtube-sources.sh                    # 只列出，不下載、不寫入
#   bash tools/recut/fetch-youtube-sources.sh --write            # 下載並更新
#   bash tools/recut/fetch-youtube-sources.sh --write --course-title "AI入門基礎課"   # 只處理指定課程
#   bash tools/recut/fetch-youtube-sources.sh --write --cookies ~/youtube-cookies.txt  # YouTube 要求登入確認時
#
# 可用環境變數覆寫：FOCUSFLOW_ROOT（預設 /opt/focusflow）、RECUT_HOME（預設 ~/recut-runtime）、
# YTDLP_EXTRA_ARGS（預設 --js-runtimes node）。

set -euo pipefail

FOCUSFLOW_ROOT="${FOCUSFLOW_ROOT:-/opt/focusflow}"
RECUT_HOME="${RECUT_HOME:-$HOME/recut-runtime}"
BACKEND_DIR="$FOCUSFLOW_ROOT/backend"
LOG_DIR="$RECUT_HOME/logs"
YTDLP="$HOME/.local/bin/yt-dlp"
export YTDLP_EXTRA_ARGS="${YTDLP_EXTRA_ARGS:---js-runtimes node}"

WRITE=0; COOKIES=""; TITLES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --write) WRITE=1 ;;
    --cookies) COOKIES="$2"; shift ;;
    --course-title) TITLES+=("$2"); shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "不認得的參數：$1" >&2; exit 1 ;;
  esac
  shift
done
[ ${#TITLES[@]} -eq 0 ] && TITLES=("AI入門基礎課" "影片處理工具 - OpenCV")

step() { printf '\n== %s\n' "$1"; }

step "1. yt-dlp"
if command -v yt-dlp >/dev/null 2>&1; then
  YTDLP="$(command -v yt-dlp)"
elif [ ! -x "$YTDLP" ]; then
  mkdir -p "$(dirname "$YTDLP")"
  curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "$YTDLP"
  chmod a+rx "$YTDLP"
fi
echo "使用 $YTDLP（版本 $("$YTDLP" --version)）"

step "2. 檢查工具"
for tool in node ffmpeg ffprobe; do
  command -v "$tool" >/dev/null 2>&1 || { echo "找不到 $tool，請先安裝（可參考 tools/recut/setup-vm.sh）" >&2; exit 1; }
done
echo "node $(node -v)、ffmpeg、ffprobe 都在"

ARGS=()
for title in "${TITLES[@]}"; do ARGS+=(--course-title "$title"); done
ARGS+=(--yt-dlp "$YTDLP")
[ -n "$COOKIES" ] && ARGS+=(--cookies "$COOKIES")
[ "$WRITE" -eq 1 ] && ARGS+=(--write)

RUN=(node src/scripts/recutFetchYoutubeSources.js "${ARGS[@]}")
if [ ! -r "$BACKEND_DIR/.env" ]; then
  echo "目前帳號讀不到 backend/.env，改用 sudo 執行"
  RUN=(sudo env "PATH=$PATH" "YTDLP_EXTRA_ARGS=$YTDLP_EXTRA_ARGS" "${RUN[@]}")
fi

if [ "$WRITE" -eq 1 ]; then step "3. 下載並更新（會寫入 Atlas）"; else step "3. 只列出要處理的影片"; fi
mkdir -p "$LOG_DIR"
REPORT="$LOG_DIR/fetch-youtube-sources-$(date +%Y%m%d-%H%M%S).json"
cd "$BACKEND_DIR"
"${RUN[@]}" > "$REPORT"

node -e '
const r = require(process.argv[1]);
const count = {};
for (const i of r.items) { const k = i.result.split(":")[0]; count[k] = (count[k] || 0) + 1; }
for (const i of r.items) if (i.result !== "source present") console.log(`  ${i.title} (${i.youtubeVideoId || "-"})：${i.result}`);
console.log("\n統計：" + Object.entries(count).map(([k, v]) => `${k} ${v}`).join("、"));
' "$REPORT"
echo "完整結果：$REPORT"

if [ "$WRITE" -eq 0 ]; then
  echo
  echo "以上只是列出。確認後加 --write 執行：bash tools/recut/fetch-youtube-sources.sh --write"
else
  echo
  echo "完成後回短影片製作，對失敗的那支按「重新產生」。"
  echo "另外請確認 YOUTUBE_UPLOAD_CLEANUP_ENABLED 是關閉的，否則取回的原片之後可能又被清理。"
fi
