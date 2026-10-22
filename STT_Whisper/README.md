# FocusFlow 影片處理安裝與使用

這份文件說明影片處理程序的安裝、執行與中斷續跑方式，方便把教材轉成可搜尋資料。STT 是把語音轉成文字；請先設定環境與資料庫目標，功能進度及驗收結果只看[目前狀態](../docs/current-status.md)。

## 安裝與設定

使用 Python 3.10 以上，依 [requirements.txt](requirements.txt) 安裝套件；本輪未實際安裝驗證完整依賴相容性。FFmpeg 是抽取音軌的工具，可放在 PATH 或設定 `FFMPEG_BINARY`；[工具程式](src/utils.py)也提供 imageio-ffmpeg 套件內附執行檔的替代方式。

從 repo 根目錄執行，將虛擬環境（這個專案專用的 Python 與套件）建在本目錄：

```powershell
cd STT_Whisper
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

編輯 [.env.example](.env.example) 對應的本機 `.env`：`WHISPER_MODEL_SIZE/DEVICE/COMPUTE_TYPE` 控制語音模型；`ENABLE_GEMINI_EMBEDDING` 與 `GEMINI_API_KEY` 控制搜尋向量產生；向量是一串用來比較內容相似度的數字。`MONGODB_URI/MONGODB_DATABASE_NAME` 指定寫入目標，`BACKEND_URL/PROCESSING_WEBHOOK_SECRET` 必須與後端回報設定一致。

[主流程](src/main.py)會執行模型、資料庫上傳與後端回報；它不是離線測試。使用前先確認資料庫與模型費用，已存在的 `.env` 不要覆蓋。

## 執行與續跑

以下在 `STT_Whisper/` 執行；以實際檔案及識別碼取代範例值。

| 用途 | 指令（前綴一律為 `.\.venv\Scripts\python.exe`） |
|---|---|
| 指定本機影片 | `src/main.py --video-path "Test_video_file/lesson.mp4"` |
| 對應後端影片 | `src/main.py --video-path "影片路徑" --video-id "影片識別碼"`；識別碼需對應目標資料庫影片。 |
| YouTube 輸入 | `src/main.py --youtube-url "YouTube網址" --video-id "影片識別碼"`；由 yt-dlp 下載音訊。 |
| 接續單次處理 | `src/main.py --resume-run-id "run_id"` |
| 建立多影片批次 | `src/batch_main.py --batch-input Test_video_file` |
| 接續既有批次 | `src/batch_main.py --batch-resume "batch_id"` |
| 重試批次指定影片 | `src/batch_main.py --batch-resume "batch_id" --batch-retry-video-id "影片識別碼"` |

Resume 是接續既有工作，checkpoint 是判斷能否沿用成果的檢查資料；[續跑程式](src/resume_checkpoint.py)從第一個無法沿用的步驟重做後續流程。`--resume-run-id` 不可與 `--overwrite` 或 `--run-id` 同用。批次自動重試由 `BATCH_ITEM_MAX_RETRIES` 設定，預設為 `0`；批次同時處理數由 `BATCH_MAX_CONCURRENCY` 設定，預設為 `1`，詳見[批次入口](src/batch_main.py)與[批次管理](src/batch_manager.py)。

例：`lesson.mp4` → 抽音軌、逐字稿、切段、向量、資料上傳 → 於 `data/outputs/runs/<run_id>/` 查看 `manifest.json` 與 `run_summary.json`；中斷時用同一 `run_id` 續跑。批次紀錄在 `data/outputs/batches/<batch_id>/`，後端啟動的處理日誌在 `data/pipeline_<videoId>.log`。

## 進階操作入口

[影像處理](src/video_multimodal_pipeline.py)使用 `--video-path` 與 `--video-id` 綁定課程影片，加入 `--upload` 才寫入影像資料；須設定 `ENABLE_GEMINI_VIDEO_EMBEDDING=true`。較大段落的產生、向量與發布分別見[段落建立](src/build_parent_chunk_artifact.py)、[向量產生](src/embed_parent_chunk_artifact.py)、[發布工具](src/publish_parent_embeddings.py)；各工具參數可用 `--help` 查閱，發布工具預設為不連資料庫的事前檢查。
