# FocusFlow 專案概覽

FocusFlow 是一個 **AI 驅動的教育影片問答系統**，讓學生對教師上傳的教材提問，取得附有影片時間位置的回答。這份概覽說明產品目的與功能範圍，方便團隊決定要交付哪些使用流程。請先閱讀範圍與模組；完成度、試用日期及驗收結果統一見[目前狀態](docs/current-status.md)。

---

## 技術堆疊

| 服務 | 技術 | 埠號 |
|------|------|------|
| **後端 API** | Node.js、Express 4、MongoDB + Mongoose、JWT | 4000 |
| **前端 SPA** | React 19、Vite、Three.js、GSAP | 5173 |
| **AI Pipeline** | Python、Faster-Whisper、Gemini Embedding、FFmpeg、yt-dlp | CLI |

---

## 核心使用範圍

1. 使用者登入與角色控制（admin / teacher / student）
2. 課程與影片管理（教師建立、上傳本機影片或貼 YouTube URL，含 PATCH/DELETE）
3. 影片處理狀態流程（queued → processing → completed / failed），影片建立後由 backend 背景觸發 STT pipeline
4. AI 問答 API（語意搜尋 + 回答生成、提問自動寫入 `questions`）
5. LINE Bot 整合（Webhook、一次性 token 綁定、課程切換、提問、多輪對話歷史）
6. Teacher / Student / Admin dashboard 統計與管理介面
7. 基本測試與錯誤處理

營運需求範圍包含修課學生 CSV（以逗號分隔欄位的表格檔）匯入、學生每日提問與字數上限、登入失敗鎖定、忘記密碼、網頁多輪問答、問題回報與管理員服務診斷；此處列產品範圍，不另判定完成度。

---

## 主要模組

### Backend（`backend/`）
- **auth** — JWT 登入、RBAC 三角色、學生自助註冊（教師由管理員建立）、忘記密碼、登入失敗鎖定
- **courses / videos** — 課程與影片 CRUD（含 PATCH/DELETE）、processing 狀態機、修課授權（Enrollment）、多影片批次上傳
- **conversations** — 網頁多輪問答，與 QA 共用每日提問上限
- **notifications / feedback** — 站內通知、使用者問題回報
- **short-scripts / shorts** — 短影片腳本自動生成、教師審核上架；設定條件見[功能開關](backend/docs/feature-flags.md)
- **qa** — 雙策略搜尋（向量 + 詞彙）+ 可插拔 provider（gemini/openai/mock）+ 自動將提問寫入 `questions`
- **line** — Webhook 簽章驗證、帳號綁定（一次性 token / QR）、問答 routing、多輪對話歷史
- **stats** — Teacher / Student dashboard 統計
- **admin** — 使用者、影片、事件管理與全站統計
- **questionRecording** — 將每則 QA 提問寫入 `questions`，連結 `usage_logs`
- **bridgeScope** — 課程 QA 搜尋範圍調度（standard / qa_scope_only / mixed_scope）
- **demoSeed** — 透過 `npm run seed` / `seed:reset` 植入示範資料

### Frontend（`frontend/focus-flow/`）
網頁按學生、教師與管理員角色區分操作範圍：學生觀看教材與提問，教師管理課程、上傳影片與審核短片，管理員維護帳號及查看服務診斷，個人資料由各角色共用。頁面入口見[前端應用程式](frontend/focus-flow/src/App.jsx)，操作與設定見[前端 README](frontend/focus-flow/README.md)，整合及驗收結果見[目前狀態](docs/current-status.md)。

### AI Pipeline（`STT_Whisper/`）
獨立 CLI 流程：本機影片或 YouTube URL → FFmpeg / yt-dlp 音訊處理 → Faster-Whisper STT → 文字分段 → Gemini 向量嵌入 → 匯出 JSON / JSONL → `mongodb_uploader.py` 寫入 MongoDB。Backend 建立影片後可背景 spawn 這個 CLI，並透過 internal webhook 接收處理狀態。

---

## 資料庫模型

| Model（Collection） | 說明 |
|------|------|
| `User`（`users`）| 帳號、角色、密碼雜湊；含 LINE 綁定狀態（`lineUserId`、`lineConversationState`、`lineConversationHistory`、`activeCourseId`） |
| `Course`（`courses`）| 課程容器（draft / published / archived） |
| `Video`（`videos`）| 影片元資料與 processing 狀態；App-owned 影片以 camelCase 欄位為主，支援 `sourceType: upload / youtube` 與 `youtubeVideoId`；仍保留少量 legacy pipeline metadata 相容 |
| `VideoSegment`（`video_segments_text`，可由 `VIDEO_SEGMENT_COLLECTION` 切換）| 問答用的文字片段與搜尋向量；欄位採 camelCase 命名 |
| `Question`（`questions`）| 每則 QA 提問與回答歷史，含 matches、runtime 訊號與 `sourceUsageLogId` 連結 |
| `Enrollment`（`enrollments`）| 學生修課授權（`studentId`、`courseId`、`active/revoked`、指派／撤銷稽核欄位、`progress`、`lineNotify`）；學生內容存取需同時符合 active Enrollment 與 published Course |
| `Clip`（`clips`）| 影片精華片段相關資料 |
| `UsageLog`（`usage_logs`）| 使用行為記錄（login / watch / ask / clip_view） |
| `LineBindToken`（`line_bind_tokens`）| LINE 帳號綁定一次性 token，TTL 索引自動清除 |

其他 model：`Notification`、`Avatar`、`Faq`（FAQ 快取）、`Conversation` / `Message`（網頁多輪問答）、`Feedback` / `FeedbackAttachment`（問題回報）、`ShortScript` / `ShortAsset`（短影片）、`VideoBatch`（多影片批次）、`VideoSegmentParent`（較大段落的檢索資料）、`VideoSegmentVideo`（影像片段與搜尋向量）。分層及影像查詢的範圍與設定見[後端技術索引](backend/docs/current-state.md)，可用性與驗收見[目前狀態](docs/current-status.md)。

資料庫的集合清單、筆數與索引需實查，結果由[目前狀態](docs/current-status.md)追查；實查項目見[DB 交接清單](database/docs/db-handoff-current.txt)。

資料欄位與契約請對照[架構說明](ARCHITECTURE.md)、[後端技術索引](backend/docs/current-state.md)與實際程式碼；[資料庫舊契約](docs/90_Archive/superseded/MongoDB_契約定版_v1_已過期.md)僅供歷史參考。
