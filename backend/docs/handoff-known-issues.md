# Handoff / Known Issues

最後更新：2026-05-05（依後端交接盤點重新對照程式碼）

這份文件只整理 backend 無法單獨定版、但目前已在 backend 內明確化的問題，以及交接與 demo 期間的暫時應對方式。

## 尚未解決但已明確化的問題

### DB / MongoDB 協作缺口

**2026-05-01 更新：共享 Atlas 已被重置**

- `videos` 從 9 → 1 筆，`video_segments_text` 從 105 → 9 筆，內容只剩單一新上傳影片的 chunks
- Atlas Search / Vector Search Index 全數消失（Atlas UI 與 MCP 都驗證），`text_embedding_index` 目前不存在
- 後果：`.env` 仍是 `QA_VECTOR_SEARCH_MODE=atlas` 但會 fail-fast；要恢復 atlas mode 需在 Atlas 重建 `text_embedding_index`（3072 維 cosine，filter：`courseId` ObjectId、`videoId` camelCase）
- 應對：先切 `QA_VECTOR_SEARCH_MODE=memory` 即可在現有 9 筆 segments 上跑 QA

**已確認（2026-04-19，舊快照保留作參考）：**

- Atlas `text_embedding_index`：當時狀態 READY，105/105 筆 100% 索引
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
- `videos` mixed collection 的 ownership 邊界；共享 Atlas 目前只剩 1 筆 app-owned video，舊快照曾同時存在 pipeline-owned 與 app-owned records
- Collections / init 腳本不同步：共享 Atlas 目前 13 個 collections；`database/tools/setup/init_collections.js` 列 15 個。init 有但 Atlas 沒有：`stt_cache`、`raw_transcripts`、`video_segments`；Atlas 有但 init 沒有：`questions`
- shared DB 是否允許 smoke 痕跡（`usage_logs` 目前 7 筆）

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| `video_segments_text` 文件遷移 | **Done（2026-04-19）** | 105 筆文件已遷移為 camelCase；`videoId_1`、`segmentId_1` regular index 現在對應真實欄位，不再是孤立索引 |
| Pipeline STT 產出 schema 確認 | **Pipeline** | 確認後續 STT 產出改為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`），與現有 backend schema 對齊 |
| `video_segments_video` vector index | **Database** | 若 Phase-2 要開 multimodal QA，在 Atlas 補建 `video_embedding_index`（`video_segments_video`，numDimensions: 3072，similarity: cosine，filter field: `video_id`）；M0 剩 2 個配額 |
| `videos` ownership 邊界 | **Database + Backend** | 三選一：(a) 為 pipeline-owned 文件補 `sourceType: "pipeline"` 欄位；(b) 將 pipeline metadata 拆到獨立 collection；(c) 在 backend model 加 `sourceType` 欄位並更新 `video.service.js` 查詢邏輯 |
| Collections / init 腳本不同步 | **Database + Backend** | 決定 `stt_cache`、`raw_transcripts`、`video_segments` 是否仍需建立；將 `questions` 補進 init，或明確改由 Mongoose/runtime 建立 |
| `usage_logs` smoke 痕跡 | **整體決策** | 三選一：(a) demo 前 reseed 清除；(b) 另開隔離 demo DB instance；(c) 接受共享 DB 現況並在 demo 說明 |

**backend 目前已採取的行為：**

- `QA_VECTOR_SEARCH_MODE=atlas` 已生效，缺 index 或 aggregate 失敗會直接 fail-fast（不靜默回 memory）
- atlas filter 僅使用 vector index 支援欄位（`courseId` ObjectId、`videoId` camelCase）；`video_id` snake_case 已排除（文件已全面遷移為 camelCase）
- pipeline metadata 只拿來做 QA bridge，不當正式 app-owned video 使用
- `videos` 新資料以 camelCase 欄位為主；`storagePath` 已從 schema 移除，`videos.video_id` 僅作 legacy 讀取相容

---

### AI / Pipeline 協作缺口

**已定版：**

- query embedding provider：`gemini`（`gemini-embedding-2-preview`，3072 維），與 STT pipeline 一致
- `video_segments_text`：2026-04-19 舊快照為 105 筆且全部有 embedding；2026-05-01 共享 Atlas 重置後目前為 9 筆，欄位為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）
- `videoId` 確認為 canonical（camelCase）；`segmentId` 值為 null，實際識別碼為 `chunkId`（如 `video_001_chunk_0001`）

**仍未定版：**
- 哪些影片目前真的已有 searchable coverage（2026-05-01 共享 Atlas 目前僅 1 支影片 / 9 筆 segments，均屬 Pipeline Bridge Course；先前 105 筆快照已不再存在）
- `clips` 與 `video_segments_video` 的正式分工（`clips` 目前只有 1 筆）

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| `videoId_1` 索引 | **Done（2026-04-19）** | 文件遷移後 `videoId_1` 已對應真實欄位，不再是孤立索引；無需額外清除動作 |
| searchable coverage 範圍 | **Pipeline** | 說明目前 105 筆 segments 對應的是哪幾支影片、哪幾門課；若其他課程要有 QA coverage，需明確排定影片處理時程 |
| `clips` 與 `video_segments_video` 分工 | **Pipeline + Backend** | 決定 Phase-2 clip source：(a) `clips` collection 繼續作為 clip cache；(b) 由 `video_segments_video` 直接提供 clip path；決定後 Backend 更新 `findCachedClip` 邏輯 |

**backend 目前已採取的行為：**

- `.env` 仍可設定 atlas，但共享 Atlas 目前缺 `text_embedding_index`；實務 QA 需切 memory 或先重建 index
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
- repo 目前實際存在的是 webhook + bind-token/message QR 流程；LIFF endpoints / pages 尚未實作，不能把 `context/LIFF_QRCode_實作紀錄.md` 當成已上線狀態

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| ngrok URL 不固定 | **DevOps / 整體** | demo 前確認 ngrok 已啟動並更新 LINE Developers Console Webhook URL；正式環境決定部署目標（Railway / Render / 自建 VPS），改用固定 HTTPS domain |
| 學生綁定代碼 | **Frontend** | 實作登入後的綁定頁面，呼叫 `POST /api/v1/line/bind-token` 取得代碼，搭配 QR Code 顯示；Backend 側 API 已就緒，不需修改 |
| LIFF 方案 | **Frontend + Backend** | 若決定改走 LIFF，需新增前端 LIFF pages、`@line/liff`、後端 `liff-bind` / `liff-switch-course` endpoints 與測試 |

---

### STT Pipeline 自動化 / YouTube 整合狀態

**已完成：**

- `video.service.js` 影片上傳後自動 spawn STT pipeline（背景執行，不阻擋 HTTP 回應）
- STT pipeline 新增 `--video-path`、`--video-id` CLI 參數
- STT pipeline 新增 `--youtube-url` CLI 參數，YouTube URL 模式會用 `yt-dlp` 下載音訊
- STT pipeline 透過 `POST /api/v1/internal/videos/:id/processing/start|complete|fail` 回報狀態
- STT pipeline 完成後自動執行 `mongodb_uploader.py` 寫入 `video_segments_text`
- `STT_Whisper/.env.example` 新增 `BACKEND_URL`、`PROCESSING_WEBHOOK_SECRET`
- `Video.youtubeVideoId` 已新增
- `POST /api/v1/courses/:courseId/videos/youtube` 已新增
- QA / LINE 可回傳 YouTube timestamp link
- 學生端 YouTube iframe 可用 IFrame API 跳轉 timestamp

**尚未實作（需補）：**

- backend 自動上傳 YouTube（YouTube Data API v3）尚未實作；目前是教師手動上傳 YouTube 後貼 URL
- backend/uploads 原始 mp4 自動清理尚未實作
- LINE Bot 的 YouTube timestamp link 與前端 iframe timestamp seek 已接入，但仍需實機 smoke 記錄

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| YouTube 自動上傳 | **Backend** | 本機上傳影片後呼叫 YouTube Data API v3，影片設為 unlisted，取得 ID 存入 `youtubeVideoId` |
| OAuth 憑證 | **專案負責人** | 提供 FocusFlow Google 帳號的 YouTube API OAuth 憑證給後端 |
| uploads 清理 | **Backend + Pipeline** | YouTube 流程穩定後，補 STT 完成後清除本機原始 mp4 的策略 |

注意：本機 upload 影片目前仍透過 `sourceUrl=/uploads/<file>` 給前端 `<video>` 播放；除非改為 YouTube / object storage，否則不能把 `backend/uploads/` 當純 pipeline input 清掉。

---

### 測試與 dashboard 統計缺口

**已確認（2026-05-05 實跑）：**

- `tests/qa.routes.test.js` 目前 5 passed、3 failed。
- `tests/course-video.routes.test.js` 目前 18 passed、2 failed。
- `tests/line.routes.test.js` 目前 14 passed；`tests/docs.routes.test.js` 目前 2 passed。
- 失敗原因：
  - 學生 demo 權限已放寬為可進入 published 課程，但舊測試仍期待 enrollment-only / 403。
  - QA match response 已補 `videoTitle`，舊測試仍期待只有 `segmentId/videoId/startSec/endSec/transcript/score`。
- `teacherStats.service.js` student dashboard 問題統計使用 `studentId` 查 `questions`，但 `Question` schema 實際欄位是 `userId`；這會讓 question counts / recent questions 可能查不到資料。

**應採取的行動：**

| 項目 | 誰做 | 具體動作 |
|------|------|----------|
| `qa.routes.test.js` | **Backend** | 依目前 demo 權限更新 student access expected，並接受 `matches[].videoTitle` / YouTube link 欄位 |
| `course-video.routes.test.js` | **Backend** | 依目前 demo 權限更新學生課程列表與詳情 expected |
| Student dashboard question 統計 | **Backend** | 將 `teacherStats.service.js` 的 `visibleQuestionFilter.studentId` 改為 `userId`，補 route/service 測試 |

**STT_Whisper/.env 需手動補上：**
```
BACKEND_URL=http://localhost:4000
PROCESSING_WEBHOOK_SECRET=（與 backend/.env 相同的值）
```

**STT_Whisper/.venv 注意事項：**

- `.venv` 必須建立在 `STT_Whisper/.venv`
- backend 會優先使用 `STT_Whisper/.venv/Scripts/python.exe`
- 若 `.venv` 建在 repo 根目錄，backend 可能 fallback 到系統 Python，導致 faster-whisper / pymongo / yt-dlp 找不到
- 不要上傳 `.venv` 到 GitHub；請用 `requirements.txt` 重建

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
| demo 口徑 | **整體（Demo 決策）** | 在 demo 前統一說法：bridge course 是「已索引影片的 QA demo」，不是「完整上傳流程的 demo」 |

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
