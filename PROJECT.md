# FocusFlow 專案概覽

FocusFlow 是一個 **AI 驅動的教育影片問答系統**，讓教師上傳教學影片，學生可對影片內容提問，系統會以 AI 生成答案並附上對應的影片時間段。目前處於 **MVP 第一階段**。

---

## 技術架構

| 層次 | 技術 |
|------|------|
| **前端** | React 19、Vite、Three.js、GSAP |
| **後端** | Node.js + Express 4、MongoDB + Mongoose、JWT 認證 |
| **AI Pipeline** | Python、Whisper（語音轉文字）、Gemini Embedding 2、FFmpeg |

---

## 目錄結構

```
focusflow/
├── backend/           # Node.js REST API（port 4000）
│   └── src/
│       ├── controllers/   # API 請求處理
│       ├── models/        # MongoDB Schema 定義
│       ├── routes/        # API 路由
│       ├── services/      # 商業邏輯層
│       └── middleware/    # 認證、錯誤處理、上傳
│
├── frontend/focus-flow/  # React SPA（port 5173）
│   └── src/
│       └── components/   # 含 Three.js 3D 元件的登入頁
│
├── STT_Whisper/         # Python AI 處理管線
│   └── src/
│       ├── transcribe.py   # Whisper 語音辨識
│       ├── embedding.py    # Gemini 向量嵌入
│       └── chunking.py     # 文字分段
│
└── docs/               # 系統文件與會議紀錄
```

---

## 主要功能模組

### 1. 身份驗證與角色管理
- 三種角色：`admin`、`teacher`、`student`
- JWT Token 認證

### 2. 課程與影片管理
- 教師建立課程、上傳影片
- 影片處理狀態機：`queued → processing → completed / failed`

### 3. AI 問答系統
- `POST /api/v1/qa/ask` — 學生提問，語意搜尋回傳相關影片片段

### 4. LINE Bot 整合
- 透過 Webhook 支援 LINE 即時通訊問答

### 5. Python AI Pipeline
- 影片 → 音訊提取 → Whisper 語音辨識 → 文字分段 → Gemini 向量嵌入 → 存入 MongoDB

---

## 資料庫模型

| 模型 | 用途 |
|------|------|
| `User` | 使用者帳號與角色 |
| `Course` | 課程容器 |
| `Video` | 影片元資料與處理狀態 |
| `VideoSegment` | 逐段文字稿與向量嵌入 |
| `Enrollment` | 學生修課與 LINE 綁定 |
| `UsageLog` | 使用者行為記錄 |

---

## 前端現況

目前前端為**行銷登陸頁**，使用 Three.js 製作 3D 互動場景（液態漸層背景、3D 泡泡、自訂游標動畫），主要儀表板功能尚在開發中。

---

## 啟動方式

```bash
# 後端
cd backend && npm run dev

# 前端
cd frontend/focus-flow && npm run dev

# Python AI Pipeline
cd STT_Whisper && python src/main.py
```

---

## API 端點一覽

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 使用者登入 |
| GET | `/api/v1/auth/me` | 取得登入使用者資訊 |
| POST | `/api/v1/courses` | 建立課程（教師/管理員） |
| GET | `/api/v1/courses` | 列出可存取的課程 |
| GET | `/api/v1/courses/:courseId` | 取得課程詳細資訊 |
| POST | `/api/v1/courses/:courseId/videos` | 上傳影片至課程 |
| GET | `/api/v1/courses/:courseId/videos` | 列出課程影片 |
| GET | `/api/v1/videos/:videoId` | 取得影片詳細資訊 |
| GET | `/api/v1/videos/:videoId/processing` | 查詢處理進度 |
| POST | `/api/v1/videos/:videoId/processing/retry` | 重試失敗的處理 |
| POST | `/api/v1/qa/ask` | 提問並取得 AI 回答 |
| POST | `/api/v1/line/webhook` | LINE Bot Webhook |
