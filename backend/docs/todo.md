# Backend TODO

最後更新：2026-08-08

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
- **驗收**：`npm test` 83/83 passed；frontend `npm run build` ok（當輪結果；最新 backend 全測試見 2026-07-10 記錄）

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

### 0.1. Phase 2 QA 回傳契約收斂

- **狀態**：Done（2026-07-10）
- **完成內容**：
  - `/api/v1/qa/ask` 新增 `citations[]`，包含 `citationId`、source video、timestamp、jump URL、match score/confidence 與 transcript snippet。
  - `/api/v1/qa/ask` 新增 `answerStatus`，包含 `answered/no_answer`、`isAnswerable`、`matchStatus`、`confidence`、`noAnswerReason`。
  - `matches[]` 保留為 legacy/debug 相容欄位，並補齊 legacy `video_id` → source video metadata lookup。
  - LINE 回覆摘要優先使用 `citations[]` 的 timestamp / jump URL。
  - OpenAPI `QaAskResponse` 已補 `citations`、`answerStatus` schema。
- **驗收**：`qa.routes.test.js` / `qa.service.test.js` 已新增契約 assertions；全測試結果見本輪驗證。

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
  - `video_segments_video`：有 embedding，`video_embedding_index` 已 READY；backend 已從 course-scoped videos 的檔名 / URL 解析 `video_001` 類 visual ID 並接入初版 course-scoped visual citation retrieval。限制：視覺片段目前沒有 transcript / caption，不提供畫面內容生成
  - `video_segments_audio`：0 docs，無 vector search index

---

### 4. query embedding Gemini provider

- **狀態**：Done（2026-04-19）
- **完成內容**：
  - `.env` 已設定 `QA_QUERY_EMBEDDING_PROVIDER=gemini`
  - Backend `queryEmbedding.service.js` 已切換 stable `gemini-embedding-2`（3072 維、文字 instruction、無 task type）；Pipeline／Database preview vectors 仍待跨組重建與 read-only compatibility evidence
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

- **狀態**：Done（2026-07-10）
- **完成內容**：
  - `.env.example` 補 `ALLOWED_ORIGINS`
  - `app.js` 改用 `buildCorsOptions()`；未設定時保留開發相容，設定後只允許白名單 origins
  - `tests/cors.config.test.js` 鎖住未設定、允許 origin、拒絕 origin 三種情境
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
  - `db:ensure-questions`、`db:backfill-questions` 已於 2026-07-10 補齊實體 script；`db:backfill-questions` 預設 dry-run

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

- **狀態**：Done（2026-07-10）
- **完成內容**：
  - 新增 `src/scripts/ensureQuestionsCollection.js`：建立 `questions` collection 並同步 schema indexes。
  - 新增 `src/scripts/backfillQuestionsFromUsageLogs.js`：從 legacy ASK usage logs 找出缺失 question records；預設 dry-run，需加 `--write` 才會寫入。
  - README / current-status / current-state 已同步說明兩個 script 的用途與安全預設。
- **驗收**：`node --check` 通過；實際 DB 寫入需由維運者明確執行 `npm run db:backfill-questions -- --write`

---

### 19. QA 監控與成本控制 guardrails

- **狀態**：Done（2026-07-10）
- **完成內容**：
  - 新增 `costControl.service.js`：以 UTC calendar month 為重置週期，檢查全站 QA 月 token budget 與單一使用者月 quota。
  - 新增 env：`QA_ESTIMATED_TOKENS_PER_ASK`、`QA_MONTHLY_TOKEN_BUDGET`、`QA_USER_MONTHLY_TOKEN_QUOTA`；任一 quota 設為 `0` 表示該 scope 不限制。
  - `/api/v1/qa/ask` 會在 embedding / LLM 前做 quota preflight；超額回 `429 QA_QUOTA_EXCEEDED`，不呼叫外部 AI provider。
  - 成功 ASK 會在 `UsageLog.metadata.costControl` 保存當月 quota snapshot；`/health.runtime.qa.costControl` 可觀察目前設定。
- **驗收**：`health.routes.test.js`、`qa.service.test.js`、`qa.routes.test.js` 已補 guardrail assertions。

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

- **狀態**：Live 驗證通過（2026-08-02）
- **已完成**：
  - `youtubeUpload.service.js`：支援 OAuth refresh token、短期 access token override、YouTube Data API v3 resumable upload、預設 `unlisted`
  - 刪除轉 private（2026-08-02，教授決議）：`setVideoPrivacy` / `privatizeVideoOnDelete` / `privatizeVideosOnDelete`，接在 `deleteVideo` 與 `deleteCourse`；只處理自家頻道影片，失敗不中斷刪除；`YOUTUBE_PRIVATIZE_ON_DELETE` 可停用
  - Live 端對端驗證（2026-08-02）：上傳後影片以 unlisted 出現在 FocusFlow 頻道，系統刪除後 YouTube Studio 顯示「私人」；backend 316/316 tests
  - `video.service.createCourseVideo()`：`YOUTUBE_AUTO_UPLOAD_ENABLED=true` 時，本機檔案上傳後先寫入 YouTube，再把 `youtubeVideoId` / `videoUrl` / `sourceUrl` 寫回 app-owned `Video`
  - `.env.example`：補 `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET` / `YOUTUBE_OAUTH_REFRESH_TOKEN` / `YOUTUBE_UPLOAD_PRIVACY_STATUS` 等設定
  - 測試：`youtube-upload.service.test.js`、`course-video.routes.test.js` auto-upload branch；2026-07-10 `npm.cmd test` 103/103
- **仍需**：
  - ~~OAuth 同意畫面從 Testing 切到正式發布 + 重換 refresh token~~（✅ 2026-08-02 完成，token 已驗證可換發 access token、scope `youtube.force-ssl`）
  - ~~`/health` 補 YouTube 憑證狀態指標~~（✅ 2026-08-02 完成：`/health.runtime.youtubeUpload`，含 scope 檢查與最後一次轉 private 結果）
  - playlist / Shorts 發布策略定版
  - 本機原始檔自動清理需等 YouTube/cloud + processing retry 策略穩定後再開

---

### 20. `video_segments_video` 初版 visual citation retrieval

- **狀態**：Done（2026-07-10）
- **完成內容**：
  - 新增 `videoSegmentVideo.model.js` 對應 `video_segments_video` snake_case 文件。
  - `bridgeScope.service.js` 可從 course-scoped videos 的 `fileName` / `sourceUrl` / `videoUrl` 等欄位解析 `video_001`、`video_001_part_0001` 類 pipeline visual ID。
  - `qa.service.js` 在文字 segments 無命中時，以 Atlas `video_embedding_index` + `video_id` filter 檢索同課程視覺片段。
  - QA response 的 `matches[]` / `citations[]` 會標示 `modality=video`，並回 `clipPath`、timestamp、score、runtime `matchModality=video`、`visualSearch` diagnostics。
  - 視覺片段沒有 transcript / caption 時使用保守 template answer，只提示找到相關影像片段與 citation，不讓 LLM 編造畫面內容。
- **驗收**：`qa.service.test.js` 新增 course-scoped visual match 測試；2026-07-10 `npm.cmd test` 103/103。
- **後續可做**：若 Pipeline 提供 caption / OCR / frame description，再升級為可生成畫面內容的 multimodal answer。

---

## 本輪刻意不碰

- Frontend 程式碼
- Clip / Shorts 正式 routes、models、background worker 與發布流程（本輪只定義 contract）
- `database/` 內的 init / import 腳本（由 Database 組負責）
- `STT_Whisper/` pipeline 程式（由 RAG 組負責）
- MongoDB 內實際資料（不直接寫 Atlas，交由 Database 執行匯入）
- phase-2 功能：Clip / Shorts 正式 routes、models、background worker、caption / OCR / frame description 與 YouTube Shorts publish flow

---

## 規劃前提

- 共享 demo env 主線：`gemini + atlas + gemini + explicit seed`；isolated local smoke：`mock + memory`
- 切換任何 provider 或 vector mode 前，先跑 `qa.service.test.js` 與 route 測試
- 跨組未 freeze 的議題先用 [handoff-known-issues.md](./handoff-known-issues.md) 管住，不在 backend 單方面擴功能
- demo 口徑以 `/health` 與 API runtime 訊號為準
- 完成任一任務後同步更新 [todo.md](./todo.md)、[implementation-log.md](./implementation-log.md)、[README.md](./README.md) 的 Latest Update
