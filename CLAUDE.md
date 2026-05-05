# CLAUDE.md

本檔案提供 Claude Code 在 FocusFlow 專案中的工作指引。

> 本文件是給 Claude Code 的操作規則；跨代理入口索引請看 [AGENTS.md](AGENTS.md)。修改規範時，兩份文件需保持一致。

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

教師上傳影片或貼 YouTube URL → backend 觸發 STT pipeline → 產生文字片段與 embedding → 學生在前端或 LINE Bot 提問 → 系統回傳 AI 答案與影片時間戳。

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
GEMINI_CHAT_MODEL=gemini-2.5-flash
DEMO_SEED_ENABLED=false
```

重要邊界：

- 共享 Atlas 在 2026-05-01 驗證時已沒有 `text_embedding_index`。若維持 `QA_VECTOR_SEARCH_MODE=atlas`，需先重建 index；否則 QA 會 fail-fast。
- 本機無 API key smoke 可改成：

```env
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_ANSWER_PROVIDER=template
QA_VECTOR_SEARCH_MODE=memory
```

- `QA_ANSWER_PROVIDER=gemini` 時必須設定 `GEMINI_API_KEY`；缺 key 不會 fallback，會直接回設定錯誤。
- `QA_VECTOR_SEARCH_MODE=atlas` 搭配 `QA_QUERY_EMBEDDING_PROVIDER=mock` 是不合法設定。
- `/health` 是判斷 `runtime.qa`、`runtime.line` 是否 ready 的入口，不要只看 `.env` 推測狀態。

## QA / Video / LINE 邊界

### QA Provider

支援：

- `QA_QUERY_EMBEDDING_PROVIDER`: `mock` | `openai` | `gemini`
- `QA_ANSWER_PROVIDER`: `template` | `openai` | `gemini`
- `QA_VECTOR_SEARCH_MODE`: `memory` | `atlas`

QA 與 LINE Bot 提問都會寫入 `questions` collection，並保留 matches、runtime 與 `sourceUsageLogId`。

### Video Model

`videos` collection 是 mixed collection：

- App-owned video：有 `courseId`、`uploadedBy`、`title`、`processing.status`
- Pipeline metadata：有 `video_id` 或 `videoId`，但不是 app-owned

QA bridge contract：

```text
course.videoIds -> videos._id -> videos.videoId -> video_segments_text.videoId
```

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

- 不能說目前共享 Atlas 的 atlas mode ready；`text_embedding_index` 已不存在，除非重建。
- 不能把單次 LINE live smoke 說成正式部署完成。
- 不能說所有前端頁面都已完整 API 串接；目前是整合中。
- 不能說 YouTube Data API 自動上傳已完成；目前完成的是教師貼 YouTube URL。
- 不能說 `video_segments_video` 已接成正式 multimodal QA source。
- 不能把 OpenAPI 當成完整 API 契約；它仍缺 stats/admin 與部分 PATCH/DELETE。
