# ARCHITECTURE.md

FocusFlow 系統架構設計文件。

---

## 一、系統概觀

FocusFlow 採用三服務分離架構，各自獨立開發與部署，透過 HTTP API 和 MongoDB 協作：

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
                                 │  (離線執行)      │
                                 └──────────────────┘
```

**設計決策**：AI Pipeline 作為離線 CLI 工具而非後端的內嵌 subprocess，原因是 Whisper 模型體積大、執行耗時，不適合與 API 伺服器共用同一個 process。Pipeline 執行完成後直接寫入 MongoDB，後端只負責查詢結果。

---

## 二、後端架構（`backend/`）

### 分層結構

```
routes → controllers → services → models
```

每層的職責嚴格分離：

| 層次 | 職責 | 規則 |
|------|------|------|
| `routes/` | URL 對應與 middleware 掛載 | 只做路由宣告，不含邏輯 |
| `controllers/` | 解析 request、呼叫 service、組裝 response | 不直接操作 Model |
| `services/` | 全部業務邏輯 | 不直接依賴 req/res |
| `models/` | MongoDB Schema 定義 | 僅描述資料結構與索引 |

### 資料夾說明

```
backend/src/
├── config/
│   ├── env.js          # 集中管理所有環境變數，型別轉換在此完成，避免散落各處的 process.env
│   └── database.js     # Mongoose 連線邏輯
├── constants/
│   └── enums.js        # 所有列舉值（USER_ROLES、VIDEO_PROCESSING_STATUSES 等），唯一事實來源
├── middleware/
│   ├── auth.middleware.js              # JWT 驗證，解碼後將 user 掛到 req.user
│   ├── role.middleware.js              # 角色授權（admin/teacher/student）
│   ├── upload.middleware.js            # multer 設定，處理影片檔案上傳
│   ├── lineSignature.middleware.js     # 驗證 LINE Webhook 請求簽章
│   ├── internalProcessingAuth.middleware.js  # 驗證內部 Processing Webhook 的 secret
│   ├── error.middleware.js             # 全域錯誤處理，將 AppError 轉為標準 JSON 回應
│   └── notFound.middleware.js          # 404 fallback handler
├── utils/
│   ├── apiResponse.js  # sendSuccess / sendError 統一回應格式
│   ├── appError.js     # 自訂錯誤類別，帶有 statusCode 與 errorCode
│   ├── asyncHandler.js # 包裝 async controller，自動 catch 並轉交 error middleware
│   └── objectId.js     # assertObjectId，驗證並轉換 MongoDB ObjectId
└── services/
    ├── queryEmbedding.service.js   # 可插拔 provider：mock / openai / gemini
    ├── answerGeneration.service.js # 可插拔 provider：template / openai
    ├── qa.service.js               # QA 核心邏輯：向量搜尋 + 詞彙搜尋混合策略
    ├── courseAccess.service.js     # 判斷使用者是否有權限存取課程
    ├── videoProcessing.service.js  # 影片 processing 狀態機管理
    └── demoSeed.service.js         # 啟動時植入示範資料
```

### 使用者角色與權限

三種角色定義於 `constants/enums.js`：

- `admin`：完整存取
- `teacher`：管理自己建立的課程與影片
- `student`：瀏覽已加入的課程、提問

### 影片處理狀態機

```
queued → processing → completed
                   ↘ failed → (retry) → processing
```

狀態定義於 `VIDEO_PROCESSING_STATUSES`。Processing 由外部 webhook 觸發（`POST /api/v1/internal/videos/:videoId/processing`），需要 `PROCESSING_WEBHOOK_SECRET` 驗證。

### QA 系統架構

QA 採用雙策略混合搜尋（`qa.service.js`）：
1. **向量搜尋**：cosine similarity 比對 `VideoSegment.embedding`
2. **詞彙搜尋**（fallback）：當 embedding 為空時，改用詞彙重疊率評分

搜尋模式由 `QA_VECTOR_SEARCH_MODE` 控制：
- `memory`：Node.js 記憶體內計算（本機開發）
- `atlas`：MongoDB Atlas Vector Search（生產環境）

---

## 三、前端架構（`frontend/focus-flow/`）

目前前端為**展示型登入頁面**，主要使用 Three.js 製作互動式 3D 場景。

```
frontend/focus-flow/src/
├── components/     # React 元件（含 Three.js 3D 登入場景）
├── App.jsx
└── main.jsx
```

**技術選型原因**：
- **Vite**：開發伺服器啟動速度快，原生支援 ES modules
- **Three.js**：製作 3D 液態漸層背景與氣泡動畫
- **GSAP**：補間動畫控制（搭配 Three.js 使用）

主要儀表板功能（課程列表、影片管理、問答介面）尚在規劃中。

---

## 四、AI Pipeline 架構（`STT_Whisper/`）

### 執行流程

```
影片檔案
   ↓  scan_videos.py       掃描 Test_video_file/ 取得影片清單
   ↓  extract_audio.py     FFmpeg 抽取音訊（.wav）
   ↓  transcribe.py        Faster-Whisper 語音辨識 → 含時間戳的逐字稿
   ↓  normalize_transcript.py  rapidfuzz 模糊比對修正專有名詞（term_dictionary.json）
   ↓  chunking.py          依字數/片段數/時長三重限制分段
   ↓  embedding.py         Sentence-Transformers / Gemini 建立向量
   ↓  export_outputs.py    輸出 JSON/JSONL 至 data/outputs/
   ↓  mongodb_uploader.py  （可選）直接寫入 MongoDB
```

### 設定管理

全部設定集中於 `config.py`（`PipelineConfig` dataclass），從 `.env` 讀取後型別轉換，CLI 參數透過 `with_overrides()` 覆寫，不修改原始 config 物件。

### 快取策略

- 音訊提取結果快取於 `data/processed_audio/`
- Whisper 逐字稿快取於 `data/cache/transcripts/`
- 使用 `--overwrite` 旗標可強制重新處理

---

## 五、資料庫模型

| 模型 | 集合 | 說明 |
|------|------|------|
| `User` | users | 帳號、角色、密碼雜湊 |
| `Course` | courses | 課程容器，含狀態（draft/published/archived） |
| `Video` | videos | 影片元資料、上傳路徑、processing 狀態 |
| `VideoSegment` | videosegments | 逐段文字稿 + 向量嵌入（QA 搜尋的核心） |
| `Enrollment` | enrollments | 學生修課紀錄，含 LINE userId 綁定 |
| `Clip` | clips | 預先產出的短影音，含命中次數快取 |
| `UsageLog` | usagelogs | 使用者行為記錄（登入、觀看、提問、短片瀏覽） |
| `LineBindToken` | linebindtokens | LINE 帳號綁定的一次性 token |

---

## 六、模組間交互邏輯

```
前端                後端                     MongoDB
 │                   │                          │
 │  POST /auth/login │                          │
 │──────────────────→│  auth.service            │
 │                   │  bcrypt 比對密碼         │
 │  ← JWT Token ─────│                          │
 │                   │                          │
 │  POST /qa/ask     │                          │
 │  (Bearer JWT)─────→│  qa.service             │
 │                   │  embedQuery()            │
 │                   │  searchSegments()────────→│ VideoSegment
 │                   │  ←──────── matches ──────│
 │                   │  generateAnswer()        │
 │                   │  recordUsage()───────────→│ UsageLog
 │  ← answer + clip─│                          │

LINE Bot             後端
 │                   │
 │  POST /line/webhook│
 │──────────────────→│  line.service
 │                   │  驗證 HMAC 簽章
 │                   │  解析 LINE userId
 │                   │  呼叫 qa.service.askQuestion()
 │  ← reply message─│
```

---

## 七、尚未實作的功能（Phase 2+）

- 前端主介面（課程列表、影片播放、問答 UI）
- 影片短片自動生成（FFmpeg 裁切）
- 個人化學習推薦
- MongoDB Atlas Vector Search 索引建立流程
