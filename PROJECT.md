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
2. 課程與影片管理（教師建立、上傳，含 PATCH/DELETE）
3. 影片處理狀態流程（queued → processing → completed / failed），上傳後自動觸發 STT pipeline
4. AI 問答 API（語意搜尋 + 回答生成、提問自動寫入 `questions`）
5. LINE Bot 整合（Webhook、一次性 token 綁定、課程切換、提問、多輪對話歷史）
6. Teacher / Student / Admin dashboard 統計與管理介面
7. 基本測試與錯誤處理

---

## 主要模組

### Backend（`backend/`）
- **auth** — JWT 登入、RBAC 三角色
- **courses / videos** — 課程與影片 CRUD（含 PATCH/DELETE）、processing 狀態機
- **qa** — 雙策略搜尋（向量 + 詞彙）+ 可插拔 provider（gemini/openai/mock）+ 自動將提問寫入 `questions`
- **line** — Webhook 簽章驗證、帳號綁定（一次性 token / QR）、問答 routing、多輪對話歷史
- **stats** — Teacher / Student dashboard 統計
- **admin** — 使用者、影片、事件管理與全站統計
- **questionRecording** — 將每則 QA 提問寫入 `questions`，連結 `usage_logs`
- **bridgeScope** — 課程 QA 搜尋範圍調度（standard / qa_scope_only / mixed_scope）
- **demoSeed** — 透過 `npm run seed` / `seed:reset` 植入示範資料

### Frontend（`frontend/focus-flow/`）
登入頁採 Three.js 3D 場景；學生 / 教師 / 管理員三套介面共 11 頁面：StudentDashboard / StudentCourses / StudentLineBot、TeacherDashboard / TeacherCourses / TeacherUpload、AdminOverview / AdminStats / AdminUsers / AdminVideos / AdminCourses。UI 完成，API 整合進行中。

### AI Pipeline（`STT_Whisper/`）
離線 CLI 流程：影片 → FFmpeg 音訊提取 → Faster-Whisper STT → 文字分段 → Gemini 向量嵌入 → 匯出 JSON / JSONL；如需落庫，另由 `mongodb_uploader.py` 導入 MongoDB。

---

## 資料庫模型

| Model（Collection） | 說明 |
|------|------|
| `User`（`users`）| 帳號、角色、密碼雜湊；含 LINE 綁定狀態（`lineUserId`、`lineConversationState`、`lineConversationHistory`、`activeCourseId`） |
| `Course`（`courses`）| 課程容器（draft / published / archived） |
| `Video`（`videos`）| 影片元資料與 processing 狀態；同時混存 App-owned 與 Pipeline metadata |
| `VideoSegment`（`video_segments_text`，可由 `VIDEO_SEGMENT_COLLECTION` 切換）| 問答核心：文字片段 + text embedding（v1 正式，欄位 camelCase） |
| `Question`（`questions`）| 每則 QA 提問與回答歷史，含 matches、runtime 訊號與 `sourceUsageLogId` 連結 |
| `Enrollment`（`enrollments`）| 學生修課紀錄（`studentId`、`courseId`、`progress`、`lineNotify`） |
| `Clip`（`clips`）| 影片精華片段；目前定位為過渡層，`video_segments_video` 尚未接手 |
| `UsageLog`（`usage_logs`）| 使用行為記錄（login / watch / ask / clip_view） |
| `LineBindToken`（`line_bind_tokens`）| LINE 帳號綁定一次性 token，TTL 索引自動清除 |

DB 中另存在 `video_segments_video`（影片片段 + video embedding，v1 正式契約，由 AI Pipeline 寫入，backend 尚未直接接入 QA）。

2026-05-01 共享 Atlas 實況為 13 個 collections；`database/tools/setup/init_collections.js` 目前列 15 個，兩者尚未同步。init 腳本有但 Atlas 沒有：`stt_cache`、`raw_transcripts`、`video_segments`；Atlas 有但 init 腳本沒有：`questions`。因此舊版 `video_segments` 目前仍是 legacy/init 腳本殘留項，不是 backend runtime 依賴。

正式資料契約目前請以 [ARCHITECTURE.md](ARCHITECTURE.md)、[docs/current-status.md](docs/current-status.md)、[backend/docs/current-state.md](backend/docs/current-state.md) 與實際程式碼為準；[docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md](docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md) 僅保留作歷史參考。
