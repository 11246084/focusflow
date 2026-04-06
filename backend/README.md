# Focus Flow Backend

`focus flow` 第一階段目標是做出教學影片問答系統的 MVP。這一版 backend 已補到可 demo 的主線，範圍包含登入、角色權限、課程與影片管理、問答 API、LINE webhook，以及最小整合測試。

## 目前後端範圍

- Node.js + Express 後端初始化
- MongoDB 連線設定
- 統一 API response 格式
- `/health`
- JWT 登入與 `auth/me`
- `teacher / admin / student` RBAC 與課程存取規則
- 課程建立與查詢
- 本機 `uploads/` 影片上傳
- `videos.processing.status` 基礎流程
- `POST /api/v1/qa/ask`
- `POST /api/v1/line/webhook`
- `usage_logs` 事件記錄
- 不依賴外部 Mongo 的本地整合測試

## 後端結構

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
  uploads/
  docs/        # 個人本機文件區，已加入 .gitignore
```

## 主要資料模型

- `users`
- `courses`
- `videos`
- `enrollments`
- `video_segments`
- `clips`
- `usage_logs`
- `line_bind_tokens`

## 安裝

### 1. 進入後端目錄

```bash
cd backend
```

### 2. 安裝套件

```bash
npm install
```

### 3. 建立環境變數

```bash
cp .env.example .env
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
```

### 4. 確認 MongoDB 已啟動

預設連線：

```text
mongodb://127.0.0.1:27017/focusflow
```

## 啟動

開發模式：

```bash
npm run dev
```

正式啟動：

```bash
npm start
```

手動建立 demo 帳號：

```bash
npm run seed
```

如果 `.env` 中 `DEMO_SEED_ENABLED=true`，server 啟動時也會自動 upsert demo 帳號。

## 環境變數

`backend/.env.example`

```env
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/focusflow
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
```

說明：

- `QA_QUERY_EMBEDDING_PROVIDER`: `mock` 或 `openai`
- `QA_ANSWER_PROVIDER`: `template` 或 `openai`
- `QA_VECTOR_SEARCH_MODE`: `memory` 或 `atlas`
- `QA_MATCH_LIMIT`: 問答回傳的相關片段數量
- `QA_MOCK_EMBEDDING_DIMENSIONS`: mock embedding 維度
- `LINE_CHANNEL_SECRET`: LINE webhook signature 驗證用
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE reply API 用

預設設計：

- 本地 demo 預設使用 `mock + template + memory`
- 若要接正式 OpenAI / Atlas，再補正式金鑰與索引

## 測試帳號

如果已執行 `npm run seed` 或啟動時自動 seed，可用以下帳號登入：

- Teacher: `teacher@focusflow.local` / `Teacher123!`
- Student: `student@focusflow.local` / `Student123!`
- Admin: `admin@focusflow.local` / `Admin123!`

## 目前可用 API

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

### QA

- `POST /api/v1/qa/ask`

### LINE

- `POST /api/v1/line/webhook`

## API 使用說明

### 1. 登入

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "teacher@focusflow.local",
  "password": "Teacher123!"
}
```

### 2. 建立課程

只有 `teacher` 或 `admin` 可建立課程。

```http
POST /api/v1/courses
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Introduction to Deep Learning",
  "description": "MVP demo course",
  "status": "published"
}
```

### 3. 上傳影片

只有課程 owner teacher 或 admin 可上傳影片。

`multipart/form-data` 欄位：

- `video`: 檔案欄位名稱
- `title`: 可選，自訂影片標題

```http
POST /api/v1/courses/:courseId/videos
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

### 4. 提問

```http
POST /api/v1/qa/ask
Authorization: Bearer <token>
Content-Type: application/json

{
  "courseId": "507f191e810c19729de860eb",
  "question": "What does the course say about JWT authentication?"
}
```

成功回傳格式：

```json
{
  "success": true,
  "message": "Question answered successfully.",
  "data": {
    "answer": "...",
    "matches": [
      {
        "segmentId": "segment-one",
        "videoId": "video-published-001",
        "startSec": 12,
        "endSec": 32,
        "transcript": "...",
        "score": 0.91
      }
    ],
    "clip": {
      "segmentId": "segment-one",
      "clipUrl": "https://clips.local/segment-one.mp4",
      "jumpUrl": "https://videos.local/watch?v=video-published-001&t=12",
      "keyPoints": ["JWT auth", "RBAC"],
      "hitCount": 1
    }
  }
}
```

## 存取規則

- `admin`: 可存取與管理所有課程與影片
- `teacher`: 只能管理自己建立的課程與其影片
- `student`: 可讀取 `published` 課程，或已在 `enrollments` 中被允許的課程
- `videos/:id/processing`: 僅課程 owner teacher 或 admin 可讀

## 統一回應格式

成功：

```json
{
  "success": true,
  "message": "OK",
  "data": {}
}
```

失敗：

```json
{
  "success": false,
  "message": "Request failed",
  "error": {
    "code": "ERROR_CODE"
  }
}
```

## 目前的 placeholder / 約束

- 影片上傳後只建立資料並把 `processing.status` 由 `uploaded` 更新成 `queued`
- backend 不負責 Whisper、chunking、embeddings 與 FFmpeg clip generation
- backend 只讀取 AI / DB 組寫入的 `video_segments` 與 `clips`
- `bind token` 產生 endpoint 尚未正式掛出，LINE 這版先以 webhook + 問答主線為主

## 測試

```bash
npm test
```

說明：

- 測試使用自製 runner
- 不依賴本機 MongoDB 服務
- 會驗證 auth、course/video、qa、line webhook 主線

## 下一步建議

- 接上正式 OpenAI embeddings / answers
- 把 `QA_VECTOR_SEARCH_MODE` 切到 Atlas 並驗證正式索引
- 補 enrollment / active course 的正式 UI 流程
- 和 AI / DB / LINE 組做一次 end-to-end demo 串接
