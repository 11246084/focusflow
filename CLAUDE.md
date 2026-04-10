# CLAUDE.md

本檔案為 Claude Code (claude.ai/code) 在此專案中運作時提供的指引。

> **本文件規則同步自 [AGENTS.md](AGENTS.md)，修改規範時請優先參考該檔案。**

## 專屬規則

@.claude/rules/api-design.md
@.claude/rules/database.md
@.claude/rules/testing.md
@.claude/rules/security.md

## 專案概述

**FocusFlow** 是一個全端 AI 教學影片問答系統。第一階段 MVP：教師上傳影片 → 系統自動轉錄並分段 → 學生提問 → 系統回傳 AI 生成的答案與對應影片時間戳。

專案包含三個獨立服務：
- **Backend** — Node.js/Express REST API（埠號 4000）
- **Frontend** — React 19 + Vite 單頁應用（埠號 5173）
- **AI Pipeline** — Python CLI，負責影片掃描、抽音、STT、chunking 與輸出（`STT_Whisper/`）

## 常用指令

### Backend

首次設定：
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

其他常用指令：
```bash
npm start                                                                                          # 正式環境啟動
npm run seed                                                                                       # 手動匯入示範資料（users/courses/videos/segments/clips）
npm test                                                                                           # 執行全部測試
node --test --experimental-test-isolation=none --test-concurrency=1 tests/<file>.test.js          # 執行單一測試檔
```

### Frontend

首次設定：
```bash
cd frontend/focus-flow
npm install
npm run dev
```

其他常用指令：
```bash
npm run build      # 建置正式版本
npm run lint       # 執行 ESLint（修改前端前必跑）
npm run preview    # 預覽正式建置結果
```

### AI Pipeline（Python）

首次設定：
```bash
cd STT_Whisper
python -m venv .venv
source .venv/Scripts/activate    # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python src/main.py
```

其他常用指令：
```bash
python src/main.py --limit 1                  # 只處理一支影片（快速驗證）
python src/main.py --overwrite                # 強制重新處理
python src/video_multimodal_pipeline.py       # 執行視訊多模態 pipeline
python src/mongodb_uploader.py                # 直接上傳至 MongoDB
```

## 後端架構

嚴格遵循 `routes → controllers → services → models` 分層架構。所有業務邏輯集中於 services；controllers 僅負責處理 HTTP 請求與回應。

```
backend/src/
├── server.js          # 入口：連接資料庫、植入示範資料、啟動 Express
├── app.js             # Express 設定、middleware 掛載、路由註冊
├── routes/            # API 路由（auth、course、video、qa、line、health、internal-video）
├── controllers/       # HTTP 處理器 — 呼叫 service、回傳回應
├── services/          # 業務邏輯（auth、course、qa、video、embedding、lineBot、demoSeed）
├── models/            # Mongoose Schema：User、Course、Video、VideoSegment、Enrollment、Clip、UsageLog、LineBindToken
├── middleware/        # JWT 驗證、錯誤處理、multer 上傳、LINE 簽章驗證
├── config/            # env.js（型別化環境變數）、database.js
├── constants/         # 列舉值：使用者角色、影片處理狀態
├── utils/             # API 回應格式化、錯誤輔助函式、ObjectId 轉換
└── scripts/           # seedDemoUsers.js
```

已存在的 API 入口：`/health`、`/api/v1/auth`、`/api/v1/courses`、`/api/v1/qa`、`/api/v1/line`、`/api/v1/internal`、`/api/v1/videos...`

### QA 系統 Provider（可透過環境變數切換）

QA 系統使用可插拔的 provider，透過 `.env` 設定：
- `QA_QUERY_EMBEDDING_PROVIDER`: `mock` | `openai` | `gemini`
- `QA_ANSWER_PROVIDER`: `template` | `openai`
- `QA_VECTOR_SEARCH_MODE`: `memory` | `atlas`（MongoDB Atlas 向量搜尋）

開發環境預設使用 `mock` 嵌入 + `template` 答案，無需任何 API 金鑰。

### 影片處理狀態機

影片依照 `constants/` 中定義的狀態流程推進。處理透過 `POST /api/v1/videos/:videoId/processing/retry` 觸發（內部 webhook，需要 `PROCESSING_WEBHOOK_SECRET`）。修改 processing 流程時，不要自行發明另一套 naming 或 lifecycle。

### 示範資料植入（Demo Seed）

當 `DEMO_SEED_ENABLED=true` 時，伺服器啟動時會自動植入示範使用者、課程、影片、QA 片段與 Clip。

## 後端環境設定

將 `backend/.env.example` 複製為 `backend/.env`。本機開發時使用 mock provider，無需任何 API 金鑰。MongoDB 可使用本機（`mongodb://127.0.0.1:27017/focusflow`）或 Atlas。

## 測試規範

### Backend

測試位於 `backend/tests/`，涵蓋 `auth.routes`、`course-video.routes`、`qa.routes`、`qa.service`、`line.routes`、`api-response`、`demo-seed.service`。

注意事項：
- 測試透過 `tests/helpers/backendTestHarness.js` 以 in-memory store stub 掉 Mongoose model
- route 測試會啟動真實 Express app，但不依賴實際 MongoDB
- 測試期間可能在 `backend/uploads/` 寫入帶有 `test-upload-` 前綴的測試檔案，helper 會自動清理

### Frontend

目前沒有正式的自動化測試框架。修改前端時至少執行：
```bash
npm run lint
npm run build
```
若沒有執行，回覆中需明確說明原因。

### AI Pipeline

目前沒有正式的自動化測試套件。修改 pipeline 時至少確認相關 CLI 指令可執行，若依賴 FFmpeg、外部模型或金鑰，請說明是否實際驗證。

## 開發原則

- 僅專注於第一階段 MVP，不提前開發後續階段功能
- 優先使用簡單、清楚、可維護的寫法，避免不必要的抽象化
- 非必要不重新命名或大幅搬動專案結構；不重寫不相關的模組
- 不加入未被要求的推測性功能；不刪除檔案，除非可明確確認安全且必要
- 遵循現有的資料夾與命名慣例，優先配合既有結構調整
- 新增或調整 API 時：request/response 格式一致、基本輸入驗證、清楚的錯誤回應，優先沿用 `utils/apiResponse.js` 與錯誤處理 middleware 的風格

## 工作方式

進行較大的修改前：
1. 先分析目前 repo 狀態
2. 簡短說明預計採用的方法
3. 再開始實作

完成後說明：修改內容、新增或修改的檔案、假設與限制，必要時提出下一步建議。

## 文件更新

有需要時同步更新：`README.md`、`backend/.env.example`、新增套件的安裝與設定說明。修改 frontend 或 AI pipeline 時，也需檢查對應子目錄的 README 是否需要更新。
