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
├── import_videos.py                  ← 匯入影片 metadata
├── import_transcripts_normalized.py  ← 匯入正規化逐字稿
├── import_video_segments_text.py     ← 匯入文字切段 + embedding
├── import_video_segments_audio.py    ← 匯入音訊 embedding
├── import_video_segments_video.py    ← 匯入影片 embedding
└── import_term_dictionary.py         ← 匯入專有名詞詞庫
```

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

執行完畢後會看到每個 collection 建立成功的訊息。

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

進入 `database/` 資料夾後依序執行：

```bash
cd database

python import_videos.py
python import_transcripts_normalized.py
python import_video_segments_text.py
python import_video_segments_audio.py
python import_video_segments_video.py
python import_term_dictionary.py
```

每支腳本執行完畢會顯示成功、跳過、失敗的筆數。

---

## 重新匯入資料

所有腳本都使用 **upsert**（有就更新、沒有就新增），**重複執行完全安全**，不會產生重複資料。

AI pipeline 產出新資料後，直接重跑對應腳本即可：

```bash
python import_video_segments_text.py   # 文字 embedding 更新後
python import_video_segments_audio.py  # 音訊 embedding 產出後
python import_video_segments_video.py  # 影片 embedding 更新後
```

---

## 資料來源對照

| 腳本 | 資料來源 |
|------|----------|
| `import_videos.py` | `STT_Whisper/data/outputs/videos.json` |
| `import_transcripts_normalized.py` | `STT_Whisper/data/outputs/transcripts_normalized.json` |
| `import_video_segments_text.py` | `STT_Whisper/data/outputs/chunks.jsonl` + `embeddings_text_gemini.jsonl` |
| `import_video_segments_audio.py` | `STT_Whisper/data/outputs/embeddings_audio_gemini.jsonl` |
| `import_video_segments_video.py` | `STT_Whisper/data/outputs/embeddings_video_gemini.jsonl` |
| `import_term_dictionary.py` | `STT_Whisper/data/term_dictionary.json` |

---

## 常見問題

**Q：執行腳本時出現 `ModuleNotFoundError: No module named 'pymongo'`**

```bash
python -m pip install pymongo
```

**Q：執行腳本時出現 `MONGODB_URI is not set`**

確認 `database/.env` 檔案存在且內容正確。

**Q：`import_video_segments_audio.py` 出現 `FileNotFoundError`**

`embeddings_audio_gemini.jsonl` 尚未產生，需先執行 AI pipeline 的音訊 embedding 流程。

**Q：Atlas Vector Search Index 要怎麼建？**

需至 MongoDB Atlas 網頁手動建立，路徑：**Atlas → Search & Vector Search → Create Vector Search Index**

| Collection | Index 名稱 | path | numDimensions |
|---|---|---|---|
| `video_segments_text` | `text_embedding_index` | `embedding` | 3072 |
| `video_segments_video` | `video_embedding_index` | `embedding` | 依模型而定 |
