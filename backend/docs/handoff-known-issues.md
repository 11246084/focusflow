# Handoff / Known Issues

最後更新：2026-04-24（更新 Frontend 頁面完成狀態；補充教授開會決議）

這份文件只整理 backend 無法單獨定版、但目前已在 backend 內明確化的問題，以及交接與 demo 期間的暫時應對方式。

## 尚未解決但已明確化的問題

### DB / MongoDB 協作缺口

**已確認（2026-04-19）：**

- Atlas `text_embedding_index`：狀態 READY，105/105 筆 100% 索引
  - filter fields（向量索引搜尋時允許用來篩選的欄位，需事先登記）：`courseId`（ObjectId 型別）、`videoId`（camelCase 字串）
  - DB 組已於 2026-04-19 完成：vector index filter 改為 `videoId`（camelCase）、105 筆文件欄位遷移為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）
- M0 free cluster：vector indexes（向量索引，Atlas 做相似度搜尋所需，類似書的目錄）1 of 3 used，剩 2 個配額可用
- `video_segments_text` regular indexes（DB 組 2026-04-19 更新後）：`_id_`、`courseId_1`、`segmentId_1`、`videoId_1`、`courseId_1_videoId_1`；105 筆文件已遷移為 camelCase，`videoId_1` 現在對應真實欄位，不再是孤立索引；`segmentId` 值為 null，實際識別碼為 `chunkId`（如 `video_001_chunk_0001`）
- Atlas filter 兩處 bug 已修（`qa.service.js`）：
  - ① `courseId` 型別不符：backend 傳純字串，但 DB 存的是 ObjectId（MongoDB 的專用 ID 型別，外觀相似但 Atlas 視為不同型別，比對不到就回傳 0 筆）→ 已修正為傳 ObjectId
  - ② `videoId`（camelCase）不在舊 vector index filter fields，Atlas 拒絕此條件 → 已從 atlas filter 中剔除；DB 組已將 vector index filter 更新為 `videoId`，backend `isAtlasFilterCompatible` 同步對齊
- `video_segments_video`：有 embedding（3072 維），**無 vector search index**，multimodal QA 目前不可用

**尚未定版：**

- `video_segments_text` canonical 欄位口徑：已定版為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）；DB 文件、backend model/service、vector index filter 三者一致（2026-04-19）
- `video_segments_video` 的 Atlas vector index（若要開 multimodal QA，需補建 `video_embedding_index`，3072 維 cosine，filter field：`video_id`）
- `videos` mixed collection 的 ownership 邊界（6 筆 pipeline-owned 無 `sourceType`，3 筆 app-owned 有 `sourceType: "upload"`）
- Collections 實際 12 個，init 腳本宣稱 14，落差說明由 Database 組負責
- shared DB 是否允許 smoke 痕跡（`usage_logs` 目前已有 23 筆）

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| `video_segments_text` 文件遷移 | **Done（2026-04-19）** | 105 筆文件已遷移為 camelCase；`videoId_1`、`segmentId_1` regular index 現在對應真實欄位，不再是孤立索引 |
| Pipeline STT 產出 schema 確認 | **Pipeline** | 確認後續 STT 產出改為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`），與現有 backend schema 對齊 |
| `video_segments_video` vector index | **Database** | 若 Phase-2 要開 multimodal QA，在 Atlas 補建 `video_embedding_index`（`video_segments_video`，numDimensions: 3072，similarity: cosine，filter field: `video_id`）；M0 剩 2 個配額 |
| `videos` ownership 邊界 | **Database + Backend** | 三選一：(a) 為 pipeline-owned 文件補 `sourceType: "pipeline"` 欄位；(b) 將 pipeline metadata 拆到獨立 collection；(c) 在 backend model 加 `sourceType` 欄位並更新 `video.service.js` 查詢邏輯 |
| Collections 12 vs 14 落差 | **Database** | 說明 init 腳本多宣稱的 2 個 collection 是哪些、是否需要建立 |
| `usage_logs` smoke 痕跡 | **整體決策** | 三選一：(a) demo 前 reseed 清除；(b) 另開隔離 demo DB instance；(c) 接受共享 DB 現況並在 demo 說明 |

**backend 目前已採取的行為：**

- `QA_VECTOR_SEARCH_MODE=atlas` 已生效，缺 index 或 aggregate 失敗會直接 fail-fast（不靜默回 memory）
- atlas filter 僅使用 vector index 支援欄位（`courseId` ObjectId、`videoId` camelCase）；`video_id` snake_case 已排除（文件已全面遷移為 camelCase）
- pipeline metadata 只拿來做 QA bridge，不當正式 app-owned video 使用

---

### AI / Pipeline 協作缺口

**已定版：**

- query embedding provider：`gemini`（`gemini-embedding-2-preview`，3072 維），與 STT pipeline 一致
- `video_segments_text`：105 筆，全部有 embedding，欄位為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）；DB 文件遷移已於 2026-04-19 完成
- `videoId` 確認為 canonical（camelCase）；`segmentId` 值為 null，實際識別碼為 `chunkId`（如 `video_001_chunk_0001`）

**仍未定版：**
- 哪些影片目前真的已有 searchable coverage（目前全數 105 筆均屬 Pipeline Bridge Course）
- `clips` 與 `video_segments_video` 的正式分工（`clips` 目前只有 1 筆）

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| `videoId_1` 索引 | **Done（2026-04-19）** | 文件遷移後 `videoId_1` 已對應真實欄位，不再是孤立索引；無需額外清除動作 |
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

**已確認（2026-04-21 教授開會）：**

- LINE Bot 不完全整合進網頁：網頁負責影片觀看，LINE Bot 負責問答，各自角色獨立
- 影片採 YouTube 託管：利用 YouTube embed 追蹤觀看狀態；LINE Bot 回覆含時間戳的 YouTube 連結
- 禁止學生直接上傳影片（版權考量）：改用分享連結（如 YouTube URL）
- LINE 綁定流程：現階段一次性 token 可接受；未來前端以 QR Code 顯示（含課程 ID）

**尚未定版：**

- bridge course 在 UI 上要隱藏、標示 `QA-only`，還是做 metadata-only 呈現
- 是否要把 degraded / backend-only 訊號直接顯示在畫面上
- demo 口徑是否接受 bridge course 只作 QA scope，不當完整影片課程

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| Frontend API 整合 | **Frontend** | 第一階段頁面 UI 已完成（2026-04-21）；下一步串接登入、課程列表、QA 問答、LINE 綁定 API |
| LINE 綁定 QR Code 頁面 | **Frontend** | 呼叫 `POST /api/v1/line/bind-token`，以 QR Code 顯示 token（或直接顯示供使用者輸入）；Backend 側 API 已就緒 |
| YouTube embed 整合 | **Frontend** | 影片頁改用 YouTube embed；QA 回答含時間戳時，連結格式為 `https://youtu.be/<id>?t=<sec>` |
| bridge course UI 策略 | **Frontend** | 決定三選一：(a) 課程列表隱藏 bridge course；(b) 顯示但標示「QA only」badge；(c) 顯示且允許進入，只是影片頁回 metadata-only 提示。決定後通知 Backend，若需要新 API 欄位再補 |
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
