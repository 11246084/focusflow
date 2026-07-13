# FocusFlow AI Pipeline MVP

這個專案是 FocusFlow 的本地 AI pipeline，角色是 AI Data Producer。它會把教學影片轉成可搜尋的 transcript、chunks、Gemini embeddings，並可在 pipeline 成功後自動上傳到 MongoDB，供 backend QA 與 LINE Bot 使用。

目前主流程分成兩種輸入模式：

1. 本機影片模式：讀取 `backend/uploads/` 或 `Test_video_file/` 的影片檔。
2. YouTube URL 模式：由 backend 傳入 `--youtube-url`，pipeline 用 `yt-dlp` 下載音訊後處理。

後段流程一致：

影片  
→ 掃描影片 metadata  
→ FFmpeg 抽音軌  
→ Whisper STT  
→ transcript normalization  
→ chunking  
→ Gemini Embedding 2 text embedding  
→ 匯出 JSON / JSONL  
→ 上傳 MongoDB  
→ 回報 backend processing 狀態

另外新增一條音訊 embedding 支線：

音軌檔案  
→ Gemini Embedding 2 audio embedding  
→ 匯出 audio embedding JSONL

另外也新增一條獨立的影片多模態 embedding 支線，這條支線不影響主線：

第一部影片  
→ 切成多個 120 秒或小於 120 秒的短片段  
→ 每段影片直接送入 Gemini 多模態 embedding 請求  
→ 匯出 `embeddings_video_gemini.jsonl`

## 專案結構

```text
STT_Whisper/
├─ Test_video_file/
├─ data/
│  ├─ cache/
│  │  └─ transcripts/
│  ├─ outputs/
│  │  ├─ videos.json
│  │  ├─ transcripts.json
│  │  ├─ transcripts_normalized.json
│  │  ├─ chunks.jsonl
│  │  ├─ embeddings_text_gemini.jsonl
│  │  ├─ embeddings_audio_gemini.jsonl
│  │  └─ embeddings_video_gemini.jsonl
│  ├─ processed_audio/
│  ├─ video_multimodal_chunks/
│  └─ term_dictionary.json
├─ src/
│  ├─ chunking.py
│  ├─ config.py
│  ├─ debug_gemini_embedding.py
│  ├─ embedding.py
│  ├─ export_outputs.py
│  ├─ extract_audio.py
│  ├─ main.py
│  ├─ normalize_transcript.py
│  ├─ scan_videos.py
│  ├─ transcribe.py
│  ├─ utils.py
│  ├─ validate_gemini_embedding.py
│  └─ video_multimodal_pipeline.py
├─ .env.example
├─ README.md
└─ requirements.txt
```

## 目前的 embedding 設計

目前最終 embedding 已改為 Gemini Embedding 2。

- 文字 chunk embedding：`gemini-embedding-2-preview`
- 音軌 audio embedding：`gemini-embedding-2-preview`
- 不再保留 `BAAI/bge-m3` 作為最終輸出向量
- 不再輸出 legacy embedding 或 dual embedding 作為正式成果

Whisper 仍然存在，但它只負責 STT / transcript / chunking，不再負責最終向量模型。

## 安裝需求

- Python 3.10+
- `pip install -r requirements.txt`
- FFmpeg 可選：
  - 可以安裝在系統 PATH
  - 也可以依賴 `imageio-ffmpeg` 內建 binary，本專案會自動 fallback
- YouTube URL 模式需要 `yt-dlp`（`requirements.txt` 已固定 `yt-dlp>=2026.3.17`）；pipeline 透過 `python -m yt_dlp` 呼叫，避免依賴 PATH 上的 `yt-dlp.exe`
- 系統 PATH 沒有 `ffmpeg` 時會自動 fallback 到 `imageio-ffmpeg` 內建 binary

### 建立虛擬環境

> 重要：`.venv` 必須建立在 `STT_Whisper/` 裡。backend 觸發 STT 時會優先尋找 `STT_Whisper/.venv/Scripts/python.exe`。

```powershell
cd STT_Whisper
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

檢查環境：

```powershell
python --version
python -m pip check
python -c "from faster_whisper import WhisperModel; print('whisper ok')"
python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
python -m yt_dlp --version
```

不要把 `.venv` 上傳到 GitHub；請用 `requirements.txt` 讓每台電腦自行重建。

### 安裝 FFmpeg

做法 A：自行安裝 FFmpeg

1. 到 [FFmpeg 官網](https://ffmpeg.org/download.html) 下載 Windows build
2. 把 `bin/` 加進系統 `PATH`
3. 重新開 PowerShell
4. 驗證：

```powershell
ffmpeg -version
```

做法 B：依賴 `imageio-ffmpeg`

本專案也支援用 Python 套件提供的 bundled FFmpeg。若系統 `PATH` 沒有 `ffmpeg`，程式會自動嘗試使用 `imageio-ffmpeg`。

如需指定固定路徑，可在 `.env` 設定：

```env
FFMPEG_BINARY=C:/tools/ffmpeg/bin/ffmpeg.exe
```

## 環境變數

先複製：

```powershell
Copy-Item .env.example .env
```

重要設定如下：

```env
VIDEO_INPUT_DIR=Test_video_file
FFMPEG_BINARY=

WHISPER_MODEL_SIZE=tiny
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_LANGUAGE=zh

ENABLE_GEMINI_EMBEDDING=true
ENABLE_GEMINI_VIDEO_EMBEDDING=false
GEMINI_API_KEY=your_gemini_api_key
GEMINI_EMBEDDING_MODEL_NAME=gemini-embedding-2-preview
GEMINI_EMBEDDING_OUTPUT_DIM=3072
GEMINI_EMBEDDING_BATCH_SIZE=8
GEMINI_MAX_RETRIES=3
GEMINI_RETRY_SLEEP_SEC=20
GEMINI_MAX_CHUNKS_PER_RUN=
CHUNKS_OUTPUT_PATH=data/outputs/chunks.jsonl
TEXT_EMBEDDINGS_OUTPUT_PATH=data/outputs/embeddings_text_gemini.jsonl
AUDIO_EMBEDDINGS_OUTPUT_PATH=data/outputs/embeddings_audio_gemini.jsonl

MONGODB_URI=your_mongodb_uri
MONGODB_DATABASE_NAME=focusflow
BACKEND_URL=http://localhost:4000
PROCESSING_WEBHOOK_SECRET=focusflow-dev-secret
```

`GEMINI_MAX_CHUNKS_PER_RUN` 可用來做測試模式，只讓本次執行處理前 N 個尚未完成的 text chunks。

## 如何執行 pipeline

### 從 backend 自動觸發（主要 demo 流程）

老師在前端上傳本機影片或貼 YouTube URL 後，backend 會自動 spawn：

```powershell
.\.venv\Scripts\python src/main.py --video-path <backend/uploads/xxx.mp4> --video-id <mongoId> --overwrite
```

或 YouTube URL 模式：

```powershell
.\.venv\Scripts\python src/main.py --youtube-url <youtubeUrl> --video-id <mongoId> --overwrite
```

pipeline 會：

1. 呼叫 backend internal webhook，將 processing 狀態改為 `processing`
2. 執行 STT / chunking / Gemini embedding
3. 上傳 MongoDB
4. 成功後回報 `completed`，失敗則回報 `failed`

log 會寫在：

```text
STT_Whisper/data/pipeline_<videoId>.log
```

### 完整執行

```powershell
python src/main.py
```

### 只跑第一支影片

```powershell
python src/main.py --limit 1
```

### 只讓 Gemini text embedding 跑前 20 個 pending chunks

```powershell
python src/main.py --limit 1 --gemini-max-chunks 20
```

### 強制重建中間產物

```powershell
python src/main.py --overwrite
```

### 手動測試指定本機影片

```powershell
python src/main.py --video-path ..\backend\uploads\<file>.mp4 --video-id <mongoId> --overwrite
```

### 手動測試 YouTube URL

```powershell
python src/main.py --youtube-url "https://youtu.be/<id>" --video-id <mongoId> --overwrite
```

YouTube 影片建議在 YouTube Studio 設為「不公開」，不要設為「私人」。私人影片通常無法被 iframe 或 `yt-dlp` 正常處理。

### 執行影片多模態 embedding 支線

這條支線不會動到主線，只會：

1. 掃描第一部影片
2. 切成 120 秒或小於 120 秒的短片段
3. 對每個片段直接送出 Gemini video embedding 請求
4. 將結果寫到 `embeddings_video_gemini.jsonl`

```powershell
python src/video_multimodal_pipeline.py
```

如需覆蓋既有片段：

```powershell
python src/video_multimodal_pipeline.py --overwrite
```

## transcript normalization

Whisper 對技術術語常有誤辨，例如：

- `CHATGVT` → `ChatGPT`
- `Open A I` → `OpenAI`
- `Mongo DB` → `MongoDB`

因此在 STT 後、chunking 前，會先執行 `normalize_transcript.py`。程式會保留：

- `original_text`
- `text`
- `corrections`

術語詞庫在：

`data/term_dictionary.json`

## 輸出檔案

正式輸出預設在：

`data/outputs`

backend 觸發單支影片時，為避免多人同時處理互相覆蓋，輸出會改到：

```text
data/outputs/runs/<videoId>/
```

### `videos.json`

每支影片的 metadata。

### `transcripts.json`

Whisper 原始 STT 結果，保留給 debug 與追溯使用。

### `transcripts_normalized.json`

術語校正後的 transcript，chunking 會使用這份資料。

### `chunks.jsonl`

所有搜尋用文字 chunks，每行一筆。

### `embeddings_text_gemini.jsonl`

Gemini text embedding 結果。每筆至少包含：

- `chunk_id`
- `video_id`
- `start_sec`
- `end_sec`
- `text`
- `embedding`
- `embedding_model`
- `embedding_modality`
- `embedding_dim`
- `embedding_timestamp`
- `embedding_status`

### `embeddings_audio_gemini.jsonl`

Gemini audio embedding 結果。每筆至少包含：

- `video_id`
- `audio_path`
- `embedding`
- `embedding_model`
- `embedding_modality`
- `embedding_dim`
- `embedding_timestamp`
- `embedding_status`

### `embeddings_video_gemini.jsonl`

影片多模態 embedding 支線的輸出。每筆至少包含：

- `clip_id`
- `video_id`
- `clip_path`
- `start_sec`
- `end_sec`
- `duration_sec`
- `embedding`
- `embedding_model`
- `embedding_modality=video`
- `embedding_dim`
- `embedding_timestamp`
- `embedding_status`

## Gemini quota / retry / resume

免費版 Gemini API 可能出現 `429 RESOURCE_EXHAUSTED`。目前已加入：

- batch 控制：使用 `GEMINI_EMBEDDING_BATCH_SIZE`
- retry：預設最多 3 次
- sleep / backoff：預設 20 秒，若錯誤訊息可解析 retry delay，會優先使用該值
- partial success：某批失敗時不會讓整個 pipeline 直接 crash
- resume / checkpoint：若輸出檔已存在，會跳過已成功的紀錄，只補跑尚未完成者

常見 `embedding_status`：

- `success`
- `reused_checkpoint`
- `failed_after_retries`
- `failed`
- `skipped_by_limit`

## Gemini text embedding 與 modality 說明

目前 text chunks 傳給 Gemini 時，會明確標記為：

- `embedding_modality=text`

這代表它是 Gemini text embedding，不是 multimodal embedding。

程式執行時也會輸出：

```text
This output uses Gemini, but is TEXT-ONLY. It is NOT multimodal embedding.
```

## audio embedding 支線

audio embedding 會直接使用 FFmpeg 輸出的音軌檔，不經 Whisper、不轉文字。

流程是：

音軌檔案  
→ Gemini Embedding 2  
→ `embeddings_audio_gemini.jsonl`

注意：Gemini 對 direct audio embedding 的支援會受到 API backend 能力影響。這條支線已接入、會自動嘗試執行，但若目前使用的 Gemini backend 不接受 audio embedding，程式不會 crash，而是會把錯誤寫進：

- `embedding_status`
- `embedding_error`

這樣你仍然可以保留 text pipeline 成果，之後再切換 backend 或配額設定補跑 audio embeddings。

## 影片多模態 embedding 支線

這是一條新的支線，不會修改原本的主線：

影片  
→ 切成多個 120 秒或小於 120 秒的短片段  
→ 每段影片直接送進 Gemini 多模態 embedding 請求  
→ 輸出 `embeddings_video_gemini.jsonl`

目前預設只處理第一部影片，目的是做 MVP 驗證、效果觀察與成本評估。

支線設定重點：

```env
ENABLE_GEMINI_VIDEO_EMBEDDING=true
VIDEO_MULTIMODAL_CHUNK_DIR=data/video_multimodal_chunks
VIDEO_EMBEDDINGS_OUTPUT_PATH=data/outputs/embeddings_video_gemini.jsonl
VIDEO_CHUNK_DURATION_SEC=120
VIDEO_MAX_FILES_PER_RUN=1
```

程式會：

- 只處理第一部影片
- 先切成多個 120 秒或小於 120 秒的 `.mp4` 片段
- 每段保留 `clip_id / video_id / clip_path / start_sec / end_sec / duration_sec`
- 對每個 clip 寫 log
- 遇到 429 時 sleep 20 秒後 retry，最多 3 次
- 若部分 clip 失敗，也會保留已成功或已失敗的 partial output，不會整份消失

注意：這條支線目前是 MVP 驗證版。Gemini 對 direct video embedding 的實際支援會依 backend 而異，所以程式會保留成功與失敗狀態，方便你先驗證可行性與成本。

## 驗證方式

### 驗證 text embeddings

```powershell
python src/validate_gemini_embedding.py
```

### 驗證 audio embeddings

```powershell
python src/validate_gemini_embedding.py --modality audio
```

### 單筆 Gemini text embedding debug

```powershell
python src/debug_gemini_embedding.py --text "Binary search tree is a sorted tree structure."
```

或直接指定 chunk：

```powershell
python src/debug_gemini_embedding.py --chunk-id video_001_chunk_0001
```

### 檢查 normalization 是否生效

```powershell
Select-String -Path data\outputs\transcripts.json -Pattern "CHATGVT"
Select-String -Path data\outputs\transcripts_normalized.json -Pattern "ChatGPT"
```

### 檢查 JSONL 行數是否合理

```powershell
(Get-Content data\outputs\chunks.jsonl).Count
(Get-Content data\outputs\embeddings_text_gemini.jsonl).Count
(Get-Content data\outputs\embeddings_audio_gemini.jsonl).Count
```

## 如何交給 DB / Search 成員

建議交付順序：

1. `videos.json`
2. `transcripts.json`
3. `transcripts_normalized.json`
4. `chunks.jsonl`
5. `embeddings_text_gemini.jsonl`
6. `embeddings_audio_gemini.jsonl`

關鍵 join 欄位：

- `video_id`
- `segment_id`
- `chunk_id`
- `start_sec`
- `end_sec`

## 後續擴充方向

- MongoDB ingestion adapter
- MongoDB Atlas Vector Search
- Qdrant / Chroma / Weaviate connector
- query API
- query-time reranking
- timestamp jump link
- FFmpeg clip cutting
- domain-specific normalization dictionary

## MongoDB Upload Channel

This project also includes a MongoDB upload channel. `src/main.py` now calls this uploader automatically after a successful pipeline run when MongoDB settings are configured.

Script:

```powershell
python src/mongodb_uploader.py
```

Recommended `.env` settings:

```env
MONGODB_URI=
MONGODB_DATABASE_NAME=focusflow
MONGODB_VIDEOS_COLLECTION=videos
MONGODB_TRANSCRIPTS_COLLECTION=transcripts_normalized
MONGODB_CHUNKS_COLLECTION=video_segments_text
MONGODB_TEXT_EMBEDDINGS_COLLECTION=video_segments_text
MONGODB_VIDEO_EMBEDDINGS_COLLECTION=video_segments_video
MONGODB_BULK_BATCH_SIZE=200
```

Uploader inputs:

- `data/outputs/videos.json`
- `data/outputs/transcripts_normalized.json`
- `data/outputs/chunks.jsonl`
- `data/outputs/embeddings_text_gemini.jsonl`
- `data/outputs/embeddings_video_gemini.jsonl`

MongoDB target collections and upsert keys:

- `videos` -> `videoId`
- `transcripts_normalized` -> `video_id`
- `video_segments_text` -> `chunkId`
- `video_segments_video` -> `clip_id`

Notes:

- `chunks.jsonl` is used as supporting metadata when building `video_segments_text`
- empty video embeddings are skipped during upload rather than crashing the whole run
- YouTube video documents are not overwritten with temporary `fileName`, `filePath`, or `audioPath` values during upload.
- **嚴格判定 (2026-05-05)**：`mongodb_uploader.py` 在 backend-triggered（帶 `--video-id`）模式下，若 `videos` collection 找不到對應的 app-owned Video 文件，直接報錯結束，**不再 upsert 孤兒 metadata**（避免歷史 bug：pipeline 在無對應 Video 時新建一筆只有 `video_id` snake_case 的孤兒文件）。此外，必要 collection（`video_segments_text`、`transcripts_normalized`）的成功寫入筆數需 > 0，否則整支 pipeline 視為失敗並 `notify_backend(fail)`
- **Race-condition guard (2026-05-07)**：`mongodb_uploader._target_video_exists()` 在所有 upload 函式之前先檢查 `videos` collection 中對應的 `_id` 是否仍存在（僅在 `config.target_video_id` 為合法 ObjectId 時觸發；CLI / 非 backend-triggered 一律放行）。若 Video record 已被刪除，整個 `upload_all()` 直接 `return False`，跳過 `upload_videos / upload_transcripts_normalized / upload_text_embeddings / upload_video_embeddings`，由 `main.py` 改呼叫 `notify_backend(... "fail" ...)`，避免在教師中途刪影片的情況下重新產生孤兒 segments。

## 常見問題

### 有 `.env` 還需要 `.venv` 嗎？

需要。兩者用途不同：

- `.env`：設定與金鑰，例如 `MONGODB_URI`、`GEMINI_API_KEY`、模型參數。
- `.venv`：Python 執行環境與套件，例如 `faster-whisper`、`pymongo`、`google-genai`、`yt-dlp`。

有 `.env` 但沒有 `.venv`，Python 仍會因為找不到套件而失敗。

### 本機上傳也跑不起來怎麼查？

先檢查：

```powershell
cd STT_Whisper
.\.venv\Scripts\python --version
.\.venv\Scripts\python -m pip check
.\.venv\Scripts\python -c "from faster_whisper import WhisperModel; print('whisper ok')"
.\.venv\Scripts\python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
```

再看對應 log：

```text
STT_Whisper/data/pipeline_<videoId>.log
```

如果 backend 觸發 STT 時使用到系統 Python，而不是 `.venv`，通常代表 `.venv` 沒有建在 `STT_Whisper/` 底下。

## Phase 2 - Pipeline Job Manager

每次執行 `src/main.py` 都會建立一個獨立的 run manifest：

```text
data/outputs/runs/<run_id>/manifest.json
```

`run_id` 使用 `run_YYYYMMDD_HHMMSS` 格式識別一次 pipeline 執行；同一秒若有多個 run，會自動加上流水號避免互相覆寫。Manifest 會記錄整體 run、每支影片，以及 `scan`、`extract_audio`、`transcribe`、`normalize`、`chunk`、`text_embedding`、`audio_embedding`、`export`、`mongodb_upload`、`backend_webhook` 各 stage 的狀態與時間。

要查看某支影片目前處理到哪裡，可開啟該 run 的 `manifest.json`，找到對應 `video_id`，查看：

- `status`：影片整體狀態。
- `current_stage`：目前或最後執行的 stage。
- `stages.<stage_name>.status`：該 stage 是 `pending`、`running`、`completed`、`failed` 或 `skipped`。
- `started_at`、`ended_at`、`error`：處理時間與失敗原因。

Manifest 會在每次狀態改變時以 UTF-8 原子寫入，降低執行中斷造成 JSON 損壞的風險。這套紀錄是未來 Resume／Retry 的基礎；目前版本只記錄狀態，**尚未實作 Resume 或 Retry**。

## Phase 2 - Run / Output Version Management

Job Manager 建立 `run_id` 後，本次執行的正式輸出會集中在同一個版本目錄：

```text
data/outputs/runs/<run_id>/
├─ manifest.json
├─ videos.json
├─ transcripts.json
├─ transcripts_normalized.json
├─ chunks.jsonl
├─ embeddings_text_gemini.jsonl
├─ embeddings_audio_gemini.jsonl
├─ upload_summary.json
└─ run_summary.json
```

- `manifest.json`：記錄 run、影片及各 stage 的即時狀態與錯誤。
- `run_summary.json`：記錄 run 最終狀態、輸出檔名與各類資料筆數；失敗或缺檔時以 0 計數，不會因 partial output 中斷。
- `upload_summary.json`：記錄本次 MongoDB upload 的完成、失敗或未執行狀態。
- `data/outputs/` 頂層標準檔案：維持舊流程使用的 latest compatibility copy。
- `data/outputs/runs/<run_id>/`：Phase 2 後正式、可追蹤與可回溯的批次資料來源。

舊有 `bak/`、deprecated 資料及歷史輸出不會自動搬移或刪除。這套版本管理是未來 Resume／Retry 的資料基礎；目前仍**尚未實作 Resume 或 Retry**。

## Phase 2-3 - Resume / Checkpoint

Resume 用於接續既有 `run_id` 的 pipeline 執行，避免已完成且 checkpoint 有效的 stage 被重跑。使用方式：

```powershell
python src/main.py --resume-run-id <run_id>
```

Resume 會讀取：

```text
data/outputs/runs/<run_id>/manifest.json
```

若 run 目錄不存在、`manifest.json` 不存在、或 manifest 不是合法 JSON，程式會清楚失敗，且不會自動建立新的 manifest 覆蓋舊資料。`--overwrite` 不可與 `--resume-run-id` 同時使用；若同時指定，程式會拒絕執行：

```text
--overwrite cannot be used together with --resume-run-id
```

目前 pipeline 採線性 Resume 規則。程式會從 `scan`、`extract_audio`、`transcribe`、`normalize`、`chunk`、`text_embedding`、`audio_embedding`、`export`、`mongodb_upload`、`backend_webhook` 依序檢查，找出第一個無法安全跳過的 stage；從該 stage 開始，後續所有 stage 都會重新執行。

Stage 狀態處理：

- `completed`：只有該 stage 在 manifest 中為完成狀態、checkpoint 檔案存在、非空、JSON / JSONL 可解析，且資料可供下一個 stage 使用時才會跳過。若先前 run 是後段 stage 失敗，前段已完成且 checkpoint 有效的 stage 仍可跳過。
- `failed`：從該 stage 開始重新執行。
- `pending`：正常執行。
- `running`：視為上次中斷，從該 stage 開始重新執行。

Checkpoint 遺失、空白、損壞或格式錯誤時，不會跳過該 stage，而是從該 stage 起重新執行後續流程。例如 `chunk` 顯示 `completed`，但 `chunks.jsonl` 遺失或無法解析，Resume 會從 `chunk` 開始重跑，後面的 embedding、export、upload、webhook 也會重跑。

目前 checkpoint 對照如下：

- `scan` -> `videos.json`
- `extract_audio` -> `videos.json` 內每支影片的 `audio_path` 對應 WAV 檔
- `transcribe` -> `transcripts.json`
- `normalize` -> `transcripts_normalized.json`
- `chunk` -> `chunks.jsonl`
- `text_embedding` -> `embeddings_text_gemini.jsonl`
- `audio_embedding` -> `embeddings_audio_gemini.jsonl`
- `export` -> run 目錄內的正式 JSON / JSONL 輸出檔
- `mongodb_upload` -> `upload_summary.json` 且狀態為 `completed`
- `backend_webhook` -> 只在 manifest 已完成時視為可跳過

Resume 時 checkpoint 來源一律使用 `data/outputs/runs/<run_id>/`。開始 Resume 時不會覆蓋 `data/outputs/` 頂層 latest compatibility copy；只有 Resume 全部成功後，才會刷新頂層 latest copy。

本 Sprint 只實作 Resume / Checkpoint 的線性接續能力，**不包含 Retry**，也不會改變既有 JSON / JSONL schema 或 MongoDB collection contract。
