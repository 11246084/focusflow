# Backend 目前狀態

最後更新：2026-08-08（Backend query embedding 已切換到可設定的 stable `gemini-embedding-2` contract，補上 instruction／generation／normalization／active data compatibility diagnostics 與測試；Pipeline／Database 既有 vectors 尚未重建或 live 確認，Atlas readiness 不得只由 3072 維判定，Parent uploader 與 live Parent E2E 尚未完成，Gate 維持 false）

同日另一項：2026-08-02（影片／課程刪除時自動把 FocusFlow 上傳的 YouTube 影片轉 private；並以 `youtube.force-ssl` refresh token 完成 live 端對端驗證：上傳出現在頻道、系統刪除後 YouTube Studio 顯示「私人」）

前一輪：2026-07-26（role-aware auth、註冊、站內通知與 private avatar 已完成隔離 MongoDB + Playwright 驗證；262/262 tests、frontend lint/build 通過）

再前一輪：2026-07-25（`QA_MATCH_LIMIT` 3→15 修正跨片段歸納答不出來；FAQ 快取語意命中路徑順序優化 3133ms→1240ms；FAQ 快取失效缺口盤點）

更早一輪：2026-07-20（YouTube 自動上傳 OAuth 憑證取得）

更早一輪：2026-07-18（ShortAsset、修課限定 Shorts feed、YouTube metadata sync 與課程刪除封存）

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
- `GEMINI_CHAT_MODEL=gemini-3.5-flash`
- `DEMO_SEED_ENABLED=false`
- `SHORTS_SYNC_INTERVAL_MS=600000`（設 0 停用 startup/interval sync）
- LINE live：`readiness=ready`、`deliveryMode=live`

這代表：

- query embedding 使用 `GEMINI_EMBEDDING_MODEL_NAME`（預設 stable `gemini-embedding-2`，3072 維），request 以 `task: search result | query: ...` instruction 取代 legacy task type，並以 `unit_l2_v1` 驗證／正規化；既有 Pipeline／Database 向量是否已同 contract 必須由 `/health.runtime.qa.dataContractCompatibility` 與跨組證據確認
- `.env` 設定使用 Atlas vector search（`text_embedding_index`）；該 index 的 READY/queryable 結果是 2026-05-23 的歷史 snapshot，本輪未連線重查，且在 active Leaf contract 未確認前不可宣稱 Atlas ready
- answer generation 使用 Gemini（`gemini-3.5-flash`）
- demo 資料不自動建立，需明確執行 `npm run seed`
- 若要先清掉再重建，使用 `npm run seed:reset`
- LINE live 已可端對端接收訊息並回傳 AI 答案與影片時間戳
- YouTube URL MVP 已接入：教師可貼 YouTube URL 建立影片，STT 用 `yt-dlp` 下載音訊，學生端用 YouTube iframe 播放，QA / LINE 可產生 `https://youtu.be/<id>?t=<sec>` 跳轉連結
- YouTube auto-upload adapter 已接入：`YOUTUBE_AUTO_UPLOAD_ENABLED=true` 且 OAuth 設定完整時，本機檔案上傳會先由 backend 走 YouTube Data API resumable upload，成功後保存 `youtubeVideoId` 與 YouTube `videoUrl/sourceUrl`，再用本機暫存檔接續既有 STT flow；2026-08-02 已用真實 OAuth 憑證（`youtube.force-ssl`）完成 live upload 驗證
- 刪除轉 private（2026-08-02，教授決議「轉 private 而非直接刪除」）：`deleteVideo` 與 `deleteCourse` 完成 DB 刪除後，呼叫 `youtubeUpload.privatizeVideoOnDelete` / `privatizeVideosOnDelete` 把影片改為 private。原因是 unlisted 影片只要有連結就能播，只清 DB 會讓學生舊連結與 LINE timestamp link 仍然有效。邊界：只處理 `youtubeUpload.status === 'uploaded'`（FocusFlow 自家頻道）的影片，教師貼 URL 的他人影片不碰；`videos.update` 前先 `videos.list` 讀回 status 只覆寫 `privacyStatus`（不帶 `publishAt`，避免排程公開把影片救回公開）；失敗只記 log 不中斷刪除。需 `youtube.force-ssl` scope 的 refresh token，舊 upload-only token 會被 403 拒絕；`YOUTUBE_PRIVATIZE_ON_DELETE=false` 可停用
- 學生 Shorts feed 已改為本地 `ShortAsset` 查詢：`GET /api/v1/youtube/shorts` 需要 JWT 且只允許 student，回傳 `Enrollment ∩ published Course ∩ published ShortAsset ∩ youtubeAvailability=playable`；使用 `publishedAt + _id` opaque cursor（預設 20、最多 50）。目前前端 `StudentShortsWall.jsx` 仍需另案改用 authenticated `apiFetch`，本輪只提供 [前端串接方案](./handoff-shorts-frontend-plan.md)，未修改 `frontend/`
- Short YouTube metadata sync 只用 `YOUTUBE_API_KEY` 的 `videos.list`（每批 50），啟動後非阻塞執行並依 `SHORTS_SYNC_INTERVAL_MS` 排程；startup/interval/direct 共用 single-flight promise。public/unlisted 可播放，private/成功回應缺 ID 不可播放，暫時性整批失敗保留上次成功狀態。`/health.runtime.shortsSync` 提供 enabled/lastAttemptAt/lastSuccessAt/lastError/degraded
- `/health.runtime.youtubeUpload`（2026-08-02）：`readiness` = `ready` / `degraded` / `hard_fail` / `not_enabled`；`credentialCheck` 記錄最後一次 OAuth token 交換的時間、錯誤與 `grantedScopes`；`lastPrivatize` 記錄最後一次轉 private 的結果。**`privatizeScopeSatisfied`** 在 token 只有 `youtube.upload` scope 時轉 false 並示警——這正是「刪除後影片仍是 unlisted」的靜默失敗成因。server 啟動時做一次非阻塞 token 交換（只換 access token，不耗 YouTube 配額），開機後即有狀態可看；只保留最後一次結果，不持久化
- 學生端影片播放來源已加強：YouTube 影片會從 `youtubeVideoId` / `youtube_video_id` / `videoUrl` 解析 iframe 播放，metadata-only / QA-only 影片不再 fallback 到 `/uploads`；YouTube iframe 也改掛在 React-owned wrapper 的子節點內，避免切換影片或點其他頁面時因 iframe teardown 造成整頁黑屏
- 本機 upload 影片仍以 `sourceUrl=/uploads/<file>` 供前端 `<video>` 播放，`backend/uploads/` 不能無差別自動清除
- 教師上傳表單支援多支影片連續上傳：移除 `uploadDone` 鎖、POST 後自動清空輸入；2026-07-12 起前端收斂為單一軌道（本地檔案），YouTube URL tab 已從 UI 移除（backend `POST /courses/:courseId/videos/youtube` API 保留）
- 刪除 cascade（2026-05-07）：教師可刪自己課程（route 放寬到 TEACHER + ADMIN，service 仍限 admin 或 owner teacher）；`deleteVideo` / `deleteCourse` cascade 清 Video / Segment / transcripts / `course.videoIds $pull` / `Enrollment` / `User.activeCourseId $unset`；**撤銷** UsageLog / Question cascade 改保留歷史紀錄
- Display 層分流（2026-05-07；2026-07-12 修正老師 #13）：老師 Top Segments 指向已刪除影片時優先 fallback 到該課程現存影片；課程已無現存影片時**不再整列丟棄**（先前會讓整個課程從統計消失），改帶 `contentMissing` flag 且同課程合併為一列；學生 Recent Queries 與管理員 Recent Events 同樣帶 `contentMissing` flag，前端顯示「內容已下架」badge
- 影片多課程掛載（2026-07-12，P1-3）：保留 `video.courseId` 為主課程，其他課程透過 `course.videoIds` 掛載引用（沿用 bridge contract，`collectScopedVideos` 原生支援）。新增 `POST /api/v1/courses/:courseId/videos/:videoId/attach|detach`（TEACHER/ADMIN；attach 需同時可管理目標課程與影片主課程，主課程不可 detach 回 `400 VALIDATION_ERROR`，重複掛載回 `409 DUPLICATE_VIDEO`）；`resolveAccessibleVideoContext` 主課程無權限時 fallback 到任一有權限的掛載課程；`deleteVideo` / `deleteCourse` 會從**所有**課程 `videoIds` 清引用；`markVideoWatched` 接受主課程或掛載課程的影片；`segmentMatchesScope` 修正為 courseId 對不上時 fallback 用 videoId 判斷（掛載影片的 segments 帶主課程 courseId）。前端 TeacherCourses 課程展開面板有「掛載既有影片」與掛載列「解除」按鈕。注意：stats 的 videosCount 仍按主課程歸屬計算
- 本地影片自動上傳 YouTube（2026-07-12 實作，feature flag 預設關閉；**2026-08-02 完成 live 憑證端對端驗證**）：`youtubeUpload.service.js` 以 OAuth2 refresh token 換 access token 後走 YouTube Data API v3 resumable upload；`createCourseVideo`（本地檔案路徑）在 spawn STT 後 fire-and-forget 觸發，成功回寫 `youtubeVideoId` + `videoUrl`（前端播放器自動改用 YouTube iframe），狀態記錄在 `videos.youtubeUpload {status: uploading|uploaded|failed, error, uploadedAt}`。需 `YOUTUBE_UPLOAD_ENABLED=true` + `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN`（scope 需 `youtube.force-ssl`，才能同時支援上傳與刪除轉 private）四項齊備，缺任一項靜默略過，失敗不影響本地播放與 STT pipeline
- QA 拒答（2026-05-07）：`scopedVideos.videos` 為空時直接回「這門課目前沒有可回答的影片資料」，不叫 AI；LINE 課程選單透過 `filterCoursesWithLiveVideos()` 過濾沒有 live video 的課程
- 後端查詢平行化（2026-05-07）：`teacherStats.service.js` dashboard 兩輪 `Promise.all` + 全 `.lean()`（學生端 1.6–2.4s → ~0.8–1s）；`qa.service.js` 三處平行（access+videos / generateAnswer+findCachedClip / writes 收尾）；`loadScopedSearchableSegments` 加 `.lean()`（51 segments hydration 8.8s → ~1s）。API 回應格式 / 答案品質 100% 不變
- `QA_MATCH_LIMIT` 3 → 15（2026-07-25）：`5df3148` 把 answer prompt 改成「綜合所有相關片段」，但片段數上限自最初 MVP commit `e69580b` 起一直是 `3`，導致整門課只有約 166 字進 prompt（實測課程逐字稿總量約 6,700 字，佔 2.5%），跨片段歸納型問題（例如「這門課在講什麼」）一律回「目前資料庫片段不足以回答這個問題。」。調成 `15` 後可正確產出跨 4 支影片、6 個片段的整理答案並標註依據時間。`.env.example` 同步更新；**已存在的 FAQ 快取不會因此失效，需手動 `DELETE /api/v1/courses/:courseId/faqs`**
- FAQ 快取語意命中路徑順序優化（2026-07-25）：`askQuestion` 原本「載入片段 → 算 embedding → 查快取第二層」串行，語意命中時前面那次片段載入（實測約 1,800ms）完全白做。改為先啟動 `loadScopedSearchableSegments` 的 promise 不 await → 算 embedding → 查快取 → 命中直接回應，只有 miss 才 await（附 no-op catch 避免提早 return 造成 unhandled rejection）。實測語意命中 3,133ms → 1,240ms，完整 miss 也因兩段重疊快約 900ms。API 回應格式不變。副作用：對「完全沒有已索引片段」的課程會多付一次 embedding 呼叫才回錯誤訊息；語意命中時不再執行 no-searchable-segments 檢查
- FAQ 快取失效缺口修補（2026-07-25）：(1) 「答不出來」的回覆不再入快取 —— `answerGeneration.service.js` 新增 `isNoAnswerReply()` 與 `NO_ANSWER_INSUFFICIENT` / `NO_ANSWER_UNDETERMINED` 兩個常數（常數直接插進 system instruction 與 `buildPrompt` 規則 5，避免 prompt 文案與比對字串走鐘），`qa.service.js` 的 `shouldSaveFaq` 加上這個條件。先前這類回覆因 `runtime.degraded=false` 被當成正常答案快取，導致資料補齊或設定調好後仍永久回舊答案。(2) `attachVideoToCourse`（`$addToSet` 之後呼叫）與 `detachVideoFromCourse`（`$pull` 之前呼叫，與 `deleteVideo` 同一個反查順序理由）補上 `clearFaqsForVideoCourses`。新增 6 條 `isNoAnswerReply` 單元測試
- QA 診斷 log（2026-05-07）：新增 `[qa-timing]` 7 段 mark（`course-lookup` / `access+videos` / `build-segment-scope` / `load-segments` / `embed` / `search` / `llm+clip` / `writes` / `TOTAL`），可用 `QA_TIMING=off` 關閉；`NODE_ENV=test` 自動靜音
- 錯誤碼 `INVALID_ENCODING` (400)：`utils/textEncoding.js` + `qa.controller.js` 偵測客戶端送出壞 utf-8 body 時拒收；學生 dashboard 舊壞編碼 fallback 顯示「(編碼異常)」
- AI prompt / 標題防 ObjectId 洩漏：`answerGeneration.service.js` 移除 `match.videoId` fallback；`qa.service.js getVideoPresentationTitle` 偵測 ObjectId 後改顯示 `YouTube: <id>`
- STT pipeline race-condition guard：`mongodb_uploader._target_video_exists()` 在所有 upload 函式之前檢查 Video record 是否仍存在；不存在直接 return False，由 `main.py` notify_backend(fail)
- Multer 中文檔名修正：`upload.middleware.js#decodeUploadFilename` 將 multer 預設 latin1 解析的 `originalname` 還原為 UTF-8（先 `Buffer.from(name, 'latin1').toString('utf8')`，無效時退回原字串），避免中文檔名存成亂碼
- `dotenv.config()` 已移除 `override: true`：`.env` 不再覆蓋既有 process env，測試 / CI 注入的環境變數可正常生效
- CORS allowed origin 已可設定：未設定 `ALLOWED_ORIGINS` 時維持開發相容；設定逗號分隔白名單後只對指定 origins 回 CORS allow header，並支援 credentials
- Backend spawn STT 時注入 `CLEANUP_AFTER_UPLOAD=true` + `CLEANUP_KEEP_CHECKPOINTS=false`：pipeline 上傳成功後自動清理 `data/outputs/runs/<videoId>/` 中的中間產物（含 checkpoints），避免長期累積
- Pipeline run-aware outputs：backend 觸發單支影片時，pipeline 輸出改寫到 `data/outputs/runs/<videoId>/`（取代共用 `data/outputs/`），避免多教師同時處理時互相覆蓋
- `bridgeScope.collectScopedVideos()` 已支援 `Course.videoIds` 對應到 `videos._id` / `videoId` / `video_id` 三種 key，避免歷史資料只寫其中一種時 bridge 找不到 video
- `videos` ownership 回應 contract 已固定：app-owned 影片回 `ownership=app_owned` / `isAppOwned=true` / `metadataOnly=false`；pipeline metadata 影片回 `ownership=pipeline_metadata` / `isAppOwned=false` / `metadataOnly=true`
- QA 提問落庫流程（2026-05-01）：`recordUsage()` 改回傳建立的 `UsageLog` 文件；QA controller / `lineConversation.service.js` 先建 usage log，再把 `_id` 寫入對應 `questions.sourceUsageLogId`；LINE QA hard-fail 路徑也會寫 `questions`（`status: failed`），不再因為失敗就漏掉提問紀錄
- 重複上傳防呆（2026-05-07，P2-7）：`video.model.js` 新增 `fileHash` 欄位 + `{ courseId, fileHash }` index；`video.service.createCourseVideoFromYouTube` 建立前 `Video.findOne({ courseId, youtubeVideoId })` 命中回 `409 DUPLICATE_VIDEO`；`video.service.createCourseVideo` 上傳完成後對暫存檔做 SHA-256 stream-hash，命中既存 → `unlinkSync` → 回 `409 DUPLICATE_VIDEO`。仍未涵蓋跨課程共用同一支影片（屬 P1-3）
- 學生 Course Progress 真實串接（2026-05-07，P3-2 選項 A 部分完成）：`Enrollment` 新增 `watchedVideoIds: [ObjectId]`；新 endpoint `POST /api/v1/courses/:courseId/videos/:videoId/watched`（`course.routes.js` + `course.controller.js`），service `markVideoWatched` 驗證學生身分 + 影片屬該課程，`$addToSet` 後重算 `progress = watched/total × 100`；**第一次**觀看時額外寫 `UsageLog event=WATCH metadata.videoId=...`（重複觀看不重複寫）。前端 `StudentCourses.jsx` 觸發來源：mp4 `<video>` `onTimeUpdate ≥ 80%` 或 `onEnded`；YouTube IFrame `onStateChange ENDED` 或每 5 秒 poll `cur/dur ≥ 80%`；`watchedMarkedRef` 確保同 session 只 POST 一次。副作用：admin Usage Statistics 的 WATCH 從此可累加（先前永遠為 0）。「進度誤顯 0%」已於 2026-07-13 修復（見下一條）
- 學生進度 0% 修復 + LINE 跳轉 fallback（2026-07-13）：
  - `markVideoWatched` 進度分母改為「主課程影片（`video.courseId`）∪ 掛載影片（`course.videoIds`）」聯集。先前只算 `course.videoIds`，未掛載的主課程影片看完不被計入，進度永遠 0%
  - `getStudentDashboardStats` 的 `courseList.progress` 改為：enrollment 有 `watchedVideoIds` 就用同一聯集分母即時重算（上限 100%），不再只讀儲存的 `enrollment.progress`（過期的 0 會一直顯示）；舊 enrollment 只有 progress 數值時沿用儲存值。2026-08-02 起 Dashboard 只統計 `Enrollment ∩ published Course`，新註冊且尚未修課的學生固定回傳 200 zero-state（所有 count/rate/progress 為 0，`courseList`／`recentQueries` 為空），不再把公開課程目錄誤算成個人學習進度。`courseList.videoCount` 改為聯集大小（頂層 `videosCount` 仍按已修課之主課程歸屬計算）
  - LINE `buildQuestionSummaryLines`：命中影片無 `youtubeVideoId`（組不出 `youtu.be` 跳轉連結，常見於本地上傳未同步 YouTube）時，改附「此片段「{影片名}」尚未提供跳轉連結，請到 FocusFlow 網站的課程頁播放對應時間點」提示，先前是整行「跳轉：」直接消失；clip 快取 jumpUrl 仍優先於 match jumpUrl
  - API response 形狀不變；新增 5 條回歸測試（course-video.routes ×2、line.routes ×3）

目前 QA bridge contract：

`course.videoIds -> videos._id | videos.videoId | videos.video_id -> video_segments_text.videoId`

`bridgeScope.service.js` 會把同一支影片的 `_id`、`videoId`、`video_id` 三種 key 全部放進 allowed set，命中任一即納入 scope。實務上 **app-owned 影片沒有 `videoId` 欄位**（值為 `undefined`），pipeline 直接把 `String(videos._id)` 寫進片段的 `videoId`；只有 pipeline metadata 影片才有 `videoId` / `video_id`。因此手動查 collection 時不要用 `videos.videoId` 去 join `video_segments_text`，app-owned 影片會全部對不到（2026-07-25 排查實測）。

## 資料庫實況（共享 Atlas, MCP 驗證）

> 連線目標：`百陶's Org` → `focusflow` cluster → `focusflow` DB（共享 Atlas）。
> 下表多數筆數沿用舊快照；2026-07-24 唯讀實查共享 Atlas 為 15 collections，仍沒有 `notifications`，因此不得把下表總數視為目前 live 真相。
> **2026-08-02 唯讀實查更新**：共享 Atlas 為 16 collections（新增 `video_segments_parent`）。實測筆數與下表舊快照差距很大，以本段為準：`video_segments_text` 1,651、`videos` 31（其中 29 筆 app-owned，**0 筆有 `videoId` / `video_id` 欄位**）、`questions` 139、`usage_logs` 516、`faqs` 19、`courses` 4、`users` 5、`video_segments_video` 16、`transcripts_normalized` 31、`term_dictionary` 14、`clips` 1、`shortassets` 1、`enrollments` 3、`notifications` 2、`video_segments_parent` 0、`video_segments_audio` 0、`line_bind_tokens` 0。
> **重要發現**：`video_segments_text` 全部 1,651 筆的 `courseId` 皆為 **missing**（型別分佈 `missing:1651`），`videoId` 全為 string（`String(Video._id)`）。也就是 `text_embedding_index` 的 `courseId` filter 從未真正生效，course scope 實際上是靠 `QA_ATLAS_FILTER_MODE=bridge_course_or_video` 展開的 `videoId $in [...]` 達成。Parent upload 若不修正這點，同一問題會被複製到 parent collection。

| Collection | 筆數 | 備註 |
|---|---|---|
| `courses` | 3 | FocusFlow Pipeline Bridge Course / Demo QA Course / Demo Processing Course |
| `videos` | 16 | 2026-05-23 實查；混存 app-owned 與 pipeline metadata |
| `users` | 3 | Demo Teacher / Student / Admin |
| `video_segments_text` | 130 | 2026-05-23 實查；全部 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`），`embedding` 為 3072 維 |
| `video_segments_video` | 16 | DB 文件仍為 snake_case（`video_id`、`clip_id`、`start_sec`），`video_embedding_index` 已 READY；已接入初版 course-scoped visual citation retrieval |
| `video_segments_audio` | 0 | Pipeline 預留 |
| `questions` | 1 | **新增**，每次 QA 提問自動寫入；含 matches/runtime/`sourceUsageLogId` 連結 |
| `clips` | 1 | Legacy |
| `enrollments` | 1 | |
| `usage_logs` | 7 | login / watch / ask / clip_view |
| `line_bind_tokens` | 0 | TTL 自動清除 |
| `transcripts_normalized` | 1 | Pipeline 產出 |
| `term_dictionary` | 14 | Pipeline 產出 |

**下表快照總計：13**；2026-07-24 共享 Atlas live 清單為 15 collections。

**與 init 腳本差異（2026-07-24 唯讀實查）：**

- `database/tools/setup/init_collections.js` 目前列 16 個 collection，已加入 `notifications`
- init 有、Atlas 目前沒有：`stt_cache`、`raw_transcripts`、`video_segments`、`notifications`
- Atlas 有、init 目前沒有：`questions`、`faqs`、`shortassets`
- 結論：Notification bootstrap source 已補齊，但共享 Atlas 尚未建立 collection/index；正式 rollout 需 DB owner 核准並以 `listIndexes()` 驗證，release E2E 不得 fallback 到 shared Atlas

**已知 index 狀態：**

- `video_segments_text`：classic indexes（`_id_`、`courseId_1`、`segmentId_1`、`videoId_1`、`courseId_1_videoId_1`）；`text_embedding_index` 的 3072 維／filter 設定僅為 2026-05-23 歷史 snapshot，本輪未重查，不能取代 active embedding contract 證據
- `video_segments_video`：`video_embedding_index` 的 READY/queryable 結果僅為 2026-07-10 歷史 snapshot，本輪未重查
- `questions`：13 個 classic indexes，包含 `courseId`、`status`、`source`、`topSegmentId`、`askedAt`、複合索引（`courseId_1_askedAt_-1`、`userId_1_askedAt_-1`、`courseId_1_status_1_askedAt_-1`、`courseId_1_topSegmentId_1`）、text index（`question_text_answer_text`）、`sourceUsageLogId` partial unique sparse index；schema 預設不寫入 `sourceUsageLogId: null`
- `video_segments_parent`：2026-08-02 的 DB setup／index 結果屬歷史 snapshot；目前仍須由 Database／Pipeline 以 read-only 證據確認 collection、index、active Parent contract 與資料筆數，且等待 Pipeline uploader 完成

**對 runtime 的影響：**

- `.env` 設定 `QA_VECTOR_SEARCH_MODE=atlas` + `QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`；cluster/index READY 是歷史 snapshot，未代表本輪 active Leaf contract 已驗證。現在若缺少或不相容的 Leaf metadata，`runtime.qa.readiness=hard_fail`，不得宣稱 Atlas ready
- 本機無 API key 的隔離 smoke 仍可改用 `QA_VECTOR_SEARCH_MODE=memory` + `mock` embedding + `template` answer
- 若未來 Atlas 再次被重置或 index 被刪，atlas mode 會 fail-fast；屆時需重建 `text_embedding_index`（3072 維 cosine，filter fields：`courseId` ObjectId、`videoId` camelCase）
- Parent storage 目前**不影響預設 runtime 行為**：`HIERARCHICAL_RETRIEVAL_ENABLED=false` 時 `qa.service.js` 直接走 leaf-only 路徑。正式 Parent Search adapter 已接入 Gate 開啟路徑；collection／index、維度、scope、timeout、無命中或 Child expansion 發生問題時，由 `HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF=true` 安全退回 Leaf retrieval
- Parent storage 若要重建或退場：`npm run db:ensure-parent-storage` 為冪等（既存 index 直接略過）；rollback 只需關閉 Gate，collection 完全獨立，最壞情況可整個 drop 而不影響 `video_segments_text`

## 已完成項目

- **Phase 2-2 Hierarchical Retrieval Round 1（`3d9a234`）**：新增 `parentSearch.service.js`（`searchParents()` 介面 + `validateParentHit()` + 刻意保留的 `createUnavailableParentRepository()` stub）、`hierarchicalRetrieval.service.js`（Parent → Child → Context 主流程與 Leaf fallback）、`childExpansion.service.js`（依有序 `childChunkIds` 查回 Leaf、去重、scope 驗證）、`leafContextAssembly.service.js`（Leaf 數量與字元上限）。新增 7 個環境變數（`HIERARCHICAL_RETRIEVAL_ENABLED=false`、`HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF=true`、`HIERARCHICAL_PARENT_LIMIT=5`、`HIERARCHICAL_CHILD_EXPANSION_LIMIT=30`、`HIERARCHICAL_CONTEXT_MAX_LEAVES=15`、`HIERARCHICAL_CONTEXT_MAX_CHARACTERS=5000`、`HIERARCHICAL_PARENT_TIMEOUT_MS=1000`）。Gate 關閉時完全沿用 Leaf-only QA；診斷資訊只寫進 `runtime.hierarchicalRetrieval`
- **Phase 2-2 Parent Storage（2026-08-02，DB 組）**：新增 `models/videoSegmentParent.model.js`（契約 §10 欄位 + `parentId` unique index）、`services/parentVectorIndex.service.js`（regular index 與 Atlas vector index 的冪等 ensure 邏輯）、`scripts/ensureParentStorage.js` 與 `npm run db:ensure-parent-storage`（支援 `--dry-run`，輸出遮蔽連線字串）、`tests/parent-vector-index.service.test.js`（8 條）。環境變數 `VIDEO_SEGMENT_PARENT_COLLECTION`（預設 `video_segments_parent`）與 `VIDEO_SEGMENTS_PARENT_VECTOR_INDEX_NAME`（預設 `parent_embedding_index`），`.env.example` 已同步。已於共享 Atlas 實際建立並驗證 READY。**DB 組拍板的五項決策**：(1) 採獨立 collection `video_segments_parent`；(2) unique key 用單鍵 `parentId`（MVP 單 generation，重跑同影片 idempotent upsert 覆蓋）；(3) `generationVersion` / `isActive` 保留欄位與 default，但不進 unique key、不進 regular index、不進 vector index filter，正式採 generation switch 時才啟用；(4) vector index 名 `parent_embedding_index`，3072 cosine，filter=`courseId`+`videoId`；(5) cleanup 走契約 §12 的 D→A 路線 —— 現階段只 upsert 不刪，正式開檢索前才啟用「全批 upsert 成功且驗證通過後刪同影片 stale parentId」，partial upload 絕不 cleanup，rollback 即關閉 Gate
- **Phase 2-2 正式 Parent Search adapter（2026-08-02，Backend 組）**：新增 `parentSearchAdapter.service.js`，依環境變數使用 `video_segments_parent`／`parent_embedding_index`，強制 3072 維有限數值向量，並以 `courseId` ObjectId **或課程允許的掛載 `videoId`** 套用 Atlas scope；QA Gate 開啟路徑已由 unavailable stub 改接正式 adapter。Parent Model 強制 `courseId`、3072 維 embedding 與 `embeddingDimension=3072`，並保留新版 embedding contract metadata；Gemini query 使用 stable instruction contract，不再送 `RETRIEVAL_QUERY` task type。Parent hit 會再次驗證 course／video scope、`hierarchyLevel=1`、`documentType=parent_chunk` 與有序 Child IDs；Atlas 查詢套用 `maxTimeMS`，MongoDB 原始錯誤不對外傳遞，索引／collection／維度／scope 等失敗均可依既有設定安全回退 Leaf-only。成功診斷改為 `searchBackendUsed=parent_vector`
- auth / JWT / RBAC 主線已可用；login 必填預期 `role`，跨身分入口回 `403 ROLE_MISMATCH`；register 限 `student` / `teacher`，已涵蓋 duplicate index race、bcrypt 與 public-user 敏感欄位測試
- 站內通知已完成：使用者列表／cursor／未讀／單筆與全部已讀；admin 可發維護公告；影片完成對主課程與掛載課程的 active enrolled students 以 partial-unique dedupe 做可重送 fanout
- private avatar 已完成：User nullable metadata、authenticated JPEG/PNG/WebP 上傳與 binary 讀取、5 MiB/magic 驗證、private storage、CAS 並發保護；跨環境 user sync 保留 target-local avatar
- courses CRUD（含 PATCH/DELETE）、videos CRUD（含 DELETE）、processing 狀態流程已可用
- `/api/v1/qa/ask` 已能回 answer、matches、時間資訊與 runtime 訊號
- `/api/v1/qa/ask` 已新增 Phase 2 contract 欄位：`citations[]`（source video、timestamp、jump URL、match confidence、transcript snippet）與 `answerStatus`（answered/no_answer、confidence、noAnswerReason）。`matches[]` 保留為 legacy / debug 相容欄位。
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
- `queryEmbedding.service.js` 使用可設定的 stable `gemini-embedding-2`（3072 維），以 `gemini_embedding_2_search_v1` instruction、`text_search_generation_v1` generation 與 `unit_l2_v1` normalization 組成可檢查的 query contract；preview model 與 legacy task type 不會被 runtime 呼叫
- LINE non-live、backend-only、QA hard-fail 訊號已補齊
- `GET /health` 已能直接顯示 `runtime.qa`、`runtime.line` 與 `runtime.multimodal`
- `ShortAsset` model 與內部 create/update service 已完成；保存 course/source/job/title/description/status/YouTube metadata、封存欄位與只含 `courseId/title/teacherId/status` 的 `courseSnapshot`。published+playable 必須具備非空 `youtubeVideoId` 與有效 `publishedAt`，legacy 空值不進 feed。feed 索引為 course/status/youtubeAvailability/publishedAt/_id，另有 `youtubeVideoId` unique+sparse（缺值不存 `null`）
- Course hard delete 會在其他 cascade 成功後、`Course.deleteOne()` 前 idempotent 封存該課程尚未封存的 ShortAsset；已封存資料不覆寫 `statusBeforeArchive`，Course 刪除失敗時只 best-effort 還原本輪封存，不宣稱 transaction/atomicity
- `video_segments_video` 初版 visual citation retrieval 已接入 QA：backend 會從 course-scoped videos 的 `fileName` / `sourceUrl` / `videoUrl` 等欄位解析 `video_001` 類 pipeline visual ID，再以 Atlas `video_embedding_index` + `video_id` filter 檢索視覺片段；命中時回 `modality=video`、`clipPath`、timestamp citation 與保守答案。限制：目前視覺片段無 transcript / caption，不讓 LLM 編造畫面內容
- backend-only acceptance smoke 已存在，可在不碰共享 MongoDB 的前提下重驗主線
- demo baseline 可用 `npm run seed` 收斂，`npm run seed:reset` 可保守清除後重建
- DB 同步 / 維運 scripts 現況：
  - `npm run db:sync-atlas` 可用，實際執行 `src/scripts/syncLocalMongoToAtlas.js`，以 upsert-by-`_id` 將 local MongoDB 同步到 Atlas，清單包含 `questions`
  - `src/scripts/syncQuestionsToAtlas.js` 可單獨同步 questions 到 Atlas（含 course 補齊與 local user → Atlas user 對應），但目前未掛 npm script
  - `npm run db:ensure-questions` 可建立 `questions` collection 並同步 schema indexes
  - `npm run db:backfill-questions` 預設 dry-run；需要寫入時使用 `npm run db:backfill-questions -- --write`，從 legacy ASK usage logs 補回缺失 questions
- OpenAPI 現況：`backend/docs/openapi.yaml` 已掛在 `/docs`，已同步 login role、notifications、avatar 與主要既有端點；internal processing webhook 等少數內部端點以 route files 為準
- FAQ 快取／常見問題資料庫（2026-07-13）：`faqs` collection + `faqCache.service.js`，兩層快取接在 `qa.service.askQuestion`（API 與 LINE 共用）——第一層正規化文字完全相同直接命中（零 token，連 embedding 都不算）；第二層以 query embedding 對課程 FAQ 做 cosine 相似度（預設門檻 0.95），命中則跳過向量搜尋與 LLM 生成。只快取 runtime ready 且不帶對話歷史的回答；命中仍照常寫 `usage_logs` 與 `questions`（runtime 帶 `faqCache.hit/matchType`，`answerProviderUsed=faq_cache`）。影片刪除、重新處理完成、課程刪除會自動清該課程快取。新端點：`GET /api/v1/courses/:courseId/faqs`（依 hitCount 排序）、`DELETE /api/v1/courses/:courseId/faqs`（teacher/admin）。設定：`FAQ_CACHE_ENABLED` / `FAQ_CACHE_SIMILARITY_THRESHOLD` / `FAQ_CACHE_MAX_ENTRIES_PER_COURSE`

## 2026-05-05 程式碼對照補充

- Course routes：`POST/GET /api/v1/courses`、`GET/PATCH/DELETE /api/v1/courses/:courseId`；DELETE 僅 admin，可 cascade videos / segments / enrollments。
- Video routes：`POST /api/v1/courses/:courseId/videos`、`POST /api/v1/courses/:courseId/videos/youtube`、`GET /api/v1/courses/:courseId/videos`、`GET /api/v1/videos/:videoId`、`GET /api/v1/videos/:videoId/processing`、`POST /api/v1/videos/:videoId/processing/retry`、`DELETE /api/v1/videos/:videoId`、`POST /api/v1/courses/:courseId/videos/:videoId/watched`（學生標記觀看完成）。
- LINE routes：目前只有 webhook verify / webhook POST / bind-token；repo 未實作 LIFF 的 `liff-bind`、`liff-switch-course` 或前端 LIFF pages。
- `Video` schema 已移除 `storagePath`，主欄位為 camelCase：`videoId`、`fileName`、`filePath`、`audioPath`、`durationSec`、`videoSource`、`videoUrl`、`youtubeVideoId`。
- `bridgeScope.service.js` 仍讀 legacy `video_id`，但這是相容路徑，不代表新資料要繼續寫 `videos.video_id`。

## 目前測試狀態

- 2026-08-02 `npm.cmd test`：**341 passed / 0 failed**（42 suites；新增新註冊學生 Dashboard zero-state與 Admin Enrollment `studentId` 聚合回歸測試）。
- 2026-08-02 `npm test`：**336 passed / 0 failed**（40 suites；含 Phase 2-2 Round 1、Parent Storage、正式 Parent Search adapter／QA 接線、mounted-video scope、Health/OpenAPI compatibility、Gemini query 契約，以及 YouTube 上傳／刪除轉 private 回歸測試）。
- 2026-07-26 `npm.cmd test`：**262 passed / 0 failed**（31 suites；含 `QA_MATCH_LIMIT=15`、answer-generation、role-aware auth、registration `lineUserId` sparse-index、notifications 與 avatar 回歸）。
- 2026-07-24 `npm.cmd test`：**251 passed / 0 failed**（29 suites；新增 register defensive body cases 後重跑，涵蓋 auth role/register、notifications、avatar、sync ownership 與既有主線）。
- 2026-07-18 `npm.cmd test`：**163 passed / 0 failed**（25 suites；含 ShortAsset lifecycle、修課 feed/cursor、YouTube sync/retry/log/single-flight、health、course delete rollback、invalid asset 與 repeated cursor）。
- 2026-07-14 `npm.cmd test`：**135 passed / 0 failed**（整合 Phase 2 QA contract、FAQ 快取、QA quota guardrails、visual citation retrieval、YouTube auto-upload 新舊設定相容與 Shorts proxy 後重驗）。
- 2026-07-10 `npm.cmd test`：**103 passed / 0 failed**（含 Phase 2 QA contract、初版 visual citation retrieval、YouTube auto-upload adapter、CORS allowlist、QA quota guardrails）。
- 2026-07-13 `npm test`：**119 passed / 0 failed**（含 FAQ 快取 13 個新測試：`faq-cache.service.test.js` 6 + `faq.routes.test.js` 7；harness 補 `store.faqs` 與 Faq model stubs）。
- 2026-05-07 `npm test`：**87 passed / 0 failed**（含 dashboard 平行化、QA `.lean()`、刪除 cascade、display 分流、教師上傳表單解鎖、編碼防護等變動後）。
- 整套時間會依機器與檔案系統而變；2026-07-24 reviewer 實跑約 80.9s，不再沿用舊版約 20s 的估計。
- 主要單檔現況：`qa.routes.test.js` 9 / `qa.service.test.js` 13 / `course-video.routes.test.js` 26 / `line.routes.test.js` 14 / `docs.routes.test.js` 2 / `teacherStats.service.test.js` 3 / `textEncoding.test.js` 6。
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
- `runtime.shortsSync.degraded=true`
  - YouTube Data API 回覆 `403 quotaExceeded`；本輪不重試，保留最後成功的 ShortAsset availability/privacy，等待下一輪排程

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
- 不能說 `video_segments_video` 已是正式 clip source 或 caption QA source；目前只作 course-scoped visual citation retrieval
- 不能把 ShortAsset feed 與 metadata sync 誤稱為完整 Short 產線；自動選片、FFmpeg 剪輯、字幕、YouTube 發布 worker與教師管理仍未實作
- **不能說 Hierarchical Retrieval 已啟用或已完成 live 驗證**。Storage 與正式 Backend adapter 已完成，但 `video_segments_parent` 是 **0 筆**、Pipeline 的 Parent uploader 尚未實作（`mongodb_uploader.py` 完全沒有 parent 程式碼）、`HIERARCHICAL_RETRIEVAL_ENABLED` 仍為 false。Parent → Child expansion → Leaf context → Answer 尚未以真實 Atlas Parent 文件跑過端對端流程
- 不能把「index 已建立」講成「檢索已可用」。`parent_embedding_index` 是在空 collection 上建立的，READY 只代表索引本身就緒，尚未以任何真實 parent 文件驗證維度、filter 型別或 scope 隔離
- 不能把 `docs/Phase2-2_Hierarchy_Data_Contract_v1.md` 整份當成已定案契約；全文有 109 處 `[Proposed for v1]`、16 處 `[Database review required]`，目前 DB 組只拍板了 collection 名稱、unique 策略、generation 欄位處理、index 名稱與 cleanup 路線五項

## 已知限制

- `videos` 仍是 mixed collection（`videoId` 欄位 unique+sparse，pipeline-owned 與 app-owned 共存於同一 collection）；後端 presentation ownership 已定版，但是否拆 collection 仍是跨組資料庫決策
- `video_segments_text` 欄位：已全面統一為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）；`segmentId` 值通常為 null，實際識別碼為 `chunkId`（如 `<videoObjectId>_chunk_0001`）
- `video_segments_video` 文件仍為 snake_case（`video_id`、`clip_id`、`start_sec`、`end_sec`），與 `video_segments_text` 不一致；backend 目前以獨立 model 讀取，不把欄位命名混入 text segment schema
- `video_segments_video`：有 embedding，Atlas vector search index `video_embedding_index` 已建立且 READY/queryable（2026-07-10 驗證，3072 維 cosine，filter=`video_id`）；backend 已從 course-scoped videos 的檔名 / URL 解析 `video_001` 類 pipeline visual ID 以安全套用 course access scope。限制：資料沒有 transcript / caption，因此 multimodal QA 目前只提供 visual citation，不提供畫面內容生成
- `text_embedding_index` 已 READY（2026-05-23 驗證）；atlas mode 可用。仍需注意若 cluster 被重置或 index 被刪，atlas mode 會 fail-fast
- `FocusFlow Pipeline Bridge Course` 是 pipeline-style demo baseline，不代表 live pipeline 已完整同步
- YouTube Data API auto-upload 與刪除轉 private 已於 2026-08-02 完成 live 驗證；同日 OAuth 同意畫面已發布為正式版並重換 refresh token（scope `youtube.force-ssl`，已驗證可換發 access token），**不再 7 天過期**。未送 Google 驗證，授權畫面仍顯示未驗證警告、未驗證 app 有 100 使用者上限（本專案只需 1 個授權帳號）。憑證若失效，上傳回 `YOUTUBE_UPLOAD_FAILED`、轉 private 只寫 log，但 `/health.runtime.youtubeUpload` 可觀察（見下方）。YouTube URL MVP（教師手動上傳到 YouTube 後貼 URL）也仍可用
- 轉 private 沒有 backend 還原入口（DB 紀錄已刪），需人工到 YouTube Studio 把瀏覽權限改回；轉 private 失敗只記 log 不中斷刪除，該影片會留在頻道上且仍可用連結播放
- 上傳預設 unlisted 無法改成 private：YouTube private 影片不支援 iframe 嵌入播放，設 private 會讓學生端全部播不出來。因此「未修課者拿到連結仍可觀看」是採 YouTube 託管的固有限制
- ShortAsset metadata sync 有 fake fetch/timer 測試，但未使用真實 `YOUTUBE_API_KEY` 或長時間排程 smoke；學生前端尚未帶 JWT 呼叫新 feed，需先依 handoff 方案完成另案實作
- ngrok 每次重啟 URL 會變，LINE Developers Console Webhook URL 須手動更新
- CORS 已支援 `ALLOWED_ORIGINS` 白名單；未設定時維持開發期相容，正式環境需填入實際前端 origin
- 2026-07-24 共享 Atlas 唯讀實查為 15 collections、尚無 `notifications`；`init_collections.js` 列 16 個並已含 `notifications`，shared Atlas rollout 仍需人工核准
- **`video_segments_text` 全部 1,651 筆的 `courseId` 皆為 missing**（2026-08-02 型別分佈實查）。`text_embedding_index` 雖宣告 `courseId` 為 filter field，但實際從未生效；course scope 完全依賴 `QA_ATLAS_FILTER_MODE=bridge_course_or_video` 展開的 `videoId $in [...]`。Parent uploader 需把 courseId 解析成功列為 blocking 條件並於 upload summary 回報，否則 parent collection 會複製同一缺陷
- `videos` 31 筆中 **0 筆有 `videoId` / `video_id` 欄位**（2026-08-02 實查）。bridge 實際靠 `String(videos._id)` 對上 `video_segments_text.videoId`，因此 Parent 的 `videoId` 必須沿用同一 canonical string，不需要另存 `sourceVideoId` / `backendVideoId`
- `HIERARCHICAL_PARENT_TIMEOUT_MS` 預設 1000ms 對 Atlas vector search 偏緊，正式接線後可能頻繁 timeout 而靜默 fallback 到 leaf，需以實測調整
- Parent Child Expansion 主要依 `video_segments_text.chunkId` 回查 Leaf，但共享 Atlas 目前沒有 `chunkId` classic index；正式開 Gate 前需由 DB owner 唯讀確認重複／null 分布，再建立並以 `explain("executionStats")` 驗證不走 COLLSCAN
- Backend query code 已切換至可設定的 stable `gemini-embedding-2`；Pipeline／Database 的既有 preview artifacts 與 vectors 尚未由本輪重建。stable 模型不使用舊 `task_type`，而採 query/document prompt contract；embedding space 遷移仍需由 Backend + AI Pipeline + DB 組共同完成 re-embedding、active metadata、Atlas smoke 與 rollback，因此不能把 Backend code change 說成正式資料已切換

## 一句話結論

截至 2026-08-02，backend 已整合 `QA_MATCH_LIMIT=15`、role-aware auth、站內通知、private avatar 與既有 Shorts/YouTube 主線，並完成 Phase 2-2 的 Hierarchical Retrieval Round 1、Parent Storage 與正式 Parent Search adapter 接線（`video_segments_parent` + `parent_embedding_index` 已於共享 Atlas 建立並驗證 READY）。但 parent collection 目前 0 筆、Parent uploader 尚未實作、Gate 維持關閉，仍不能誤稱 Hierarchical Retrieval 已可用；也不等於 shared Atlas 真實 Parent 查詢或 Gemini／LINE／YouTube／STT live provider 已完成驗證。
