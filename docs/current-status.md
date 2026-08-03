# docs/current-status.md — FocusFlow 目前進度

最後更新：2026-08-02（Phase 2-2 Parent Storage 與正式 Backend Parent Search adapter／QA 接線已完成；`video_segments_parent`、3 個 regular index 與 `parent_embedding_index` 已於共享 Atlas 建立並驗證 READY/queryable；合併 YouTube 更新並補齊 Health/OpenAPI 契約後 backend 336/336 tests 通過。Parent uploader 與 live Parent E2E 尚未完成，`HIERARCHICAL_RETRIEVAL_ENABLED` 維持 false）

同日另一項：2026-08-02（影片／課程刪除時自動把 FocusFlow 上傳的 YouTube 影片轉為 private，教授決議「轉 private 而非直接刪除」；並完成真實 OAuth 憑證 live 驗證：上傳後影片以 unlisted 出現在頻道，系統刪除後轉為「私人」）

前一輪：2026-07-26（role-aware auth、註冊、站內通知與 private avatar 已完成隔離 MongoDB + Playwright 驗證；backend 262/262、frontend lint/build 通過，指定功能 PASS）

再前一輪：2026-07-25（`QA_MATCH_LIMIT` 3→15 修正 QA 答不出跨片段問題；FAQ 快取語意命中 3133ms→1240ms；FAQ 快取失效缺口盤點，詳見 [backend/docs/current-state.md](../backend/docs/current-state.md)）

更早一輪：2026-07-20（YouTube 自動上傳 OAuth 憑證取得；live smoke 待執行）

> 這份文件是跨服務的動態進度頁。後端詳細狀態見 [backend/docs/current-state.md](../backend/docs/current-state.md)。

---

## Phase-1 整體完成度

| 服務 | 狀態 | 說明 |
|------|------|------|
| **Backend** | ✅ 主線可用，全測試 336/336（2026-08-02 合併後實測） | `QA_MATCH_LIMIT=15`、auth（role-aware login + 自助 register + private avatar）/ notifications / courses / videos / qa / LINE / stats / admin 已可用；Phase 2-2 Parent adapter 已接線但 Gate 維持關閉，live Parent E2E 尚未完成 |
| **Frontend** | ✅ 第一階段頁面與本輪串接完成，lint/build 通過 | Login 會送出 role；Topbar 已串通知列表、分頁、已讀與 admin 公告；Profile 已串 authenticated avatar 上傳／讀取；`Icons.jsx` 非元件設定已原樣拆分，`StudentCourses.jsx` effect cleanup warning 已修正 |
| **AI Pipeline** | ✅ 可執行 | STT → chunking → embedding → MongoDB 主流程完整；本機上傳與 YouTube URL 都可由 backend 自動 spawn；mongodb_uploader 寫入前 race-condition guard |

---

## Backend 目前 Runtime（2026-05-23 更新）

```
QA_QUERY_EMBEDDING_PROVIDER = gemini
QA_VECTOR_SEARCH_MODE       = atlas
QA_ATLAS_VECTOR_INDEX_NAME  = text_embedding_index
QA_ATLAS_FILTER_MODE        = bridge_course_or_video
QA_ANSWER_PROVIDER          = gemini
GEMINI_CHAT_MODEL           = gemini-3.5-flash
DEMO_SEED_ENABLED           = false  （需手動 npm run seed）
```

- `/health` 可直接觀察 `runtime.qa`、`runtime.line` 與 `runtime.multimodal` 狀態
- `/health.runtime.qa.costControl` 可觀察 QA 月 token budget / user quota 是否啟用；quota 以 UTC calendar month 自動重置
- `/health.runtime.shortsSync` 可觀察 Shorts metadata sync 的 enabled/lastAttemptAt/lastSuccessAt/lastError/degraded；`SHORTS_SYNC_INTERVAL_MS` 預設 600000，設 0 停用
- `/health.runtime.youtubeUpload`（2026-08-02）可觀察 YouTube OAuth 憑證健康度：readiness、最後一次 token 交換結果與授權 scope、最後一次刪除轉 private 的結果；scope 不足以轉 private 時會示警
- QA misconfig 與 Atlas not ready 已 fail-fast，不靜默降級
- **共享 Atlas 現況**（2026-05-23 直連驗證）：`videos` 16 筆、`video_segments_text` 130 筆，`text_embedding_index` 存在且 READY/queryable（3072 維 cosine，filter=`courseId`+`videoId`，3 shards 全 READY）；`.env` 的 `atlas` mode 可正常檢索，不需切回 `memory`
- LINE Bot 已端對端驗證；正式部署前 ngrok URL / Channel 設定須再確認

---

## 已完成

- auth / JWT / RBAC 主線
- `POST /api/v1/auth/login` 現在必填 `role=student|teacher|admin`；密碼與停用狀態驗證後才比較帳號角色，跨入口登入回 `403 ROLE_MISMATCH`，不發 token
- `POST /api/v1/auth/register` 已補 duplicate unique-index race、嚴格欄位型別與完整 route tests；student / teacher 可註冊，admin 禁止自助註冊
- 站內通知：`GET /api/v1/notifications`、單筆／全部已讀、`POST /api/v1/admin/notifications`；影片 processing complete 會對相關課程的 active enrolled students 做 idempotent fanout
- 頭貼：`PUT/GET /api/v1/auth/me/avatar`；JPEG/PNG/WebP、5 MiB、magic signature、private storage、CAS 並發保護；public user 只回 `hasAvatar/avatarUpdatedAt`
- courses CRUD（含 PATCH/DELETE）、videos CRUD、processing 狀態流程
- 影片上傳後自動 spawn STT pipeline（`video.service.js`），pipeline 透過 `/api/v1/internal/videos/:id/processing/{start,complete,fail}` 回報狀態
- YouTube URL MVP：`POST /courses/:courseId/videos/youtube` 可貼 YouTube URL 建立影片；STT 用 `yt-dlp` 下載音訊；學生端用 YouTube IFrame API 播放並支援 QA timestamp 跳轉；LINE Bot 可回傳 YouTube timestamp link。2026-07-12 起教師上傳頁收斂為單一軌道（本地檔案），URL 入口從 UI 移除、API 保留
- YouTube auto-upload adapter：`YOUTUBE_UPLOAD_ENABLED=true` 時，本機影片可由 backend 用 FocusFlow OAuth refresh token 走 YouTube Data API resumable upload，成功後保存 `youtubeVideoId/videoUrl`；舊版 `YOUTUBE_AUTO_UPLOAD_ENABLED` / `YOUTUBE_OAUTH_*` 名稱仍相容；2026-08-02 已用真實 OAuth 憑證（`youtube.force-ssl` scope）完成 live upload 驗證
- 刪除影片／課程時 YouTube 影片轉 private（2026-08-02）：教授決議採「轉 private」而非直接刪除（YouTube 刪除不可逆，且刪課程會一次帶走整門課影片）。只處理 FocusFlow 自家頻道上傳的影片（`youtubeUpload.status === 'uploaded'`），教師貼 URL 的他人影片不碰；失敗只記 log 不中斷刪除。需 `youtube.force-ssl` scope 的 refresh token，`YOUTUBE_PRIVATIZE_ON_DELETE=false` 可停用
- Shorts 修課過濾與同步（backend 已完成，frontend 待另案）：`GET /api/v1/youtube/shorts` 現需 JWT 且只允許 student，僅回 Enrollment ∩ published Course ∩ published/playable ShortAsset，採 `publishedAt + _id` opaque cursor；Course hard delete 會保存並封存 ShortAsset，YouTube `videos.list` metadata sync 具 retry/backoff 與 health 診斷。現有學生 9:16 卡片牆仍需依 `backend/docs/handoff-shorts-frontend-plan.md` 改用 authenticated `apiFetch`，本輪未修改 `frontend/`
- `/api/v1/qa/ask`：answer、matches、時間資訊、runtime 訊號
- `/api/v1/qa/ask` Phase 2 contract：新增 `citations[]`（source video、timestamp、jump URL、match confidence、transcript snippet）與 `answerStatus`（answered/no_answer、confidence、noAnswerReason），`matches[]` 保留為 legacy/debug 相容欄位
- Clip / Shorts Phase 2 contract：ShortAsset 儲存、student feed、course deletion archive 與 YouTube metadata sync 已實作；candidate/job、自動選片、FFmpeg、字幕、發布 worker、教師管理 routes/UI 仍未實作
- 提問自動寫入 `questions` collection（`questionRecording.service.js`，含 matches、runtime、`sourceUsageLogId` 連結）
- bridge-first API 契約已收斂：課程與 QA runtime 會提供 `isBridgeCourse`；`appOwnedVideoCount` / `metadataOnlyVideoCount` 是 `appVideoCount` / `bridgeVideoCount` 的 readability aliases；`resultCategory` 是 Phase-1 convenience field，細節仍以 `status` / `matchStatus` / `degradedReasons` 為準
- `videos` ownership presentation 已收斂：影片回應明確提供 `ownership=app_owned|pipeline_metadata`、`isAppOwned`、`metadataOnly`，避免前端/LINE 從 mixed collection 欄位自行推論
- CORS hardening：`ALLOWED_ORIGINS` 可用逗號分隔設定正式前端來源；未設定時維持開發期相容
- QA cost guardrails：`QA_MONTHLY_TOKEN_BUDGET`、`QA_USER_MONTHLY_TOKEN_QUOTA` 與 `QA_ESTIMATED_TOKENS_PER_ASK` 已接入；超額時 `/api/v1/qa/ask` 回 `429 QA_QUOTA_EXCEEDED`，成功 ASK 會在 `UsageLog.metadata.costControl` 保存當月 snapshot
- demo baseline / reset 路徑已收斂：`npm run seed` 預設只做 converge baseline；`npm run seed:reset` 會保守清除 demo-owned / demo-derived 痕跡後重建；bridge 課程基線目前定位為 pipeline-style demo baseline
- DB 同步腳本：`db:sync-atlas` 可用；`syncQuestionsToAtlas.js` 可直接用 node 執行但未掛 npm script；`db:ensure-questions` 可建立 `questions` 並同步 indexes；`db:backfill-questions` 預設 dry-run，需加 `-- --write` 才會從 legacy ASK usage logs 補寫缺失 questions
- LINE：bind-token、webhook verify、bind、switch course、ask routing；前端 LINE QR 綁定流程已串接（2026-04-30）
- LINE Bot 多輪對話歷史（2026-04-21）：每輪 Q&A 後將最新 6 筆紀錄（3 輪）存入 `User.lineConversationHistory`；下次提問時帶入 Gemini 作為 conversation context
- Dashboard 統計 API：`/api/v1/stats/teacher`、`/api/v1/stats/student`；2026-05-07 改為兩輪 `Promise.all` 平行 + 全 `.lean()`，學生端從 1.6–2.4s 降到 ~0.8–1s
- Admin 管理 API：`/api/v1/admin/{stats,users,videos,events,event-stats}`，包含使用者停用/角色更新、影片刪除、最近事件查詢；Admin Total Users 描述補 `adminCount`
- 刪除 cascade（2026-05-07）：教師可刪自己課程（route 放寬到 TEACHER + ADMIN，service 仍限 admin 或 owner teacher）；`deleteVideo` / `deleteCourse` cascade 清 Video / Segment / transcripts / `course.videoIds $pull` / `Enrollment` / `User.activeCourseId $unset`（2026-08-02 起另把 YouTube 影片轉 private）；**撤銷** UsageLog / Question cascade（保留歷史紀錄），改由 display 分流（老師 Top Segments filter、學生 Recent Queries / 管理員 Recent Events 顯示「內容已下架」badge）
- QA 拒答（2026-05-07）：scope 內無 live video 時直接回「這門課目前沒有可回答的影片資料」，不叫 AI；LINE 課程選單 `filterCoursesWithLiveVideos()` 過濾沒有 live video 的課程
- QA 效能優化（2026-05-07）：`qa.service.js` 三處平行（access+videos / generateAnswer+findCachedClip / writes 收尾）；`loadScopedSearchableSegments` 加 `.lean()`，51 segments hydration 從 8.8s 降到 ~1s；新增 `[qa-timing]` 診斷 log（可 `QA_TIMING=off` 關閉）
- 重複上傳防呆（2026-05-07，P2-7）：YouTube 路徑於 `createCourseVideoFromYouTube` 在建立前 `Video.findOne({ courseId, youtubeVideoId })`，命中回 `409 DUPLICATE_VIDEO`；mp4 路徑於 `createCourseVideo` 上傳完成後 SHA-256 stream-hash，命中既存 → `unlinkSync` 暫存檔 → 回 `409 DUPLICATE_VIDEO`；`Video` 新增 `fileHash` 欄位 + `{ courseId, fileHash }` index
- 影片多課程掛載（2026-07-12，P1-3）：主課程仍記在 `video.courseId`，其他課程用 `course.videoIds` 掛載引用；新 API `POST /api/v1/courses/:courseId/videos/:videoId/attach|detach`；刪影片/刪課程會清所有課程的引用；掛載課程的學生可播放、記 watched、QA 檢索可命中（memory `segmentMatchesScope` fallback videoId + atlas `bridge_course_or_video` filter 原生支援）；前端 TeacherCourses 提供「掛載既有影片」與「解除」UI
- 老師 dashboard 統計修復（2026-07-12，老師 #13）：Top Queried Segments 在課程所有影片被刪除後不再整列丟棄（先前中文課程「影像處理導論」因此消失），改標 `contentMissing` 並同課程合併一列，前端顯示「內容已下架」badge
- 本地影片自動上傳 YouTube（2026-07-12 實作，feature flag 預設關閉；2026-08-02 完成 live 憑證端對端驗證）：設定 `YOUTUBE_UPLOAD_ENABLED=true` + OAuth 憑證後，教師上傳本地影片會背景自動傳到 YouTube（預設 unlisted），成功回寫 `youtubeVideoId`，學生端自動改用 YouTube iframe 播放；狀態在 `videos.youtubeUpload`
- 學生 Course Progress 真實串接（2026-05-07，P3-2 選項 A 部分完成）：`Enrollment` 新增 `watchedVideoIds: [ObjectId]`；新 endpoint `POST /api/v1/courses/:courseId/videos/:videoId/watched`，service `markVideoWatched` 驗證學生身分 + 影片屬該課程，`$addToSet` 後重算 `progress = watched/total × 100`，第一次觀看時額外寫 `UsageLog event=WATCH metadata.videoId=...`（重複觀看不重複寫）；前端 `StudentCourses.jsx` mp4 用 `onTimeUpdate ≥ 80%` 或 `onEnded`、YouTube 用 `onStateChange ENDED` 或每 5 秒 poll，`watchedMarkedRef` 確保同 session 只 POST 一次。副作用：admin Usage Statistics 卡片的 WATCH 從此可累加（先前永遠為 0 因為沒任何路徑寫 WATCH usage log）
- 學生進度 0% 修復 + 統計語意（2026-07-13；2026-08-02 補 zero-state）：watched 進度分母補算主課程影片、dashboard 依 `watchedVideoIds` 即時重算，解決「孤兒清理後 0%」誤顯（P3-2 收尾）；學生 Dashboard 現只統計 `Enrollment ∩ published Course`，新註冊且無修課／提問紀錄時回 200、零值與空陣列，不再把公開課程目錄誤算為個人進度；`StudentDashboard.jsx` 統計卡片加中文說明與 tooltip（本週＝最近 7 天 vs 累計）；LINE 命中影片無 YouTube 連結時改附「請到網站播放對應時間點」提示，跳轉資訊不再整行消失
- FAQ 快取／常見問題資料庫（2026-07-13）：新增 `faqs` collection 與 `faqCache.service.js`，`qa.service.askQuestion`（API 與 LINE 共用）接兩層快取——正規化文字完全相同直接命中（零 token），或 query embedding cosine 相似度 ≥ 門檻（預設 0.95）命中跳過向量搜尋與 LLM。只快取 runtime ready 且無對話歷史的回答；影片刪除／重新處理完成／課程刪除自動清快取。新 API：`GET/DELETE /api/v1/courses/:courseId/faqs`；設定 `FAQ_CACHE_ENABLED`（預設開）、`FAQ_CACHE_SIMILARITY_THRESHOLD`、`FAQ_CACHE_MAX_ENTRIES_PER_COURSE`
- 錯誤碼 `INVALID_ENCODING` (400)：`utils/textEncoding.js` 偵測客戶端送出的壞 utf-8 body；學生 dashboard 舊壞編碼 fallback 顯示「(編碼異常)」
- AI prompt / 標題防洩漏：`answerGeneration.service.js` 移除 `match.videoId` fallback；`getVideoPresentationTitle` 偵測 ObjectId 後改顯示 `YouTube: <id>`
- `GET /health`：qa + line runtime 可觀察性
- backend Swagger / OpenAPI 已掛在 `/docs`；raw spec 在 `backend/docs/openapi.yaml`，已同步 login role、notifications 與 avatar 契約；internal processing webhook 等少數端點仍以 route files 為準
- backend tests：2026-08-02 全測 341/341 passed（42 suites；含 Dashboard zero-state 與 Admin Enrollment `studentId` 聚合）；隔離 MongoDB 7 已實證三個無 LINE 綁定帳號可穿過 `lineUserId` unique+sparse index，註冊 A/B/C 為 201/409/201；CAS 與併發邊界仍以既有測試與本輪頭貼 E2E 證據為準
- Frontend 11 頁面（Student/Teacher/Admin 各角色 dashboard），登入、教師建立課程、QA grounding、LINE QR 綁定流程已開始串接
- **Phase 2-2 Hierarchical Retrieval Backend 接線（2026-08-02）**：既有 `parentSearch` / `hierarchicalRetrieval` / `childExpansion` / `leafContextAssembly` 與 Leaf-only fallback 保留；新增正式 Atlas Parent Search adapter，依 env 契約執行 `courseId OR allowedVideoIds` scoped 3072 維 `$vectorSearch` 並接入 QA，支援多課程掛載影片。Model 強制 Parent `courseId`／3072 維 embedding，Gemini query 明確使用 `RETRIEVAL_QUERY`／3072 維，Health 會回報不相容 provider。`HIERARCHICAL_RETRIEVAL_ENABLED` 預設仍為 false，Parent 查詢或資料驗證失敗時仍可安全回退 Leaf-only
- **Phase 2-2 Parent Storage（2026-08-02，DB 組）**：新增 `videoSegmentParent.model.js`、`parentVectorIndex.service.js` 與 `npm run db:ensure-parent-storage`（支援 `--dry-run`，輸出自動遮蔽連線字串）。共享 Atlas 已建立 `video_segments_parent`（目前 0 筆）、regular index `parentId_1`（unique）/ `courseId_1_videoId_1` / `videoId_1_hierarchyFingerprint_1`，以及 Atlas Vector Index `parent_embedding_index`（3072 維 cosine，filter=`courseId`+`videoId`），2026-08-02 直連驗證 READY/queryable。跨組決策定案：MVP 採單一 generation（unique `parentId`）、`generationVersion`/`isActive` 保留欄位但不參與 index 與查詢、cleanup 走契約 §12 的 D→A 路線（現階段只 upsert 不刪）、rollback 即關閉 `HIERARCHICAL_RETRIEVAL_ENABLED`。契約見 [docs/Phase2-2_Hierarchy_Data_Contract_v1.md](Phase2-2_Hierarchy_Data_Contract_v1.md)

---

## 未完成 / 缺口

### 跨組待定版（Phase-1 Blocker）

| 項目 | 負責方 | 說明 |
|------|--------|------|
| Atlas vector index / future naming | DB / MongoDB 組 | `text_embedding_index` 已 READY（2026-05-23 驗證），atlas mode 可用。`video_segments_video` 的 `video_embedding_index` 已建立且 READY（2026-07-10 驗證）；backend 已用 course-scoped videos 的檔名 / URL 解析 `video_001` 類 pipeline visual ID，並以 `video_id` filter 接入初版 multimodal visual citation retrieval。限制：視覺片段目前無 transcript / caption，因此回覆只給保守答案與可檢視 citation，不編造畫面內容 |
| init collections 與 Atlas 實況差異 | Database + Backend | 2026-07-24 唯讀實查 Atlas 15 collections、尚無 `notifications`；`init_collections.js` 現列 16 個並已含 `notifications`。不得未核准直接用 shared Atlas 啟服觸發 autoIndex |
| OpenAPI 維護 | Backend | `backend/docs/openapi.yaml` 已涵蓋主要 auth / courses / videos / QA / LINE / stats / admin 端點與 Phase 2 QA contract；internal processing webhook 等少數內部端點仍以 route files 為準 |
| Query embedding 與 pipeline 維度對齊 | AI Pipeline 組 | 目前已改用 Gemini query embedding；仍需持續確認 coverage 與長期契約 |
| `videos` physical storage 邊界 | Backend + DB 組 | 後端回應 contract 已用 `ownership` / `isAppOwned` / `metadataOnly` 固定語意；是否拆 collection 或調整 DB 實體模型仍屬跨組資料庫決策 |
| Live LINE smoke / ops 記錄 | Backend + 外部 | 已有成功提問驗證；仍需保留 callback、channel 與 smoke 紀錄 |
| Phase 2-2 Parent uploader | AI Pipeline 組 | `STT_Whisper/src/mongodb_uploader.py` 目前**完全沒有 parent 相關程式碼**；需新增獨立 upload 路徑讀取 `embeddings_parent_gemini.jsonl`、snake_case→camelCase、以 `parentId` idempotent upsert、產出獨立 upload summary。Storage 端（collection / index）已就緒 |
| ~~Phase 2-2 正式 Parent Search adapter~~ | ✅ Backend 組，2026-08-02 完成 | 已新增 env-backed Atlas adapter、QA 接線、scope／文件契約驗證、安全錯誤分類、Leaf fallback 與測試；待 Parent uploader 提供真實資料後做 live E2E |
| Leaf `courseId` 全為空 | AI Pipeline + DB 組 | 2026-08-02 實查：`video_segments_text` 1,651 筆的 `courseId` **全部 missing**，`text_embedding_index` 的 courseId filter 從未真正生效，實際靠 `videoId` bridge 過濾。Parent upload 需把 courseId 解析成功列為 blocking 條件並於 upload summary 回報，否則同一問題會複製到 parent |
| Demo 環境策略 | 全組 | 共享 DB 是否提供專屬 demo DB |
| ~~Route tests 與 demo 權限同步~~ | ✅ 2026-05-06 完成 | qa.routes / course-video.routes 已對齊；全測試 83/83 passed |
| ~~Student dashboard questions 統計~~ | ✅ 2026-05-06 完成 | `visibleQuestionFilter` 已改為 `userId` |

### Frontend 現況（API 整合已完成）

- 11 個頁面全數串接 backend API：登入、課程列表、QA、LINE 綁定、Topbar 站內通知與 Profile 頭貼皆已接通
- YouTube URL 上傳模式與學生端 YouTube iframe / timestamp 跳轉已接入；demo 已實際執行過

### Pipeline 待確認

- `clips` 與 `video_segments_video` 正式分工；目前 QA 只把 `video_segments_video` 當視覺 citation retrieval 來源，不當 caption 或正式 clip publishing source
- 哪些影片已有 searchable segments 覆蓋率（2026-05-23 共享 Atlas 為 16 支影片 + 130 筆 segments）

---

## 教授開會決議（2026-04-21）

以下為最近一次與指導教授開會確定的方向，對後續開發有影響：

| 決議事項 | 說明 |
|---------|------|
| 影片託管採 YouTube | 不自建串流伺服器；透過 YouTube embed API 追蹤觀看狀態（暫停、換分頁等）；LINE Bot 回覆影片連結時帶上時間戳 |
| 禁止學生直接上傳影片 | 避免版權問題；改為「分享連結」方式（如 YouTube URL）|
| LINE Bot 不完全整合進網頁 | 網頁負責影片觀看；LINE Bot 負責問答；各自角色獨立 |
| LINE 綁定流程 | 目前一次性 token 可接受；未來前端以 QR Code 顯示（課程ID帶入 QR）|
| 6月2日 demo 重點 | 展示完整工作流程（pipeline → 問答 → LINE 回覆影片時間戳），細節不盡完美亦可 |
| API 使用成本 | 後端已提供 QA 月 budget / user quota guardrails；實際上限值需由部署環境填入 |

---

## 下一步優先順序

1. Backend + AI Pipeline + DB 組共同把即將停用的 `gemini-embedding-2-preview` 遷移到 `gemini-embedding-2`：定版 query/document instruction、重建既有 Leaf／Parent embeddings、驗證 Atlas 查詢與 rollback；不可只切 Backend model
2. AI Pipeline 完成 Parent uploader，將 `courseId` 解析成功、3072 維 embedding 與 upload summary 列為發布必要條件
3. 以隔離資料驗證 Parent Atlas Search → Child expansion → Leaf Citation，再依 latency 實測調整 timeout；全部通過前維持 Gate 關閉
4. DB owner 稽核 `video_segments_text.chunkId` 的重複／null 分布，建立 classic index 並用 explain 確認 Child Expansion 不走 COLLSCAN
5. 上線前 hardening：`backend/uploads/` 自動清理策略與真實部署 runbook
6. ~~YouTube auto-upload 真實 OAuth smoke、OAuth 同意畫面發布正式版~~（✅ 2026-08-02 全部完成，含刪除轉 private 與重換不過期的 refresh token）
7. 決定 demo 環境策略（共享 DB or 獨立 demo DB）
8. 跨組 freeze phase-1 契約（`videos` physical storage 是否拆分、demo seed 流程）

---

## 不能誤稱的邊界

- YouTube auto-upload 與刪除轉 private **已於 2026-08-02 完成 live 憑證驗證**，OAuth 同意畫面同日發布為正式版、refresh token 不再 7 天過期；但未送 Google 驗證（授權時仍有未驗證警告、100 使用者上限），也尚未長期運行觀察，不能說成「已長期穩定運作」
- 上傳預設 unlisted 是**架構限制**：YouTube private 影片無法用 iframe 嵌入，學生端會播不出來。unlisted = 拿到連結就能看，不能說成「只有修課學生看得到」；影片連結只發給有課程存取權的人，剩餘風險是學生自行轉貼
- Atlas vector retrieval：`text_embedding_index` 於 2026-05-23 直連驗證為 READY/queryable，atlas mode 目前可用；仍須持續確認 query embedding 與 pipeline 資料覆蓋率的一致性
- Query embedding **已切到 Gemini，但仍需持續確認與 pipeline 資料覆蓋率的一致性**
- `video_segments_video` **已接入初版 visual citation retrieval**；目前 Atlas `video_embedding_index` 已 READY，backend 會從 course-scoped videos 的檔名 / URL 解析 pipeline visual ID 後用 `video_id` filter 檢索。仍不能誤稱為 caption QA 或正式 clip publishing source，因為視覺片段沒有 transcript / caption
- Live LINE **已有成功提問驗證，但尚未完成完整運維化紀錄**
- LINE webhook **已納入 OpenAPI 文件**，但 stats/admin 與部分 PATCH/DELETE 尚未納入；OpenAPI 目前不是完整 API 契約
- LIFF **不是目前 repo 已上線流程**；目前實際存在的是 LINE webhook + bind-token/message QR，LIFF endpoints / pages 尚未實作
- Shorts backend **只完成修課 feed、ShortAsset 保存/封存與 YouTube metadata 可用性同步**；自動選片、剪輯、字幕、發布 worker與教師管理尚未實作，現有前端也尚未帶 JWT 呼叫新 feed
- Phase 2-2 已完成 storage 與正式 Backend Parent Search adapter，但**尚未啟用或完成 live E2E**：`video_segments_parent` 目前 **0 筆資料**、Parent uploader 尚未實作、`HIERARCHICAL_RETRIEVAL_ENABLED` 仍為 false。Parent → Leaf → Answer 尚未以真實 Atlas Parent 文件跑過端對端流程
- Embedding 模型遷移尚未完成：目前 Backend／Pipeline 使用的 preview model 對應 Google deprecation 表中的 `embedding-2-preview`，最早停用日為 **2026-08-10**；替代模型 `gemini-embedding-2` 的 task instruction 與向量空間需跨組同步，既有向量不可直接混用
- Phase 2-2 契約文件 `docs/Phase2-2_Hierarchy_Data_Contract_v1.md` 內大量條目標記為 `[Proposed for v1]` / `[Database review required]`，**不是全部已定案**；目前已由 DB 組拍板的只有 collection 名稱、unique 策略、generation 欄位處理、index 名稱與 cleanup 路線五項
