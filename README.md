# FocusFlow

[文件總索引](docs/README.md) · [目前狀態](docs/current-status.md) · [功能狀態總表](docs/30_Features/README.md) · [四技部交付文件](docs/00_Deliverables/README.md)

FocusFlow 是一個 AI 驅動的教學影片問答系統。教師上傳教學影片後，系統自動執行語音轉文字、分段與向量嵌入，處理完成後可依設定自動上傳 YouTube；學生在網頁或 LINE Bot 對課程提問，取得 AI 回答與對應的影片時間點。

> **2026-09-21 起開放學生試用。** 網址：<https://focusflow.ntub.edu.tw>
>
> 目前是試用階段，不是正式上線：學生試用驗收仍在進行，LINE Bot webhook 仍透過 ngrok 轉接（是否改走正式網域待與指導教授討論）。各項邊界見 [docs/current-status.md](docs/current-status.md)。

---

## 使用方式（試用環境）

| 角色 | 入口 | 帳號來源 |
|------|------|----------|
| 學生 | <https://focusflow.ntub.edu.tw/login> | 教師在「修課學生管理」以 CSV 匯入（初始密碼為學號），或學生自行註冊後由教師以 Email 加入課程 |
| 教師 | <https://focusflow.ntub.edu.tw/login> | 由管理員建立；2026-09-18 起不開放教師自行註冊 |
| 管理員 | <https://focusflow.ntub.edu.tw/admin> | 不開放註冊 |

- 請一律使用 `https://` 網址：學校不開放 port 80，明確寫 `http://` 的連結會連不上。
- 學生只能看到自己**已加入且已發布**的課程；沒有自助選課或邀請碼。
- 學生每天最多提問 5 次（網頁與 LINE 合併計算，失敗不計），每題最多 50 字。
- 忘記密碼可在登入頁以 Email 驗證碼重設；登入連續失敗 5 次會鎖定 15 分鐘。
- 使用中遇到問題，可點畫面右下角「回報問題」（可附截圖）。

---

## 主要功能

| 角色 | 功能 |
|------|------|
| 學生 | 課程影片播放、網頁多輪 AI 問答（附引用片段與時間點跳轉）、常見問題、LINE Bot 綁定與提問、教學短片牆、學習統計、站內通知 |
| 教師 | 建立／管理課程、上傳本機影片（可多檔）、處理失敗重試、影片掛載多課程、修課學生指派與 CSV 匯入、教學統計、短影片腳本與審核（功能開關預設關閉） |
| 管理員 | 系統總覽與服務狀態、使用者／課程／影片管理、使用統計與事件、全站公告、問題回報處理 |

AI 處理流程：本機影片 → FFmpeg 音訊 → Faster-Whisper 語音轉文字 → 分段 → Gemini embedding → MongoDB Atlas Vector Search → Gemini 生成回答。重複問題會命中 FAQ 快取，不再呼叫 LLM。

---

## 專案結構

| 路徑 | 服務 | 技術 | 本機埠號 |
|------|------|------|----------|
| `backend/` | REST API | Node.js、Express 4、MongoDB／Mongoose、JWT | `4000` |
| `frontend/focus-flow/` | SPA 前端 | React 19、Vite、Three.js、GSAP | `5173` |
| `STT_Whisper/` | AI Pipeline（由 backend 自動呼叫的 CLI） | Python、Faster-Whisper、Gemini Embedding、FFmpeg、yt-dlp | CLI |
| `database/` | DB 初始化、index 與匯入工具 | Node.js、Python | — |

正式環境跑在學校 VM（Rocky Linux 9）：nginx 提供前端靜態檔並把 `/api/` 反向代理到 backend（PM2 執行）。**push 到 `main` 會由 GitHub Actions 自動部署到正式環境**；`.env` 不進版控，VM 上需另外維護。部署細節見 [CLAUDE.md](CLAUDE.md) 的「部署與對外連線」與 [docs/40_Operations/deployment/](docs/40_Operations/deployment/)。

---

## 本機開發

### 前置需求

- Node.js 18+
- Python 3.10+
- MongoDB（本機或 Atlas）
- FFmpeg（AI Pipeline 使用；也可走 `imageio-ffmpeg` 內建 binary）

### 1. 後端

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

不需要外部 API key 的本機 smoke 設定（`backend/.env`）：

```env
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_ANSWER_PROVIDER=template
QA_VECTOR_SEARCH_MODE=memory
```

`.env.example` 預設的是共享 demo 設定（`gemini + atlas + gemini`），需要 `GEMINI_API_KEY`。實際 runtime 是否 ready 以 `GET /health` 為準。

### 2. 示範資料（僅本機）

```powershell
cd backend
npm run seed         # 建立／收斂 demo baseline，不清除既有資料
npm run seed:reset   # 保守清除 demo 痕跡後重建
```

本機示範帳號（**只存在於執行過 seed 的本機／測試資料庫**，正式環境不使用）：

| 角色 | Email | 密碼 |
|------|-------|------|
| 管理員 | `admin@focusflow.local` | `Admin123!` |
| 教師 | `teacher@focusflow.local` | `Teacher123!` |
| 學生 | `student@focusflow.local` | `Student123!` |

### 3. 前端

```powershell
cd frontend\focus-flow
npm install
Copy-Item .env.example .env
npm run dev
```

預設連到 `VITE_API_BASE_URL=http://127.0.0.1:4000/api/v1`；LINE 加入好友網址另填 `VITE_LINE_BOT_URL`。

### 4. AI Pipeline

```powershell
cd STT_Whisper
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Backend 在教師上傳影片後會自動呼叫 pipeline，並優先使用 `STT_Whisper/.venv/Scripts/python.exe`。手動處理、批次與 resume 用法見 [STT_Whisper/README.md](STT_Whisper/README.md)。

---

## 常用指令

### Backend

| 指令 | 用途 |
|------|------|
| `npm run dev` / `npm start` | 開發模式／正式啟動 |
| `npm test` | 執行 backend 全部測試 |
| `npm run seed` / `npm run seed:reset` | demo baseline |
| `npm run db:import-students` | 從 CSV 匯入修課學生（預設 dry-run） |
| `npm run report:pilot-usage` | 試用期使用統計（唯讀，只輸出彙總數字） |
| `npm run db:sync-atlas` | 將本機 MongoDB 同步至 Atlas |

完整 script 清單見 `backend/package.json`；各 script 的用途與注意事項見 [backend/docs/current-state.md](backend/docs/current-state.md)。

### Frontend

| 指令 | 用途 |
|------|------|
| `npm run dev` | Vite 開發伺服器 |
| `npm run lint` | ESLint 檢查 |
| `npm run build` | production build |
| `npm test` | 前端工具函式測試（`node --test`） |

---

## API 入口

| 路徑 | 說明 |
|------|------|
| `GET /health` | 健康檢查：`runtime.qa`、`line`、`multimodal`、`shortsSync`、`youtubeUpload`（正式環境只在 VM 內部可達） |
| `GET /docs` | Swagger UI |
| `GET /docs/openapi.yaml` | Raw OpenAPI spec（repo 檔案：[backend/docs/openapi.yaml](backend/docs/openapi.yaml)） |

REST API 前綴為 `/api/v1`，模組：`auth`、`courses`（含 enrollments、FAQ）、`videos` / `video-batches`、`qa`、`conversations`、`line`、`notifications`、`stats`、`admin`、`youtube`、`shorts`、`short-scripts`、`feedback`、`internal`（pipeline webhook）。完整端點以 [backend/src/routes/](backend/src/routes/) 為準；OpenAPI 尚未涵蓋 short-scripts、short-assets、feedback 與 internal webhook。

---

## LINE Bot

1. 學生登入網站，在 LINE Bot 頁面取得 10 分鐘有效的一次性綁定碼（或掃 QR Code）。
2. 將綁定碼傳給 LINE Bot，完成綁定後選擇課程。
3. 之後直接傳文字即可對目前課程提問；傳「切換課程」可更換課程。網站個人頁可解除綁定。

正式環境的 webhook 目前由 VM 上的 `ngrok.service` 轉接到 backend。本機開發可用 `ngrok http 4000`，webhook URL 為 `https://<your-domain>/api/v1/line/webhook`，需設定 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`。

---

## 目前狀態

進度、已知限制與「不能誤稱」的邊界集中在 [docs/current-status.md](docs/current-status.md)；backend 細節見 [backend/docs/current-state.md](backend/docs/current-state.md)。

| 階段 | 內容 | 狀態 |
|------|------|------|
| Phase 1 | 影片問答、課程／影片管理、LINE Bot、三角色網頁 | 2026-09-21 起開放學生試用 |
| Phase 2 | 教學短影片（ShortAsset feed、腳本自動生成、審核上架）、階層式檢索 | 部分實作，分階段驗收中 |
| Phase 3 | 完整前端體驗 | 規劃中 |
| Phase 4 | 個人化學習推薦 | 規劃中 |

其他重要文件：

| 文件 | 用途 |
|------|------|
| [學生試用版後端整合文件](docs/30_Features/Student_Pilot_Backend/README.md) | 試用版規格、施工單與驗收證據 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架構、資料流與 schema 邊界 |
| [backend/docs/phase2-api-contract.md](backend/docs/phase2-api-contract.md) | QA / Video / Clip / YouTube 回傳語意 |
| [docs/40_Operations/ai-code-understanding-guide.md](docs/40_Operations/ai-code-understanding-guide.md) | AI Pipeline、embedding、QA 與 citation 說明 |
