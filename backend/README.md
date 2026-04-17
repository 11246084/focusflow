# FocusFlow Backend

`focusflow` phase-1 MVP 的 backend 目前已整理到可穩定 demo、可重現、可交接的狀態，但仍明確保留 phase-1 的 bridge 與協作邊界。

## 目前真實 runtime

phase-1 預設應視為：

```env
DEMO_SEED_ENABLED=false
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_VECTOR_SEARCH_MODE=memory
QA_ANSWER_PROVIDER=gemini
QA_ATLAS_FILTER_MODE=bridge_course_or_video
QA_ATLAS_VECTOR_INDEX_NAME=
```

代表：

- query embedding 仍是 mock，不是正式 3072 維對齊
- retrieval 正式模式仍是 memory
- answer provider 正式模式是 Gemini
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

`course.videoIds -> videos._id -> videos.video_id -> video_segments_text.video_id|videoId`

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

### backend-only 可驗證內容

- `POST /api/v1/line/bind-token`
- bind token -> bind
- `切換課程`
- `select_course` postback
- question routing 到 QA

### live LINE 與 backend-only 的差異

- 有 `LINE_CHANNEL_SECRET + LINE_CHANNEL_ACCESS_TOKEN`
  - webhook 可驗簽且可送出 live reply
- 只有 `LINE_CHANNEL_SECRET`
  - webhook route 仍可做 backend-only 驗證
  - `/health` 會顯示 `runtime.line.readiness=degraded`
  - `/health` 會顯示 `runtime.line.deliveryMode=backend_only`
  - 但結果會標示 `replySkipped=true`

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

這一輪已重新確認：

- `npm.cmd test`
  - `65 / 65 passed`（2026-04-15）
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
- [backend/docs/demo-runbook.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/demo-runbook.md)
- [backend/docs/handoff-known-issues.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/handoff-known-issues.md)
- [backend/docs/task-plan.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/task-plan.md)
- [backend/docs/implementation-log.md](/c:/Users/User/Documents/GitHub/focusflow/backend/docs/implementation-log.md)
