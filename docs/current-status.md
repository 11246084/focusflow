# docs/current-status.md — FocusFlow 目前進度

最後更新：2026-07-10

> 這份文件是跨服務的動態進度頁。後端詳細狀態見 [backend/docs/current-state.md](../backend/docs/current-state.md)。

---

## Phase-1 整體完成度

| 服務 | 狀態 | 說明 |
|------|------|------|
| **Backend** | ✅ 主線可用，全測試 103/103 | auth（login + 自助 register）/ courses（CRUD）/ videos / qa / LINE / stats / admin 已可用；共享環境設定為 `gemini + atlas + gemini`，Atlas `text_embedding_index` 已 READY（2026-05-23 直連驗證）；LINE Bot 多輪對話歷史；提問自動寫入 `questions`；2026-07-10 新增 Phase 2 QA contract：`citations`、`answerStatus`、source video、timestamp、match/no-answer 狀態；`video_segments_video` 初版視覺向量檢索已接入 course-scoped QA citation；YouTube auto-upload adapter 已支援 OAuth refresh token + resumable upload，真實 smoke 待 FocusFlow Google 憑證；QA cost guardrails 已支援全站月 token budget、單一使用者月 quota、UTC 月重置與 `/health` snapshot；2026-05-07 完成 dashboard / QA 平行化 + `.lean()` + `[qa-timing]` 診斷、重複上傳防呆（YouTube + mp4 SHA-256）、學生 watched 進度 endpoint、`POST /api/v1/auth/register` 限 student/teacher 自助註冊 |
| **Frontend** | ✅ 第一階段頁面完成 | 登入頁 + 註冊頁 + 11 頁面（Student/Teacher/Admin × 多頁）；登入頁「立即註冊」按鈕連到 `RegisterPage`，註冊成功直接登入；11 頁面已全數串接 backend API（每頁皆呼叫 `apiFetch`）：教師建立課程、LINE QR 綁定、QA grounding 皆已串接；教師上傳表單支援多支影片連續上傳；學生端 YouTube 影片用 IFrame API 播放 |
| **AI Pipeline** | ✅ 可執行 | STT → chunking → embedding → MongoDB 主流程完整；本機上傳與 YouTube URL 都可由 backend 自動 spawn；mongodb_uploader 寫入前 race-condition guard |

---

## Backend 目前 Runtime（2026-05-23 更新）

```
QA_QUERY_EMBEDDING_PROVIDER = gemini
QA_VECTOR_SEARCH_MODE       = atlas
QA_ATLAS_VECTOR_INDEX_NAME  = text_embedding_index
QA_ATLAS_FILTER_MODE        = bridge_course_or_video
QA_ANSWER_PROVIDER          = gemini
GEMINI_CHAT_MODEL           = gemini-2.5-flash
DEMO_SEED_ENABLED           = false  （需手動 npm run seed）
```

- `/health` 可直接觀察 `runtime.qa`、`runtime.line` 與 `runtime.multimodal` 狀態
- `/health.runtime.qa.costControl` 可觀察 QA 月 token budget / user quota 是否啟用；quota 以 UTC calendar month 自動重置
- QA misconfig 與 Atlas not ready 已 fail-fast，不靜默降級
- **共享 Atlas 現況**（2026-05-23 直連驗證）：`videos` 16 筆、`video_segments_text` 130 筆，`text_embedding_index` 存在且 READY/queryable（3072 維 cosine，filter=`courseId`+`videoId`，3 shards 全 READY）；`.env` 的 `atlas` mode 可正常檢索，不需切回 `memory`
- LINE Bot 已端對端驗證；正式部署前 ngrok URL / Channel 設定須再確認

---

## 已完成

- auth / JWT / RBAC 主線
- courses CRUD（含 PATCH/DELETE）、videos CRUD、processing 狀態流程
- 影片上傳後自動 spawn STT pipeline（`video.service.js`），pipeline 透過 `/api/v1/internal/videos/:id/processing/{start,complete,fail}` 回報狀態
- YouTube URL MVP：教師可貼 YouTube URL 建立影片；STT 用 `yt-dlp` 下載音訊；學生端用 YouTube IFrame API 播放並支援 QA timestamp 跳轉；LINE Bot 可回傳 YouTube timestamp link
- YouTube auto-upload adapter：`YOUTUBE_AUTO_UPLOAD_ENABLED=true` 時，本機影片可由 backend 用 FocusFlow OAuth refresh token 走 YouTube Data API resumable upload，成功後保存 `youtubeVideoId/videoUrl`；仍需真實 OAuth 憑證 smoke
- `/api/v1/qa/ask`：answer、matches、時間資訊、runtime 訊號
- `/api/v1/qa/ask` Phase 2 contract：新增 `citations[]`（source video、timestamp、jump URL、match confidence、transcript snippet）與 `answerStatus`（answered/no_answer、confidence、noAnswerReason），`matches[]` 保留為 legacy/debug 相容欄位
- Clip / Shorts Phase 2 contract：已定義 candidate / job / asset 三層語意、狀態轉移、權限、預留端點與錯誤碼；尚未實作正式 routes / background worker
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
- 刪除 cascade（2026-05-07）：教師可刪自己課程（route 放寬到 TEACHER + ADMIN，service 仍限 admin 或 owner teacher）；`deleteVideo` / `deleteCourse` cascade 清 Video / Segment / transcripts / `course.videoIds $pull` / `Enrollment` / `User.activeCourseId $unset`；**撤銷** UsageLog / Question cascade（保留歷史紀錄），改由 display 分流（老師 Top Segments filter、學生 Recent Queries / 管理員 Recent Events 顯示「內容已下架」badge）
- QA 拒答（2026-05-07）：scope 內無 live video 時直接回「這門課目前沒有可回答的影片資料」，不叫 AI；LINE 課程選單 `filterCoursesWithLiveVideos()` 過濾沒有 live video 的課程
- QA 效能優化（2026-05-07）：`qa.service.js` 三處平行（access+videos / generateAnswer+findCachedClip / writes 收尾）；`loadScopedSearchableSegments` 加 `.lean()`，51 segments hydration 從 8.8s 降到 ~1s；新增 `[qa-timing]` 診斷 log（可 `QA_TIMING=off` 關閉）
- 重複上傳防呆（2026-05-07，P2-7）：YouTube 路徑於 `createCourseVideoFromYouTube` 在建立前 `Video.findOne({ courseId, youtubeVideoId })`，命中回 `409 DUPLICATE_VIDEO`；mp4 路徑於 `createCourseVideo` 上傳完成後 SHA-256 stream-hash，命中既存 → `unlinkSync` 暫存檔 → 回 `409 DUPLICATE_VIDEO`；`Video` 新增 `fileHash` 欄位 + `{ courseId, fileHash }` index。仍未涵蓋：跨課程共用同一支影片（屬 P1-3）
- 學生 Course Progress 真實串接（2026-05-07，P3-2 選項 A 部分完成）：`Enrollment` 新增 `watchedVideoIds: [ObjectId]`；新 endpoint `POST /api/v1/courses/:courseId/videos/:videoId/watched`，service `markVideoWatched` 驗證學生身分 + 影片屬該課程，`$addToSet` 後重算 `progress = watched/total × 100`，第一次觀看時額外寫 `UsageLog event=WATCH metadata.videoId=...`（重複觀看不重複寫）；前端 `StudentCourses.jsx` mp4 用 `onTimeUpdate ≥ 80%` 或 `onEnded`、YouTube 用 `onStateChange ENDED` 或每 5 秒 poll，`watchedMarkedRef` 確保同 session 只 POST 一次。副作用：admin Usage Statistics 卡片的 WATCH 從此可累加（先前永遠為 0 因為沒任何路徑寫 WATCH usage log）。仍未做：「孤兒清理後 0%」顯示異常修復
- 錯誤碼 `INVALID_ENCODING` (400)：`utils/textEncoding.js` 偵測客戶端送出的壞 utf-8 body；學生 dashboard 舊壞編碼 fallback 顯示「(編碼異常)」
- AI prompt / 標題防洩漏：`answerGeneration.service.js` 移除 `match.videoId` fallback；`getVideoPresentationTitle` 偵測 ObjectId 後改顯示 `YouTube: <id>`
- `GET /health`：qa + line runtime 可觀察性
- backend Swagger / OpenAPI 已掛在 `/docs`；raw spec 在 `backend/docs/openapi.yaml`，但尚未涵蓋 stats/admin 路由，也缺 courses/videos 的 PATCH/DELETE，API 清單暫以實際 route files 與 README 為準
- backend tests：11 個測試檔（auth、course-video、qa.routes、qa.service、line.routes、health、docs、api-response、demo-seed.service、answer-generation.service、mvp.acceptance），in-memory store，不依賴真實 MongoDB
- Frontend 11 頁面（Student/Teacher/Admin 各角色 dashboard），登入、教師建立課程、QA grounding、LINE QR 綁定流程已開始串接

---

## 未完成 / 缺口

### 跨組待定版（Phase-1 Blocker）

| 項目 | 負責方 | 說明 |
|------|--------|------|
| Atlas vector index / future naming | DB / MongoDB 組 | `text_embedding_index` 已 READY（2026-05-23 驗證），atlas mode 可用。`video_segments_video` 的 `video_embedding_index` 已建立且 READY（2026-07-10 驗證）；backend 已用 course-scoped videos 的檔名 / URL 解析 `video_001` 類 pipeline visual ID，並以 `video_id` filter 接入初版 multimodal visual citation retrieval。限制：視覺片段目前無 transcript / caption，因此回覆只給保守答案與可檢視 citation，不編造畫面內容 |
| init collections 與 Atlas 實況差異 | Database + Backend | Atlas 13 collections；`init_collections.js` 列 15 個。init 多 `stt_cache` / `raw_transcripts` / `video_segments`，Atlas 多 `questions` |
| OpenAPI 維護 | Backend | `backend/docs/openapi.yaml` 已涵蓋主要 auth / courses / videos / QA / LINE / stats / admin 端點與 Phase 2 QA contract；internal processing webhook 等少數內部端點仍以 route files 為準 |
| Query embedding 與 pipeline 維度對齊 | AI Pipeline 組 | 目前已改用 Gemini query embedding；仍需持續確認 coverage 與長期契約 |
| `videos` physical storage 邊界 | Backend + DB 組 | 後端回應 contract 已用 `ownership` / `isAppOwned` / `metadataOnly` 固定語意；是否拆 collection 或調整 DB 實體模型仍屬跨組資料庫決策 |
| Live LINE smoke / ops 記錄 | Backend + 外部 | 已有成功提問驗證；仍需保留 callback、channel 與 smoke 紀錄 |
| Demo 環境策略 | 全組 | 共享 DB 是否提供專屬 demo DB |
| ~~Route tests 與 demo 權限同步~~ | ✅ 2026-05-06 完成 | qa.routes / course-video.routes 已對齊；全測試 83/83 passed |
| ~~Student dashboard questions 統計~~ | ✅ 2026-05-06 完成 | `visibleQuestionFilter` 已改為 `userId` |

### Frontend 現況（API 整合已完成）

- 11 個頁面全數串接 backend API（每頁皆呼叫 `apiFetch`）：登入、課程列表、QA 問答、LINE 綁定流程皆已接通
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

1. 上線前 hardening：`backend/uploads/` 自動清理策略與真實部署 runbook
2. YouTube auto-upload 真實 OAuth smoke
3. 決定 demo 環境策略（共享 DB or 獨立 demo DB）
4. 跨組 freeze phase-1 契約（`videos` physical storage 是否拆分、demo seed 流程）

---

## 不能誤稱的邊界

- Atlas vector retrieval：`text_embedding_index` 於 2026-05-23 直連驗證為 READY/queryable，atlas mode 目前可用；仍須持續確認 query embedding 與 pipeline 資料覆蓋率的一致性
- Query embedding **已切到 Gemini，但仍需持續確認與 pipeline 資料覆蓋率的一致性**
- `video_segments_video` **已接入初版 visual citation retrieval**；目前 Atlas `video_embedding_index` 已 READY，backend 會從 course-scoped videos 的檔名 / URL 解析 pipeline visual ID 後用 `video_id` filter 檢索。仍不能誤稱為 caption QA 或正式 clip publishing source，因為視覺片段沒有 transcript / caption
- Live LINE **已有成功提問驗證，但尚未完成完整運維化紀錄**
- LINE webhook **已納入 OpenAPI 文件**，但 stats/admin 與部分 PATCH/DELETE 尚未納入；OpenAPI 目前不是完整 API 契約
- LIFF **不是目前 repo 已上線流程**；目前實際存在的是 LINE webhook + bind-token/message QR，LIFF endpoints / pages 尚未實作
