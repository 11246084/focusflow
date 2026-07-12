# FocusFlow

FocusFlow 是一個 AI 驅動的教育影片問答系統。教師上傳教學影片後，系統會自動執行 STT、文字分段與向量嵌入（並可在設定憑證後自動上傳 YouTube）；學生可在網頁或 LINE Bot 提問，取得 AI 生成答案與對應影片時間戳。

> 目前範圍是 **Phase 1 MVP**：文字版影片問答、課程/影片管理、LINE Bot 問答與前端角色頁面整合。

---

## 專案結構

| 路徑 | 服務 | 技術 | 預設埠號 |
|------|------|------|----------|
| `backend/` | REST API | Node.js、Express 4、MongoDB、JWT | `4000` |
| `frontend/focus-flow/` | SPA 前端 | React 19、Vite、Three.js、GSAP | `5173` |
| `STT_Whisper/` | AI Pipeline | Python、Faster-Whisper、Gemini Embedding、FFmpeg、yt-dlp | CLI |

重要文件：

| 文件 | 用途 |
|------|------|
| [docs/current-status.md](docs/current-status.md) | 跨服務最新進度與缺口 |
| [backend/docs/current-state.md](backend/docs/current-state.md) | Backend runtime、DB 實況、已知限制 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架構、資料流與 schema 邊界 |
| [backend/docs/openapi.yaml](backend/docs/openapi.yaml) | OpenAPI 規格檔，執行時掛在 `/docs` |

---

## 快速啟動

### 前置需求

- Node.js 18+
- Python 3.10+
- MongoDB（本機或 Atlas）
- FFmpeg（AI Pipeline 使用；也可走 `imageio-ffmpeg` 內建 binary）

### 1. 啟動後端

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

Unix-like shell 可用：

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

最小化本機 smoke 測試不需要外部 API key，可在 `backend/.env` 改成：

```env
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_ANSWER_PROVIDER=template
QA_VECTOR_SEARCH_MODE=memory
```

共享 demo env 目前偏向 `gemini + atlas + gemini`，但共享 Atlas 在 2026-05-01 驗證時已沒有 `text_embedding_index`。若 `QA_VECTOR_SEARCH_MODE=atlas`，必須先確認 Atlas vector index 存在，否則 `/health` 或提問會 fail-fast。

### 2. 植入示範資料

```powershell
cd backend
npm run seed
```

需要清掉 demo-owned / demo-derived 痕跡再重建時：

```powershell
npm run seed:reset
```

示範帳號：

| 角色 | Email | 密碼 |
|------|-------|------|
| 管理員 | `admin@focusflow.local` | `Admin123!` |
| 教師 | `teacher@focusflow.local` | `Teacher123!` |
| 學生 | `student@focusflow.local` | `Student123!` |

### 3. 啟動前端

```powershell
cd frontend\focus-flow
npm install
Copy-Item .env.example .env
npm run dev
```

前端預設連到：

```env
VITE_API_BASE_URL=http://127.0.0.1:4000/api/v1
```

### 4. 設定 AI Pipeline

```powershell
cd STT_Whisper
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

`STT_Whisper/.venv/` 是建議位置。Backend 自動觸發 STT 時會優先使用 `STT_Whisper/.venv/Scripts/python.exe`。

手動處理影片：

```powershell
python src/main.py
python src/main.py --limit 1
python src/main.py --overwrite
```

教師上傳採**單一軌道**（2026-07-12 起）：本地上傳影片後，系統自動執行 STT → 切段 → embedding，並在設定 YouTube 憑證時自動上傳 YouTube 供學生 iframe 播放（支援 timestamp 跳轉）。YouTube URL API（`POST /courses/:courseId/videos/youtube`）保留，但已不在教師上傳頁露出。

---

## 常用指令

### Backend

| 指令 | 用途 |
|------|------|
| `npm run dev` | 啟動 nodemon 開發模式 |
| `npm start` | 正式啟動 |
| `npm run seed` | 建立 / 更新 demo baseline |
| `npm run seed:reset` | 清除 demo 痕跡後重建 baseline |
| `npm run db:sync-atlas` | 將本機 MongoDB 同步至 Atlas |
| `npm test` | 執行 backend 全部測試 |

注意：`db:ensure-questions` 與 `db:backfill-questions` 目前是 dangling scripts，指向的 `src/scripts/ensureQuestionsCollection.js`、`src/scripts/backfillQuestionsFromUsageLogs.js` 不存在，執行會失敗。`questions` collection 目前由 Mongoose schema 與 QA 記錄流程建立。

### Frontend

| 指令 | 用途 |
|------|------|
| `npm run dev` | 啟動 Vite 開發伺服器 |
| `npm run lint` | ESLint 檢查 |
| `npm run build` | 建立 production build |
| `npm run preview` | 預覽 production build |

### AI Pipeline

| 指令 | 用途 |
|------|------|
| `python src/main.py` | 處理輸入資料夾內所有影片 |
| `python src/main.py --limit 1` | 快速處理第一支影片 |
| `python src/main.py --overwrite` | 強制重跑，不使用既有輸出 |
| `python src/video_multimodal_pipeline.py` | 執行視訊多模態 pipeline |
| `python src/mongodb_uploader.py` | 將 pipeline 輸出寫入 MongoDB |

---

## API 入口

執行 backend 後可使用：

| 路徑 | 說明 |
|------|------|
| `GET /health` | 健康檢查，含 `runtime.qa` 與 `runtime.line` |
| `GET /docs` | Swagger UI |
| `GET /docs/openapi.yaml` | Raw OpenAPI spec |

主要 REST 端點：

| 模組 | 端點 |
|------|------|
| Auth | `POST /api/v1/auth/login`、`GET /api/v1/auth/me` |
| Courses | `POST/GET /api/v1/courses`、`GET/PATCH/DELETE /api/v1/courses/:courseId` |
| Videos | `POST /api/v1/courses/:courseId/videos`、`POST /api/v1/courses/:courseId/videos/youtube`、`GET /api/v1/courses/:courseId/videos`、`GET/DELETE /api/v1/videos/:videoId`、`GET /api/v1/videos/:videoId/processing`、`POST /api/v1/videos/:videoId/processing/retry` |
| QA | `POST /api/v1/qa/ask` |
| LINE | `GET/POST /api/v1/line/webhook`、`POST /api/v1/line/bind-token` |
| Stats | `GET /api/v1/stats/teacher`、`GET /api/v1/stats/student` |
| Admin | `GET /api/v1/admin/stats`、`GET /api/v1/admin/users`、`PATCH /api/v1/admin/users/:userId`、`GET /api/v1/admin/videos`、`DELETE /api/v1/admin/videos/:videoId`、`GET /api/v1/admin/events`、`GET /api/v1/admin/event-stats` |
| Internal Pipeline | `POST /api/v1/internal/videos/:videoId/processing/start`、`complete`、`fail` |

OpenAPI 目前尚未完整涵蓋 stats/admin 與部分 PATCH/DELETE 端點；完整狀態以實際 route files、此 README 與 [backend/docs/current-state.md](backend/docs/current-state.md) 為準。

---

## LINE Bot

環境變數：

```env
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
VITE_LINE_BOT_URL=
```

本機開發可用 ngrok 將 backend 暴露到網路：

```powershell
ngrok http 4000
```

LINE Developers Console Webhook URL：

```text
https://<your-domain>/api/v1/line/webhook
```

學生綁定流程：

1. 學生登入 FocusFlow 前端。
2. 前端呼叫 `POST /api/v1/line/bind-token` 取得 10 分鐘有效的一次性 token。
3. 學生將 token 傳給 LINE Bot。
4. Bot 寫入 `lineUserId` 並引導學生選擇課程。
5. 後續自然語言訊息會對目前課程執行 QA。

LINE Bot 指令：

| 訊息 | 功能 |
|------|------|
| `<綁定 token>` | 完成帳號綁定 |
| `切換課程` | 顯示可選課程 |
| 其他文字 | 對目前選定課程提問 |

---

## 目前狀態與限制

截至 2026-05-07：

- Backend 主線已包含 auth、courses、videos、QA、LINE、stats、admin、internal processing webhook；route + service 全測試 83/83 passed（含 student dashboard 改用 `userId` 與 `matches[].videoTitle` 修正）。
- 2026-05-07 後端查詢平行化：`teacherStats.service.js` dashboard 兩輪 Promise.all + 全 `.lean()`；`qa.service.js` 三處平行（access+videos / generateAnswer+findCachedClip / writes 收尾）；`loadScopedSearchableSegments` 補 `.lean()`，51 segments hydration 從 8.8s 降到 ~1s。API 回應格式 / 答案品質 100% 不變。
- 新增 `[qa-timing]` 診斷 log（`course-lookup` / `access+videos` / `load-segments` / `embed` / `search` / `llm+clip` / `writes` / `TOTAL`），可用 `QA_TIMING=off` 關閉，`NODE_ENV=test` 自動靜音。
- Frontend 已有登入與 Student / Teacher / Admin 角色頁面，登入、課程、QA grounding、LINE QR 綁定流程已串接；教師上傳表單支援多支影片連續上傳（移除 `uploadDone` 鎖）。
- AI Pipeline 可執行 STT → chunking → embedding → MongoDB 寫入，並可由 backend 在影片上傳或 YouTube URL 建立後自動觸發；`mongodb_uploader._target_video_exists()` 在寫入前檢查 Video record，避免 STT 寫入時 race condition 產生孤兒 segments。
- `questions` collection 已接入，QA 與 LINE Bot 提問會自動落庫；2026-05-07 起刪除 Video / Course 不再連動刪 UsageLog / Question（保留歷史），改由 display 層分流：老師 Top Segments 指向已刪影片時 fallback 到課程現存影片、課程無現存影片時標「內容已下架」（2026-07-12 修正，先前會整列消失）；學生 Recent Queries / 管理員 Recent Events 顯示「內容已下架」badge。
- 影片可掛載多課程（2026-07-12，P1-3）：`POST /api/v1/courses/:courseId/videos/:videoId/attach|detach`；主課程記在 `video.courseId`，掛載課程用 `course.videoIds` 引用；QA / 播放 / watched 進度都支援掛載課程。
- 教師可刪自己的課程：`DELETE /api/v1/courses/:id` 放寬到 TEACHER + ADMIN，service 仍限 admin 或 owner teacher；cascade 清 Video / Segment / transcripts / `course.videoIds $pull` / `Enrollment` / `User.activeCourseId $unset`。
- QA 拒答：scope 內無 live video 時直接回「這門課目前沒有可回答的影片資料」，不叫 AI；LINE 課程選單透過 `filterCoursesWithLiveVideos()` 過濾沒有 live video 的課程。
- 新增錯誤碼 `INVALID_ENCODING` (400)：`qa.controller.js` 偵測到客戶端送出壞 utf-8 body 時拒收。
- LINE live 曾端對端驗證成功，但 ngrok URL / Channel 設定屬部署時變動項。
- 共享 Atlas 目前缺少 `text_embedding_index`，不能直接宣稱 atlas mode ready。
- `video_segments_video` 仍是預留 / legacy 邊界，尚未成為正式 clip source。
- YouTube 整合：教師可貼 URL（backend 解析存 `youtubeVideoId`，pipeline 用 `yt-dlp` 下載音訊）；2026-07-12 起本地影片可透過 YouTube Data API 自動上傳（feature flag `YOUTUBE_UPLOAD_ENABLED`，預設關閉，需 OAuth 憑證，**尚未以 live 憑證端對端驗證**）。自動清 `backend/uploads/`、playlist 管理尚未做。
- CORS 目前仍是寬鬆設定，正式部署前需限縮。

更細的進度與缺口請看 [docs/current-status.md](docs/current-status.md)。

---

## 專案藍圖

| 階段 | 內容 | 狀態 |
|------|------|------|
| Phase 1 | 文字問答系統、LINE Bot、課程/影片管理、前端角色頁面 | 整合中 |
| Phase 2 | 自動短影音生成 | 規劃中 |
| Phase 3 | 完整前端網頁體驗 | 規劃中 |
| Phase 4 | 個人化學習推薦 | 規劃中 |
