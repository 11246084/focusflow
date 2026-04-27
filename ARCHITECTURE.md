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
                                 │  （離線執行）    │
                                 └──────────────────┘
```

**關鍵決策**：AI Pipeline 作為離線 CLI（非 backend subprocess）。Whisper 模型體積大、執行耗時，因此與 backend process 分離；目前主線先輸出標準化 JSON / JSONL，必要時再由 uploader 導入 MongoDB。見 [docs/decision-log.md](docs/decision-log.md)。

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

`auth` → JWT 驗證 / `role` → RBAC / `upload` → multer 影片上傳 / `lineSignature` → LINE HMAC 驗簽 / `internalProcessingAuth` → Processing webhook secret / `error` → 全域錯誤處理

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

- `Video.isAppOwnedRecord(video)` — `courseId` + `uploadedBy` + `title` + `processing.status` 均存在 → App 上傳的正式影片
- `Video.isPipelineMetadataRecord(video)` — 有 `video_id` 且不是 App owned → AI Pipeline 寫入的 metadata

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

### LINE Bot 對話狀態機

LINE Bot 在 `User` 文件上維護**使用者層級**的對話狀態：

| 欄位 | 說明 |
|------|------|
| `lineConversationState` | `idle`（可提問）/ `awaiting_course_selection`（等待選課） |
| `lineConversationHistory` | 最近 6 則對話（3 輪 Q&A），傳給 Gemini 做多輪上下文 |
| `activeCourseId` | 目前選定的課程 |

切換課程時顯示的選項 = 自己的 enrollment ∪ 所有 `published` 課程（去重，最多 4 筆），不是只顯示自己修的。

---

## 三、前端架構

登入頁採 Three.js 3D 場景（液態漸層背景、氣泡動畫、GSAP 補間）；學生 / 教師 / 管理員三套介面共 10 頁面 UI 已完成，目前進行 API 整合。

```
frontend/focus-flow/src/
├── components/     # 共用元件（LoginPage、Sidebar、Topbar、3D 場景等）
├── pages/          # 角色頁面（Student / Teacher / Admin × 多頁）
├── App.jsx
└── main.jsx
```

---

## 四、AI Pipeline 流程（`STT_Whisper/`）

```
影片檔案
  ↓ scan_videos.py          掃描 Test_video_file/
  ↓ extract_audio.py        FFmpeg 抽音（.wav）
  ↓ transcribe.py           Faster-Whisper → 含時間戳逐字稿
  ↓ normalize_transcript.py rapidfuzz 修正專有名詞
  ↓ chunking.py             三重限制分段（字數/片段數/時長）
  ↓ embedding.py            Gemini text + audio embedding
  ↓ video_multimodal_pipeline.py  Gemini video embedding
  ↓ export_outputs.py       輸出 JSON/JSONL → data/outputs/
  ↓ mongodb_uploader.py     （可選）直接寫入 MongoDB
```

快取：音訊 → `data/processed_audio/`；Whisper 逐字稿 → `data/cache/transcripts/`。`--overwrite` 強制重新處理。

---

## 五、資料庫模型與 Legacy 差異

| 模型 / Collection | 狀態 | 說明 |
|-------------------|------|------|
| `users` | 正式 | 帳號、角色、密碼雜湊 |
| `courses` | 正式 | 課程容器 |
| `videos` | 混合 | App-owned video 與 pipeline metadata 混存，ownership 尚未定版 |
| `video_segments_text` | **v1 正式** | 問答搜尋核心，text embedding index |
| `video_segments_video` | **v1 正式** | 影片片段 + video embedding |
| `video_segments` | **Legacy** | 舊版過渡 collection，非 v1 契約 |
| `clips` | **Legacy** | 快取層，`video_segments_video` 尚未接手 |
| `enrollments` | 正式 | 學生修課、LINE userId 綁定 |
| `usagelogs` | 正式 | 使用行為記錄 |
| `linebindtokens` | 正式 | LINE 綁定一次性 token |

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
 │                   │  recordUsage()───────────→│ usagelogs
 │  ← answer + clip─│                          │

LINE Bot             後端
 │  POST /line/webhook│
 │──────────────────→│  line.service
 │                   │  HMAC 驗簽 → 解析 userId
 │                   │  qa.service.askQuestion()
 │  ← reply message─│
```
