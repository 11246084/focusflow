# FocusFlow AI Pipeline MVP

這個專案是 FocusFlow 的本地 AI pipeline，角色是 AI Data Producer。它會把教學影片轉成可交給 DB / Search 成員整合的標準化資料檔，不直接寫入 MongoDB 或 Vector DB。

目前主流程保留為：

影片  
→ 掃描影片 metadata  
→ FFmpeg 抽音軌  
→ Whisper STT  
→ transcript normalization  
→ chunking  
→ Gemini Embedding 2 text embedding  
→ 匯出 JSON / JSONL

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
- FFmpeg
- `pip install -r requirements.txt`

### 建立虛擬環境

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

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
ENABLE_GEMINI_EMBEDDING=true
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
```

`GEMINI_MAX_CHUNKS_PER_RUN` 可用來做測試模式，只讓本次執行處理前 N 個尚未完成的 text chunks。

## 如何執行 pipeline

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

[data/term_dictionary.json](C:/Users/user/Desktop/STT_Whisper/data/term_dictionary.json)

## 輸出檔案

正式輸出都在：

[data/outputs](C:/Users/user/Desktop/STT_Whisper/data/outputs)

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

This project also includes a separate MongoDB upload channel that does not change the AI pipeline itself.

Script:

```powershell
python src/mongodb_uploader.py
```

If you also want to upload video multimodal embeddings:

```powershell
python src/mongodb_uploader.py --include-video-embeddings
```

Recommended `.env` settings:

```env
MONGODB_URI=
MONGODB_DATABASE_NAME=focusflow
MONGODB_VIDEOS_COLLECTION=videos
MONGODB_TRANSCRIPTS_COLLECTION=transcripts
MONGODB_CHUNKS_COLLECTION=chunks
MONGODB_TEXT_EMBEDDINGS_COLLECTION=embeddings_text_gemini
MONGODB_VIDEO_EMBEDDINGS_COLLECTION=embeddings_video_gemini
MONGODB_BULK_BATCH_SIZE=200
```

Uploader inputs:

- `data/outputs/videos.json`
- `data/outputs/transcripts.json`
- `data/outputs/chunks.jsonl`
- `data/outputs/embeddings_text_gemini.jsonl`
- `data/outputs/embeddings_video_gemini.jsonl` when `--include-video-embeddings` is enabled

MongoDB upsert keys:

- `videos` -> `video_id`
- `transcripts` -> `video_id`
- `chunks` -> `chunk_id`
- `embeddings_text_gemini` -> `chunk_id`
- `embeddings_video_gemini` -> `clip_id`
