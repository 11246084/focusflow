# FocusFlow

FocusFlow 是一個 AI 驅動的教育影片問答系統。教師上傳教學影片後，系統自動完成語音辨識、文字分段與向量嵌入；學生可透過介面或 LINE Bot 提問，系統回傳 AI 生成的答案與對應影片時間戳。

> 目前處於 **第一階段 MVP**：文字版問答系統 + LINE Bot 整合。

---

## 系統架構總覽

| 服務 | 技術 | 埠號 |
|------|------|------|
| **後端 API** | Node.js、Express 4、MongoDB、JWT | 4000 |
| **前端** | React 19、Vite、Three.js、GSAP | 5173 |
| **AI Pipeline** | Python、Faster-Whisper、Sentence-Transformers、FFmpeg | CLI |

---

## 安裝與啟動

### 前置需求

- Node.js 18+
- Python 3.10+
- MongoDB（本機或 Atlas）
- FFmpeg（AI Pipeline 使用）

### 後端

```bash
cd backend
npm install
cp .env.example .env      # 填入 MongoDB URI 與 JWT_SECRET
npm run dev               # 啟動開發伺服器（port 4000）
```

**主要環境變數（`backend/.env`）：**

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `MONGODB_URI` | MongoDB 連線字串 | — |
| `JWT_SECRET` | JWT 簽章金鑰 | — |
| `DEMO_SEED_ENABLED` | 啟動時自動植入示範資料 | `true` |
| `QA_QUERY_EMBEDDING_PROVIDER` | 向量嵌入 provider（`mock`/`openai`/`gemini`） | `mock` |
| `QA_ANSWER_PROVIDER` | 答案生成 provider（`template`/`openai`） | `template` |
| `QA_VECTOR_SEARCH_MODE` | 向量搜尋模式（`memory`/`atlas`） | `memory` |

本機開發使用預設值即可，不需要任何 API 金鑰。

### 前端

```bash
cd frontend/focus-flow
npm install
npm run dev               # 啟動 Vite 開發伺服器（port 5173）
```

### AI Pipeline（Python）

```bash
cd STT_Whisper
python -m venv .venv
source .venv/Scripts/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

將影片放入 `STT_Whisper/Test_video_file/`，然後執行：

```bash
python src/main.py                 # 處理所有影片
python src/main.py --limit 1      # 只處理第一支（快速驗證）
python src/main.py --overwrite    # 強制重新處理（不使用快取）
```

---

## API 端點一覽

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| POST | `/api/v1/auth/login` | 使用者登入，回傳 JWT | 公開 |
| GET | `/api/v1/auth/me` | 取得目前登入使用者資訊 | 已登入 |
| POST | `/api/v1/courses` | 建立課程 | 教師/管理員 |
| GET | `/api/v1/courses` | 列出可存取的課程 | 已登入 |
| GET | `/api/v1/courses/:courseId` | 取得課程詳細資訊 | 已登入 |
| POST | `/api/v1/courses/:courseId/videos` | 上傳影片至課程 | 教師/管理員 |
| GET | `/api/v1/courses/:courseId/videos` | 列出課程影片 | 已登入 |
| GET | `/api/v1/videos/:videoId` | 取得影片詳細資訊 | 已登入 |
| GET | `/api/v1/videos/:videoId/processing` | 查詢影片處理進度 | 已登入 |
| POST | `/api/v1/qa/ask` | 提問並取得 AI 回答 | 已登入 |
| POST | `/api/v1/line/webhook` | LINE Bot Webhook | LINE 簽章驗證 |
| GET | `/health` | 服務健康檢查 | 公開 |

---

## 示範帳號

啟動後端時若 `DEMO_SEED_ENABLED=true`，系統會自動建立以下示範帳號：

| 角色 | Email | 密碼 |
|------|-------|------|
| 管理員 | `admin@example.com` | `password123` |
| 教師 | `teacher@example.com` | `password123` |
| 學生 | `student@example.com` | `password123` |

---

## 專案藍圖

| 階段 | 內容 | 狀態 |
|------|------|------|
| 第一階段 | 文字問答系統 + LINE Bot | **進行中** |
| 第二階段 | 自動短影音生成 | 規劃中 |
| 第三階段 | 完整前端網頁體驗 | 規劃中 |
| 第四階段 | 個人化學習推薦 | 規劃中 |
