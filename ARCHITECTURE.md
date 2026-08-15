# ARCHITECTURE.md

FocusFlow 系統技術架構、資料流與資料庫契約。

> 正式資料契約請以 [docs/current-status.md](docs/current-status.md)、[backend/docs/current-state.md](backend/docs/current-state.md) 與實際程式碼為準。
>
> `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` 目前僅供歷史參考。Legacy 欄位（`video_segments`、`clips`）為過渡狀態。

---

## 一、系統概觀

三服務獨立，透過 HTTP API 與 MongoDB 協作：

```
┌─────────────────┐     HTTP      ┌─────────────────┐
│   前端 SPA      │ ←──────────→ │   後端 API      │
│  React 19/Vite  │              │ Node.js/Express  │
│   port 5173     │              │   port 4000      │
└─────────────────┘              └────────┬─────────┘
                                          │
                                     MongoDB Atlas
                                          │
                                 ┌────────┴─────────┐
                                 │   AI Pipeline    │
                                 │  Python CLI      │
                                 │ backend 可觸發   │
                                 └──────────────────┘
```

**關鍵決策**：AI Pipeline 仍是獨立 Python CLI，不內嵌 Express process；但 Phase-1 目前已由 backend 在影片建立後背景 spawn CLI。Pipeline 透過 MongoDB 寫入結果，並用 internal webhook 回報 `queued → processing → completed / failed`。見 [docs/decision-log.md](docs/decision-log.md)。

---

## 二、後端架構

### 分層

```
routes → controllers → services → models
```

| 層次 | 職責 |
|------|------|
| `routes/` | URL 對應與 middleware 掛載 |
| `controllers/` | 解析 request、呼叫 service、組裝 response |
| `services/` | 全部業務邏輯（不依賴 req/res） |
| `models/` | MongoDB Schema 定義與索引 |

### Middleware

`auth` → JWT 驗證 / `role` → RBAC / `upload` → multer 影片上傳 / `lineSignature` → LINE HMAC 驗簽 / `internalProcessingAuth` → Processing webhook secret / `notFound` + `error` → 404 與全域錯誤處理

### 路由模組

`backend/src/routes/index.js` 將下列模組掛在 `/api/v1`：

| 模組 | 主要路徑 | 對應 controller / service |
|------|----------|---------------------------|
| `auth.routes` | `/auth/login`、`/auth/me` | `auth.controller` / `auth.service` |
| `course.routes` | `/courses`（CRUD）、`/courses/:courseId/enrollments` | `course.controller` / `course.service` + `enrollment.controller` / `enrollment.service` |
| `video.routes` | `/courses/:courseId/videos`、`/courses/:courseId/video-batches`、`/video-batches/:batchId`、`/videos/:videoId/...` | `video.controller` / `video.service` + `videoBatch.controller` / batch services + `videoProcessing.service` |
| `qa.routes` | `/qa/ask` | `qa.controller` / `qa.service` + `questionRecording.service` |
| `line.routes` | `/line/webhook`、`/line/bind-token` | `line.controller` / `line.service` |
| `internal-video.routes` | `/internal/videos/:videoId/processing/{start,complete,fail}` | `video.controller` 內部 handlers |
| `stats.routes` | `/stats/teacher`、`/stats/student` | `teacherStats.service` |
| `admin.routes` | `/admin/{stats,users,videos,events,event-stats}` | `admin.controller` / `admin.service` |
| `health.routes` | `/health` | `runtimeDiagnostics.service` |

### QA 系統

雙策略混合搜尋（`qa.service.js`）：

1. **向量搜尋**（主）：以 `video_segments_text.embedding` 進行語意搜尋
2. **詞彙搜尋**（fallback）：embedding 不可用時，改用文字重疊率評分

搜尋模式由環境變數控制：

| 變數 | 值 | 說明 |
|------|----|------|
| `QA_QUERY_EMBEDDING_PROVIDER` | `mock` / `openai` / `gemini` | query 向量化方式 |
| `QA_ANSWER_PROVIDER` | `template` / `openai` / `gemini` | 答案生成方式 |
| `QA_VECTOR_SEARCH_MODE` | `memory` / `atlas` | 本機記憶體 vs Atlas Vector Search |

> Phase-1 當前正式 runtime 以 `gemini + atlas + gemini` 為主；若只做本機 smoke，可暫時切回 `mock + memory`，但實際狀態仍以 `.env` 與 `/health` 為準。

補充：為了讓 bridge-first MVP 更穩定、可理解，課程回應與 QA runtime course summary 現已提供 `isBridgeCourse`。`appOwnedVideoCount` / `metadataOnlyVideoCount` 只是 `appVideoCount` / `bridgeVideoCount` 的 readability aliases，不是另一套統計來源；QA 回應中的 `resultCategory` 則是 Phase-1 convenience field，方便前端或 demo 先分流，細節仍以 `status`、`matchStatus`、`degradedReasons` 為準。

### BridgeScope 搜尋範圍調度

`bridgeScope.service.js` 是 QA 搜尋範圍的核心調度器。`buildCourseSegmentScope()` 依據課程內影片組成判定 bridge mode：

| bridge mode | 條件 |
|-------------|------|
| `standard` | 只有 App owned 影片（或無影片） |
| `qa_scope_only` | 只有 Pipeline metadata 影片（無 App owned） |
| `mixed_scope` | 同時有 App owned 與 Pipeline metadata 影片 |

回傳 `allowedCourseIds` 與 `allowedVideoIds`，供 `qa.service.js` 在 `video_segments_text` 中過濾可搜尋範圍。

### Video Model 雙身份設計

`videos` collection 同時存放兩種文件，由 Model 靜態方法區分：

- `Video.isAppOwnedRecord(video)` — `courseId` + `uploadedBy` + `title` + `processing.status` 均存在 → App 建立的正式影片（本機上傳或 YouTube URL）
- `Video.isPipelineMetadataRecord(video)` — 有 `videoId` 或 legacy `video_id`，且不是 App owned → AI Pipeline metadata / bridge 相容資料

目前 `videos` 以 camelCase 欄位為主：`videoId`、`fileName`、`filePath`、`audioPath`、`durationSec`、`videoSource`、`videoUrl`、`youtubeVideoId`。`videos.video_id` 不應再新增；相容邏輯只為讀取舊資料與 bridge 範圍。

混存設計目的：讓 QA Pipeline 的外部影片資料可透過 `course.videoIds` 參照進入 QA 範圍，而不需要獨立 collection。Ownership 邊界尚未定版，是 Phase-1 已知 known issue。

### 影片處理狀態機

```
queued → processing → completed
                   ↘ failed → (retry) → processing
```

兩條觸發路徑：

- 前端 retry：`POST /api/v1/videos/:videoId/processing/retry`（JWT + teacher/admin 角色）
- Pipeline webhook：`POST /api/v1/internal/videos/:videoId/processing/{start,complete,fail}`（需 `PROCESSING_WEBHOOK_SECRET`）

合法狀態轉換由 `videoProcessing.service.js` 硬性強制，非法轉換直接回傳 409 `VIDEO_PROCESSING_TRANSITION_INVALID`，沒有軟性 fallback。

多影片批次的手動 retry 不會另建新批次：`single_adapter` 以原本受控本機來源重啟單片 worker；`pipeline_batch` 則在既有 manifest 對指定 `videoId` 授予一次額外嘗試並沿用同一 checkpoint。execution lease 仍禁止兩個 worker 同時修改同一批次。

### LINE Bot 對話狀態機

LINE Bot 在 `User` 文件上維護**使用者層級**的對話狀態：

| 欄位 | 說明 |
|------|------|
| `lineConversationState` | `idle`（可提問）/ `awaiting_course_selection`（等待選課） |
| `lineConversationHistory` | 最近 6 則對話（3 輪 Q&A），傳給 Gemini 做多輪上下文 |
| `activeCourseId` | 目前選定的課程 |

切換課程時顯示的選項 = `active Enrollment ∩ published Course`（最多 4 筆）。直接選擇、綁定後選擇與每次提問都重新驗證同一規則；資格撤銷時立即清除相符的 `activeCourseId` 與對話上下文。

### Enrollment 存取政策

- student 對課程內容一律採 default deny；只有 `active Enrollment ∩ published Course` 可存取 Course、Video、QA／FAQ、Shorts、課程通知與 LINE 問答。
- 只有課程 owner teacher 與 admin 可用完整學生 Email 指派或撤銷資格；目前沒有自助選課、邀請碼、審核流程或一般註冊自動加入。
- 撤銷採 soft revoke 並保留 Question／UsageLog 歷史；舊資料若尚未有 `status`，視為既有 active grant，避免升級時意外中斷已授權學生。

---

## 三、前端架構

登入頁採 Three.js 3D 場景（液態漸層背景、氣泡動畫、GSAP 補間）；學生 / 教師 / 管理員三套介面目前有 13 個頁面檔，第一階段 API 整合已完成。

```
frontend/focus-flow/src/
├── components/     # 共用元件（LoginPage、DashboardApp、Sidebar、Topbar、BubbleScene、Button3D 等）
├── pages/          # 13 個角色／共用頁面：
│                   #   Student: Dashboard, Courses, LineBot, ShortsWall
│                   #   Teacher: Dashboard, Courses, Upload
│                   #   Admin:   Overview, Stats, Users, Videos, Courses
│                   #   Shared:  Profile
├── api.js          # 共用 fetch wrapper（JWT 注入 / token 與 user 持久化）
├── App.jsx
└── main.jsx
```

API base URL 由 `VITE_API_BASE_URL` 控制，預設 `http://localhost:4000/api/v1`。Token 存於 `localStorage.ff_token`。

---

## 四、AI Pipeline 流程（`STT_Whisper/`）

```
本機影片或 YouTube URL
  ↓ scan_videos.py / yt-dlp  掃描本機檔或下載 YouTube 音訊
  ↓ extract_audio.py        FFmpeg 抽音（本機影片）
  ↓ transcribe.py           Faster-Whisper → 含時間戳逐字稿
  ↓ normalize_transcript.py rapidfuzz 修正專有名詞
  ↓ chunking.py             三重限制分段（字數/片段數/時長）
  ↓ embedding.py            Gemini text + audio embedding
  ↓ video_multimodal_pipeline.py  Gemini video embedding
  ↓ export_outputs.py       輸出 JSON/JSONL → data/outputs/
  ↓ mongodb_uploader.py     （可選）直接寫入 MongoDB
```

Backend 觸發時會傳：

```text
本機影片：python src/main.py --video-path <backend/uploads/file> --video-id <Mongo Video _id> --overwrite
YouTube：python src/main.py --youtube-url <url> --video-id <Mongo Video _id> --overwrite
```

Backend 觸發的單支影片輸出會寫到 `STT_Whisper/data/outputs/runs/<videoId>/`，避免併發覆蓋共用 `outputs/*.jsonl`。快取：音訊 → `data/processed_audio/`；Whisper 逐字稿 → `data/cache/transcripts/`。`--overwrite` 強制重新處理。

### Stable embedding generation 與 Hierarchical Retrieval 安全門

- Leaf 與 Parent artifact 都必須攜帶 provider、model、dimension、instruction、generation、normalization、contract/schema 與 task type；uploader 會在寫入前阻擋缺欄或不相容資料。
- Parent publication 預設把 artifact 的 `embedding_generation_version` 寫入 `generationVersion`，並以 `isActive=true` 標示可檢索資料；Backend Parent Search 同時用這兩個欄位過濾，且命中後再驗完整契約。
- Backend 啟用 hierarchy 時，會先對 rollout video allowlist 做唯讀 live readiness：確認 active Parent／其 Child Leaf 都屬同一 embedding generation、`chunkId_1` 可用，以及 Parent vector index 為 READY 且能 filter `courseId`、`videoId`、`generationVersion`、`isActive`。
- `.env` 的 `QA_ACTIVE_*_EMBEDDING_CONTRACT_JSON` 只屬部署宣告，不能取代實際 MongoDB 證據。任一 live check 缺失或不相容時，shadow／serve 均 fail closed；預設 Gate 仍為 false，Leaf fallback 保留。

---

## 五、資料庫模型與 Legacy 差異

| 模型 / Collection | 狀態 | 說明 |
|-------------------|------|------|
| `users` | 正式 | 帳號、角色、密碼雜湊；含 LINE 對話狀態與歷史 |
| `courses` | 正式 | 課程容器，`videoIds` 引用 `videos._id` |
| `videos` | 混合 | App-owned video 與 pipeline metadata 混存，ownership 尚未定版 |
| `video_segments_text` | **v1 正式** | 問答搜尋核心，text embedding；欄位 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`） |
| `video_segments_video` | v1 正式（QA 尚未接） | 影片片段 + video embedding；DB 文件目前仍為 snake_case（`video_id`、`clip_id`、`start_sec`） |
| `video_segments_audio` | 預留 | Pipeline 預留位，目前 0 筆 |
| `questions` | 正式 | 每則提問的問題、答案、matches、runtime 訊號與 `sourceUsageLogId` |
| `transcripts_normalized` | Pipeline | 正規化逐字稿 |
| `term_dictionary` | Pipeline | 專有名詞字典（rapidfuzz 修正用） |
| `clips` | Legacy | 快取層，`video_segments_video` 尚未接手 |
| `enrollments` | 正式 | 學生修課授權（`studentId` × `courseId` 唯一索引、`active/revoked`、指派／撤銷稽核欄位、`progress`、`lineNotify`） |
| `usage_logs` | 正式 | 使用行為記錄（login / watch / ask / clip_view） |
| `line_bind_tokens` | 正式 | LINE 綁定一次性 token，`expiresAt` TTL 自動清除 |

---

## 六、模組交互流程

```
前端                後端                     MongoDB
 │                   │                          │
 │  POST /auth/login │                          │
 │──────────────────→│  auth.service            │
 │  ← JWT Token ─────│  bcrypt 比對密碼         │
 │                   │                          │
 │  POST /qa/ask     │                          │
 │  (Bearer JWT)─────→│  qa.service             │
 │                   │  embedQuery()            │
 │                   │  searchSegments()────────→│ video_segments_text
 │                   │  ←──────── matches ──────│
 │                   │  generateAnswer()        │
 │                   │  recordUsage()───────────→│ usage_logs
 │  ← answer + clip─│                          │

LINE Bot             後端
 │  POST /line/webhook│
 │──────────────────→│  line.service
 │                   │  HMAC 驗簽 → 解析 userId
 │                   │  qa.service.askQuestion()
 │  ← reply message─│
```
