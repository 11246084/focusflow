# FocusFlow AI Pipeline MVP

## Phase 2 STT Accuracy Optimization Sprint 1

Pipeline 使用 `faster-whisper`，並提供可選 `STT_INITIAL_PROMPT`、安全的 boundary-aware terminology normalization、run-specific `correction_audit.jsonl`、STT／Normalize fingerprints 與品質摘要。術語校正只接受字典明列 alias，不再執行未受限的 fuzzy 全域替換；raw `transcripts.json` 不會被覆蓋，校正結果與稽核資訊位於 normalized transcript 與 correction audit。

完全離線評估可執行 `python tools/evaluate_stt_accuracy.py`。文字 fixture 可驗證 CER、WER、Term Accuracy、False Replacement 與校正契約，但不能證明真實音訊辨識率；真實效果仍需用同一段音訊比較 baseline、prompt only 與 prompt + safe terminology。

## Phase 2-2 Sprint 2A：Parent Embedding

Parent Embedding 是位於 `hierarchy` 與 Leaf `text_embedding` 之間的獨立 blocking stage。它預設關閉，只有同時設定 `HIERARCHY_ENABLED=true` 與 `PARENT_EMBEDDING_ENABLED=true` 才會執行；若只啟用 Parent Embedding，設定驗證會在 Run 建立前失敗。

啟用後，Pipeline 將 `parent_chunks.jsonl` 轉為 run-scoped `embeddings_parent_gemini.jsonl`。每筆記錄保留 `parent_id`、`video_id`、有序 `child_chunk_ids`、Parent 文字與時間範圍、向量與兩層 fingerprint，使 Sprint 2B 可建立 Parent Document，Sprint 3 可由 Parent 命中展開回 Leaf。Parent 與 Leaf 使用相同 provider、model、dimension、`RETRIEVAL_DOCUMENT` task type與 L2 normalization，但兩者的 ID、artifact、fingerprint、resume 邊界完全分離。

Parent Embedding fingerprint 依賴 Hierarchy fingerprint 及非敏感向量設定。Resume 只有在 fingerprint 相同且 artifact 通過完整 schema、mapping、向量維度與 finite-number 驗證時才會 reuse；缺檔、損毀、舊 manifest 或設定改變會從 `parent_embedding` 重跑。Feature Gate 關閉時 stage 為 `skipped`，不建立假 artifact，也不讓既有 Parent Artifact 影響 Leaf-only 流程。

Failure policy 採 explicit opt-in + blocking：所有 required Parent 必須為成功或合法 reuse，任一失敗都不會將 stage 標示為 completed 或 publishable。測試以 Fake Provider 完全離線執行：

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_parent_embedding
```

本 Sprint 只產生可交接的 Parent Embedding Artifact，不修改 MongoDB、Backend、Frontend，也尚未啟用 Parent Storage、Parent Search、Child Expansion 或 Hierarchical Retrieval。`courseId` 仍須在 Sprint 2B 由 uploader／資料庫映射確認；最終 Citation 仍由 Leaf Chunk 產生。

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

## Batch Video Processing

Batch 模式只負責排程；每支影片仍由既有 `src/main.py` 建立獨立的 run、manifest、
checkpoint、output 與 run summary。單支失敗不會中止其他影片。

```powershell
python src/batch_main.py --batch-input Test_video_file
```

設定：

```env
BATCH_MAX_CONCURRENCY=1
BATCH_ITEM_MAX_RETRIES=0
```

- `BATCH_MAX_CONCURRENCY` 僅允許 `1`～`2`，預設 `1`，避免 Whisper、FFmpeg、
  Embedding 同時競爭 CPU、GPU、RAM 與 Disk I/O。
- `BATCH_ITEM_MAX_RETRIES` 僅允許 `0`～`2`。Retry 使用同一個 `run_id` 呼叫既有
  `--resume-run-id`，不重做已通過 checkpoint 驗證的 stage。
- Batch manifest 與 summary 位於
  `data/outputs/batches/<batch_id>/batch_manifest.json` 及 `batch_summary.json`。
- Resume：`python src/batch_main.py --batch-resume <batch_id>`。已完成項目不重跑；
  中斷時的 running 項目會轉為 retrying，queued 項目繼續執行。
- Batch JSON 使用 temporary file、flush、fsync、atomic replace，避免留下半份正式檔案。

完全離線測試：

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_batch_manager -v
```

Batch 測試只使用 Fake Runner，不會呼叫 FFmpeg、Whisper、Gemini、Embedding、
MongoDB、Backend Webhook 或 Docker。目前尚未執行真實影片與多 worker 壓力測試；
正式環境應先維持 concurrency `1`。

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
VIDEO_SEGMENT_PARENT_COLLECTION=video_segments_parent
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
- **Race-condition guard (2026-05-07)**：`mongodb_uploader._target_video_exists()` 在所有 upload 函式之前先檢查 `videos` collection 中對應的 `_id` 是否仍存在（僅在 `config.target_video_id` 為合法 ObjectId 時觸發；CLI / 非 backend-triggered 一律放行）。若 Video record 已被刪除，`upload_all()` 會以 `validation_error` 失敗並跳過所有 collection upload，由 `main.py` 將 stage 與 run 標記為 failed，避免在教師中途刪影片的情況下重新產生孤兒 segments。

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

## Phase 2 - Sprint 4: MongoDB Upload Improvement

本 Sprint 將原本逐筆 `update_one(..., upsert=True)` 的上傳改為有上限的 `bulk_write(UpdateOne(...), ordered=False)`，減少大量 segment 上傳時的網路往返。批次大小由 `MONGODB_BULK_BATCH_SIZE` 控制，預設為 `200`；每個 collection 分開分批，不會一次送出無限制資料。

### Parent publication adapter（Phase 2-2）

`src/parent_mongodb_uploader.py` 是 Parent artifact 的正式 publication adapter，但目前刻意不接入 `main.py` 或既有 Leaf `upload_all()`。它只接受已通過 Parent Embedding stage 的 `embeddings_parent_gemini.jsonl`，且呼叫端必須顯式注入 MongoDB collection 與權威 `courseId`（或可替換的 resolver）。模組本身不建立 MongoDB client，也不會從 `videoId`、第一門課或本機資料猜測 `courseId`。

發布前會整批驗證 JSONL、Parent 欄位、fingerprints，以及固定的 `gemini-embedding-2-preview`／`RETRIEVAL_DOCUMENT`／3072 維 contract。任何一筆失敗時整批阻擋且 write count 為 0。通過後才把白名單 snake_case 欄位集中映射成 Backend schema 的 camelCase document，並使用唯一 filter `{ parentId }` 建立 `upsert=True`、`ordered=False` 的 bulk operations。

Collection 名稱由 `VIDEO_SEGMENT_PARENT_COLLECTION` 設定，預設 `video_segments_parent`。`generationVersion` 僅保留為 nullable audit 欄位、`isActive` 預設 `true`；目前不做 generation switching、stale cleanup 或 delete。這一階段只完成 offline/mock 驗證，尚未代表 shared Atlas 已發布或 live upsert 已驗收。

上傳仍使用既有文件欄位與識別條件，不新增 MongoDB 文件欄位：

- `videos`：Backend app-owned Video 使用 `_id` 更新且不 upsert；standalone pipeline metadata 使用 `videoId` upsert。
- `transcripts_normalized`：使用 `video_id` upsert。
- `video_segments_text`：使用 `chunkId` upsert，文件維持 Backend 使用的 camelCase 欄位。
- `video_segments_video`：使用 `clip_id` upsert，維持既有 snake_case contract。

其中 `videos`、`transcripts_normalized`、`video_segments_text` 是目前主 Pipeline 完成 upload 的必要 collections；`video_segments_video` 是選用的 multimodal/legacy 邊界。主 Pipeline 沒有獨立 `video_embedding` stage，因此 `embeddings_video_gemini.jsonl` 不存在或沒有資料時，只要三個必要 collections 成功，upload 仍可為 `completed`。

相同資料再次上傳時會 match 並更新既有文件，不會在一般循序執行情境下無限制新增重複文件。正式 unique index 不在本 Sprint 的部署範圍內；併發寫入的資料庫層唯一性仍取決於環境中既有 index。

每次上傳都會在 run 目錄寫入 `upload_summary.json`。格式包含 `run_id`、`status`、`started_at`、`finished_at`、各 collection 的 `attempted / inserted / updated / matched / skipped / failed`、合計 `totals`、安全分類後的 `errors`，以及向後相容的頂層 `error`。`updated` 是 PyMongo 的 `modified_count`，`matched` 是 `matched_count`，兩者不可相加解讀為不同文件數；程式不會推測 PyMongo 未提供的數據。

狀態規則：

- `completed`：必要 collections（`videos`、`transcripts_normalized`、`video_segments_text`）都有成功寫入或 match，且沒有 skipped / failed / error。
- `partial`：至少有部分文件成功，但另有 validation skip 或 collection/batch failure。
- `failed`：沒有任何文件成功，或在連線、驗證等前置階段即失敗。

錯誤只分類為 `configuration_error`、`connection_error`、`authentication_error`、`validation_error`、`duplicate_or_write_error`、`unknown_error`；summary 與 uploader log 不寫入 MongoDB URI、帳號、密碼或原始 driver error。發生 partial / failed 時仍會先寫出 summary，然後讓 exception 繼續使 `mongodb_upload` stage 失敗，不會誤標 completed。

Resume 相容規則不變：只有 `upload_summary.json` 可解析且 `status=completed` 時才跳過 upload；`partial`、`failed`、缺檔、空白或損壞都會重新執行 upload。跳過 upload 時不執行 cleanup，也不重複完成 webhook；Resume 全部成功後才更新 latest compatibility copy。

本 Sprint **沒有**自動 Retry、Exponential Backoff、unique index 部署、schema migration、正式資料清理或 Retrieval / Reranker / Chunking / QA 修改。

離線驗證（不連 MongoDB、不呼叫 Gemini、不執行 Whisper）：

```powershell
.\.venv\Scripts\python.exe -m compileall src tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
git diff --check
```

## Phase 2 - Chunk Strategy Optimization Sprint 1

本 Sprint 新增 adaptive Segment-based Chunk Overlap。既有 `CHUNK_MAX_CHARS`、`CHUNK_MAX_SEGMENTS`、`CHUNK_MAX_DURATION_SEC` 仍共同決定 Chunk 邊界；不是固定 Sliding Window，也不切割單一 Whisper segment。

```env
CHUNK_OVERLAP_SEGMENTS=0
```

- 允許值：`0`、`1`、`2`，且必須小於 `CHUNK_MAX_SEGMENTS`。
- 預設 `0`：輸出與舊版無 overlap 行為一致。
- 設為 `1` 或 `2`：新 Chunk 最多帶入前一 Chunk 最後 N 個完整 segments。
- carry-over 仍計入字數、segment count 與時間限制；若新 segment 無法加入，會由 `2 -> 1 -> 0` 自動縮減。
- 每個新 Chunk 至少包含一個尚未處理的新 segment，不會產生只含 overlap 的尾 Chunk。
- `start_sec` 取 Chunk 第一個 segment，`end_sec` 取最後一個 segment；`chunk_id` 與 `chunks.jsonl` 欄位不變。

新 run 的 `manifest.json` 與 `run_summary.json` 會保存 `chunk_config` 與 SHA-256 `chunk_config_fingerprint`。Resume 只有在 fingerprint 相同時才能沿用 Chunk checkpoint。舊 manifest 沒有 fingerprint 時，只有 `220 chars / 45 sec / 6 segments / overlap=0` 可視為 legacy-compatible；其他設定會從 `chunk` 起重跑所有後續 stages。

離線測試與 A/B：

```powershell
cd STT_Whisper
.\.venv\Scripts\python.exe -m unittest tests.test_chunking -v
.\.venv\Scripts\python.exe -m unittest tests.test_resume_checkpoint -v
.\.venv\Scripts\python.exe tools\chunk_ab_test.py
```

A/B 工具只使用固定假 Transcript 與 character n-gram，不寫入正式 outputs、不呼叫 Gemini/Whisper、不連 MongoDB，也不需要 Docker。

本 Sprint **尚未 rollout 共享 MongoDB Atlas**。同一影片用不同 Chunk Strategy 重跑時，現有 `<video_id>_chunk_<序號>` 可能覆寫相同序號，而 uploader 不會自動清除 stale Chunk。正式 rollout 前仍需資料庫負責人定版 replace-by-video 或 stale chunk cleanup 規則。

## Phase 2-2 - Hierarchical Chunk Generation Sprint 1

Deterministic Parent Chunk Generation 預設關閉，啟用後會在 `chunk` 與
`text_embedding` 之間執行獨立 `hierarchy` stage：

```env
HIERARCHY_ENABLED=false
HIERARCHY_PARENT_LEAF_COUNT=3
HIERARCHY_PARENT_OVERLAP_LEAVES=0
PARENT_CHUNKS_OUTPUT_PATH=data/outputs/parent_chunks.jsonl
```

- `HIERARCHY_PARENT_LEAF_COUNT` 允許 `2` 到 `8`。
- `HIERARCHY_PARENT_OVERLAP_LEAVES` 允許 `0` 到 `2`，且必須小於 group size。
- Parent 依 `chunks.jsonl` 原始順序固定分組，步長為
  `parent_leaf_count - parent_overlap_leaves`。
- Parent ID 為 `<video_id>_parent_<四位流水號>`，文字使用 canonical newline
  合併，不做文字去重、改寫、topic detection 或 LLM summary。
- 獨立輸出 `parent_chunks.jsonl`；既有 `chunks.jsonl`、Leaf ID、Leaf text
  embedding、MongoDB uploader 與 retrieval 契約均不變。
- Manifest 與 run summary 保存 hierarchy config、依賴 Leaf Chunk fingerprint
  的 SHA-256 hierarchy fingerprint、來源 Leaf 數及 Parent 數。
- 本輸出只供後續 Sprint 使用；本 Sprint 不建立 Parent embedding、不寫入
  MongoDB，也不接入 Backend retrieval。
