# CLAUDE.md

本檔案提供 Claude Code 在 FocusFlow 專案中的工作指引。

> 本文件是給 Claude Code 的操作規則；跨代理入口索引請看 [AGENTS.md](AGENTS.md)。修改規範時，兩份文件需保持一致。

## 接手讀取順序

Claude Code 接手任何 FocusFlow 任務時，先建立上下文，再開始修改：

1. 先讀 [AGENTS.md](AGENTS.md)，確認跨 agent 入口、專案服務與文件索引。
2. 依 `AGENTS.md` 的「AI Agent 實作前讀取清單」選擇任務相關文件。
3. 依任務類型讀 `.claude/rules/` 對應規則。
4. 再讀實際程式碼與測試，避免只根據單一文件或舊會議紀錄推論現況。

注意：
- `docs/current-status.md` 與 `backend/docs/current-state.md` 是目前狀態入口。
- `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` 僅供歷史參考，不可當成目前資料庫真相。
- `CLAUDE.local.md` 是個人本機偏好，不是團隊共用規範。

## 專屬規則

進行對應任務前，先閱讀規則檔：

| 任務類型 | 規則檔 |
|----------|--------|
| API route / controller / response / error code | `@.claude/rules/api-design.md` |
| Mongoose schema / index / data access | `@.claude/rules/database.md` |
| 測試或 test harness | `@.claude/rules/testing.md` |
| JWT / password / validation / CORS | `@.claude/rules/security.md` |

## 專案概述

**FocusFlow** 是 Phase 1 MVP 的 AI 教學影片問答系統：

教師本地上傳影片（單一軌道，2026-07-12 起）→ backend 觸發 STT pipeline → 產生文字片段與 embedding（設定憑證時另自動上傳 YouTube）→ 學生在前端或 LINE Bot 提問 → 系統回傳 AI 答案與影片時間戳。貼 YouTube URL 的 API 保留但不在教師上傳頁露出。

三個服務：

- `backend/` — Node.js / Express REST API，預設 port `4000`
- `frontend/focus-flow/` — React 19 + Vite SPA，預設 port `5173`
- `STT_Whisper/` — Python 離線 AI Pipeline CLI

最新跨服務狀態以 [docs/current-status.md](docs/current-status.md) 為準；backend 細節以 [backend/docs/current-state.md](backend/docs/current-state.md) 為準。

## 常用指令

### Backend

首次設定：

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

常用指令：

```powershell
npm start
npm run seed
npm run seed:reset
npm run db:sync-atlas
npm test
node --test --experimental-test-isolation=none --test-concurrency=1 tests\<file>.test.js
```

注意：

- `npm run seed` 是 converge baseline，不清除既有資料。
- `npm run seed:reset` 會保守清除 demo-owned / demo-derived 痕跡後重建。
- `db:ensure-questions`、`db:backfill-questions` 目前是 dangling scripts，對應檔案不存在，除非先補檔或修 package script，否則不要執行。
- Swagger UI 掛在 `/docs`，raw spec 掛在 `/docs/openapi.yaml`，repo 規格檔在 `backend/docs/openapi.yaml`。
- OpenAPI 目前尚未完整涵蓋 stats/admin 與部分 PATCH/DELETE 端點，完整 API 清單暫以 route files、README、backend current-state 為準。

### Frontend

```powershell
cd frontend\focus-flow
npm install
Copy-Item .env.example .env
npm run dev
```

修改前端後至少執行：

```powershell
npm run lint
npm run build
```

### AI Pipeline

```powershell
cd STT_Whisper
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python src/main.py --limit 1
```

Backend 自動觸發 pipeline 時會優先使用 `STT_Whisper/.venv/Scripts/python.exe`。YouTube URL MVP 需要 `yt-dlp`，已列在 `STT_Whisper/requirements.txt`。

## Backend 架構

遵循 `routes -> controllers -> services -> models`：

```text
backend/src/
├── server.js          # 連 DB、seed、啟動 Express
├── app.js             # Express 設定、middleware、docs、route mount
├── routes/            # auth、course、video、qa、line、stats、admin、health、internal-video
├── controllers/       # HTTP request/response layer
├── services/          # 業務邏輯
├── models/            # Mongoose schema
├── middleware/        # auth、role、upload、LINE signature、error handling
├── config/            # env.js、database.js
├── constants/         # enum / lifecycle constants
├── utils/             # apiResponse、AppError、ObjectId helpers
└── scripts/           # seedDemoUsers、syncLocalMongoToAtlas、syncQuestionsToAtlas
```

Controllers 不放主要業務邏輯；新增或修改行為時，優先把規則寫進 service，controller 只負責輸入、呼叫 service、回應。

## Runtime 與環境變數

`backend/src/config/env.js` 的程式碼預設偏本機可跑；`backend/.env.example` 目前代表共享 demo 主線，偏 `gemini + atlas + gemini`。

共享 demo 主線：

```env
QA_QUERY_EMBEDDING_PROVIDER=gemini
QA_VECTOR_SEARCH_MODE=atlas
QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index
QA_ATLAS_FILTER_MODE=bridge_course_or_video
QA_ANSWER_PROVIDER=gemini
GEMINI_CHAT_MODEL=gemini-3.5-flash
QA_MATCH_LIMIT=15
DEMO_SEED_ENABLED=false
```

重要邊界：

- 共享 Atlas 的 `text_embedding_index` 狀態以實查為準：2026-05-01 曾驗證為不存在，但 2026-06-05 重新查證已存在且 `status=READY`（`video_segments_text`，3072 維，130 筆）。狀態請以連 Atlas 實查為準（不要憑文件斷言）。若哪天又查到不存在，需先重建 index，否則 atlas 模式會 fail-fast。
- 本機無 API key smoke 可改成：

```env
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_ANSWER_PROVIDER=template
QA_VECTOR_SEARCH_MODE=memory
```

- `QA_ANSWER_PROVIDER=gemini` 時必須設定 `GEMINI_API_KEY`；缺 key 不會 fallback，會直接回設定錯誤。
- `QA_VECTOR_SEARCH_MODE=atlas` 搭配 `QA_QUERY_EMBEDDING_PROVIDER=mock` 是不合法設定。
- `QA_MATCH_LIMIT` 決定送進 answer prompt 的片段數，直接決定答案品質。2026-07-25 從 `3` 調成 `15`：`3` 時整門課只有約 166 字進 prompt（全課程逐字稿約 6,700 字），跨片段歸納型問題會一律回「目前資料庫片段不足以回答這個問題。」。調整這個值後既有 FAQ 快取不會失效，需手動 `DELETE /api/v1/courses/:courseId/faqs` 才看得到差異。
- `/health` 是判斷 `runtime.qa`、`runtime.line`、`runtime.youtubeUpload` 是否 ready 的入口，不要只看 `.env` 推測狀態。YouTube 憑證是否有效、scope 夠不夠轉 private，都要看 `/health.runtime.youtubeUpload`，不要憑 `.env` 有填就當作可用。

## QA / Video / LINE 邊界

### QA Provider

支援：

- `QA_QUERY_EMBEDDING_PROVIDER`: `mock` | `openai` | `gemini`
- `QA_ANSWER_PROVIDER`: `template` | `openai` | `gemini`
- `QA_VECTOR_SEARCH_MODE`: `memory` | `atlas`

QA 與 LINE Bot 提問都會寫入 `questions` collection，並保留 matches、runtime 與 `sourceUsageLogId`。

### FAQ 快取（2026-07-13）

`askQuestion` 內建兩層 FAQ 快取（`faqs` collection + `faqCache.service.js`，API 與 LINE 共用）：正規化文字完全相同直接命中（零 token）；否則以 query embedding 對課程 FAQ 比 cosine 相似度 ≥ `FAQ_CACHE_SIMILARITY_THRESHOLD`（預設 0.95）命中，跳過向量搜尋與 LLM。命中時 `runtime.faqCache.hit=true`、`answerProviderUsed='faq_cache'`，仍照常寫 `usage_logs` 與 `questions`。只快取 runtime ready 且無對話歷史的回答；影片刪除／重新處理完成／課程刪除會自動清該課程快取。修改 QA 回應格式時，快取命中路徑（`respondFromFaqCache`）需同步；測試要走非快取路徑可設 `FAQ_CACHE_ENABLED=false` 或避免同題重問。

自動失效時機（`faqs` 無 TTL，只有事件驅動失效）：影片刪除、影片重新處理完成、課程刪除、影片掛載到課程（`attachVideoToCourse`）、影片自課程移除（`detachVideoFromCourse`）。另有容量淘汰：單一課程超過 `FAQ_CACHE_MAX_ENTRIES_PER_COURSE` 時砍 `hitCount` 最低的。

「答不出來」的回覆不會被快取（2026-07-25 起）：`answerGeneration.service.js` 的 `isNoAnswerReply()` 比對兩個罐頭字串（`NO_ANSWER_INSUFFICIENT` / `NO_ANSWER_UNDETERMINED`，同一份常數直接插進 prompt 避免走鐘），命中時 `shouldSaveFaq` 為 false。修改 prompt 的罐頭文案時改常數，不要改 prompt 內的字面字串。

**尚存缺口：設定 / 模型 / prompt 變更不會讓快取失效**。改 `QA_MATCH_LIMIT`、`GEMINI_CHAT_MODEL` 或 prompt 規則後，舊快取仍回舊答案，必須手動 `DELETE /api/v1/courses/:courseId/faqs`。

### Video Model

`videos` collection 是 mixed collection：

- App-owned video：有 `courseId`、`uploadedBy`、`title`、`processing.status`
- Pipeline metadata：有 `video_id` 或 `videoId`，但不是 app-owned

QA bridge contract：

```text
course.videoIds -> videos._id | videos.videoId | videos.video_id -> video_segments_text.videoId
```

`bridgeScope.service.js` 會把同一支影片的 `_id`、`videoId`、`video_id` **三種 key 全部**放進 allowed set，命中任一即納入 scope。實務分佈：

- App-owned 影片**沒有 `videoId` 欄位**（值為 `undefined`），pipeline 直接把 `String(videos._id)` 寫進片段的 `videoId`
- 只有 pipeline metadata 影片才有 `videoId` / `video_id`

所以查 collection 時不要用 `videos.videoId` 去 join `video_segments_text`，app-owned 影片會全部對不到（2026-07-25 排查時踩過）。要用 `String(videos._id)`。

不要誤稱 `video_segments_video` 已成為正式 clip source；它目前仍是預留 / legacy 邊界，且欄位仍偏 snake_case。

### Processing State Machine

影片處理由 `videoProcessing.service.js` 強制狀態轉換：

| 操作 | 前置狀態 | 目標狀態 |
|------|----------|----------|
| retry | `failed` | `queued` |
| start webhook | `queued` | `processing` |
| complete webhook | `processing` | `completed` |
| fail webhook | `queued` 或 `processing` | `failed` |

非法轉換回 `409 VIDEO_PROCESSING_TRANSITION_INVALID`。

### LINE Bot

LINE Bot 在 `User` 上維護：

- `lineConversationState`
- `lineConversationHistory`，最近 6 筆訊息
- `activeCourseId`

切換課程時，選項 = 自己 enrollment ∪ 所有 `published` 課程，去重後最多顯示 4 筆。

LINE live 曾端對端驗證成功，但 ngrok URL、Channel Secret、Channel Access Token 是部署時變動項。不要把暫時 ngrok URL 寫成固定正式網址。

## 測試規範

### Backend

測試位於 `backend/tests/`，使用 Node 內建 `node:test`。route tests 透過 `tests/helpers/backendTestHarness.js` 的 in-memory store，不依賴真實 MongoDB。

修改 backend 後至少執行：

```powershell
cd backend
npm test
```

若只改單一模組，可先跑單檔：

```powershell
node --test --experimental-test-isolation=none --test-concurrency=1 tests\<file>.test.js
```

### Frontend

目前沒有正式自動化測試框架。修改 frontend 後至少執行：

```powershell
cd frontend\focus-flow
npm run lint
npm run build
```

### AI Pipeline

目前沒有正式自動化測試套件。修改 pipeline 後至少確認相關 CLI 可執行；若依賴 FFmpeg、外部模型或 API key，回覆中需說明是否實際驗證。

## 開發原則

- 僅專注 Phase 1 MVP，不提前實作後續階段功能。
- 優先沿用既有資料夾、命名、service pattern、response helper 與 error middleware。
- 非必要不重新命名、不搬動大型結構、不重寫無關模組。
- 新增 API 時維持 request/response 格式一致，補基本輸入驗證與清楚錯誤碼。
- 修改 schema、index、資料存取前，先讀 `.claude/rules/database.md`。
- 涉及 JWT、密碼、CORS、LINE signature、外部 webhook secret 前，先讀 `.claude/rules/security.md`。
- 不刪除檔案或清資料，除非使用者明確要求且已確認影響。

## 文件更新

修改功能時，檢查是否需要同步：

- [README.md](README.md)
- [docs/current-status.md](docs/current-status.md)
- [backend/docs/current-state.md](backend/docs/current-state.md)
- [backend/docs/openapi.yaml](backend/docs/openapi.yaml)
- `backend/.env.example`
- `frontend/focus-flow/README.md`
- `STT_Whisper/README.md`

若只修內部實作且對使用方式、runtime、API contract 沒影響，可以不改文件，但完成回覆中需明確說明未改文件的理由。

## 不能誤稱的邊界

- 共享 Atlas 的 atlas mode 是否 ready 以實查為準：2026-06-05 查證 `text_embedding_index` 已存在且 READY，atlas 模式具備可跑條件（仍需 `QA_QUERY_EMBEDDING_PROVIDER=gemini` + `GEMINI_API_KEY`）。不要憑舊文件斷言它不存在，請連 Atlas 實查 `listSearchIndexes` 確認。
- 不能把單次 LINE live smoke 說成正式部署完成。
- 不能說所有前端頁面都已完整 API 串接；目前是整合中。
- YouTube Data API 自動上傳：2026-08-02 已用真實 OAuth 憑證完成 live 端對端驗證（教師上傳 → 影片以 unlisted 出現在 FocusFlow 頻道）。feature flag `YOUTUBE_UPLOAD_ENABLED` 預設仍關閉，需 `youtube.force-ssl` scope 的 refresh token。OAuth 同意畫面同日已發布為正式版（未送 Google 驗證，授權時仍顯示未驗證警告、未驗證 app 有 100 使用者上限），refresh token 不再 7 天過期；但尚未經過長期運行觀察，不能說成「已長期穩定運作」。
- 刪除影片／課程時轉 private（2026-08-02，`privatizeVideoOnDelete`）：同日已 live 驗證（系統刪除後 YouTube Studio 顯示「私人」）。只處理 `youtubeUpload.status === 'uploaded'` 的自家頻道影片；轉 private 失敗只記 log 不中斷刪除，所以不能說「刪除必定讓 YouTube 影片下架」。
- 上傳預設 unlisted 是架構限制不是疏漏：private 影片無法用 iframe 嵌入播放，學生端會全部掛掉。unlisted 代表「拿到連結就能看」，不能說成「只有修課學生看得到」。
- 不能說 `video_segments_video` 已接成正式 multimodal QA source。
- 不能把 OpenAPI 當成完整 API 契約；它仍缺 stats/admin 與部分 PATCH/DELETE。
