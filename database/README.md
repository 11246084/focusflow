# FocusFlow Database 使用說明

本資料夾包含 FocusFlow 資料庫的初始化腳本與資料匯入工具。

---

## 資料夾結構

```
database/
├── README.md                         ← 本文件
├── .env                              ← 放 MONGODB_URI（不進版控）
├── init_collections.js               ← 建立所有 Collection
├── init_indexes.js                   ← 建立所有 Index
├── mongodb_uploader.py               ← ✅ 統一上傳工具（取代以下所有 import_*.py）
├── import_videos.py                  ← 舊版（已整合進 mongodb_uploader.py）
├── import_transcripts_normalized.py  ← 舊版（已整合進 mongodb_uploader.py）
├── import_video_segments_text.py     ← 舊版（snake_case，已停用）
├── import_video_segments_audio.py    ← 舊版（已整合進 mongodb_uploader.py）
├── import_video_segments_video.py    ← 舊版（已整合進 mongodb_uploader.py）
└── import_term_dictionary.py         ← 舊版（已整合進 mongodb_uploader.py）
```

> ⚠️ 所有 `import_*.py` 均已整合至 `mongodb_uploader.py`，**請統一使用新工具**。
> `import_video_segments_text.py` 額外注意：寫入 snake_case 欄位，與 Mongoose model 不相容，**禁止使用**。

---

## 第一次使用（初始化資料庫）

### 步驟 1：建立 .env

在 `database/` 資料夾內新增 `.env` 檔，填入 MongoDB 連線字串：

```
MONGODB_URI=mongodb+srv://<帳號>:<密碼>@<cluster>.mongodb.net/focusflow
```

> 本機測試可用：`MONGODB_URI=mongodb://127.0.0.1:27017/focusflow`

---

### 步驟 2：建立 Collections

在 MongoDB Shell（mongosh）執行：

```bash
mongosh "你的連線字串" --file database/init_collections.js
```

---

### 步驟 3：建立 Indexes

```bash
mongosh "你的連線字串" --file database/init_indexes.js
```

> ⚠️ 請確認 init_collections.js 已先執行完畢再執行此步驟。

---

### 步驟 4：安裝 Python 套件

```bash
python -m pip install pymongo
```

---

### 步驟 5：匯入資料

```bash
python database/mongodb_uploader.py
```

一次執行全部模組（segments、videos、transcripts、audio、video_clips、terms）。
每個模組完成後會顯示成功、跳過、失敗的筆數。

若只需執行特定模組：

```bash
python database/mongodb_uploader.py --only segments
python database/mongodb_uploader.py --only segments videos
```

---

## mongodb_uploader.py 使用說明

### 基本用法

```bash
python database/mongodb_uploader.py              # 執行全部模組
python database/mongodb_uploader.py --only segments          # 只跑文字 segment
python database/mongodb_uploader.py --only segments videos   # 指定多個模組
```

可用模組：`segments`、`videos`、`transcripts`、`audio`、`video_clips`、`terms`

### segments 模組寫入欄位

讀取 `STT_Whisper/data/outputs/embeddings_text_gemini.jsonl`，以 `chunkId` 為 upsert key，寫入以下 camelCase 欄位：

| 欄位 | 說明 |
|------|------|
| `chunkId` | chunk 唯一識別碼 |
| `videoId` | 對應影片的 video_id |
| `segmentId` | 對應 segment 識別碼 |
| `startSec` | 開始時間（秒） |
| `endSec` | 結束時間（秒） |
| `text` | 逐字稿文字 |
| `embedding` | 3072 維 Gemini embedding 向量 |

### 指定課程（courseId）

若需將 segment 直接綁定到某門課，設定環境變數 `FOCUSFLOW_COURSE_ID`：

```bash
FOCUSFLOW_COURSE_ID=680000000000000000000103 python database/mongodb_uploader.py
```

或在 `database/.env` 加入：

```
FOCUSFLOW_COURSE_ID=680000000000000000000103
```

---

## 重新匯入資料

所有模組都使用 **upsert**（有就更新、沒有就新增），重複執行完全安全。

AI pipeline 產出新資料後，重跑對應模組即可：

```bash
python database/mongodb_uploader.py --only segments     # 文字 embedding 更新後
python database/mongodb_uploader.py --only audio        # 音訊 embedding 產出後
python database/mongodb_uploader.py --only video_clips  # 影片 embedding 更新後
```

---

## 資料來源對照

| 模組（--only） | Collection | 資料來源 |
|--------------|-----------|----------|
| `segments` | `video_segments_text` | `STT_Whisper/data/outputs/embeddings_text_gemini.jsonl` |
| `videos` | `videos` | `STT_Whisper/data/outputs/videos.json` |
| `transcripts` | `transcripts_normalized` | `STT_Whisper/data/outputs/transcripts_normalized.json` |
| `audio` | `video_segments_audio` | `STT_Whisper/data/outputs/embeddings_audio_gemini.jsonl` |
| `video_clips` | `video_segments_video` | `STT_Whisper/data/outputs/embeddings_video_gemini.jsonl` |
| `terms` | `term_dictionary` | `STT_Whisper/data/term_dictionary.json` |

---

## 目前資料庫狀態（2026-04-19）

### video_segments_text

| 條件 | 數量 |
|------|------|
| 總文件數 | 105 |
| camelCase 文件（有 `chunkId`） | 105 |
| snake_case 文件（有 `chunk_id`） | 0 |
| Pipeline segments（`videoId='video_001'`，`courseId=103`） | 102 |
| Demo segments（`courseId=101`） | 3 |

### Index 清單

| Index 名稱 | 類型 | 欄位 |
|-----------|------|------|
| `_id_` | default | `_id` |
| `courseId_1` | regular | `courseId` |
| `segmentId_1` | regular | `segmentId` |
| `videoId_1` | regular | `videoId` |
| `courseId_1_videoId_1` | compound | `courseId`, `videoId` |
| `text_embedding_index` | vectorSearch | `embedding`（3072 dims）、filter: `courseId`、filter: `videoId` |

### 課程與影片對應

| 課程 | course._id | video.video_id | segment.videoId | 備註 |
|------|-----------|----------------|-----------------|------|
| FocusFlow Demo QA Co | 680000000000000000000101 | 680000000000000000000202 | 680000000000000000000201 | demo 用途 |
| FocusFlow Pipeline B | 680000000000000000000103 | focusflow-demo-video-pipeline-bridge | video_001 | 靠 courseId 綁定 |

> ⚠️ Pipeline Bridge Course 的 `video.video_id` 與 pipeline segments 的 `videoId` 不匹配，目前靠 `courseId` 直接綁定運作。若未來 pipeline 更換影片，需同步更新 `courseId` 或 `videoId`。

---

## 常見問題

**Q：執行腳本時出現 `ModuleNotFoundError: No module named 'pymongo'`**

```bash
python -m pip install pymongo
```

**Q：執行腳本時出現 `MONGODB_URI is not set`**

確認 `database/.env` 檔案存在且內容正確。

**Q：執行 `--only audio` 時出現 `FileNotFoundError`**

`embeddings_audio_gemini.jsonl` 尚未產生，需先執行 AI pipeline 的音訊 embedding 流程。找不到的模組會自動跳過，不影響其他模組執行。

**Q：Atlas Vector Search Index 要怎麼建？**

需至 MongoDB Atlas 網頁手動建立，路徑：**Atlas → Search & Vector Search → Create Vector Search Index**

| Collection | Index 名稱 | path | numDimensions | filter fields |
|---|---|---|---|---|
| `video_segments_text` | `text_embedding_index` | `embedding` | 3072 | `courseId`、`videoId` |
| `video_segments_video` | `video_embedding_index` | `embedding` | 依模型而定 | — |

**Q：舊的 `import_*.py` 還能用嗎？**

不建議。所有功能已整合至 `mongodb_uploader.py`。其中 `import_video_segments_text.py` 寫入 snake_case 欄位（`chunk_id`、`video_id` 等），與 Mongoose VideoSegment model 不相容，**禁止使用**。其餘 import 腳本保留備用，但日後請統一使用 `mongodb_uploader.py`。
