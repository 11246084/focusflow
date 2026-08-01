# FocusFlow Backend

`focusflow` phase-1 MVP 的 backend 目前已整理到可穩定 demo、可重現、可交接的狀態，但仍明確保留 phase-1 的 bridge 與協作邊界。

## Phase 2-2 Hierarchical Retrieval Round 1

本輪加入預設關閉的 `HIERARCHICAL_RETRIEVAL_ENABLED` Kill Switch，以及預設開啟的 `HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF`。Gate 關閉時完全沿用既有 Leaf-only QA；Gate 開啟但 Parent repository unavailable、timeout、無命中、文件無效或 Child expansion 無有效 Leaf 時，會安全退回 Leaf retrieval，並只在 `runtime.hierarchicalRetrieval` 保存診斷 metadata。

Round 1 已建立 Parent Search interface、離線 Fake repository、Child Expansion、deterministic Leaf deduplication、有限制的 Leaf Context Assembly，以及 Leaf Citation 相容測試。正式 Parent adapter 目前是明確的 unavailable stub：本輪沒有建立 `video_segments_parent`、沒有部署 Parent Atlas Vector Index、沒有連線真實 Parent MongoDB，也沒有修改 Frontend 或 Citation response contract。

本輪測試只證明安全整合、fallback 與契約行為，不能證明 AI 回覆品質已提升。正式 Parent Storage／Vector Search 屬於後續 Database handoff。

離線驗證：

```powershell
npm test
```

## Phase 2-2 Parent Storage（2026-08-02）

Storage 層已由 DB 組完成。共享 Atlas 上已建立 `video_segments_parent`，含 regular index `parentId_1`（unique）、`courseId_1_videoId_1`、`videoId_1_hierarchyFingerprint_1`，以及 Atlas Vector Index `parent_embedding_index`（3072 維 cosine，filter=`courseId`+`videoId`），實查為 READY/queryable。

建立與重建（冪等，既存 index 會直接略過）：

```powershell
npm run db:ensure-parent-storage -- --dry-run
```

```powershell
npm run db:ensure-parent-storage
```

相關設定（`.env.example` 已同步）：

```env
VIDEO_SEGMENT_PARENT_COLLECTION=video_segments_parent
VIDEO_SEGMENTS_PARENT_VECTOR_INDEX_NAME=parent_embedding_index
```

DB 組拍板的決策：MVP 採單一 generation，unique key 用單鍵 `parentId`（重跑同影片以 idempotent upsert 覆蓋）；`generationVersion` / `isActive` 保留欄位但不進 index 與 filter；cleanup 現階段只 upsert 不刪，正式開檢索前才啟用 guarded stale 清理；rollback 即關閉 `HIERARCHICAL_RETRIEVAL_ENABLED`。

**目前 collection 是 0 筆。** Parent uploader（AI Pipeline 組）與正式 `searchParents()` Atlas adapter（Backend 組）都尚未實作，Gate 維持關閉，不能誤稱 Hierarchical Retrieval 已可用。

## 目前真實 runtime

phase-1 當前狀態（2026-05-05）：

```env
DEMO_SEED_ENABLED=false
QA_QUERY_EMBEDDING_PROVIDER=gemini
QA_VECTOR_SEARCH_MODE=atlas
QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index
QA_ATLAS_FILTER_MODE=bridge_course_or_video
QA_ANSWER_PROVIDER=gemini
GEMINI_API_KEY=<需填入>
LINE_CHANNEL_SECRET=<需填入>
LINE_CHANNEL_ACCESS_TOKEN=<需填入>
VIDEO_SEGMENT_COLLECTION=video_segments_text
```

代表：

- query embedding 使用 Gemini（`gemini-embedding-2-preview`，3072 維），與 STT pipeline 一致
- `.env` 目前指向 Atlas vector search（`text_embedding_index`），但共享 Atlas 在 2026-05-01 驗證時已沒有該 index；除非重建 index，否則需切回 `QA_VECTOR_SEARCH_MODE=memory` 才能穩定 QA
- answer provider 是 Gemini
- LINE live 已完整驗證（`readiness=ready`、`deliveryMode=live`）
- 影片建立後可背景 spawn `STT_Whisper`；支援本機上傳與 YouTube URL MVP；STT pipeline 寫入前會檢查 Video record 是否仍存在（`mongodb_uploader._target_video_exists()`），避免教師在 pipeline 跑到一半時刪影片產生孤兒 segments
- 2026-07-12 本地影片自動上傳 YouTube：`youtubeUpload.service.js`（feature flag `YOUTUBE_UPLOAD_ENABLED` 預設關閉，需 OAuth 憑證，尚未以真實憑證 live 驗證）；教師上傳頁已收斂為單一軌道（本地檔案），貼 YouTube URL 的 API 保留但 UI 不露出
- 教師可刪自己課程：`DELETE /api/v1/courses/:id` route 放寬到 TEACHER + ADMIN，service 仍限 admin 或 owner teacher；cascade 清 Video / Segment / transcripts / `course.videoIds $pull` / `Enrollment` / `User.activeCourseId $unset`
- 歷史紀錄保留：刪 Video / Course **不**連動刪 UsageLog / Question；Display 層分流（老師 Top Segments filter；學生 Recent Queries / 管理員 Recent Events 顯示「內容已下架」badge）
- 2026-05-07 後端查詢平行化：`teacherStats.service.js` dashboard 兩輪 `Promise.all` + 全 `.lean()`；`qa.service.js` 三處平行；`loadScopedSearchableSegments` 加 `.lean()`；學生 dashboard 從 1.6–2.4s 降到 ~0.8–1s，QA segments hydration 從 8.8s 降到 ~1s
- 2026-05-07 自助註冊：新增 `POST /api/v1/auth/register`（無 auth），限 `student` / `teacher`；validation：姓名必填、email 格式、密碼 ≥ 8；email 重複 → `409 DUPLICATE_RESOURCE`；bcrypt salt=10；成功回 `201 + { token, user }` 並寫 `UsageLog event=login metadata.via=register`
- 2026-05-07 重複上傳防呆：YouTube 於 `createCourseVideoFromYouTube` 在建立前以 `(courseId, youtubeVideoId)` 查重，命中回 `409 DUPLICATE_VIDEO`；mp4 於 `createCourseVideo` 上傳完成後 SHA-256 stream-hash，命中 `(courseId, fileHash)` 既存 video → `unlinkSync` 暫存檔 → 回 `409 DUPLICATE_VIDEO`；`Video` 新增 `fileHash` 欄位 + `{ courseId, fileHash }` index
- 2026-07-12 影片多課程掛載（P1-3）：`POST /api/v1/courses/:courseId/videos/:videoId/attach|detach`；主課程記在 `video.courseId`，掛載課程用 `course.videoIds` 引用；刪影片/刪課程清所有課程引用；QA / 播放 / watched 進度支援掛載課程
- 2026-07-12 老師 Top Segments 修復（老師 #13）：課程所有影片被刪除後不再整列丟棄，改標 `contentMissing` 併同課程合併一列，前端顯示「內容已下架」badge
- 2026-07-13 學生進度 0% 修復 + 統計語意：watched 進度分母補上主課程影片、dashboard 依 `watchedVideoIds` 即時重算；學生統計卡片加「本週（最近 7 天）/ 累計」中文說明；LINE 命中影片無 YouTube 連結時改附「請到網站播放對應時間點」提示
- 2026-07-13 FAQ 快取：`faqs` collection + `faqCache.service.js` 兩層快取（正規化文字相同零 token 直接命中；query embedding 相似度 ≥ 0.95 跳過向量搜尋與 LLM），API 與 LINE 共用；影片刪除/重新處理完成/課程刪除自動清該課程快取；`GET/DELETE /api/v1/courses/:courseId/faqs`；env `FAQ_CACHE_ENABLED`（預設開）、`FAQ_CACHE_SIMILARITY_THRESHOLD`、`FAQ_CACHE_MAX_ENTRIES_PER_COURSE`
- 2026-05-07 學生 watched 進度 endpoint：新增 `POST /api/v1/courses/:courseId/videos/:videoId/watched`（學生身分），由 `course.service.markVideoWatched` 驗證影片屬該課程後 `$addToSet` 至 `Enrollment.watchedVideoIds` 並重算 `progress`；首次觀看時同步寫 `UsageLog event=WATCH metadata.videoId=...`（重複不重複寫），讓 admin Usage Statistics 的 WATCH 卡片可實際累加
- 新增 `[qa-timing]` 診斷 log（`course-lookup` / `access+videos` / `load-segments` / `embed` / `search` / `llm+clip` / `writes` / `TOTAL`）；可用 `QA_TIMING=off` 關閉，`NODE_ENV=test` 自動靜音
- startup 不會自動 seed

## 必要 env

最少需要：

- `MONGODB_URI`
- `JWT_SECRET`
- `PROCESSING_WEBHOOK_SECRET`

依 runtime 決定：

- `GEMINI_API_KEY`
  - `QA_ANSWER_PROVIDER=gemini` 時必填
- `OPENAI_API_KEY`
  - `QA_QUERY_EMBEDDING_PROVIDER=openai` 或 `QA_ANSWER_PROVIDER=openai` 時必填
- `LINE_CHANNEL_SECRET`
  - 驗 LINE webhook signature 必填
- `LINE_CHANNEL_ACCESS_TOKEN`
  - 要送出 live LINE reply 必填

## Fail-Fast 與 Fallback

### 會直接 fail-fast 的情況

- `QA_QUERY_EMBEDDING_PROVIDER` / `QA_VECTOR_SEARCH_MODE` / `QA_ANSWER_PROVIDER` 設成不支援值
- `QA_ANSWER_PROVIDER=gemini` 但缺 `GEMINI_API_KEY`
- `QA_QUERY_EMBEDDING_PROVIDER=openai` 或 `QA_ANSWER_PROVIDER=openai` 但缺 `OPENAI_API_KEY`
- `QA_VECTOR_SEARCH_MODE=atlas` 但缺 `QA_ATLAS_VECTOR_INDEX_NAME`
- `QA_VECTOR_SEARCH_MODE=atlas` 搭配 `QA_QUERY_EMBEDDING_PROVIDER=mock`
- Atlas aggregate 失敗時，回 `503 QA_ATLAS_NOT_READY`

### 目前仍保留 fallback，但會明確標記的情況

- memory ranking 無法做向量比對時，退回 lexical ranking
  - `/api/v1/qa/ask` 會回 `data.runtime.fallbacks`
- Gemini 在已正確設定 key 的前提下若臨時失敗
  - 會改用 template answer
  - `/api/v1/qa/ask` 會回 `data.runtime.fallbacks`
- LINE 在 backend-only / non-live 驗證時若缺 `LINE_CHANNEL_ACCESS_TOKEN`
  - webhook 不會假裝 live reply 已送出
  - 會回 `replySkipped=true` 與 `replyReason=line_channel_access_token_missing`

## Health 與可觀測性

`GET /health` 現在會回：

- `runtime.qa`
- `runtime.line`

可快速看出：

- 目前 QA provider / search mode / answer mode
- `runtime.qa.readiness`
  - `ready`
  - `hard_fail`
- `runtime.qa.readyForAsk`
- `runtime.qa.warnings`
- `runtime.qa.hardFailures`
- Atlas index 是否有配置
- Gemini / OpenAI key 是否已配置
- LINE live flow 是否真的 ready
- `runtime.line.readiness`
  - `ready`
  - `degraded`
  - `hard_fail`
- `runtime.line.deliveryMode`
  - `live`
  - `backend_only`
  - `disabled`
- `runtime.line.degradedReasons`
- `runtime.line.hardFailures`

## QA API

### 目前最小 bridge contract

`course.videoIds -> videos._id | videos.videoId | videos.video_id -> video_segments_text.videoId`

`bridgeScope.service.js` 會把同一支影片的 `_id`、`videoId`、`video_id` 三種 key 全部放進 allowed set，命中任一即納入 scope（`video_id` 是 legacy 相容讀取）。

實務分佈（2026-07-25 實查）：**app-owned 影片沒有 `videoId` 欄位**，pipeline 直接把 `String(videos._id)` 寫進片段的 `videoId`；只有 pipeline metadata 影片才帶 `videoId` / `video_id`。手動查 collection 時要用 `String(videos._id)` 對 `video_segments_text.videoId`，用 `videos.videoId` 會全部對不到。

### `/api/v1/qa/ask` 現在的可觀測欄位

成功與 no-match 回應都會帶：

- `data.runtime.status`
  - `ready`
  - `degraded`
- `data.runtime.degraded`
- `data.runtime.degradedReasons`
- `data.runtime.matchStatus`
  - `matched`
  - `no_relevant_match`
  - `no_searchable_segments`
- `data.runtime.searchableSegmentCount`
- `data.runtime.searchBackendUsed`
- `data.runtime.answerProviderUsed`
- `data.runtime.course.qaScopeOnly`
- `data.runtime.course.bridgeMode`
- `data.runtime.fallbacks`

### bridge course 沒 searchable data 時的行為

若課程只有 metadata、沒有 searchable segment：

- API 仍回 `200`
- `matches=[]`
- `runtime.matchStatus=no_searchable_segments`
- answer 明確說明目前只有 bridge metadata，尚未有可搜尋片段

## Courses / Videos

`FocusFlow Pipeline Bridge Course` 目前不再是「課程列得出來，但影片清單空掉」。

課程 response 會帶：

- `qaScopeOnly`
- `bridgeMode`
- `videoCount`
- `appVideoCount`
- `bridgeVideoCount`
- `bridgeContract`
- `bridgeContractPath`

bridge course 的 `/api/v1/courses/:courseId/videos` 會回 `metadataOnly=true` 的 bridge rows。

限制：

- 這些 rows 可用於 QA scope
- 不是完整 app-owned video
- `GET /api/v1/videos/:videoId/processing` 會回 `409 VIDEO_METADATA_ONLY`

## LINE

### live 狀態（2026-04-19 已驗證）

端對端流程已在真實裝置走通：

```text
學生在 LINE 輸入問題
↓
LINE Platform → POST /api/v1/line/webhook（ngrok → localhost:4000）
↓
lineSignature.middleware 驗證 HMAC-SHA256
↓
line.service.handleQuestion()
↓
qa.service.askQuestion()
↓
Gemini / memory 或 Atlas 搜尋 → video_segments_text
↓
Gemini gemini-3.5-flash 生成答案
↓
LINE reply API 回傳答案 + 影片時間戳；YouTube 影片可附 https://youtu.be/<id>?t=<sec>
```

### 可驗證內容

- `POST /api/v1/line/bind-token` — 發放綁定代碼（需 JWT）
- bind token → bind（LINE 傳入代碼完成帳號綁定）
- `BIND:<token>:COURSE:<courseId>` → 綁定後直接切換課程
- 「切換課程」→ `select_course` postback
- `COURSE:<courseId>` → 切換目前課程；若 published 課程尚未 enrollment，後端會建立 enrollment
- 自然語言提問 → QA 語意搜尋 → 答案 + 時間戳回傳至 LINE

### live LINE 與 backend-only 的差異

- 有 `LINE_CHANNEL_SECRET + LINE_CHANNEL_ACCESS_TOKEN`（目前狀態）
  - webhook 可驗簽且可送出 live reply，`/health` 顯示 `readiness=ready`
- 只有 `LINE_CHANNEL_SECRET`（金鑰遺失時的降級狀態）
  - webhook route 仍可做 backend-only 驗證
  - `/health` 會顯示 `runtime.line.readiness=degraded`、`deliveryMode=backend_only`
  - 結果會標示 `replySkipped=true`

### 已知短期限制

- ngrok 每次重啟 URL 會變，需手動更新 LINE Developers Console Webhook URL
- 目前 repo 實際存在的是 webhook + bind-token/message QR 流程；LIFF endpoints / pages 尚未實作

## YouTube URL MVP

已上線的 YouTube 流程：

```text
POST /api/v1/courses/:courseId/videos/youtube
→ video.service.parseYouTubeVideoId()
→ 建立 sourceType=youtube 的 Video
→ 背景 spawn STT_Whisper/src/main.py --youtube-url <url> --video-id <mongoId> --overwrite
→ yt-dlp 下載音訊
→ STT / chunk / embedding / MongoDB upload
→ internal webhook 回報 completed / failed
```

尚未做的是：「backend 自動把本機影片上傳到 YouTube」、`backend/uploads/` 自動清理、YouTube playlist 管理。本機 upload 影片仍會用 `sourceUrl=/uploads/<file>` 提供前端 `<video>` 播放，所以 `backend/uploads/` 不能無差別清除。

LINE Bot 回覆會在有 YouTube videoId 時附 `跳轉：https://youtu.be/<id>?t=<sec>`；課程選單透過 `filterCoursesWithLiveVideos()` 過濾沒有 live video 的課程，避免使用者切到無法回答的空課程。

### LINE question flow 的 hard-fail 訊號

若 LINE 問答碰到 QA runtime 問題，webhook result 不再只剩 generic `internal_error`，而會帶：

- `reason`
  - `qa_runtime_misconfigured`
  - `qa_atlas_not_ready`
  - `answer_provider_not_configured`
  - `qa_internal_error`
- `errorCode`
- `qaRuntime.readiness`
- `qaRuntime.readyForAsk`
- `qaRuntime.hardFailureCodes`

## Quick Start

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

新環境若需要 demo 基礎資料，再手動執行：

```powershell
cd backend
npm run seed
```

說明：

- `npm run seed` 只建立 / 更新 backend demo users、courses、videos、segments、clip（converge baseline，不清除既有資料）
- `npm run seed:reset` 先清除 demo-owned / demo-derived 痕跡，再重建基線
- 不負責 pipeline metadata
- 不負責建立 Atlas vector index
- 不會保證多影片 searchable coverage

啟動：

```powershell
cd backend
npm start
```

## 驗證

最近重新確認：

- `npm test` 全套
  - 2026-05-07 實跑結果：**87 passed / 0 failed**（含 dashboard 平行化、QA `.lean()`、刪除 cascade、display 分流、教師上傳表單解鎖、重複上傳防呆、學生 watched endpoint 等變動後）
  - 整套執行時間 ~20s（dashboard / QA 平行化的副效果，與先前 ~30s 相比快 30%）
- `node --test --experimental-test-isolation=none --test-concurrency=1 tests\qa.routes.test.js`：8 passed
- `node --test --experimental-test-isolation=none --test-concurrency=1 tests\course-video.routes.test.js`：20 passed（含 YouTube 註冊不暴露 `/uploads` URL）
- `node --test --experimental-test-isolation=none --test-concurrency=1 tests\line.routes.test.js`：14 passed
- `node --test --experimental-test-isolation=none --test-concurrency=1 tests\docs.routes.test.js`：2 passed
- `node --test --experimental-test-isolation=none --test-concurrency=1 tests\teacherStats.service.test.js`：3 passed（含已刪影片 fallback、Recent Videos 排序、合併同影片 top segments）
- `node --test --experimental-test-isolation=none --test-concurrency=1 tests\textEncoding.test.js`：6 passed
- `node --test --experimental-test-isolation=none --test-concurrency=1 tests\\mvp.acceptance.test.js`
  - 鎖 `health -> auth -> courses -> QA -> LINE` backend-only demo 主線
- `tests\\health.routes.test.js`
  - 鎖 `/health` readiness / deliveryMode contract
- 實際 backend startup + `/health`
  - passed（2026-04-14）
- `auth / me`、courses、bridge course videos、QA、LINE bind/ask
  - 以 backend route tests / harness 重新驗證
  - 這樣可避免在共享 MongoDB 上新增 usage log / bind token

## 先看哪些文件

- [backend/docs/current-state.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/current-state.md)
- [backend/docs/handoff-known-issues.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/handoff-known-issues.md)
- [backend/docs/todo.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/todo.md)
- [backend/docs/implementation-log.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/implementation-log.md)
