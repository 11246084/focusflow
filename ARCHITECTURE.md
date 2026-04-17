# ARCHITECTURE.md

FocusFlow 系統技術架構、資料流與資料庫契約。

> 正式資料契約：[docs/05_Database_Schema_Contract/MongoDB_契約定版_v1.md](docs/05_Database_Schema_Contract/MongoDB_契約定版_v1.md)
>
> 若程式碼與本文件衝突，以契約文件與實際 PR 為準。Legacy 欄位（`video_segments`、`clips`）為過渡狀態。

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

**關鍵決策**：AI Pipeline 作為離線 CLI（非 backend subprocess）。Whisper 模型體積大、執行耗時，Pipeline 完成後直接寫入 MongoDB，backend 只查詢結果。見 [docs/decision-log.md](docs/decision-log.md)。

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
| `QA_ANSWER_PROVIDER` | `template` / `openai` | 答案生成方式 |
| `QA_VECTOR_SEARCH_MODE` | `memory` / `atlas` | 本機記憶體 vs Atlas Vector Search |

> Phase-1 正式 runtime：`mock + memory + gemini`。`atlas` mode 目前 fail-fast，尚未上線。

補充：為了讓 bridge-first MVP 更穩定、可理解，課程回應與 QA runtime course summary 現已提供 `isBridgeCourse`。`appOwnedVideoCount` / `metadataOnlyVideoCount` 只是 `appVideoCount` / `bridgeVideoCount` 的 readability aliases，不是另一套統計來源；QA 回應中的 `resultCategory` 則是 Phase-1 convenience field，方便前端或 demo 先分流，細節仍以 `status`、`matchStatus`、`degradedReasons` 為準。

### 影片處理狀態機

```
queued → processing → completed
                   ↘ failed → (retry) → processing
```

觸發：`POST /api/v1/internal/videos/:videoId/processing`（需 `PROCESSING_WEBHOOK_SECRET`）

---

## 三、前端架構

目前為展示型登入頁，Three.js 3D 場景（液態漸層背景、氣泡動畫、GSAP 補間）。主介面待開發。

```
frontend/focus-flow/src/
├── components/     # React 元件（含 Three.js 3D 登入場景）
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
