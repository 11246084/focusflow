# FocusFlow 專案概覽

FocusFlow 是一個 **AI 驅動的教育影片問答系統**。教師上傳教學影片，學生可對影片內容提問，系統以 AI 生成答案並附上對應影片時間段。

目前處於 **MVP 第一階段**。進度詳見 [docs/current-status.md](docs/current-status.md)。

---

## 技術堆疊

| 服務 | 技術 | 埠號 |
|------|------|------|
| **後端 API** | Node.js、Express 4、MongoDB + Mongoose、JWT | 4000 |
| **前端 SPA** | React 19、Vite、Three.js、GSAP | 5173 |
| **AI Pipeline** | Python、Faster-Whisper、Gemini Embedding、FFmpeg | CLI |

---

## Phase 1 MVP 範圍

1. 使用者登入與角色控制（admin / teacher / student）
2. 課程與影片管理（教師建立、上傳）
3. 影片處理狀態流程（queued → processing → completed / failed）
4. AI 問答 API（語意搜尋 + 回答生成）
5. LINE Bot 整合（Webhook、帳號綁定、課程切換、提問）
6. 基本測試與錯誤處理

---

## 主要模組

### Backend（`backend/`）
- **auth** — JWT 登入、RBAC 三角色
- **courses / videos** — 課程與影片 CRUD、processing 狀態機
- **qa** — 雙策略搜尋（向量 + 詞彙）+ 可插拔 provider（mock/openai/gemini）
- **line** — Webhook 簽章驗證、帳號綁定、問答 routing
- **demoSeed** — 啟動時植入示範資料（`DEMO_SEED_ENABLED=true`）

### Frontend（`frontend/focus-flow/`）
登入頁採 Three.js 3D 場景；學生 / 教師 / 管理員三套介面共 10 頁面（StudentDashboard / Courses / LineBot、TeacherDashboard / Courses / Upload、AdminOverview / Stats / Users / Videos）已完成 UI，目前進行 API 整合。

### AI Pipeline（`STT_Whisper/`）
離線 CLI 流程：影片 → FFmpeg 音訊提取 → Faster-Whisper STT → 文字分段 → Gemini 向量嵌入 → 匯出 JSON / JSONL；如需落庫，另由 `mongodb_uploader.py` 導入 MongoDB。

---

## 資料庫模型

| Model（Collection） | 說明 |
|------|------|
| `User`（`users`）| 帳號、角色、密碼雜湊 |
| `Course`（`courses`）| 課程容器（draft / published / archived） |
| `Video`（`videos`）| 影片元資料與 processing 狀態；同時混存 App-owned 與 Pipeline metadata |
| `VideoSegment`（`video_segments_text`，可由 `VIDEO_SEGMENT_COLLECTION` 切換）| 問答核心：文字片段 + text embedding（v1 正式） |
| `Enrollment`（`enrollments`）| 學生修課紀錄、LINE userId 綁定 |
| `Clip`（`clips`）| 影片精華片段；目前定位為過渡層，`video_segments_video` 尚未接手 |
| `UsageLog`（`usagelogs`）| 使用行為記錄 |
| `LineBindToken`（`linebindtokens`）| LINE 帳號綁定一次性 token |

DB 中另存在 `video_segments_video`（影片片段 + video embedding，v1 正式契約，由 AI Pipeline 寫入，backend 尚未直接接入 QA）。舊版 `video_segments`（無後綴）為 legacy collection，目前不被 backend 程式碼引用。

正式資料契約目前請以 [ARCHITECTURE.md](ARCHITECTURE.md)、[docs/current-status.md](docs/current-status.md)、[backend/docs/current-state.md](backend/docs/current-state.md) 與實際程式碼為準；[docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md](docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md) 僅保留作歷史參考。
