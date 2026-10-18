# 舊 agent 入口的歷史快照

2026-10-10 自 AGENTS.md 移出；內文的「目前」及測試數字只指原註記日期，不是最新 runtime 或本輪驗證。不得用此快照啟用 feature flag 或宣稱已驗收。需要現況請查程式、runtime 與 current-status。

## 一、專案定位與目前階段

**FocusFlow** 是 AI 教學影片問答系統。教師上傳影片後，系統執行 STT、分段與 embedding；學生可從網頁或 LINE Bot 提問，取得 AI 回答、來源片段與影片時間戳。

目前判讀：

- **2026-09-21 起開放學生試用**（`https://focusflow.ntub.edu.tw`）：角色登入、課程與修課授權、影片處理、網頁多輪 QA、LINE、Dashboard、通知、頭貼、忘記密碼、問題回報已在正式 VM 上供試用。對外口徑是「開放試用」，不是「正式上線」。
- **Phase 2 部分實作**：QA citations、visual citation、ShortAsset feed/sync、多影片批次、Parent 階層式檢索（Gate 關閉）、短影片腳本自動生成與教師審核上架（`SHORT_SCRIPT_AUTOMATION_ENABLED` 預設關閉）已存在；影片產製已可運作：ComfyUI 控制地端模型 MiniMax H3，跑在指導教授的主機上（團隊電腦硬體不足）；FocusFlow 程式碼沒有呼叫 ComfyUI，教師把系統產出的腳本貼到 ComfyUI 產片後再上傳成品，系統串接規劃中；推薦系統未開始。
- 不可因單元測試通過就稱為 fully production-ready；共享 Atlas、Gemini、LINE、YouTube、STT live provider 與正式部署仍各有獨立驗收門檻。

---

## 二、目前專案結構

| 路徑 | 定位 | 技術 / 入口 |
|------|------|-------------|
| `backend/` | REST API 與主要業務邏輯 | Node.js、Express 4、Mongoose；`src/server.js`；預設 port `4000` |
| `frontend/focus-flow/` | Student / Teacher / Admin SPA | React 19、Vite；`src/main.jsx`；預設 port `5173` |
| `STT_Whisper/` | 單支與批次 AI Pipeline CLI | Python、Faster-Whisper、Gemini embedding、FFmpeg、yt-dlp |
| `database/` | DB 初始化、index、正式 uploader 與歷史修復工具 | `tools/setup/`、`tools/mongodb_uploader.py`；不是獨立 runtime service |
| `docs/` | 跨服務進度、決策、會議紀錄與交付文件 | `current-status.md` 是動態入口 |
| `.agents/skills` | Codex repo-local skills | `docs-maintainer`、`github-copy` |
| `.claude/rules`、`.claude/skills` | Claude Code 規則與對應 skills | API / DB / testing / security 規則 |
| `.github/workflows/deploy.yml` | 部署 workflow | 改部署前須連同 backend/frontend runtime 一起核對 |

本機產物如 `node_modules/`、`dist/`、`.venv/`、`.playwright-*`、`uploads/`、`private-data/`、pipeline outputs 與暫存 log，不是程式架構來源。

---

## 三、目前程式地圖

### Backend

遵循：

```text
routes -> controllers -> services -> models
```

2026-09-23 掃描為 15 個 route files、15 個 controllers、60 個 services、21 個 models 與 85 個 backend test files。主要能力：

- `auth`：role-aware login、只開放 student 自助註冊（teacher 由管理員建立）、登入失敗鎖定、忘記密碼（SMTP 驗證碼）、修改個人資料與密碼、JWT、RBAC
- `avatar`：authenticated JPEG/PNG/WebP 上傳與讀取、1 MiB、圖片存 MongoDB `avatars` collection
- `conversations`：網頁多輪 QA（對話、訊息、失敗重試），與 `/qa/ask` 共用每日提問上限與字數上限
- `feedback`：使用者問題回報（最多 3 張截圖）與管理員處理（`/admin/feedback`）
- `short-scripts` / `shorts`：短影片腳本自動選題與生成、教師上傳成品與審核上架（feature flag 預設關閉）
- `notifications`：列表、cursor、未讀、單筆／全部已讀、admin 公告、影片完成 fanout
- `courses` / `videos`：CRUD、processing state machine、多課程 attach/detach、watched progress
- `qa`：FAQ cache、Gemini/OpenAI/mock providers、Atlas/memory retrieval、citations、answerStatus、quota guardrails
- `line`：webhook 驗簽、bind token、切換課程、多輪問答
- `stats` / `admin`：Student、Teacher、Admin dashboard 與管理 API
- `youtube` / `shorts`：YouTube URL、auto-upload adapter、修課限定 ShortAsset feed 與 metadata sync
- `internal-video`：pipeline processing start / complete / fail webhook

主要 API mount 以 [backend/src/routes/index.js](../../backend/src/routes/index.js) 與各 `*.routes.js` 為準。`backend/docs/openapi.yaml` 涵蓋 `/api/v1/*` 與 `/health` 的每一個 route（`tests/docs.routes.test.js` 從 runtime router 比對，不一致即失敗）；internal processing webhook 與 `GET /api/v1/line/webhook` 刻意不收錄。

### Frontend

- `src/main.jsx` 依 URL 分流：`/admin` 使用 `AdminApp.jsx` 的獨立管理員登入入口，其餘使用 `App.jsx`。
- `App.jsx` 處理 landing、一般登入、student 註冊與 dashboard；teacher、admin 不開放自助註冊。頁面狀態會同步到網址（`src/utils/pageRouting.js`）。
- `DashboardApp.jsx` 組合 Student / Teacher / Admin 頁面與共用 `Profile`、`Topbar`、`Sidebar`。
- `src/pages/` 目前有 16 個 JSX 頁面檔：Student 含 Courses、Dashboard、LINE Bot、Shorts；Teacher 含 Dashboard、Courses、Upload、ShortScripts、VideoReview；Admin 含 Overview、Users、Courses、Videos、Stats、Feedback；另有共用 Profile。
- `TeacherUpload.jsx` 支援 MP4/MOV/MKV 多檔選取、逐檔驗證、進度與重新整理恢復；`services/videoUpload.js` 以單一 multipart request 呼叫 `POST /courses/:courseId/video-batches`。
- `StudentCourses.jsx` 已支援 QA 命中片段完整展開、整張 citation card 點擊，以及 Enter / Space 鍵盤跳轉影片時間點。

### AI Pipeline

- 單支主入口：`STT_Whisper/src/main.py`
- 批次入口：`STT_Whisper/src/batch_main.py`
- 批次狀態：`batch_manager.py` 保存 batch manifest / summary，限制 concurrency、隔離單支失敗並可 resume。
- Run checkpoint：`job_manager.py`、`resume_checkpoint.py`、`run_summary.py`
- Chunking：既有 leaf chunks 加上選用的 deterministic parent hierarchy；輸出 `parent_chunks.jsonl`。
- MongoDB 交接：pipeline 自有 `src/mongodb_uploader.py`；`database/tools/mongodb_uploader.py` 是 database 區域的統一匯入工具，使用前要先確認來源與目標契約。

常用新入口：

```powershell
cd STT_Whisper
python src/main.py --resume-run-id <run_id>
python src/batch_main.py --batch-input Test_video_file
python src/batch_main.py --batch-resume <batch_id>
```

Parent hierarchy 預設由 `HIERARCHY_ENABLED=false` 關閉。Pipeline 已能產生 stable Parent embedding artifact，`parent_mongodb_uploader.py` 具 blocking preflight 與 idempotent upsert；Backend 也已接 Parent → Child retrieval，但 production Gate 仍為 false。沒有 active Leaf／Parent generation、`chunkId_1`、Parent vector filter/index 與唯讀 live E2E 證據時，不可啟用或宣稱 production-ready。

### Database

- 日常匯入使用 `database/tools/mongodb_uploader.py`。
- `database/tools/legacy/` 只供歷史參考；其中舊版 text segment importer 會寫 snake_case，禁止拿來更新目前 camelCase `video_segments_text`。
- `database/tools/setup/` 涉及 collection/index 寫入；不可未經核准對 shared Atlas 執行。
- `videos` 仍是 app-owned 與 pipeline metadata 混合 collection；`video_segments_text` 以 camelCase 為主，`video_segments_video` 仍有 snake_case 邊界。

---

## 四、最近進度快照

### 2026-07-28 ～ 2026-07-29

- Frontend Teacher Upload 已加入多檔選取、驗證、進度追蹤與 refresh recovery；現階段為 sequential single-upload adapter。
- Pipeline 已加入 durable batch orchestration：concurrency `1`～`2`、單支失敗隔離、每支 retry 與 `--batch-resume`。
- Pipeline 已加入可 Resume 的 deterministic parent-chunk hierarchy：固定 leaf grouping、overlap、SHA-256 config fingerprint 與 artifact validation。
- Student QA citation card 已擴大為整張可跳轉，並補鍵盤與 focus/hover 可及性。
- 前一輪完成的 role-aware auth、獨立 admin 入口、站內通知與 private avatar 已保留在目前主線。

### 2026-07-31 本輪重新驗證

| 區域 | 實際結果 |
|------|----------|
| Backend | `npm test`：**262 passed / 0 failed**，31 suites |
| Frontend | `npm test`：**9 passed / 0 failed**；`npm run lint` 通過；`npm run build` 通過 |
| AI Pipeline | `.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'`：**99 passed** |

Frontend build 仍有單一 bundle 大於 500 kB 的 Vite warning；這不是 build failure，但屬後續效能優化項目。

---


## 八、不能誤稱的目前邊界

- 對外口徑是「2026-09-21 起開放學生試用」，不是「已正式上線」；試用驗收證據仍在進行，LINE webhook 仍走 ngrok（改正式網域待與教授討論）。
- 多影片批次 API（`/video-batches`）已存在，但 `VIDEO_BATCH_PIPELINE_ENABLED` 預設 false；真實多影片 STT/Gemini 與壓力測試尚未驗證，不能稱 production-ready。
- Parent 階層式檢索已有 stable embedding、uploader 與 backend adapter，但 `HIERARCHICAL_RETRIEVAL_ENABLED` 為 false，沒有 live E2E 證據前不可宣稱可用。
- `video_segments_video` 目前只作 course-scoped visual citation，不能稱為 caption QA 或正式 clip publishing source。綁定鍵為 `String(videos._id)`（2026-09-29），需以 pipeline CLI 人工產生；並行影像檢索 `QA_VISUAL_RETRIEVAL_ENABLED` 預設 false。
- 短影片：自動選題、腳本生成、教師上傳成品與審核上架已實作，但上架（YouTube 發布）尚未 live 驗證；影片本身由教師在系統外產製，ComfyUI／MiniMax H3 已可在教授主機以地端模型運作，但未與 FocusFlow 串接（系統串接規劃中）。
- YouTube auto-upload 與刪除轉 private 已於 2026-08-02 live 驗證；recovery／本地檔案清理 feature flags 仍預設關閉、未做 live 驗證。
- LINE 曾 live smoke 成功，不代表目前 webhook URL、channel credentials 或正式部署永久有效。
- Shared Atlas 的 collection/index 狀態必須 live 查證；不得靠舊快照推定，也不得未核准啟服觸發 autoIndex。

---
