# Handoff / Known Issues

最後更新：2026-04-19（atlas filter bug 修正 + video_id canonical 文件確認 + videoId_1 孤立索引確認）

這份文件只整理 backend 無法單獨定版、但目前已在 backend 內明確化的問題，以及交接與 demo 期間的暫時應對方式。

## 尚未解決但已明確化的問題

### DB / MongoDB 協作缺口

**已確認（2026-04-19）：**

- Atlas `text_embedding_index`：狀態 READY，105/105 筆 100% 索引
  - filter fields（向量索引搜尋時允許用來篩選的欄位，需事先登記）：`courseId`（ObjectId 型別）、`video_id`（snake_case 字串）
- M0 free cluster：vector indexes（向量索引，Atlas 做相似度搜尋所需，類似書的目錄）1 of 3 used，剩 2 個配額可用
- `video_segments_text` regular indexes：`videoId_1`（15 uses）、`video_id_1`（16 uses）、`segment_id_1`、`segmentId_1`
  - **文件直接確認（2026-04-19）**：實際文件只有 `video_id` 欄位，**沒有 `videoId`**；`videoId_1` 為孤立索引（orphaned index，索引了一個文件中不存在的欄位）；`segment_id` 值為 null，實際識別碼為 `chunk_id`
  - 後續需要 Database 組刪除 `videoId_1` 孤立索引（無實際作用，只佔系統資源）
- Atlas filter 兩處 bug 已修（`qa.service.js`）：
  - ① `courseId` 型別不符：backend 傳純字串，但 DB 存的是 ObjectId（MongoDB 的專用 ID 型別，外觀相似但 Atlas 視為不同型別，比對不到就回傳 0 筆）→ 已修正為傳 ObjectId
  - ② `videoId`（camelCase）不在 vector index filter fields，Atlas 拒絕此條件 → 已從 atlas filter 中剔除
- `video_segments_video`：有 embedding（3072 維），**無 vector search index**，multimodal QA 目前不可用

**尚未定版：**

- `video_segments_text` canonical 欄位口徑：`video_id`（snake_case）已文件確認為 canonical，`videoId`（camelCase）欄位**不存在於文件中**；但 DB regular indexes 仍存在孤立的 `videoId_1`，需 Database 組清除
- `video_segments_video` 的 Atlas vector index（若要開 multimodal QA，需補建 `video_embedding_index`，3072 維 cosine，filter field：`video_id`）
- `videos` mixed collection 的 ownership 邊界（6 筆 pipeline-owned 無 `sourceType`，3 筆 app-owned 有 `sourceType: "upload"`）
- Collections 實際 12 個，init 腳本宣稱 14，落差說明由 Database 組負責
- shared DB 是否允許 smoke 痕跡（`usage_logs` 目前已有 23 筆）

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| `videoId_1` 孤立索引清除 | **Database** | 確認 `video_segments_text` 文件無 `videoId` 欄位後，在 Atlas 刪除 `videoId_1` regular index（孤立索引，無實際作用） |
| `video_segments_text` camelCase fallback 縮窄 | **Backend**（配合 Database 清除後）| Database 清除孤立索引後，縮窄 `normalizeSegment` 的 `videoId` 相容路徑，移除 `segment.videoId` fallback |
| Pipeline STT 產出 schema 確認 | **Pipeline** | 確認後續 STT 產出只寫 `video_id`（snake_case），不再寫入 camelCase `videoId` |
| `video_segments_video` vector index | **Database** | 若 Phase-2 要開 multimodal QA，在 Atlas 補建 `video_embedding_index`（`video_segments_video`，numDimensions: 3072，similarity: cosine，filter field: `video_id`）；M0 剩 2 個配額 |
| `videos` ownership 邊界 | **Database + Backend** | 三選一：(a) 為 pipeline-owned 文件補 `sourceType: "pipeline"` 欄位；(b) 將 pipeline metadata 拆到獨立 collection；(c) 在 backend model 加 `sourceType` 欄位並更新 `video.service.js` 查詢邏輯 |
| Collections 12 vs 14 落差 | **Database** | 說明 init 腳本多宣稱的 2 個 collection 是哪些、是否需要建立 |
| `usage_logs` smoke 痕跡 | **整體決策** | 三選一：(a) demo 前 reseed 清除；(b) 另開隔離 demo DB instance；(c) 接受共享 DB 現況並在 demo 說明 |

**backend 目前已採取的行為：**

- `QA_VECTOR_SEARCH_MODE=atlas` 已生效，缺 index 或 aggregate 失敗會直接 fail-fast（不靜默回 memory）
- atlas filter 僅使用 vector index 支援欄位（`courseId` ObjectId、`video_id` snake_case），`videoId` camelCase 已排除
- pipeline metadata 只拿來做 QA bridge，不當正式 app-owned video 使用

---

### AI / Pipeline 協作缺口

**已定版：**

- query embedding provider：`gemini`（`gemini-embedding-2-preview`，3072 維），與 STT pipeline 一致
- `video_segments_text`：105 筆，全部有 embedding，欄位為 snake_case（`video_id`、`start_sec`）
- `video_id` 確認為 canonical（2026-04-19 文件直接確認）：DB 內文件只有 `video_id`，沒有 `videoId`；`videoId_1` 是孤立索引
- `segment_id` 值為 null，實際識別碼為 `chunk_id`（如 `video_001_chunk_0001`）

**仍未定版：**

- `videoId_1` 孤立索引：已確認無對應文件欄位，但 Database 組尚未清除
- 哪些影片目前真的已有 searchable coverage（目前全數 105 筆均屬 Pipeline Bridge Course）
- `clips` 與 `video_segments_video` 的正式分工（`clips` 目前只有 1 筆）

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| `videoId_1` 孤立索引清除 | **Database** | 同 DB 缺口（上方已列）；`video_id` canonical 已確認，不再需要 Pipeline 說明來源 |
| searchable coverage 範圍 | **Pipeline** | 說明目前 105 筆 segments 對應的是哪幾支影片、哪幾門課；若其他課程要有 QA coverage，需明確排定影片處理時程 |
| `clips` 與 `video_segments_video` 分工 | **Pipeline + Backend** | 決定 Phase-2 clip source：(a) `clips` collection 繼續作為 clip cache；(b) 由 `video_segments_video` 直接提供 clip path；決定後 Backend 更新 `findCachedClip` 邏輯 |

**backend 目前已採取的行為：**

- retrieval 主線是 atlas，Pipeline Bridge Course 下 105 個 segments 有 embedding 可供搜尋
- 無法做 vector scoring 時改走 lexical fallback，並在 `runtime.fallbacks` 留下訊號
- 若課程只有 metadata，回 `runtime.matchStatus=no_searchable_segments`

---

### LINE 協作缺口（已解決，2026-04-19）

**已完成：**

- `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` 已填入 `.env`
- 真實 LINE 端對端 live smoke 已驗證：bind → switch course → ask 全程走通
- `/health` 顯示 `runtime.line.readiness=ready`、`deliveryMode=live`

**仍需持續注意：**

- ngrok 每次重啟 URL 會變，需手動更新 LINE Console → 正式環境需部署到固定 HTTPS
- 學生綁定代碼目前需透過 API 手動取得 → 正式場景需前端做登入 + QR Code 頁面

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| ngrok URL 不固定 | **DevOps / 整體** | demo 前確認 ngrok 已啟動並更新 LINE Developers Console Webhook URL；正式環境決定部署目標（Railway / Render / 自建 VPS），改用固定 HTTPS domain |
| 學生綁定代碼 | **Frontend** | 實作登入後的綁定頁面，呼叫 `POST /api/v1/line/bind-token` 取得代碼，搭配 QR Code 顯示；Backend 側 API 已就緒，不需修改 |

---

### Frontend / Demo Consumer 協作缺口

**尚未定版：**

- bridge course 在 UI 上要隱藏、標示 `QA-only`，還是做 metadata-only 呈現
- 是否要把 degraded / backend-only 訊號直接顯示在畫面上
- demo 口徑是否接受 bridge course 只作 QA scope，不當完整影片課程

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| bridge course UI 策略 | **Frontend** | 決定三選一：(a) 課程列表隱藏 bridge course；(b) 顯示但標示「QA only」badge；(c) 顯示且允許進入，只是影片頁回 metadata-only 提示。決定後通知 Backend，若需要新 API 欄位再補 |
| degraded 訊號是否顯示 | **Frontend** | 決定是否在 QA 回答頁顯示 `runtime.degraded=true` 時的降級提示（如「目前使用備援搜尋模式」）；Backend `runtime.fallbacks` 已有足夠訊號 |
| demo 口徑 | **整體（Demo 決策）** | 在 demo 前統一說法：bridge course 是「已索引影片的 QA demo」，不是「完整上傳流程的 demo」；將這個口徑寫進 `demo-runbook.md` |

**backend 目前已採取的行為：**

- bridge course 標示 `qaScopeOnly`、`bridgeMode`、`bridgeContract`
- `/api/v1/courses/:courseId/videos` 會回 `metadataOnly=true`
- metadata-only bridge video 的 processing API 會回 `409 VIDEO_METADATA_ONLY`

---

## 若尚未定版時的應對方式

- **Atlas index 未 ready**：切回 `QA_VECTOR_SEARCH_MODE=memory`，走 memory cosine similarity，對外說明目前是降級模式
- **DB / AI 口徑未 freeze 前**：以 `/health`、Atlas index 狀態與實際 runtime 為準
- **bridge coverage 未補齊前**：說 `QA-only` 或 `metadata-only`；回 `no_searchable_segments` 照實說
- **LINE 條件未到位前**：只講 backend-only 驗證完成，不講 live reply ready
- **共享 DB 不可寫前**：走 `/health`、acceptance smoke 與 route tests
