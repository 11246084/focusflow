# Focus Flow Backend

`focus flow` 第一階段目標是做出教學影片問答系統的 MVP。這一輪先完成可 demo、可本地啟動的後端骨架，範圍只包含登入、課程管理、影片上傳與影片處理狀態骨架，不提前實作問答、歷史紀錄或重處理功能。

## 目前後端範圍

- Node.js + Express 後端初始化
- MongoDB 連線設定
- 統一 API response 格式
- `/health` 健康檢查
- JWT 登入與 `auth/me`
- `users`、`courses`、`videos` 三個基礎 model
- 課程建立與查詢
- 本機 `uploads/` 影片上傳
- `processing.status` 基礎流程欄位與 placeholder service

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
```

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
```

說明：

- `NODE_ENV`: 執行環境，預設為 `development`
- `PORT`: API server 監聽埠號，預設 `4000`
- `MONGODB_URI`: MongoDB 連線字串
- `JWT_SECRET`: JWT 簽章密鑰，本地開發請改成自訂值
- `JWT_EXPIRES_IN`: JWT 有效時間，例如 `7d`
- `DEMO_SEED_ENABLED`: server 啟動時是否自動建立 demo 帳號
- `UPLOAD_DIR`: 上傳檔案目錄，預設為 `backend/uploads`

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

### 2. 取得目前使用者

```http
GET /api/v1/auth/me
Authorization: Bearer <token>
```

### 3. 建立課程

只有 `teacher` 或 `admin` 可建立課程。

```http
POST /api/v1/courses
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Introduction to Deep Learning",
  "description": "MVP demo course",
  "status": "draft"
}
```

### 4. 上傳影片

只有 `teacher` 或 `admin` 可上傳影片。

`multipart/form-data` 欄位：

- `video`: 檔案欄位名稱
- `title`: 可選，自訂影片標題

```http
POST /api/v1/courses/:courseId/videos
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

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

## 目前的 placeholder

- 影片上傳後只建立資料並把 `processing.status` 由 `uploaded` 更新成 `queued`
- 尚未串接 STT、chunking、embeddings、retrieval
- `durationSec` 目前未自動計算
- 尚未加入更完整的 request validation 與整合測試

## 測試

目前先提供最小 smoke test，驗證統一 response helper：

```bash
npm test
```

## 下一步建議

- 補齊註冊流程或正式使用者建立流程
- 加入課程/影片 ownership 驗證
- 接上影片處理佇列與 STT pipeline
- 補 API integration tests
