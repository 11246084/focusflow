# MongoDB 契約定版文件 v1

## 本次由後端組員補充（2026-04-12）

以下帶有「本次由後端組員補充」或「本次由後端組員定版」字樣的段落，為本輪人工整理後新增或明確定版的內容，提供 database 組員快速辨識。

- `v1 核心決策`
- `transcripts_normalized` 正式採用 `segments[]` 結構
- `video_segments_text` 不存 `course_id`
- `video_segments_video` 作為正式影片片段來源
- `clips` 改列為 legacy / 快取層
- vector index 正式命名
- 同影片重跑規則
- 與目前 repo 的主要落差

備註：

- 若未特別標記，表示該段主要屬於既有背景說明或整理後沿用內容
- 若後續組員再修改，建議沿用相同格式補上新的編修註記

## 目的

本文件定義 FocusFlow 第一階段 MVP 的 MongoDB 資料契約，作為 backend、database、AI pipeline 三方共同依據。

這份文件優先用來解決以下問題：

- AI pipeline 寫入欄位與 backend 查詢欄位不一致
- 舊版 `video_segments` / `clips` 結構與新版 Gemini embedding 分流設計並存
- 測試資料、索引、重跑策略缺少明確共同規格

## 文件定位

- 本文件是目前 repo 的 MongoDB 契約 `v1`
- 兩份 PDF 僅視為整理來源，不再作為最終口徑
- 若本文件與舊腳本、舊 model、舊 meeting notes 衝突，以本文件為準

## 範圍

本文件只涵蓋第一階段 MVP 需要的資料契約，不提前定義第二階段短影音生成或個人化流程的擴充欄位。

## v1 核心決策（本次由後端組員定版）

1. 正式採用分 collection 設計，不再以單一 `video_segments` 作為正式主結構
2. 文字檢索主 collection 為 `video_segments_text`
3. 影片片段檢索主 collection 為 `video_segments_video`
4. `chunk_id` 與 `clip_id` 為正式 canonical key，不再把 `segmentId` 當正式 DB 欄位名
5. 正式欄位命名以 `snake_case` 為準
6. `clips` 在 v1 不作為 source of truth；若保留，視為 legacy 或 API 快取層
7. `video_segments_audio` 暫不列入 v1 正式查詢契約

## 正式 collection 清單

### 正式主集合

- `videos`
- `raw_transcripts`
- `stt_cache`
- `transcripts_normalized`
- `video_segments_text`
- `video_segments_video`
- `users`
- `courses`
- `enrollments`
- `usage_logs`
- `line_bind_tokens`
- `term_dictionary`

### 非正式主集合

- `clips`
  - 可暫時保留給舊 backend 或快取用途
  - 不作為 AI pipeline 正式寫入目標
- `video_segments`
  - 視為 legacy
  - 不再作為新的正式 schema 目標
- `video_segments_audio`
  - 目前僅視為實驗性或後續擴充
  - 不納入第一階段 MVP 的正式問答契約

## 命名規則

### 正式欄位命名

- `video_id`
- `course_id`
- `chunk_id`
- `clip_id`
- `segment_id`
- `start_sec`
- `end_sec`
- `text`
- `embedding`
- `embedding_model`
- `embedding_dim`
- `clip_path`

### 禁止再新增的正式欄位命名

- `videoId`
- `courseId`
- `startSec`
- `endSec`
- `segmentId`
- `clipUrl`

說明：

- backend API 回傳層若需要沿用 camelCase，可在 response mapper 轉換
- MongoDB 實際落地欄位統一使用 snake_case

## 正式 schema

### 1. `videos`

用途：影片基本資料主表，由 backend 與 pipeline 共用。

必要欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `video_id` | `string` | 唯一識別碼，unique |
| `course_id` | `ObjectId \| null` | 所屬課程，允許暫時為 `null` 但正式資料應補齊 |
| `title` | `string` | 影片標題 |
| `source_type` | `string` | `upload` / `external_url` / `local` |
| `video_url` | `string \| null` | 對外可存取播放連結 |
| `file_path` | `string \| null` | 原始檔案路徑 |
| `audio_path` | `string \| null` | 抽音輸出路徑 |
| `duration_sec` | `number \| null` | 影片長度 |
| `uploaded_by` | `ObjectId \| null` | 上傳者 |
| `processing_status` | `object` | pipeline 寫入完成狀態 |
| `created_at` | `datetime` | 建立時間 |
| `updated_at` | `datetime` | 更新時間 |

`processing_status` 建議結構：

```json
{
  "transcript_completed": true,
  "text_embedding_completed": true,
  "video_embedding_completed": true,
  "mongodb_written": true,
  "processing_completed": true
}
```

補充：

- 現有 backend 的 `processing.status = queued / processing / completed / failed` 可先保留作應用狀態機
- 若要與 pipeline 寫入完成語意整合，建議以 `processing_status` 作資料契約欄位，後續再做欄位整併

### 2. `raw_transcripts`

用途：Whisper 原始輸出，供 debug 與追溯。

必要欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `video_id` | `string` | upsert key，unique |
| `segments` | `array` | 原始 STT 切段 |

`segments[]` 結構：

| 欄位 | 型別 |
|------|------|
| `segment_id` | `string` |
| `start_sec` | `number` |
| `end_sec` | `number` |
| `text` | `string` |

### 3. `stt_cache`

用途：Whisper STT 快取，避免重複處理同影片。

必要欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `video_id` | `string` | upsert key，unique |
| `segments` | `array` | 與 `raw_transcripts` 相同結構 |

### 4. `transcripts_normalized`（本次由後端組員定版）

用途：正規化後逐字稿，中間產物，供 chunking 與 embedding 使用。

v1 正式採用 `segments[]` 結構，不採摘要型 `full_transcript` schema。  
原因：

- 與目前 `STT_Whisper` 實作一致
- 改動最小
- 對 chunking 與 traceability 較友善

必要欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `video_id` | `string` | upsert key，unique |
| `segments` | `array` | 正規化後切段 |
| `updated_at` | `datetime` | 更新時間 |

`segments[]` 結構：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `segment_id` | `string` | 原 STT 片段 id |
| `start_sec` | `number` | 開始時間 |
| `end_sec` | `number` | 結束時間 |
| `text` | `string` | 校正後文字 |
| `original_text` | `string` | 校正前文字 |
| `corrections` | `array` | 校正紀錄 |

補充：

- `transcripts_normalized` 為 pipeline 中間產物，可保留，也可在穩定後由維運策略決定是否清理
- v1 不加 TTL

### 5. `video_segments_text`（本次由後端組員定版）

用途：文字 chunk 與 text embedding，為 MVP 問答搜尋核心 collection。

必要欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `chunk_id` | `string` | 唯一鍵，unique |
| `video_id` | `string` | 對應影片，indexed |
| `segment_id` | `string \| null` | 對應原 transcript segment，可選 |
| `start_sec` | `number` | 開始時間 |
| `end_sec` | `number` | 結束時間 |
| `text` | `string` | chunk 文字 |
| `embedding` | `number[]` | text embedding |
| `embedding_model` | `string` | 例如 `gemini-embedding-2-preview` |
| `embedding_dim` | `number` | 例如 `3072` |
| `updated_at` | `datetime` | 更新時間 |

v1 決議：

- `video_segments_text` 不存 `course_id`
- backend 查詢時以 `video_id` lookup `videos` 取得 `course_id`

原因：

- 目前 pipeline 沒有穩定 `course_id` 來源
- 避免 AI pipeline 承擔課程關聯責任
- 降低重複資料與同步風險

### 6. `video_segments_video`（本次由後端組員定版）

用途：影片片段與 video embedding。

必要欄位：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `clip_id` | `string` | 唯一鍵，unique |
| `video_id` | `string` | 對應影片，indexed |
| `start_sec` | `number` | 開始時間 |
| `end_sec` | `number` | 結束時間 |
| `clip_path` | `string` | 片段檔案路徑 |
| `embedding` | `number[]` | video embedding |
| `embedding_model` | `string` | 實際模型名稱 |
| `embedding_dim` | `number` | 實際維度 |
| `updated_at` | `datetime` | 更新時間 |

v1 決議：

- `video_segments_video` 不存 `course_id`
- 若前端需要 `clipUrl`，由 backend API 層根據 `clip_path` 或儲存服務映射產生

## 關於 `clips`（本次由後端組員定版）

v1 決議：

- `clips` 不作為正式 source of truth
- 若現有 backend 仍依賴 `clips.segmentId -> clipUrl`，可暫時保留作快取或過渡層
- 新的 AI pipeline 不應再以 `clips` 作為正式寫入目標

換句話說：

- 正式資料層看 `video_segments_video`
- 對前端播放友善的 API 回傳層可另外產生 `clipUrl`

## embedding 契約

### text embedding

- `embedding_model = gemini-embedding-2-preview`
- `embedding_dim = 3072`

### video embedding

- `embedding_model =` 實際使用模型名稱
- `embedding_dim =` 實際使用維度

規則：

- backend 不可硬編碼假設 text 與 video embedding 維度一定相同
- 各 collection 都需明確存 `embedding_model` 與 `embedding_dim`

## vector index 規格（本次由後端組員定版）

### `video_segments_text`

- index name: `text_embedding_index`
- path: `embedding`
- similarity: `cosine`
- numDimensions: `3072`

### `video_segments_video`

- index name: `video_embedding_index`
- path: `embedding`
- similarity: `cosine`
- numDimensions: 依實際模型而定

規則：

- 不再共用 `vector_index`
- text 與 video 必須分開建立 Vector Search Index

## 一般 index 規格

### `videos`

- unique: `video_id`
- index: `course_id`

### `raw_transcripts`

- unique: `video_id`

### `stt_cache`

- unique: `video_id`

### `transcripts_normalized`

- unique: `video_id`
- index: `segments.segment_id`

### `video_segments_text`

- unique: `chunk_id`
- index: `video_id`

### `video_segments_video`

- unique: `clip_id`
- index: `video_id`

### `users`

- unique: `email`
- sparse unique: `lineUserId`

### `enrollments`

- index: `studentId`
- index: `courseId`
- unique compound: `studentId + courseId`

### `usage_logs`

- index: `userId`
- index: `timestamp desc`
- TTL: `timestamp` 90 天

### `line_bind_tokens`

- unique: `token`
- TTL: `expiresAt`

## 查詢責任邊界

### AI pipeline 負責

- 產出 `video_id`
- 產出 transcript / normalized transcript
- 產出 `chunk_id`
- 產出 `clip_id`
- 產出 embeddings
- 寫入 `video_segments_text` / `video_segments_video`

### backend 負責

- 用 `video_id` 關聯 `videos`
- 取得 `course_id`
- 對前端回傳 API 友善欄位，例如 `clipUrl`
- 做權限驗證、課程過濾、QA 回應組裝

### database 負責

- collection 建立
- 索引維護
- Vector Search Index 建立
- 權限與連線配置

## 同影片重跑規則（本次由後端組員定版）

以 `video_id` 為重跑單位。

### `videos`

- 用 `video_id` upsert

### `raw_transcripts`

- 用 `video_id` upsert

### `stt_cache`

- 用 `video_id` upsert

### `transcripts_normalized`

- 用 `video_id` upsert

### `video_segments_text`

- 先 `delete_many({ video_id })`
- 再寫入新版本 chunk 文件

### `video_segments_video`

- 先 `delete_many({ video_id })`
- 再寫入新版本 clip 文件

原因：

- chunk 數量可能改變
- clip 切法可能改變
- 單純逐筆 upsert 容易殘留舊資料

## 處理完成語意

v1 契約定義：

- `processing_status.processing_completed = true`
- 代表 transcript、text embedding、video embedding 與 MongoDB 寫入都已完成
- backend 可以直接查詢，不應再把它理解成「只有 STT 完成」

## sample JSON

### `videos`

```json
{
  "video_id": "video_001",
  "course_id": null,
  "title": "Binary Search Tree Lecture",
  "source_type": "local",
  "video_url": null,
  "file_path": "Test_video_file/video_001.mp4",
  "audio_path": "data/processed_audio/video_001.wav",
  "duration_sec": 1832.4,
  "uploaded_by": null,
  "processing_status": {
    "transcript_completed": true,
    "text_embedding_completed": true,
    "video_embedding_completed": true,
    "mongodb_written": true,
    "processing_completed": true
  }
}
```

### `transcripts_normalized`

```json
{
  "video_id": "video_001",
  "updated_at": "2026-04-11T09:05:00Z",
  "segments": [
    {
      "segment_id": "video_001_seg_0001",
      "start_sec": 0.0,
      "end_sec": 12.4,
      "text": "二元搜尋樹是一種常見的資料結構。",
      "original_text": "二元搜尋數是一種常見的資料結構。",
      "corrections": [
        {
          "from": "搜尋數",
          "to": "搜尋樹",
          "method": "dictionary"
        }
      ]
    }
  ]
}
```

### `video_segments_text`

```json
{
  "chunk_id": "video_001_chunk_0001",
  "video_id": "video_001",
  "segment_id": "video_001_seg_0001",
  "start_sec": 0.0,
  "end_sec": 28.4,
  "text": "二元搜尋樹是一種常見的資料結構，用來進行快速查找。",
  "embedding": [0.0123, -0.0391, 0.2844],
  "embedding_model": "gemini-embedding-2-preview",
  "embedding_dim": 3072,
  "updated_at": "2026-04-11T09:06:00Z"
}
```

### `video_segments_video`

```json
{
  "clip_id": "video_001_clip_0001",
  "video_id": "video_001",
  "start_sec": 0.0,
  "end_sec": 120.0,
  "clip_path": "data/video_multimodal_chunks/video_001_clip_0001.mp4",
  "embedding": [0.0441, -0.1182, 0.2271],
  "embedding_model": "gemini-multimodal-embedding",
  "embedding_dim": 3072,
  "updated_at": "2026-04-11T09:08:00Z"
}
```

## 與目前 repo 的主要落差（本次由後端組員補充）

1. backend 仍以 `video_segments` 為核心，需改為 `video_segments_text`
2. backend 仍使用 `segmentId / transcript / startSec / endSec` 舊欄位
3. `clips` 仍為獨立 collection，需改為以 `video_segments_video` 為正式來源
4. DB 初始化腳本仍建立舊的 `video_segments`
5. DB index 腳本仍使用 `vector_index` 與舊版 1536 維說明
6. `database/import_video_segments.py` 為 legacy 腳本，不能再視為正式匯入流程

## 建議實作順序

1. 先修改 backend `qa.service` 與相關 model，改查 `video_segments_text`
2. 更新 `database/init_collections.js` 與 `database/init_indexes.js`
3. 將舊 `video_segments` / `clips` 標記為 legacy
4. 之後再處理 `videos.processing` 與 `processing_status` 的整併

## 是否需要建立到 `docs/`

需要。

原因：

- 這是跨 backend / database / AI pipeline 的共享契約
- 不應只存在聊天紀錄、PDF 或個人筆記
- 放進 `docs/` 後，才能作為後續改 model、service、index、seed 資料時的共同依據

v1 已建立於：

- `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1.md`
