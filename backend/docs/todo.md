# Backend TODO

最後更新：2026-04-27

> 本文件為後端組員**個人執行版**任務清單。跨服務整體進度看 repo 根目錄 [docs/current-status.md](../../docs/current-status.md)。
> runtime 現況看 [current-state.md](./current-state.md)，協作缺口看 [handoff-known-issues.md](./handoff-known-issues.md)。

## 狀態語彙

- **Done** — 已實作並通過測試
- **Partial** — 主體已完成，尚有明確缺口待補
- **Pending** — 可立即推進的後端工作
- **Blocked** — 後端側準備好，等其他組交付才能收尾
- **Need Confirmation** — 資訊不足，需先確認才能排程

---

## 個人任務清單（僅後端）

---

### 1. 發起 phase-1 契約 Freeze 會議

- **狀態**：Pending（由我發起）
- **要 freeze 的議題**：
  - Atlas vector index 健康狀態與 3072 維維度確認（`text_embedding_index` 是否已建立且正確）
  - Atlas filter fields 契約（目前使用 `video_id`，是否定版）
  - `videos` collection ownership 邊界（app-owned vs. pipeline metadata 要拆分還是加 `sourceType`）
  - pipeline segments 如何綁定 course（加 `courseId` / 改查 `video_id` 三擇一）
  - Collections 實際 12 vs. init 腳本宣稱 14 的落差說明
- **我要主動做**：
  - 彙整上述議題為一頁議題單
  - 約 Database、RAG 兩組同步時間
  - 會後把結論寫進 [handoff-known-issues.md](./handoff-known-issues.md) 並同步 [current-state.md](./current-state.md)
- **等誰**：Database、RAG 兩組到齊
- **等待期間可先做**：起草議題單；列出 backend normalize 目前相容的欄位範圍

---

### 2. 決定 demo DB 隔離策略

- **狀態**：Pending（需協調各組拿出決定）
- **背景**：DB 中 `usage_logs` 有 23 筆含 smoke test 痕跡。`line_bind_tokens` 目前乾淨（0 筆）。
- **我要主動做**：
  - 提議三選一：(a) 共享 Atlas 只讀 + 另開隔離 demo instance (b) 保留共享 Atlas 但 demo 前 reseed (c) 完全獨立 demo DB
  - 估算每個選項對 backend `.env`、seed script、CI 的影響
- **等誰**：Database 組 + 整體 demo 決策
- **對方需先交付**：Atlas 管理員可提供的 demo 環境選項

---

### 3. 確認 Atlas vector search index 健康狀態 + 修正 atlas filter 兩處 bug

- **狀態**：Done（2026-04-19 Atlas UI 截圖確認 + 兩處 filter bug 已修）
- **完成內容**：
  - `text_embedding_index`：狀態 READY，105/105 筆 100% 索引，filter fields：`embedding`、`courseId`、`video_id`
  - M0 free cluster：vector indexes 1 of 3 used，剩 2 個配額
  - backend `.env` 已設定 `QA_VECTOR_SEARCH_MODE=atlas`、`QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`
  - 修正 Bug 1：`$vectorSearch` 不經 Mongoose auto-cast，`courseId` String 需手動轉 ObjectId（`castCourseIdToObjectId`）
  - 修正 Bug 2：`videoId`（camelCase）不在 vector index filter fields，需從 atlas filter 條件中剔除（`isAtlasFilterCompatible`）；DB index 截圖確認 `videoId_1` 有 15 次使用紀錄；文件直接確認 `videoId` 欄位**不存在於文件中**，`videoId_1` 為孤立索引
  - `video_segments_text` 文件欄位直接確認（2026-04-19）：只有 `video_id`，無 `videoId`；`segment_id` 值為 null，實際識別碼為 `chunk_id`（如 `video_001_chunk_0001`）
  - `videoSegment.model.js` 已清除 `videoId` schema 欄位宣告
  - `video_segments_video`：有 embedding，**無 vector search index**，multimodal QA 目前不可用
  - `video_segments_audio`：0 docs，無 vector search index

---

### 4. query embedding Gemini provider

- **狀態**：Done（2026-04-19）
- **完成內容**：
  - `.env` 已設定 `QA_QUERY_EMBEDDING_PROVIDER=gemini`
  - `queryEmbedding.service.js` 支援 `gemini-embedding-2-preview`（3072 維）
  - 維度動態配置（`QA_QUERY_EMBEDDING_DIM`）
  - `video_segments_text` 105 筆 segments 全部有 embedding，維度一致

---

### 5. 支援 Frontend × Backend API 整合

- **狀態**：Partial（後端 API Done；Frontend 第一階段頁面已完成，API 整合進行中）
- **後端側**：Done — 登入、課程、QA、影片、LINE bind、`/health` 全數可用
- **Frontend 側**：第一階段 7+ 頁面 UI 已完成（2026-04-21），目前進行 API 串接
- **我要主動做**：
  - 整合過程中快速回覆 CORS、response format、token 處理相關問題
  - 若 Frontend 需要，補 Swagger 用法或 example payload
  - LINE 綁定 QR Code 頁面：後端 `POST /api/v1/line/bind-token` 已可用，無需修改

---

### 6. 協助 Frontend 決定 bridge course 呈現策略

- **狀態**：Pending（需要我先把欄位語義寫清楚）
- **背景**：bridge course 目前為 pipeline-style demo baseline，`qaScopeOnly`、`bridgeMode`、`bridgeContract` 已有回應
- **後端已提供的訊號**：`qaScopeOnly`、`bridgeMode`、`bridgeContract`、`metadataOnly=true`、`matchStatus=no_searchable_segments`、`VIDEO_METADATA_ONLY=409`
- **我要主動做**：
  - 整理 bridge course 相關欄位語義表給 Frontend
  - 決策完成後更新 [handoff-known-issues.md](./handoff-known-issues.md)
- **等誰**：Frontend 提出 UI 偏好

---

### 7. LINE live smoke test

- **狀態**：Done（2026-04-19 實測通過）
- **完成內容**：
  - `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET` 已設定至 `.env`
  - 真實 LINE 端對端完整走通：bind → switch course → ask
  - `/health` `runtime.line.readiness=ready`、`deliveryMode=live`
  - QA 回答成功從 LINE 傳回，含影片時間戳

---

### 8. 澄清 `videos` 所有權模型

- **狀態**：Need Confirmation（策略未定，需要 Database 一起決定）
- **背景**：DB 中 9 筆 `videos` 混用兩種形狀：pipeline-owned（video_001~006，無 `courseId`/`sourceType`）與 app-owned（3 筆，有 `sourceType: "upload"` 與 `courseId`）
- **我要主動做**：
  - 在 Phase-1 契約會議提出兩個方案：(a) Schema 加 `sourceType` 欄位 (b) 拆 collection
  - 會後若定案，更新 `models/Video.js` + `video.service.js` + demo seed + 測試 harness

---

### 9. 確認 `video_segments_text` canonical 欄位

- **狀態**：Done（2026-04-19 全面完成）
- **完成內容**：
  - canonical 欄位定版為 camelCase：`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`
  - DB 文件 105 筆已遷移為 camelCase（2026-04-19）
  - vector index filter 已改為 `videoId`（camelCase）
  - `videoSegment.model.js`：camelCase only，已移除 snake_case 欄位宣告
  - `bridgeScope.service.js`：`normalizeSegment` 只讀 camelCase，`buildSegmentLookupQuery` 只查 `{ videoId: ... }`
  - `qa.service.js` `isAtlasFilterCompatible`：允許 `videoId`，拒絕 `video_id`
  - `segmentId` 值為 null，實際識別碼為 `chunkId`（如 `video_001_chunk_0001`）

---

### 10. Collections 數量落差（12 vs. 14）

- **狀態**：Need Confirmation（低優先）
- **背景**：MCP 實測 12 collections，init 腳本宣稱 14。差異說明由 Database 組負責。
- **我要主動做**：在 Phase-1 會議順帶確認；結論寫進 [handoff-known-issues.md](./handoff-known-issues.md)

---

### 11. 生產環境前：CORS 限定 origin

- **狀態**：Pending（phase-1 MVP 可接受，demo/生產前必做）
- **背景**：`app.js` 目前使用寬鬆 `cors()`
- **我要主動做**：
  - `.env.example` 補 `ALLOWED_ORIGIN`
  - `app.js` 改為 `cors({ origin: env.ALLOWED_ORIGIN })`
  - 加一個驗證 preflight 的 route test
- **先決條件**：Frontend 確認正式部署的 origin

---

### 12. STT Pipeline 自動化整合（2026-04-27 完成）

- **狀態**：Done
- **完成內容**：
  - `video.service.js`：影片上傳後自動 spawn STT pipeline（`child_process.spawn`，`detached: true`）
  - `STT_Whisper/src/main.py`：新增 `--video-path`、`--video-id` 參數；新增 `notify_backend()` webhook 回報；STT 完成後自動執行 `mongodb_uploader.py`
  - `STT_Whisper/src/config.py`：新增 `backend_url`、`processing_webhook_secret`、`target_video_path`
  - `STT_Whisper/src/scan_videos.py`：支援 `target_video_path` 直接指定單一影片
  - `STT_Whisper/.env.example`：新增 `BACKEND_URL`、`PROCESSING_WEBHOOK_SECRET`

---

### 13. YouTube 自動上傳整合

- **狀態**：Pending
- **背景**：學生提問時需要回傳 YouTube 時間戳跳轉連結（`youtube.com/watch?v=ID&t=秒數`），需要先有 `youtubeVideoId`
- **我要主動做**：
  - `models/video.model.js` 新增 `youtubeVideoId: { type: String }` 欄位
  - `video.service.js` 上傳後呼叫 YouTube Data API v3，影片設為 unlisted
  - QA 回答時從 Video 取 `youtubeVideoId` 組合跳轉連結
- **先決條件**：專案負責人提供 FocusFlow Google 帳號 OAuth 憑證

---

## 本輪刻意不碰

- Frontend 程式碼
- `database/` 內的 init / import 腳本（由 Database 組負責）
- `STT_Whisper/` pipeline 程式（由 RAG 組負責）
- MongoDB 內實際資料（不直接寫 Atlas，交由 Database 執行匯入）
- phase-2 功能：`video_segments_video` 正式 clip source、multimodal retrieval

---

## 規劃前提

- 共享 demo env 主線：`gemini + atlas + gemini + explicit seed`；isolated local smoke：`mock + memory`
- 切換任何 provider 或 vector mode 前，先跑 `qa.service.test.js` 與 route 測試
- 跨組未 freeze 的議題先用 [handoff-known-issues.md](./handoff-known-issues.md) 管住，不在 backend 單方面擴功能
- demo 口徑以 `/health` 與 API runtime 訊號為準
- 完成任一任務後同步更新 [todo.md](./todo.md)、[implementation-log.md](./implementation-log.md)、[README.md](./README.md) 的 Latest Update
