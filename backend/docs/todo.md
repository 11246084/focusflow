# Backend TODO

最後更新：2026-05-23

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

### -1. 2026-05-07 已完成（dashboard / QA 平行化 + 刪除 cascade 收斂 + display 分流）

- **狀態**：Done（2026-05-07）
- **完成內容**：
  - ✅ `teacherStats.service.js` `getStudentDashboardStats` / `getTeacherDashboardStats` 改為兩輪 `Promise.all`，所有 `find()` 加 `.lean()`；學生 dashboard 從 1.6–2.4s 降到 ~0.8–1s
  - ✅ `qa.service.js` 三處平行：`assertCanAccessCourse + collectScopedVideos`、`generateAnswer + findCachedClip`、`recordQuestion + clipLog`；`loadScopedSearchableSegments` 加 `.lean()`（51 segments 從 8.8s 降到 ~1s）
  - ✅ 新增 `[qa-timing]` 7 段診斷 log；`QA_TIMING=off` 可關閉，`NODE_ENV=test` 自動靜音
  - ✅ 教師可刪自己課程：route 放寬到 TEACHER + ADMIN，service 仍限 admin 或 owner teacher；前端 `TeacherCourses.jsx` 加刪除按鈕 + cascade modal
  - ✅ 刪除 cascade 範圍收斂：`deleteVideo` / `deleteCourse` cascade 清 Video / Segment / transcripts / `course.videoIds $pull` / `Enrollment` / `User.activeCourseId $unset`；**撤銷** UsageLog / Question cascade（保留歷史紀錄）
  - ✅ Display 層分流：老師 Top Segments 過濾「(已刪除影片)」；學生 Recent Queries / 管理員 Recent Events 顯示「內容已下架」badge
  - ✅ QA 拒答無 live video 的課程；LINE 課程選單 `filterCoursesWithLiveVideos()` 過濾沒有 live video 的課程
  - ✅ STT pipeline `mongodb_uploader._target_video_exists()` race-condition guard
  - ✅ 一次性孤兒清理腳本 `context/cleanup-orphan-data.js`（只清 segments / `course.videoIds`）
  - ✅ `INVALID_ENCODING` (400) 錯誤碼 + `utils/textEncoding.js`；學生 dashboard 舊壞編碼 fallback「(編碼異常)」
  - ✅ AI prompt / 標題防 ObjectId 洩漏：`answerGeneration.service.js` 移除 `match.videoId` fallback；`getVideoPresentationTitle` 偵測 ObjectId 改顯示 `YouTube: <id>`
  - ✅ 教師上傳表單支援多支影片連續上傳（移除 `uploadDone` 鎖、POST 後自動清空輸入）
  - ✅ Top Queried Segments 合併同影片不同 segment count；Recent Videos 改穩定 recency 排序
  - ✅ Admin Total Users 描述補 `adminCount`
  - ✅ `StudentCourses.jsx` `resolveVideoPlayback()`：YouTube 一律用 iframe，metadata-only 不再 fallback `/uploads`
- **驗收**：`npm test` 83/83 passed；frontend `npm run build` ok

---

### 0. 修正 QA 測試與 student dashboard questions 統計

- **狀態**：Done（2026-05-06）
- **完成內容**：
  - `teacherStats.service.js#getStudentDashboardStats` 將 `visibleQuestionFilter` 由 `studentId` 改為 `userId`，與 Question schema 與 `recordQuestion()` 寫入欄位對齊。
  - 新增 `tests/teacherStats.service.test.js`，鎖定 `totalQueries` / `weeklyQueries` / `answerRate` / `recentQueries` 以 `userId` 為過濾依據，並排除非本人 question。
  - 更新 `tests/qa.routes.test.js`：access denial 場景改用非擁有者 teacher 對 draft 課程提問（學生在 demo 模型下不再被拒）；`matches[]` expected key set 補上 `videoTitle`。
  - 更新 `tests/course-video.routes.test.js`：學生課程列表 expected 改為僅 `publishedCourse`；新增的 `foreignPublishedCourse` 對學生改為 `true`；`gets a course by id` 的 denial 場景改為非擁有者 teacher 取得 `foreignDraftCourse`，並補一筆學生 200 的 relaxed assertion。
- **驗收結果**：
  - `tests/qa.routes.test.js` 8 passed / 0 failed
  - `tests/course-video.routes.test.js` 20 passed / 0 failed
  - `tests/line.routes.test.js` 14 passed / 0 failed
  - `tests/docs.routes.test.js` 2 passed / 0 failed
  - `tests/teacherStats.service.test.js` 1 passed / 0 failed

---

### 1. 發起 phase-1 契約 Freeze 會議

- **狀態**：Pending（由我發起）
- **要 freeze 的議題**：
  - ~~Atlas vector index 重建排程~~（已解決：2026-05-23 驗證 `text_embedding_index` READY；改為監控「避免再次被重置」即可）
  - Atlas filter fields 契約（`video_segments_text` 目前使用 camelCase `videoId`；`video_segments_video` 仍為 snake_case `video_id`）
  - `videos` collection ownership 邊界（app-owned vs. pipeline metadata 要拆分還是加 `sourceType`）
  - pipeline segments 如何綁定 course（加 `courseId` / 改查 camelCase `videoId` 三擇一）
  - Collections / init 腳本不同步（Atlas 13 個；`init_collections.js` 列 15 個，且缺 `questions`）
- **我要主動做**：
  - 彙整上述議題為一頁議題單
  - 約 Database、RAG 兩組同步時間
  - 會後把結論寫進 [handoff-known-issues.md](./handoff-known-issues.md) 並同步 [current-state.md](./current-state.md)
- **等誰**：Database、RAG 兩組到齊
- **等待期間可先做**：起草議題單；列出 backend normalize 目前相容的欄位範圍

---

### 2. 決定 demo DB 隔離策略

- **狀態**：Pending（需協調各組拿出決定）
- **背景**：2026-05-01 共享 Atlas 中 `usage_logs` 有 7 筆，`line_bind_tokens` 目前 0 筆。
- **我要主動做**：
  - 提議三選一：(a) 共享 Atlas 只讀 + 另開隔離 demo instance (b) 保留共享 Atlas 但 demo 前 reseed (c) 完全獨立 demo DB
  - 估算每個選項對 backend `.env`、seed script、CI 的影響
- **等誰**：Database 組 + 整體 demo 決策
- **對方需先交付**：Atlas 管理員可提供的 demo 環境選項

---

### 3. 確認 Atlas vector search index 健康狀態 + 修正 atlas filter 兩處 bug

- **狀態**：Done（2026-05-23 直連驗證：索引 READY）
- **完成內容**：
  - 2026-04-19：`text_embedding_index` 當時狀態 READY，105/105 筆 100% 索引
  - 2026-05-01：曾觀察到共享 Atlas 無 search/vector index（資料被重置）
  - **2026-05-23：MCP `$listSearchIndexes` 直連驗證 `text_embedding_index` 已存在且 READY/queryable（3072 維 cosine，filter=`courseId`+`videoId`，3 shards 全 READY）；`video_segments_text` 130 筆、`videos` 16 筆；atlas mode 可正常檢索**
  - M0 free cluster：vector indexes 1 of 3 used，剩 2 個配額
  - backend `.env` 已設定 `QA_VECTOR_SEARCH_MODE=atlas`、`QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`
  - 修正 Bug 1：`$vectorSearch` 不經 Mongoose auto-cast，`courseId` String 需手動轉 ObjectId（`castCourseIdToObjectId`）
  - 修正 Bug 2：atlas filter 僅允許 vector index 支援欄位；後續 DB 已遷移為 camelCase `videoId`
  - `video_segments_text` 現行文件欄位為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）；2026-05-01 共享 Atlas 目前 9 筆
  - `videoSegment.model.js` 已對齊 camelCase schema
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

- **狀態**：Done（2026-05-23：前端 11 頁全數串接 backend API）
- **後端側**：Done — 登入、課程、QA、影片、LINE bind、`/health` 全數可用
- **Frontend 側**：Done — 11 個頁面（Student/Teacher/Admin）每頁皆呼叫 `apiFetch`（共 42 處），demo 已實際執行過
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

### 10. Collections / init 腳本對齊

- **狀態**：Need Confirmation（低優先）
- **背景**：2026-05-01 MCP 實測共享 Atlas 為 13 collections；`database/tools/setup/init_collections.js` 目前列 15 個 collection。init 有但 Atlas 沒有：`stt_cache`、`raw_transcripts`、`video_segments`；Atlas 有但 init 沒有：`questions`。
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

### 12. STT Pipeline 自動化整合 + YouTube URL MVP（2026-05-05 更新）

- **狀態**：Done
- **完成內容**：
  - `video.service.js`：本機影片上傳後自動 spawn STT pipeline；YouTube URL 影片走 `/courses/:courseId/videos/youtube`
  - `Video` schema：新增 `youtubeVideoId`，並移除不再使用的 `storagePath`
  - `STT_Whisper/src/main.py`：支援 `--video-path`、`--video-id`、`--youtube-url`；新增 `notify_backend()` webhook 回報；STT 完成後自動執行 `mongodb_uploader.py`
  - `STT_Whisper/src/main.py`：YouTube URL 模式用 `yt-dlp` 下載音訊，並可 fallback 到 `imageio-ffmpeg` 內建 FFmpeg
  - `STT_Whisper/src/config.py`：新增 `backend_url`、`processing_webhook_secret`、`target_video_path`、`youtube_url`
  - `STT_Whisper/src/scan_videos.py`：支援 `target_video_path` 直接指定單一影片
  - `STT_Whisper/.env.example`：新增 `BACKEND_URL`、`PROCESSING_WEBHOOK_SECRET`
  - `STT_Whisper/requirements.txt`：新增 `yt-dlp`
  - `mongodb_uploader.py`：YouTube 影片回寫 MongoDB 時不覆蓋 `title`、`fileName`、`filePath`、`audioPath`
  - `qa.service.js` / `line.service.js`：YouTube 影片可產生 `https://youtu.be/<youtubeVideoId>?t=<sec>` timestamp link
  - `StudentCourses.jsx`：YouTube iframe 改用 IFrame API，QA timestamp 可 `seekTo()`

---

### 14. Question 記錄與 dashboard 統計（2026-04-30 完成）

- **狀態**：Done
- **完成內容**：
  - 新增 `models/question.model.js`：`questions` collection，含 matches、runtime、`sourceUsageLogId`、text/組合索引
  - 新增 `services/questionRecording.service.js`：QA 與 LINE 路徑提問都會落庫
  - 新增 `services/teacherStats.service.js`：聚合教師/學生 dashboard 數據
  - 新增 `routes/stats.routes.js`：`/api/v1/stats/teacher`、`/api/v1/stats/student`
  - 新增 `routes/admin.routes.js` + `services/admin.service.js`：`/api/v1/admin/{stats,users,videos,events,event-stats}`
  - 新增 `db:sync-atlas`（可用，執行 `syncLocalMongoToAtlas.js`，同步清單包含 `questions`）
  - 新增 `syncQuestionsToAtlas.js`（可直接用 node 執行，單獨同步 questions 到 Atlas；目前未掛 npm script）
- **後續修正**：
  - `db:ensure-questions`、`db:backfill-questions` 目前是 dangling scripts，對應 `ensureQuestionsCollection.js` / `backfillQuestionsFromUsageLogs.js` 不存在；需補檔或從 `package.json` 移除

---

### 17. OpenAPI 對齊 stats / admin / PATCH / DELETE

- **狀態**：Done（2026-05-23）
- **背景**：`backend/docs/openapi.yaml` 已掛在 `/docs`，先前未涵蓋 `/api/v1/stats/teacher|student`、`/api/v1/admin/*`，也缺 `PATCH/DELETE /api/v1/courses/:courseId`、`POST /api/v1/courses/:courseId/videos/:videoId/watched` 與 `DELETE /api/v1/videos/:videoId`。
- **完成內容**：
  - 補上 `Stats`、`Admin` 兩個 tag 與 13 個未記錄端點（stats×2、admin×7、courses PATCH/DELETE、videos DELETE、watched），沿用既有 `$ref` 共用 response 元件
  - `info.description` 標註本 spec 已涵蓋主要端點但仍非 100% 完整契約（internal processing webhook 等少數端點以 route files 為準）
- **驗收**：`npm test` 87/87；`docs.routes.test.js` 通過，Swagger UI 能載入 raw spec

---

### 18. 修正 dangling DB npm scripts

- **狀態**：Pending
- **背景**：`backend/package.json` 目前掛了 `db:ensure-questions` 與 `db:backfill-questions`，但 `src/scripts/ensureQuestionsCollection.js`、`src/scripts/backfillQuestionsFromUsageLogs.js` 不存在，執行會失敗。
- **我要主動做**：
  - 二選一：補齊兩個 script，或移除 package scripts 並改文件說明由 Mongoose schema / `db:sync-atlas` 處理
  - 若保留 `syncQuestionsToAtlas.js`，決定是否補 npm script（例如 `db:sync-questions-atlas`）
- **驗收**：`npm run` 顯示的 DB scripts 都可執行或文件明確標示用途

---

### 15. LINE QR 綁定 + 課程交接修正（2026-04-30 完成）

- **狀態**：Done（commit `c87fdad`）
- **完成內容**：修正 LINE QR 綁定流程與課程切換 handoff

---

### 16. QA grounding / matched video 標籤（2026-04-30 完成）

- **狀態**：Done（commit `c819bca`）
- **完成內容**：QA 回答的 grounding metadata 與 matched video 標籤改善

---

### 13. YouTube Data API 自動上傳整合

- **狀態**：Pending
- **已完成前置**：YouTube URL MVP 已完成；教師可先手動上傳 YouTube（建議設為不公開 unlisted）後貼 URL，系統會保存 `youtubeVideoId` 並啟動 STT
- **背景**：下一步若要讓老師只上傳本機影片，由 backend 自動上傳 YouTube，才需要接 YouTube Data API v3
- **我要主動做**：
  - `video.service.js` 上傳後呼叫 YouTube Data API v3，影片設為 unlisted
  - 取得 YouTube video id 後存入 `Video.youtubeVideoId` / `videoUrl`
  - 本機影片 STT 完成後可刪除 `backend/uploads` 原始檔（需先確認 demo / rollback 策略）
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
