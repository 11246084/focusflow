# Backend 目前狀態

最後更新：2026-07-13（FAQ 快取／常見問題資料庫：兩層快取接入 askQuestion，重複提問免重跑 embedding／向量搜尋／LLM；學生進度 0% 修復：watched 分母改主課程 ∪ 掛載聯集 + dashboard 依 watchedVideoIds 即時重算；LINE 無 YouTube 連結時跳轉行改 fallback 提示）

前一輪：2026-07-12（影片多課程掛載 P1-3 + 老師 Top Segments contentMissing 修復（老師 #13）+ 本地影片自動上傳 YouTube feature flag）

## 文件角色

這份文件是 phase-1 backend 現況唯一真相頁。要回答的只有五件事：

1. 目前正式 runtime 是什麼
2. phase-1 已完成到哪裡
3. `ready`、`degraded`、`hard_fail` 應怎麼解讀
4. 哪些邊界不能講錯
5. 目前已知限制是什麼

## Phase-1 runtime 現況

目前 backend `.env` 設定為：

- `QA_QUERY_EMBEDDING_PROVIDER=gemini`
- `QA_VECTOR_SEARCH_MODE=atlas`
- `QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`
- `QA_ATLAS_FILTER_MODE=bridge_course_or_video`
- `QA_ANSWER_PROVIDER=gemini`
- `GEMINI_CHAT_MODEL=gemini-2.5-flash`
- `DEMO_SEED_ENABLED=false`
- LINE live：`readiness=ready`、`deliveryMode=live`

這代表：

- query embedding 使用 Gemini（`gemini-embedding-2-preview`，3072 維），與 STT pipeline 一致
- `.env` 設定使用 Atlas vector search（`text_embedding_index`），且共享 Atlas 上該 index 已存在且 READY/queryable（2026-05-23 直連驗證），atlas mode 可正常檢索
- answer generation 使用 Gemini（`gemini-2.5-flash`）
- demo 資料不自動建立，需明確執行 `npm run seed`
- 若要先清掉再重建，使用 `npm run seed:reset`
- LINE live 已可端對端接收訊息並回傳 AI 答案與影片時間戳
- YouTube URL MVP 已接入：教師可貼 YouTube URL 建立影片，STT 用 `yt-dlp` 下載音訊，學生端用 YouTube iframe 播放，QA / LINE 可產生 `https://youtu.be/<id>?t=<sec>` 跳轉連結
- 學生端影片播放來源已加強：YouTube 影片會從 `youtubeVideoId` / `youtube_video_id` / `videoUrl` 解析 iframe 播放，metadata-only / QA-only 影片不再 fallback 到 `/uploads`；YouTube iframe 也改掛在 React-owned wrapper 的子節點內，避免切換影片或點其他頁面時因 iframe teardown 造成整頁黑屏
- 本機 upload 影片仍以 `sourceUrl=/uploads/<file>` 供前端 `<video>` 播放，`backend/uploads/` 不能無差別自動清除
- 教師上傳表單支援多支影片連續上傳：移除 `uploadDone` 鎖、POST 後自動清空輸入；2026-07-12 起前端收斂為單一軌道（本地檔案），YouTube URL tab 已從 UI 移除（backend `POST /courses/:courseId/videos/youtube` API 保留）
- 刪除 cascade（2026-05-07）：教師可刪自己課程（route 放寬到 TEACHER + ADMIN，service 仍限 admin 或 owner teacher）；`deleteVideo` / `deleteCourse` cascade 清 Video / Segment / transcripts / `course.videoIds $pull` / `Enrollment` / `User.activeCourseId $unset`；**撤銷** UsageLog / Question cascade 改保留歷史紀錄
- Display 層分流（2026-05-07；2026-07-12 修正老師 #13）：老師 Top Segments 指向已刪除影片時優先 fallback 到該課程現存影片；課程已無現存影片時**不再整列丟棄**（先前會讓整個課程從統計消失），改帶 `contentMissing` flag 且同課程合併為一列；學生 Recent Queries 與管理員 Recent Events 同樣帶 `contentMissing` flag，前端顯示「內容已下架」badge
- 影片多課程掛載（2026-07-12，P1-3）：保留 `video.courseId` 為主課程，其他課程透過 `course.videoIds` 掛載引用（沿用 bridge contract，`collectScopedVideos` 原生支援）。新增 `POST /api/v1/courses/:courseId/videos/:videoId/attach|detach`（TEACHER/ADMIN；attach 需同時可管理目標課程與影片主課程，主課程不可 detach 回 `400 VALIDATION_ERROR`，重複掛載回 `409 DUPLICATE_VIDEO`）；`resolveAccessibleVideoContext` 主課程無權限時 fallback 到任一有權限的掛載課程；`deleteVideo` / `deleteCourse` 會從**所有**課程 `videoIds` 清引用；`markVideoWatched` 接受主課程或掛載課程的影片；`segmentMatchesScope` 修正為 courseId 對不上時 fallback 用 videoId 判斷（掛載影片的 segments 帶主課程 courseId）。前端 TeacherCourses 課程展開面板有「掛載既有影片」與掛載列「解除」按鈕。注意：stats 的 videosCount 仍按主課程歸屬計算
- 本地影片自動上傳 YouTube（2026-07-12，feature flag 預設關閉、**未經 live 憑證端對端驗證**）：`youtubeUpload.service.js` 以 OAuth2 refresh token 換 access token 後走 YouTube Data API v3 resumable upload；`createCourseVideo`（本地檔案路徑）在 spawn STT 後 fire-and-forget 觸發，成功回寫 `youtubeVideoId` + `videoUrl`（前端播放器自動改用 YouTube iframe），狀態記錄在 `videos.youtubeUpload {status: uploading|uploaded|failed, error, uploadedAt}`。需 `YOUTUBE_UPLOAD_ENABLED=true` + `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN`（scope `youtube.upload`）四項齊備，缺任一項靜默略過，失敗不影響本地播放與 STT pipeline
- QA 拒答（2026-05-07）：`scopedVideos.videos` 為空時直接回「這門課目前沒有可回答的影片資料」，不叫 AI；LINE 課程選單透過 `filterCoursesWithLiveVideos()` 過濾沒有 live video 的課程
- 後端查詢平行化（2026-05-07）：`teacherStats.service.js` dashboard 兩輪 `Promise.all` + 全 `.lean()`（學生端 1.6–2.4s → ~0.8–1s）；`qa.service.js` 三處平行（access+videos / generateAnswer+findCachedClip / writes 收尾）；`loadScopedSearchableSegments` 加 `.lean()`（51 segments hydration 8.8s → ~1s）。API 回應格式 / 答案品質 100% 不變
- QA 診斷 log（2026-05-07）：新增 `[qa-timing]` 7 段 mark（`course-lookup` / `access+videos` / `build-segment-scope` / `load-segments` / `embed` / `search` / `llm+clip` / `writes` / `TOTAL`），可用 `QA_TIMING=off` 關閉；`NODE_ENV=test` 自動靜音
- 錯誤碼 `INVALID_ENCODING` (400)：`utils/textEncoding.js` + `qa.controller.js` 偵測客戶端送出壞 utf-8 body 時拒收；學生 dashboard 舊壞編碼 fallback 顯示「(編碼異常)」
- AI prompt / 標題防 ObjectId 洩漏：`answerGeneration.service.js` 移除 `match.videoId` fallback；`qa.service.js getVideoPresentationTitle` 偵測 ObjectId 後改顯示 `YouTube: <id>`
- STT pipeline race-condition guard：`mongodb_uploader._target_video_exists()` 在所有 upload 函式之前檢查 Video record 是否仍存在；不存在直接 return False，由 `main.py` notify_backend(fail)
- Multer 中文檔名修正：`upload.middleware.js#decodeUploadFilename` 將 multer 預設 latin1 解析的 `originalname` 還原為 UTF-8（先 `Buffer.from(name, 'latin1').toString('utf8')`，無效時退回原字串），避免中文檔名存成亂碼
- `dotenv.config()` 已移除 `override: true`：`.env` 不再覆蓋既有 process env，測試 / CI 注入的環境變數可正常生效
- Backend spawn STT 時注入 `CLEANUP_AFTER_UPLOAD=true` + `CLEANUP_KEEP_CHECKPOINTS=false`：pipeline 上傳成功後自動清理 `data/outputs/runs/<videoId>/` 中的中間產物（含 checkpoints），避免長期累積
- Pipeline run-aware outputs：backend 觸發單支影片時，pipeline 輸出改寫到 `data/outputs/runs/<videoId>/`（取代共用 `data/outputs/`），避免多教師同時處理時互相覆蓋
- `bridgeScope.collectScopedVideos()` 已支援 `Course.videoIds` 對應到 `videos._id` / `videoId` / `video_id` 三種 key，避免歷史資料只寫其中一種時 bridge 找不到 video
- QA 提問落庫流程（2026-05-01）：`recordUsage()` 改回傳建立的 `UsageLog` 文件；QA controller / `lineConversation.service.js` 先建 usage log，再把 `_id` 寫入對應 `questions.sourceUsageLogId`；LINE QA hard-fail 路徑也會寫 `questions`（`status: failed`），不再因為失敗就漏掉提問紀錄
- 重複上傳防呆（2026-05-07，P2-7）：`video.model.js` 新增 `fileHash` 欄位 + `{ courseId, fileHash }` index；`video.service.createCourseVideoFromYouTube` 建立前 `Video.findOne({ courseId, youtubeVideoId })` 命中回 `409 DUPLICATE_VIDEO`；`video.service.createCourseVideo` 上傳完成後對暫存檔做 SHA-256 stream-hash，命中既存 → `unlinkSync` → 回 `409 DUPLICATE_VIDEO`。仍未涵蓋跨課程共用同一支影片（屬 P1-3）
- 學生 Course Progress 真實串接（2026-05-07，P3-2 選項 A 部分完成）：`Enrollment` 新增 `watchedVideoIds: [ObjectId]`；新 endpoint `POST /api/v1/courses/:courseId/videos/:videoId/watched`（`course.routes.js` + `course.controller.js`），service `markVideoWatched` 驗證學生身分 + 影片屬該課程，`$addToSet` 後重算 `progress = watched/total × 100`；**第一次**觀看時額外寫 `UsageLog event=WATCH metadata.videoId=...`（重複觀看不重複寫）。前端 `StudentCourses.jsx` 觸發來源：mp4 `<video>` `onTimeUpdate ≥ 80%` 或 `onEnded`；YouTube IFrame `onStateChange ENDED` 或每 5 秒 poll `cur/dur ≥ 80%`；`watchedMarkedRef` 確保同 session 只 POST 一次。副作用：admin Usage Statistics 的 WATCH 從此可累加（先前永遠為 0）。「進度誤顯 0%」已於 2026-07-13 修復（見下一條）
- 學生進度 0% 修復 + LINE 跳轉 fallback（2026-07-13）：
  - `markVideoWatched` 進度分母改為「主課程影片（`video.courseId`）∪ 掛載影片（`course.videoIds`）」聯集。先前只算 `course.videoIds`，未掛載的主課程影片看完不被計入，進度永遠 0%
  - `getStudentDashboardStats` 的 `courseList.progress` 改為：enrollment 有 `watchedVideoIds` 就用同一聯集分母即時重算（上限 100%），不再只讀儲存的 `enrollment.progress`（過期的 0 會一直顯示）；舊 enrollment 只有 progress 數值時沿用儲存值；未選課課程維持 processing-completed 比例 fallback。`courseList.videoCount` 改為聯集大小（頂層 `videosCount` 仍按主課程歸屬計算）
  - LINE `buildQuestionSummaryLines`：命中影片無 `youtubeVideoId`（組不出 `youtu.be` 跳轉連結，常見於本地上傳未同步 YouTube）時，改附「此片段「{影片名}」尚未提供跳轉連結，請到 FocusFlow 網站的課程頁播放對應時間點」提示，先前是整行「跳轉：」直接消失；clip 快取 jumpUrl 仍優先於 match jumpUrl
  - API response 形狀不變；新增 5 條回歸測試（course-video.routes ×2、line.routes ×3）

目前 QA bridge contract：

`course.videoIds -> videos._id -> videos.videoId -> video_segments_text.videoId`

## 資料庫實況（共享 Atlas, MCP 驗證）

> 連線目標：`百陶's Org` → `focusflow` cluster → `focusflow` DB（共享 Atlas）。
> `videos`、`video_segments_text` 筆數與 `text_embedding_index` 狀態為 2026-05-23 MCP 直連實查；其餘 collection 筆數沿用 2026-05-01 快照，可能已變動，需要精確值時請重新以 MCP 查詢。

| Collection | 筆數 | 備註 |
|---|---|---|
| `courses` | 3 | FocusFlow Pipeline Bridge Course / Demo QA Course / Demo Processing Course |
| `videos` | 16 | 2026-05-23 實查；混存 app-owned 與 pipeline metadata |
| `users` | 3 | Demo Teacher / Student / Admin |
| `video_segments_text` | 130 | 2026-05-23 實查；全部 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`），`embedding` 為 3072 維 |
| `video_segments_video` | 16 | DB 文件仍為 snake_case（`video_id`、`clip_id`、`start_sec`），尚未接 QA |
| `video_segments_audio` | 0 | Pipeline 預留 |
| `questions` | 1 | **新增**，每次 QA 提問自動寫入；含 matches/runtime/`sourceUsageLogId` 連結 |
| `clips` | 1 | Legacy |
| `enrollments` | 1 | |
| `usage_logs` | 7 | login / watch / ask / clip_view |
| `line_bind_tokens` | 0 | TTL 自動清除 |
| `transcripts_normalized` | 1 | Pipeline 產出 |
| `term_dictionary` | 14 | Pipeline 產出 |

**Collections 總計：13**（含 2026-04-30 新增的 `questions`；先前快照為 12）

**與 init 腳本差異（2026-05-01）：**

- `database/tools/setup/init_collections.js` 目前列 15 個 collection，不是舊文件寫的 14 個
- init 有、Atlas 目前沒有：`stt_cache`、`raw_transcripts`、`video_segments`
- Atlas 有、init 目前沒有：`questions`
- 結論：問題不是單純 collection 數量差，而是 init 腳本與共享 Atlas 實況清單不同步；後續需由 Database/Backend 決定要補 init 腳本、建立缺漏 collection，或把 legacy collection 從 init 移除

**已知 index 狀態：**

- `video_segments_text`：classic indexes（`_id_`、`courseId_1`、`segmentId_1`、`videoId_1`、`courseId_1_videoId_1`）；**Atlas Vector Search Index `text_embedding_index` 已存在且 READY/queryable**（2026-05-23 MCP `$listSearchIndexes` 驗證：3072 維 cosine，filter fields=`embedding`(vector)+`courseId`+`videoId`，3 shards 全 READY，建立於 2026-04-19）
- `questions`：13 個 classic indexes，包含 `courseId`、`status`、`source`、`topSegmentId`、`askedAt`、複合索引（`courseId_1_askedAt_-1`、`userId_1_askedAt_-1`、`courseId_1_status_1_askedAt_-1`、`courseId_1_topSegmentId_1`）、text index（`question_text_answer_text`）、`sourceUsageLogId` partial unique sparse index；schema 預設不寫入 `sourceUsageLogId: null`

**對 runtime 的影響：**

- `.env` 設定 `QA_VECTOR_SEARCH_MODE=atlas` + `QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`，且 cluster 上索引已 READY，atlas mode 可正常檢索（`runtime.qa.readiness=ready`）
- 本機無 API key 的隔離 smoke 仍可改用 `QA_VECTOR_SEARCH_MODE=memory` + `mock` embedding + `template` answer
- 若未來 Atlas 再次被重置或 index 被刪，atlas mode 會 fail-fast；屆時需重建 `text_embedding_index`（3072 維 cosine，filter fields：`courseId` ObjectId、`videoId` camelCase）

## 已完成項目

- auth / JWT / RBAC 主線已可用；2026-05-07 新增 `POST /api/v1/auth/register` 自助註冊端點，限 `student` / `teacher`（admin 仍只能由現有管理員建立），密碼以 bcrypt salt=10 hash 寫入 `users.passwordHash`，成功後直接回 JWT 與 public user
- courses CRUD（含 PATCH/DELETE）、videos CRUD（含 DELETE）、processing 狀態流程已可用
- `/api/v1/qa/ask` 已能回 answer、matches、時間資訊與 runtime 訊號
- 提問自動寫入 `questions` collection（2026-04-30）：`questionRecording.service.js` 在 QA 與 LINE Bot 路徑都會落庫；含 matches、runtime、`sourceUsageLogId` 連結至對應 `usage_logs`
- Teacher / Student dashboard 統計 API（2026-04-30）：`/api/v1/stats/teacher`、`/api/v1/stats/student`，由 `teacherStats.service.js` 聚合；Recent Videos 使用穩定 recency 排序；Top Queried Segments 若命中已刪影片的歷史 segment，顯示會 fallback 到同課程現存影片並優先 YouTube，且同一顯示影片的多個 segment count 會合併成一列
- Admin 管理 API（2026-04-30）：`/api/v1/admin/{stats,users,videos,events,event-stats}`，可停用使用者、變更角色、刪除影片、查看最近事件
- Gemini query embedding 已接上；Atlas vector search 由 `.env` 指向 `text_embedding_index`，該 index 已 READY，atlas mode 可正常檢索
- QA misconfig、Atlas not ready、fallback 與 `no_searchable_segments` 已可明確觀測
- `POST /api/v1/line/bind-token`、webhook verify、bind、switch course、ask question routing 已完成
- LINE live smoke 已完成（2026-04-19）：真實 LINE 端對端 bind → switch course → ask 全程走通
- LINE Bot 多輪對話歷史（2026-04-21）：每輪 Q&A 結束後將最新 6 筆紀錄（3 輪）寫入 `User.lineConversationHistory`；下次提問時帶入 Gemini 作為 `contents` history，支援上下文連貫問答
- LINE QR 綁定 + 課程交接流程修正（2026-04-30，commit `c87fdad`）
- QA grounding / matched video 標籤改善（2026-04-30，commit `c819bca`）
- STT Pipeline 自動化整合（2026-04-27）：影片上傳後 `video.service.js` 自動 spawn STT pipeline；pipeline 透過 `POST /api/v1/internal/videos/:id/processing/start|complete|fail` 回報狀態；pipeline 結束後自動執行 `mongodb_uploader.py` 寫入 `video_segments_text`
- `queryEmbedding.service.js` 支援 `gemini-embedding-2-preview`（3072 維）
- LINE non-live、backend-only、QA hard-fail 訊號已補齊
- `GET /health` 已能直接顯示 `runtime.qa` 與 `runtime.line`
- backend-only acceptance smoke 已存在，可在不碰共享 MongoDB 的前提下重驗主線
- demo baseline 可用 `npm run seed` 收斂，`npm run seed:reset` 可保守清除後重建
- DB 同步 / 維運 scripts 現況：
  - `npm run db:sync-atlas` 可用，實際執行 `src/scripts/syncLocalMongoToAtlas.js`，以 upsert-by-`_id` 將 local MongoDB 同步到 Atlas，清單包含 `questions`
  - `src/scripts/syncQuestionsToAtlas.js` 可單獨同步 questions 到 Atlas（含 course 補齊與 local user → Atlas user 對應），但目前未掛 npm script
  - `npm run db:ensure-questions` 與 `npm run db:backfill-questions` 是 dangling scripts：`src/scripts/ensureQuestionsCollection.js`、`src/scripts/backfillQuestionsFromUsageLogs.js` 目前不存在，執行會失敗
- OpenAPI 現況：`backend/docs/openapi.yaml` 已掛在 `/docs`，但尚未涵蓋 stats/admin 路由，也缺 courses/videos 的 PATCH/DELETE；API 清單暫以實際 route files 與 README 表格為準
- FAQ 快取／常見問題資料庫（2026-07-13）：`faqs` collection + `faqCache.service.js`，兩層快取接在 `qa.service.askQuestion`（API 與 LINE 共用）——第一層正規化文字完全相同直接命中（零 token，連 embedding 都不算）；第二層以 query embedding 對課程 FAQ 做 cosine 相似度（預設門檻 0.95），命中則跳過向量搜尋與 LLM 生成。只快取 runtime ready 且不帶對話歷史的回答；命中仍照常寫 `usage_logs` 與 `questions`（runtime 帶 `faqCache.hit/matchType`，`answerProviderUsed=faq_cache`）。影片刪除、重新處理完成、課程刪除會自動清該課程快取。新端點：`GET /api/v1/courses/:courseId/faqs`（依 hitCount 排序）、`DELETE /api/v1/courses/:courseId/faqs`（teacher/admin）。設定：`FAQ_CACHE_ENABLED` / `FAQ_CACHE_SIMILARITY_THRESHOLD` / `FAQ_CACHE_MAX_ENTRIES_PER_COURSE`

## 2026-05-05 程式碼對照補充

- Course routes：`POST/GET /api/v1/courses`、`GET/PATCH/DELETE /api/v1/courses/:courseId`；DELETE 僅 admin，可 cascade videos / segments / enrollments。
- Video routes：`POST /api/v1/courses/:courseId/videos`、`POST /api/v1/courses/:courseId/videos/youtube`、`GET /api/v1/courses/:courseId/videos`、`GET /api/v1/videos/:videoId`、`GET /api/v1/videos/:videoId/processing`、`POST /api/v1/videos/:videoId/processing/retry`、`DELETE /api/v1/videos/:videoId`、`POST /api/v1/courses/:courseId/videos/:videoId/watched`（學生標記觀看完成）。
- LINE routes：目前只有 webhook verify / webhook POST / bind-token；repo 未實作 LIFF 的 `liff-bind`、`liff-switch-course` 或前端 LIFF pages。
- `Video` schema 已移除 `storagePath`，主欄位為 camelCase：`videoId`、`fileName`、`filePath`、`audioPath`、`durationSec`、`videoSource`、`videoUrl`、`youtubeVideoId`。
- `bridgeScope.service.js` 仍讀 legacy `video_id`，但這是相容路徑，不代表新資料要繼續寫 `videos.video_id`。

## 目前測試狀態

- 2026-07-13 `npm test`：**119 passed / 0 failed**（含 FAQ 快取 13 個新測試：`faq-cache.service.test.js` 6 + `faq.routes.test.js` 7；harness 補 `store.faqs` 與 Faq model stubs）。
- 2026-05-07 `npm test`：**87 passed / 0 failed**（含 dashboard 平行化、QA `.lean()`、刪除 cascade、display 分流、教師上傳表單解鎖、編碼防護等變動後）。
- 整套執行時間 ~20s（dashboard / QA 平行化的副效果，與先前 ~30s 相比快 30%）。
- 主要單檔現況：`qa.routes.test.js` 8 / `qa.service.test.js` ✓ / `course-video.routes.test.js` 20 / `line.routes.test.js` 14 / `docs.routes.test.js` 2 / `teacherStats.service.test.js` 3 / `textEncoding.test.js` 6。
- 測試 harness（`backendTestHarness.js`）`createQuery` 已補 `.lean()` / `.select()` no-op；`VideoSegment.find` 改用 thenable 以相容 service 層 `.lean()` 呼叫。

## readiness / degraded / hard_fail 怎麼解讀

### `/health`

- `runtime.qa.readiness=ready`
  - QA runtime 已就緒，可以接受提問
- `runtime.qa.readiness=hard_fail`
  - QA runtime 設定不合法（缺 key、Atlas index 未設定、mode 不相容）
- `runtime.line.readiness=ready`
  - backend 與 live LINE 所需條件都已補齊
- `runtime.line.readiness=degraded`
  - backend routing 可驗證，但 live delivery 未 ready（最常見：`deliveryMode=backend_only`）
- `runtime.line.readiness=hard_fail`
  - LINE 必要條件不成立（驗簽或 channel 設定無法成立）

### `/api/v1/qa/ask`

- `runtime.status=ready` — 問答主線正常
- `runtime.status=degraded` — 走到 fallback 或非理想條件
- `runtime.matchStatus=matched` — 有找到可回答片段
- `runtime.matchStatus=no_relevant_match` — 有資料但沒有足夠相關片段
- `runtime.matchStatus=no_searchable_segments` — 只有 bridge metadata，沒有可搜尋文字片段

## 不能誤稱的邊界

- 不能把共享環境單次成功驗證，講成所有課程與資料都已 fully production-ready
- 不能忽略 Atlas index 狀態，直接假設 `QA_VECTOR_SEARCH_MODE=atlas` 在任何環境都可用
- 不能把 Gemini query embedding 已接上，誤講成所有 pipeline coverage 都已完全對齊
- 不能說 bridge course 的所有影片都已有 searchable segments
- 不能把 ngrok 暫時端點誤稱為固定正式部署網址
- 不能說 `video_segments_video` 已是正式 clip source

## 已知限制

- `videos` 仍是 mixed collection（`videoId` 欄位 unique+sparse，pipeline-owned 與 app-owned 共存於同一 collection），ownership 邊界尚未定版
- `video_segments_text` 欄位：已全面統一為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）；`segmentId` 值通常為 null，實際識別碼為 `chunkId`（如 `<videoObjectId>_chunk_0001`）
- `video_segments_video` 文件仍為 snake_case（`video_id`、`clip_id`、`start_sec`、`end_sec`），與 `video_segments_text` 不一致；尚未接 QA
- `video_segments_video`：有 embedding，但無 Atlas vector search index，multimodal QA 目前不可用
- `text_embedding_index` 已 READY（2026-05-23 驗證）；atlas mode 可用。仍需注意若 cluster 被重置或 index 被刪，atlas mode 會 fail-fast
- `FocusFlow Pipeline Bridge Course` 是 pipeline-style demo baseline，不代表 live pipeline 已完整同步
- YouTube Data API 自動上傳尚未實作；目前已完成的是 YouTube URL MVP（教師手動上傳到 YouTube 後貼 URL）
- ngrok 每次重啟 URL 會變，LINE Developers Console Webhook URL 須手動更新
- CORS 目前是寬鬆 `cors()`；正式環境前需限縮為 `ALLOWED_ORIGIN`
- Collections 實際為 13；`init_collections.js` 列 15 個，且與 Atlas 清單不同步（init 多 `stt_cache` / `raw_transcripts` / `video_segments`，Atlas 多 `questions`）

## 一句話結論

截至 2026-07-13，backend 主線為 `gemini query embedding + gemini answer（gemini-2.5-flash）+ LINE live + 多輪對話歷史 + STT Pipeline 自動觸發（含 race-condition guard）+ 重複上傳防呆（YouTube videoId / mp4 SHA-256）+ 提問自動落庫到 questions + FAQ 兩層快取（文字相同零 token／語意相似 ≥ 0.95）+ Admin/Stats 管理 API + 教師可刪自課程 + 刪除 cascade（保留歷史）+ display 分流（含老師 #13 contentMissing 修復）+ 影片多課程掛載（attach/detach）+ 本地影片自動上傳 YouTube（feature flag 預設關閉、未 live 驗證）+ 學生 watched endpoint（進度 0% 已修）+ dashboard/QA 平行化 + [qa-timing] 診斷 log`。教師上傳為單一軌道（本地檔案），YouTube URL API 保留但 UI 不露出。`video_segments_text` 欄位已全面 camelCase；全測試 119/119 passed（2026-07-13 實測）。共享 Atlas 的 `text_embedding_index` 已 READY（2026-05-23 驗證），atlas mode 可用。OpenAPI 已補上 stats/admin/watched/attach/detach/faqs 與 courses/videos 的 PATCH/DELETE（仍標註為非 100% 完整契約）。短期限制：YouTube 自動上傳未經真實 OAuth 憑證 live 驗證、backend/uploads 自動清理尚未做、ngrok URL 不固定、CORS 仍寬鬆、`video_segments_video` 仍為 snake_case 且無 vector index。
