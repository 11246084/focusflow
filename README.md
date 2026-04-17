# FocusFlow

FocusFlow 是一個 AI 驅動的教育影片問答系統。教師上傳教學影片後，系統自動完成語音辨識、文字分段與向量嵌入；學生可透過介面或 LINE Bot 提問，系統回傳 AI 生成的答案與對應影片時間戳。

> 目前處於 **第一階段 MVP**：文字版問答系統 + LINE Bot 整合。

---

## 系統架構總覽

| 服務 | 技術 | 埠號 |
|------|------|------|
| **後端 API** | Node.js、Express 4、MongoDB、JWT | 4000 |
| **前端** | React 19、Vite、Three.js、GSAP | 5173 |
| **AI Pipeline** | Python、Faster-Whisper、Gemini Embedding、FFmpeg | CLI |

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
| `QA_QUERY_EMBEDDING_PROVIDER` | 向量嵌入 provider（`mock`/`openai`） | `mock` |
| `QA_ANSWER_PROVIDER` | 答案生成 provider（`template`/`openai`） | `template` |
| `QA_VECTOR_SEARCH_MODE` | 向量搜尋模式（`memory`/`atlas`） | `memory` |
| `LINE_CHANNEL_SECRET` | LINE Channel Secret（簽章驗證用） | — |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Channel Access Token（傳訊用） | — |

本機開發使用預設值即可，不需要任何 API 金鑰。啟用 LINE Bot 需額外填入 LINE 相關變數。

### Swagger / OpenAPI

- 執行時 Swagger UI：`/docs`
- 執行時 raw spec：`/docs/openapi.yaml`
- repo 規格檔：`backend/docs/openapi.yaml`
- LINE webhook 已納入 OpenAPI，但屬 integration-facing endpoint，不是一般前端直接呼叫入口。

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

> 資料庫 schema 契約（v1 正式 vs legacy）見 [ARCHITECTURE.md](ARCHITECTURE.md)，詳細定版見 [docs/05_Database_Schema_Contract/MongoDB_契約定版_v1.md](docs/05_Database_Schema_Contract/MongoDB_契約定版_v1.md)。

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
| GET | `/api/v1/line/webhook` | LINE Webhook 驗證（Console Verify 用） | 公開 |
| POST | `/api/v1/line/bind-token` | 發放 LINE 綁定 token（10 分鐘有效） | 已登入 |
| GET | `/health` | 服務健康檢查 | 公開 |

---

## LINE Bot 設定與使用

### 環境設定

1. 在 [LINE Developers Console](https://developers.line.biz/) 建立 Messaging API Channel
2. 取得 **Channel Secret** 與 **Channel Access Token**，填入 `backend/.env`
3. 將後端服務公開至網路（本機開發可使用 [ngrok](https://ngrok.com/)）：
   ```bash
   ngrok http 4000
   ```
4. 在 LINE Developers Console 將 Webhook URL 設為：
   ```
   https://<your-domain>/api/v1/line/webhook
   ```
5. 啟用 Webhook，點擊 **Verify** 確認回傳 200

### 學生綁定流程

```
1. 學生登入 FocusFlow 前端
2. 前端呼叫 POST /api/v1/line/bind-token（需 JWT）
   → 取得 10 分鐘有效的綁定 token
3. 學生將 token 傳送給 LINE Bot
4. Bot 完成綁定，將 lineUserId 寫入使用者帳號
5. 綁定完成後，Bot 引導學生選擇課程
```

### LINE Bot 指令

| 訊息 | 功能 |
|------|------|
| `<綁定 token>` | 完成帳號綁定 |
| `切換課程` | 顯示可選課程清單 |
| 其他文字 | 對目前選擇的課程進行 QA 問答 |

> 未選擇課程時提問，Bot 會提示先執行「切換課程」。

---

## 示範帳號

啟動後端時若 `DEMO_SEED_ENABLED=true`，系統會自動建立以下示範帳號：

| 角色 | Email | 密碼 |
|------|-------|------|
| 管理員 | `admin@focusflow.local` | `Admin123!` |
| 教師 | `teacher@focusflow.local` | `Teacher123!` |
| 學生 | `student@focusflow.local` | `Student123!` |

---

## 專案藍圖

| 階段 | 內容 | 狀態 |
|------|------|------|
| 第一階段 | 文字問答系統 + LINE Bot | **進行中** |
| 第二階段 | 自動短影音生成 | 規劃中 |
| 第三階段 | 完整前端網頁體驗 | 規劃中 |
| 第四階段 | 個人化學習推薦 | 規劃中 |
