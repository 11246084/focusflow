# AGENTS.md

## 專案名稱

本專案為 **focus flow**。

## 專案目標

第一階段目標是建立教學影片問答系統（MVP）。

使用者可以根據課程影片內容提問，系統需回傳：

- 文字回答
- 對應影片片段資訊
- 可用時提供時間戳

後續階段可能包含：

- 短影音生成
- 完整網頁化體驗
- 個人化學習流程

除非明確要求，否則不要提前開發後續階段功能。

## 目前範圍

目前 repo 已有三個主要區塊：

1. `backend/`
   - Node.js + Express REST API
   - MongoDB / Mongoose
   - JWT 登入、課程與影片管理、QA API、LINE webhook
   - 影片 processing 狀態流程與 demo seed
2. `frontend/focus-flow/`
   - React 19 + Vite 單頁前端
   - 目前偏展示型登入 / landing UI
   - 使用 Three.js 與 GSAP 做視覺效果
3. `STT_Whisper/`
   - Python 本地 AI pipeline
   - 負責影片掃描、抽音、STT、chunking、輸出資料檔
   - 目前是 CLI 型流程，不是直接掛在 backend 內執行

`docs/` 主要放系統圖、會議紀錄、資料庫初始化腳本與研究文件。

## 第一階段 MVP 優先項目

1. 使用者登入與權限控制
2. 課程與影片管理
3. 影片處理狀態流程
4. 問答 API
5. 基本測試與錯誤處理

## 技術堆疊

### Backend

- Node.js
- Express 4
- MongoDB
- Mongoose
- JWT
- Multer

### Frontend

- React 19
- Vite
- Three.js
- GSAP
- ESLint

### AI Pipeline

- Python 3
- faster-whisper
- FFmpeg / imageio-ffmpeg
- numpy
- tqdm
- rapidfuzz

## 目前專案結構

```text
focusflow/
  backend/
    src/
      app.js
      server.js
      config/
      constants/
      controllers/
      middleware/
      models/
      routes/
      scripts/
      services/
      utils/
    tests/
    uploads/
    .env.example
    package.json
  frontend/
    focus-flow/
      src/
      public/
      package.json
  STT_Whisper/
    src/
    data/
    requirements.txt
  docs/
  README.md
  PROJECT.md
  CLAUDE.md
```

## 常用指令

### Backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

其他常用指令：

```powershell
cd backend
npm start
npm run seed
npm test
node --test --experimental-test-isolation=none --test-concurrency=1 tests\<file>.test.js
```

說明：

- `npm run dev`: 使用 nodemon 啟動 backend
- `npm start`: 正常模式啟動 `src/server.js`
- `npm run seed`: 匯入 demo users / courses / videos / segments / clips
- `npm test`: 執行 backend 全部測試
- 單檔 `node --test ...`: 適合修單一路由或 service 時快速驗證

### Frontend

```powershell
cd frontend\focus-flow
npm install
npm run dev
```

其他常用指令：

```powershell
cd frontend\focus-flow
npm run build
npm run lint
npm run preview
```

### AI Pipeline

```powershell
cd STT_Whisper
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python src/main.py
```

其他常用指令：

```powershell
cd STT_Whisper
python src/main.py --limit 1
python src/main.py --overwrite
python src/video_multimodal_pipeline.py
python src/mongodb_uploader.py
```

## 後端結構偏好

backend 目前已經採用清楚的分層，修改時請優先沿用：

- `routes/`
- `controllers/`
- `services/`
- `middleware/`
- `models/`
- `config/`
- `utils/`

已存在的 API 入口包含：

- `/health`
- `/api/v1/auth`
- `/api/v1/courses`
- `/api/v1/qa`
- `/api/v1/line`
- `/api/v1/internal`
- `/api/v1/videos...`

除非真的必要，不要打亂現有 backend 結構。

## 開發原則

- 優先使用簡單、清楚、可維護的寫法
- 以可 demo 的 MVP 為優先，不過度設計
- 避免不必要的抽象化
- 不要引入大型框架，除非真的有需要
- 非必要不要破壞既有可運作程式
- 若 repo 已有既有結構，優先配合既有結構調整
- 不要無故重新命名或大幅搬動專案結構
- 不要重寫不相關模組
- 不要加入未被要求的推測性功能
- 不要刪除檔案，除非可以明確確認安全且必要

## API 與實作要求

新增或調整 API 時：

- request / response 格式要一致
- 需要基本輸入驗證
- 需要清楚的錯誤回應
- 設計以可展示、可測試為優先
- 優先沿用既有 `utils/apiResponse.js` 與錯誤處理 middleware 的風格

若修改影片 processing 流程，應注意目前 backend 已有明確狀態概念，避免自行發明另一套 naming 或 lifecycle。

## 工作方式

在進行較大的修改前：

1. 先分析目前 repo 狀態
2. 簡短說明預計採用的方法
3. 再開始實作

完成後請：

- 說明本次修改內容
- 列出新增或修改的檔案
- 說明假設與限制
- 必要時提出下一步建議

## 測試流程

### Backend

backend 目前有完整的 Node 原生測試，位於 `backend/tests/`。主要覆蓋：

- `auth.routes`
- `course-video.routes`
- `qa.routes`
- `qa.service`
- `line.routes`
- `api-response`
- `demo-seed.service`

測試方式：

```powershell
cd backend
npm test
```

需要快速驗證單一測試時：

```powershell
cd backend
node --test --experimental-test-isolation=none --test-concurrency=1 tests\qa.routes.test.js
```

注意事項：

- 目前測試透過 `tests/helpers/backendTestHarness.js` 以 in-memory store stub 掉 Mongoose model
- route 測試會啟動真實 Express app，但不依賴實際 MongoDB
- 測試期間可能會在 `backend/uploads/` 寫入帶有 `test-upload-` 前綴的測試檔案，helper 會清理這些檔案

### Frontend

frontend 目前 repo 內沒有正式的自動化測試框架。修改前端時，至少執行：

```powershell
cd frontend\focus-flow
npm run lint
npm run build
```

如果沒跑，請在回覆中明確說明原因。

### AI Pipeline

`STT_Whisper/` 目前沒有看到正式的自動化測試套件。修改 pipeline 時：

- 至少確認相關 CLI 指令能執行
- 若依賴 FFmpeg、外部模型或金鑰，請在回覆中說明是否實際驗證
- 若沒有執行驗證，不要假裝已測過

## 文件更新

有需要時請同步更新：

- `README.md`
- `backend/.env.example`
- 新增套件的安裝與設定說明

如果修改的是 frontend 或 AI pipeline，也要同步檢查對應子目錄 README 是否需要更新。
