# Focus Flow Backend

`focus flow` 第一階段目標是做出教學影片問答系統的 MVP。這一版 backend 已經有可 demo 的主線：登入與權限控制、課程與影片管理、問答 API、LINE webhook，以及可被外部 worker 接上的影片處理狀態機。

## 目前範圍

- Node.js + Express 後端
- MongoDB Atlas / MongoDB model 與基本資料流
- JWT 登入與 `auth/me`
- `teacher / admin / student` 權限與課程存取規則
- 課程建立 / 查詢
- 本機影片上傳到 `uploads/`
- 嚴格模式的影片 processing lifecycle
- `POST /api/v1/qa/ask`
- `POST /api/v1/line/webhook`
- 不依賴本機 MongoDB 的 route / service 測試

## 專案結構

```text
backend/
  src/
    app.js
    server.js
    config/
    routes/
    controllers/
    services/
    models/
    middleware/
    utils/
    constants/
    scripts/
  tests/
  docs/
  uploads/
```

## 安裝與啟動

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Windows PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
npm run dev
```

如果 `.env` 中 `DEMO_SEED_ENABLED=true`，server 啟動時會自動 upsert demo 帳號。

目前開發環境已驗證可直接連到 MongoDB Atlas，並通過：

- backend 啟動成功
- `GET /health` 回傳 `200 OK`

如果你使用 Atlas，請另外確認：

- `MONGODB_URI` 使用 `mongodb+srv://...`
- `IP Access List` 已放行目前開發機
- 資料庫帳號具備目標 database 的讀寫權限

## 環境變數

`backend/.env.example`

```env
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/focusflow?retryWrites=true&w=majority&appName=focusflow
JWT_SECRET=change-me-in-local-env
JWT_EXPIRES_IN=7d
DEMO_SEED_ENABLED=true
UPLOAD_DIR=uploads
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_ANSWER_PROVIDER=template
QA_VECTOR_SEARCH_MODE=memory
QA_MATCH_LIMIT=3
QA_MOCK_EMBEDDING_DIMENSIONS=32
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
PROCESSING_WEBHOOK_SECRET=
```

重點說明：

- `MONGODB_URI`: 本機可用 `mongodb://127.0.0.1:27017/focusflow`，若使用 Atlas，建議改成 `mongodb+srv://...`
- `PROCESSING_WEBHOOK_SECRET`: internal processing endpoints 的 shared secret。未來 Python worker / callback 呼叫 `/api/v1/internal/...` 時要放在 `x-processing-secret` header。
- `QA_QUERY_EMBEDDING_PROVIDER`: `mock` 或 `openai`
- `QA_ANSWER_PROVIDER`: `template` 或 `openai`
- `QA_VECTOR_SEARCH_MODE`: `memory` 或 `atlas`

本地 demo 預設使用 `mock + template + memory`。這一輪不會直接串 STT / Whisper / chunking 腳本。

## 與資料庫組 schema 對齊

目前 backend 已先保留既有 API 與 service 命名，並補上和資料庫組版本相容的欄位，避免後續匯入資料時出現明顯落差。

目前已補上的相容欄位包含：

- `course.videoIds`
- `video.file_name`
- `video.file_path`
- `video.audio_path`
- `video.duration_sec`
- `video.video_source`
- `video.video_url`
- `videoSegment.chunk_id`
- `videoSegment.original_text`
- `videoSegment.corrections`
- `enrollment.lineState`

這些欄位的用途是讓目前 backend 與外部資料匯入可以先共存；目前對外 API 契約仍以現有 route / controller / service 為主。

## 測試帳號

如果已執行 seed，可使用：

- Teacher: `teacher@focusflow.local` / `Teacher123!`
- Student: `student@focusflow.local` / `Student123!`
- Admin: `admin@focusflow.local` / `Admin123!`

## 影片處理狀態機

這一輪保留 `completed` 命名，不改成 `indexed`。在目前 repo 中，`completed` 的語意是：

- 影片處理 pipeline 已完成
- backend 可視為後續 QA / indexing integration 的穩定接點

這一輪不混用 `completed` 與 `indexed`。

### Processing 欄位

`videos.processing` 目前包含：

- `status`
- `errorMessage`
- `errorCode`
- `queuedAt`
- `startedAt`
- `completedAt`
- `failedAt`
- `attemptCount`

### 狀態

- `queued`
- `processing`
- `completed`
- `failed`

### 合法 transition

- upload: 直接建立為 `queued`
- internal start: `queued -> processing`
- internal complete: `processing -> completed`
- internal fail: `queued|processing -> failed`
- manual retry: `failed -> queued`

### 嚴格模式

processing callback 目前採嚴格模式：

- 非法 transition 一律回 `409`
- 不做 idempotent callback
- 重複 `start` / `complete` / `fail` 只要狀態不合法就回 `409`

## API 清單

### Public

- `GET /health`

### Auth

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

### Courses

- `POST /api/v1/courses`
- `GET /api/v1/courses`
- `GET /api/v1/courses/:courseId`

### Videos

- `POST /api/v1/courses/:courseId/videos`
- `GET /api/v1/courses/:courseId/videos`
- `GET /api/v1/videos/:videoId`
- `GET /api/v1/videos/:videoId/processing`
- `POST /api/v1/videos/:videoId/processing/retry`

### Internal Processing

- `POST /api/v1/internal/videos/:videoId/processing/start`
- `POST /api/v1/internal/videos/:videoId/processing/complete`
- `POST /api/v1/internal/videos/:videoId/processing/fail`

### QA

- `POST /api/v1/qa/ask`

### LINE

- `POST /api/v1/line/webhook`

## Processing API 使用方式

### 1. 上傳影片

`POST /api/v1/courses/:courseId/videos`

成功後 `processing.status` 會直接是 `queued`，並帶上：

- `queuedAt`
- `attemptCount = 0`

### 2. 查詢 processing 狀態

`GET /api/v1/videos/:videoId/processing`

會回傳完整 processing metadata，例如：

```json
{
  "success": true,
  "message": "Video processing status fetched successfully.",
  "data": {
    "id": "507f191e810c19729de860ec",
    "title": "Draft Video",
    "processing": {
      "status": "queued",
      "errorMessage": null,
      "errorCode": null,
      "queuedAt": "2026-04-06T11:00:00.000Z",
      "startedAt": null,
      "completedAt": null,
      "failedAt": null,
      "attemptCount": 0
    },
    "updatedAt": "2026-04-06T11:00:00.000Z"
  }
}
```

### 3. 手動 retry

`POST /api/v1/videos/:videoId/processing/retry`

限制：

- 需要 JWT
- 只有 owner teacher 或 admin 可用
- 只允許 `failed -> queued`

retry 會：

- 清掉 `errorMessage`
- 清掉 `errorCode`
- 清掉 `failedAt`
- 清掉 `startedAt`
- 清掉 `completedAt`
- 更新 `queuedAt`
- 保留既有 `attemptCount`

### 4. Internal start

```http
POST /api/v1/internal/videos/:videoId/processing/start
x-processing-secret: <PROCESSING_WEBHOOK_SECRET>
```

只允許 `queued -> processing`。

### 5. Internal complete

```http
POST /api/v1/internal/videos/:videoId/processing/complete
x-processing-secret: <PROCESSING_WEBHOOK_SECRET>
Content-Type: application/json

{
  "durationSec": 123,
  "metadata": {
    "ignoredForNow": true
  }
}
```

只允許 `processing -> completed`。`metadata` 目前接受但不寫入資料庫。

### 6. Internal fail

```http
POST /api/v1/internal/videos/:videoId/processing/fail
x-processing-secret: <PROCESSING_WEBHOOK_SECRET>
Content-Type: application/json

{
  "errorMessage": "worker timeout",
  "errorCode": "WORKER_TIMEOUT"
}
```

只允許 `queued|processing -> failed`，且 `errorMessage` 必填。

## 權限規則

- `admin`: 可存取與管理所有課程與影片
- `teacher`: 只能管理自己建立的課程與影片
- `student`: 可讀 `published` 課程，或已在 `enrollments` 中允許的課程
- `GET /videos/:id/processing`: 僅 owner teacher 或 admin 可讀
- `POST /videos/:id/processing/retry`: 僅 owner teacher 或 admin 可用
- `/api/v1/internal/...`: 不使用 JWT，僅接受 `x-processing-secret`

## 本地手動測 processing flow

以下範例假設你已登入並拿到 teacher token：

### 1. 上傳影片

```bash
curl -X POST http://127.0.0.1:4000/api/v1/courses/<courseId>/videos \
  -H "Authorization: Bearer <teacher-token>" \
  -F "title=Processing Demo" \
  -F "video=@./demo.mp4"
```

### 2. 查詢 queued 狀態

```bash
curl http://127.0.0.1:4000/api/v1/videos/<videoId>/processing \
  -H "Authorization: Bearer <teacher-token>"
```

### 3. 模擬 worker start

```bash
curl -X POST http://127.0.0.1:4000/api/v1/internal/videos/<videoId>/processing/start \
  -H "x-processing-secret: <PROCESSING_WEBHOOK_SECRET>"
```

### 4. 模擬 worker complete

```bash
curl -X POST http://127.0.0.1:4000/api/v1/internal/videos/<videoId>/processing/complete \
  -H "Content-Type: application/json" \
  -H "x-processing-secret: <PROCESSING_WEBHOOK_SECRET>" \
  -d "{\"durationSec\": 123}"
```

### 5. 模擬 fail 後 retry

```bash
curl -X POST http://127.0.0.1:4000/api/v1/internal/videos/<videoId>/processing/fail \
  -H "Content-Type: application/json" \
  -H "x-processing-secret: <PROCESSING_WEBHOOK_SECRET>" \
  -d "{\"errorMessage\": \"worker timeout\", \"errorCode\": \"WORKER_TIMEOUT\"}"
```

```bash
curl -X POST http://127.0.0.1:4000/api/v1/videos/<videoId>/processing/retry \
  -H "Authorization: Bearer <teacher-token>"
```

## 測試

```bash
node --test --experimental-test-isolation=none --test-concurrency=1
```

目前測試覆蓋：

- auth
- course / video routes
- processing detail / retry / internal lifecycle routes
- qa routes / service
- line webhook

## 目前不做的事

- 不直接呼叫 `STT_Whisper` 腳本
- 不匯入 transcript / chunk / clips 產物
- 不提供 teacher/admin 手動標記 complete/fail
- 不引入 queue system 或 background job framework

## 下一步建議

- 驗證 `auth`、`courses`、`videos` API 在 Atlas 上的實際讀寫行為
- 決定 demo seed 是否保留在目前 Atlas 開發資料庫
- 接上實際 STT / chunking / embeddings pipeline，讓 internal endpoints 由 Python worker 呼叫
- 定義 `video_segments` / `clips` 的正式匯入契約
- 把 QA 從 `mock + template + memory` 升級到正式 OpenAI / Atlas
