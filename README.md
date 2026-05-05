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

**常用 npm scripts（`backend/package.json`）：**

| Script | 用途 |
|--------|------|
| `npm run dev` | 啟動開發模式（nodemon） |
| `npm start` | 正式啟動 |
| `npm run seed` | 植入示範資料（converge baseline） |
| `npm run seed:reset` | 清除 demo 痕跡後重建 baseline |
| `npm run db:sync-atlas` | 將本機 MongoDB 同步至 Atlas（upsert by `_id`，覆蓋 `syncLocalMongoToAtlas.js` 內 `COLLECTIONS` 清單） |
| `npm test` | 執行全部測試（Node 內建 `node:test`） |

> ⚠️ `package.json` 內的 `db:ensure-questions` 與 `db:backfill-questions` 指向 `src/scripts/ensureQuestionsCollection.js` 與 `src/scripts/backfillQuestionsFromUsageLogs.js`，**這兩個檔案目前不存在**（dangling script），執行會失敗。`questions` collection 已由 Mongoose schema 自動建立，使用上不缺；後續決定補檔或從 `package.json` 移除。
>
> 另有 `src/scripts/syncQuestionsToAtlas.js`（local → Atlas 單獨同步 questions、含 user 對應），目前**未掛 npm script**，需 `node src/scripts/syncQuestionsToAtlas.js` 直接執行。

**主要環境變數（`backend/.env`）：**

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `MONGODB_URI` | MongoDB 連線字串 | — |
| `JWT_SECRET` | JWT 簽章金鑰 | — |
| `DEMO_SEED_ENABLED` | 啟動時自動植入示範資料 | `false` |
| `QA_QUERY_EMBEDDING_PROVIDER` | 向量嵌入 provider（`mock`/`openai`/`gemini`） | `gemini` |
| `QA_ANSWER_PROVIDER` | 答案生成 provider（`template`/`openai`/`gemini`） | `gemini` |
| `QA_VECTOR_SEARCH_MODE` | 向量搜尋模式（`memory`/`atlas`） | `atlas` |
| `QA_ATLAS_VECTOR_INDEX_NAME` | Atlas vector index 名稱 | `text_embedding_index` |
| `QA_ATLAS_FILTER_MODE` | Atlas filter contract | `bridge_course_or_video` |
| `LINE_CHANNEL_SECRET` | LINE Channel Secret（簽章驗證用） | — |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Channel Access Token（傳訊用） | — |

目前共享環境 `.env` 主線寫的是 `gemini + atlas + gemini`，但 2026-05-01 驗證時共享 Atlas 缺少 `text_embedding_index`；實際 QA 可用性仍以 `/health` 與 Atlas index 狀態為準。若只做不依賴外部服務的本機 smoke，可暫時切回 `mock + memory`。

### Swagger / OpenAPI

- 執行時 Swagger UI：`/docs`
- 執行時 raw spec：`/docs/openapi.yaml`
- repo 規格檔：`backend/docs/openapi.yaml`
- LINE webhook 已納入 OpenAPI，但屬 integration-facing endpoint，不是一般前端直接呼叫入口。
- 目前 OpenAPI 尚未涵蓋 stats/admin 路由與 courses/videos 的 PATCH/DELETE；完整端點清單暫看下方表格與實際 route files。

### 前端

```bash
cd frontend/focus-flow
npm install
npm run dev               # 啟動 Vite 開發伺服器（port 5173）
```

### AI Pipeline（Python）

```bash
cd STT_Whisper
py -3 -m venv .venv
source .venv/Scripts/activate   # Windows: .venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

`.venv` 必須建立在 `STT_Whisper/` 底下，backend 自動觸發 STT 時會優先使用 `STT_Whisper/.venv/Scripts/python.exe`。

將影片放入 `STT_Whisper/Test_video_file/` 後可手動執行：

```bash
python src/main.py                 # 處理所有影片
python src/main.py --limit 1      # 只處理第一支（快速驗證）
python src/main.py --overwrite    # 強制重新處理（不使用快取）
```

前端上傳影片或貼 YouTube URL 時，backend 會自動 spawn STT pipeline。YouTube URL 模式需要 `yt-dlp`，已列在 `STT_Whisper/requirements.txt`；FFmpeg 可使用系統 PATH 或 `imageio-ffmpeg` 內建 binary。

> 資料庫 schema 契約（v1 正式 vs legacy）見 [ARCHITECTURE.md](ARCHITECTURE.md)。`docs/05_Database_Schema_Contract/` 目前保留的 [MongoDB_契約定版_v1_已過期.md](docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md) 僅供歷史參考；正式 runtime 與欄位命名請以 [docs/current-status.md](docs/current-status.md)、[backend/docs/current-state.md](backend/docs/current-state.md) 與實際程式碼為準。

---

## API 端點一覽

> [backend/docs/openapi.yaml](backend/docs/openapi.yaml)（執行時掛在 `/docs`）目前**尚未涵蓋 stats、admin 路由與 courses/videos 的 PATCH/DELETE**。下表以實際路由檔為準；OpenAPI 對齊作業見 [backend/docs/todo.md](backend/docs/todo.md)。

### 認證

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| POST | `/api/v1/auth/login` | 使用者登入，回傳 JWT | 公開 |
| GET | `/api/v1/auth/me` | 取得目前登入使用者資訊 | 已登入 |

### 課程

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| POST | `/api/v1/courses` | 建立課程 | 教師/管理員 |
| GET | `/api/v1/courses` | 列出可存取的課程 | 已登入 |
| GET | `/api/v1/courses/:courseId` | 取得課程詳細資訊 | 已登入 |
| PATCH | `/api/v1/courses/:courseId` | 更新課程 | 教師/管理員 |
| DELETE | `/api/v1/courses/:courseId` | 刪除課程 | 管理員 |

### 影片

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| POST | `/api/v1/courses/:courseId/videos` | 上傳影片至課程 | 教師/管理員 |
| POST | `/api/v1/courses/:courseId/videos/youtube` | 以 YouTube URL 建立課程影片並啟動 STT | 教師/管理員 |
| GET | `/api/v1/courses/:courseId/videos` | 列出課程影片 | 已登入 |
| GET | `/api/v1/videos/:videoId` | 取得影片詳細資訊 | 已登入 |
| GET | `/api/v1/videos/:videoId/processing` | 查詢影片處理進度 | 已登入 |
| POST | `/api/v1/videos/:videoId/processing/retry` | 重試失敗的處理 | 教師/管理員 |
| DELETE | `/api/v1/videos/:videoId` | 刪除影片 | 教師/管理員 |

### QA

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| POST | `/api/v1/qa/ask` | 提問並取得 AI 回答 | 已登入 |

### LINE Bot

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| POST | `/api/v1/line/webhook` | LINE Bot Webhook | LINE 簽章驗證 |
| GET | `/api/v1/line/webhook` | LINE Webhook 驗證（Console Verify 用） | 公開 |
| POST | `/api/v1/line/bind-token` | 發放一次性 LINE 綁定 token（10 分鐘有效） | 已登入 |

### Dashboard 統計

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| GET | `/api/v1/stats/teacher` | 教師 dashboard 統計（課程/影片/問題數） | 教師/管理員 |
| GET | `/api/v1/stats/student` | 學生 dashboard 統計 | 學生/管理員 |

### Admin

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| GET | `/api/v1/admin/stats` | 全站總覽統計 | 管理員 |
| GET | `/api/v1/admin/users` | 使用者列表 | 管理員 |
| PATCH | `/api/v1/admin/users/:userId` | 更新使用者（停用/角色） | 管理員 |
| GET | `/api/v1/admin/videos` | 影片列表 | 管理員 |
| DELETE | `/api/v1/admin/videos/:videoId` | 刪除影片 | 管理員 |
| GET | `/api/v1/admin/events` | 最近 usage 事件 | 管理員 |
| GET | `/api/v1/admin/event-stats` | 事件統計（按類型/時段聚合） | 管理員 |

### Internal

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| POST | `/api/v1/internal/videos/:videoId/processing/start` | Pipeline 回報開始處理 | `PROCESSING_WEBHOOK_SECRET` |
| POST | `/api/v1/internal/videos/:videoId/processing/complete` | Pipeline 回報處理完成 | `PROCESSING_WEBHOOK_SECRET` |
| POST | `/api/v1/internal/videos/:videoId/processing/fail` | Pipeline 回報處理失敗 | `PROCESSING_WEBHOOK_SECRET` |

### 其他

| 方法 | 路徑 | 說明 | 權限 |
|------|------|------|------|
| GET | `/health` | 服務健康檢查（含 `runtime.qa` / `runtime.line`） | 公開 |
| GET | `/docs` | Swagger UI | 公開 |
| GET | `/docs/openapi.yaml` | OpenAPI raw spec | 公開 |

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
| 第一階段 | 文字問答系統 + LINE Bot + 前端頁面 | **整合中**（後端主線 + 前端頁面完成，API 整合進行中）|
| 第二階段 | 自動短影音生成 | 規劃中 |
| 第三階段 | 完整前端網頁體驗 | 規劃中 |
| 第四階段 | 個人化學習推薦 | 規劃中 |
