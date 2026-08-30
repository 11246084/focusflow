# AGENTS.md — FocusFlow Agent 入口索引

本檔是 Codex 與其他 coding agent 進入 FocusFlow repo 的短版入口。它提供目前程式地圖、來源優先序、驗證要求與不可誤稱的邊界；完整動態進度仍放在 [docs/current-status.md](docs/current-status.md)，後端細節放在 [backend/docs/current-state.md](backend/docs/current-state.md)。

> 現況掃描基準：**2026-07-31**。本輪已重新核對目錄、主要入口、最近提交與測試，不只沿用舊文件。

---

## 一、專案定位與目前階段

**FocusFlow** 是 AI 教學影片問答系統。教師上傳影片後，系統執行 STT、分段與 embedding；學生可從網頁或 LINE Bot 提問，取得 AI 回答、來源片段與影片時間戳。

目前判讀：

- **Phase 1 MVP 主線可用**：角色登入／註冊、課程與影片、QA、LINE、Dashboard、通知與 private avatar 已有實作與測試。
- **Phase 2 基礎能力部分完成**：QA citations、visual citation、ShortAsset feed/sync、批次 pipeline 與 parent-chunk 產物已存在；完整短影音選片、剪輯、字幕、發布與推薦系統尚未完成。
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
| `.agents/skills/` | Codex repo-local skills | `docs-maintainer`、`github-copy` |
| `.claude/rules/`、`.claude/skills/` | Claude Code 規則與對應 skills | API / DB / testing / security 規則 |
| `.github/workflows/deploy.yml` | 部署 workflow | 改部署前須連同 backend/frontend runtime 一起核對 |

本機產物如 `node_modules/`、`dist/`、`.venv/`、`.playwright-*`、`uploads/`、`private-data/`、pipeline outputs 與暫存 log，不是程式架構來源。

---

## 三、目前程式地圖

### Backend

遵循：

```text
routes -> controllers -> services -> models
```

2026-07-31 掃描為 12 個 route files、9 個 controllers、26 個 services、13 個 models 與 27 個 backend test files。主要能力：

- `auth`：role-aware login、student/teacher register、JWT、RBAC、`/auth/me`
- `avatar`：authenticated JPEG/PNG/WebP 上傳與讀取、5 MiB、private storage、CAS replacement
- `notifications`：列表、cursor、未讀、單筆／全部已讀、admin 公告、影片完成 fanout
- `courses` / `videos`：CRUD、processing state machine、多課程 attach/detach、watched progress
- `qa`：FAQ cache、Gemini/OpenAI/mock providers、Atlas/memory retrieval、citations、answerStatus、quota guardrails
- `line`：webhook 驗簽、bind token、切換課程、多輪問答
- `stats` / `admin`：Student、Teacher、Admin dashboard 與管理 API
- `youtube` / `shorts`：YouTube URL、auto-upload adapter、修課限定 ShortAsset feed 與 metadata sync
- `internal-video`：pipeline processing start / complete / fail webhook

主要 API mount 以 [backend/src/routes/index.js](backend/src/routes/index.js) 與各 `*.routes.js` 為準；OpenAPI 是重要規格，但 internal processing 等少數端點仍可能以 route files 較新。

### Frontend

- `src/main.jsx` 依 URL 分流：`/admin` 使用 `AdminApp.jsx` 的獨立管理員登入入口，其餘使用 `App.jsx`。
- `App.jsx` 處理 landing、一般登入、student/teacher 註冊與 dashboard；admin 不開放自助註冊。
- `DashboardApp.jsx` 組合 Student / Teacher / Admin 頁面與共用 `Profile`、`Topbar`、`Sidebar`。
- `src/pages/` 目前有 13 個 JSX 頁面檔；Student 已含 Courses、Dashboard、LINE Bot、Shorts，Teacher 已含 Dashboard、Courses、Upload，Admin 已含 Overview、Users、Courses、Videos、Stats。
- `TeacherUpload.jsx` 支援 MP4/MOV/MKV 多檔選取、逐檔驗證、進度與重新整理恢復；目前透過 `services/videoUpload.js` **依序呼叫既有單支上傳 API**，不是 backend batch upload endpoint。
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

## 五、真相來源與閱讀順序

若文件互相衝突，採以下優先序：

1. **目前程式碼、route/model/schema、測試與 runtime 查證**
2. **最近 git history / diff**
3. [docs/current-status.md](docs/current-status.md) 與 [backend/docs/current-state.md](backend/docs/current-state.md)
4. API / DB / service 專屬文件
5. 舊會議紀錄、簡報、歷史 schema 文件

`docs/current-status.md` 與 `backend/docs/current-state.md` 最後更新到 2026-07-26，尚未完整記入 7/28～7/29 的 batch、hierarchy 與 citation-card 變動，因此處理這些功能時必須再讀實際程式碼與最近提交。

AI agent 接手前，至少讀：

| 文件 / 入口 | 適用任務 |
|-------------|----------|
| `AGENTS.md` | 全部 |
| `CLAUDE.md` | 現有工作規則與 runtime 邊界 |
| `README.md`、`PROJECT.md` | 快速上手與產品範圍 |
| `ARCHITECTURE.md` | 架構、資料流、DB / legacy 邊界 |
| `docs/current-status.md` | 跨服務動態進度與缺口 |
| `docs/2026-09_Student_Pilot_Backend/README.md` | 2026 年 9 月學生試用版後端規格、施工單與驗收證據入口；此任務依資料夾內的專用權威順序執行 |
| `backend/docs/current-state.md` | Backend runtime、readiness、測試與已知限制 |
| `backend/docs/phase2-api-contract.md` | QA / Video / Clip / YouTube 回傳語意 |
| `backend/docs/openapi.yaml` | 對外 API 規格；仍須與 routes 交叉確認 |
| `backend/docs/handoff-stt-pipeline-integration.md` | Backend / STT processing 交接 |
| `STT_Whisper/README.md` | 單支、batch、resume、hierarchy 與輸出契約 |
| `database/README.md`、`database/docs/db-handoff-current.txt` | DB 寫入、index、Atlas 邊界 |
| `frontend/focus-flow/README.md` | 前端啟動與頁面行為 |

注意：

- `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` 只供歷史參考。
- `CLAUDE.local.md`、`.env` 與本機產物不是團隊共用規範，也不可把其中 secret 寫入回報。
- 只看 roadmap、README 或舊會議紀錄，不足以判斷目前程式現況。

---

## 六、任務規則入口

執行對應任務前先讀：

| 任務類型 | 規則檔 |
|----------|--------|
| API route、controller、response、error code | [`.claude/rules/api-design.md`](.claude/rules/api-design.md) |
| Mongoose schema、index、data access、Atlas | [`.claude/rules/database.md`](.claude/rules/database.md) |
| 測試、test harness、驗收 | [`.claude/rules/testing.md`](.claude/rules/testing.md) |
| JWT、password、validation、CORS、LINE、webhook | [`.claude/rules/security.md`](.claude/rules/security.md) |

實作時：

- 先跑 `git status --short`，保留使用者既有變更，不回退無關檔案。
- Backend 維持 `routes -> controllers -> services -> models`；controller 不堆主要業務邏輯。
- 修改 response contract 時，同步檢查前端、LINE、FAQ cache hit path、OpenAPI 與 route tests。
- 修改 Mongoose schema/index 時，除 source review 外，還要區分 in-memory harness 與真實 MongoDB/Atlas 行為。
- 不把測試 harness 通過誤稱為 shared Atlas 或正式 release 驗證。
- 不自行執行 shared Atlas 寫入、資料清除、live webhook、YouTube upload 或部署；除非使用者已明確授權並確認目標。

---

## 七、最低驗證要求

| 修改區域 | 最低要求 |
|----------|----------|
| `backend/` | `npm test`；高風險 DB / auth / upload 另補對應隔離 Mongo 或 E2E |
| `frontend/focus-flow/` | `npm test`、`npm run lint`、`npm run build` |
| `STT_Whisper/` | `.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'`；外部模型 smoke 必須另行標示 |
| `database/` | 先做 read-only contract review；任何實際 DB 寫入需確認 URI、DB、collection、index 與授權 |
| 文件 | 檢查相對連結、指令、日期、路徑及 `git diff --check` |

完成回報要區分：

- 本輪實際執行並通過的驗證
- 只從舊文件或歷史提交取得的結果
- 因缺少 credentials、MongoDB、外部服務或授權而未執行的驗證

---

## 八、不能誤稱的目前邊界

- 多檔 Teacher Upload 目前是前端 sequential adapter；repo 尚無通用 backend batch upload API。
- Pipeline batch CLI 與 frontend 多檔 UI 是兩個不同層級，不可說成同一個 end-to-end batch API。
- `parent_chunks.jsonl` 尚未 embedding、上傳 MongoDB 或接入 QA retrieval。
- `video_segments_video` 目前只作 course-scoped visual citation，不能稱為 caption QA 或正式 clip publishing source。
- ShortAsset 已有 feed、archive 與 metadata sync，但自動選片、FFmpeg 剪輯、字幕、發布 worker、教師管理仍未完成。
- YouTube auto-upload adapter 已實作，但真實 OAuth upload smoke 與檔案清理策略仍是獨立驗收項目。
- LINE 曾 live smoke 成功，不代表目前 webhook URL、channel credentials 或正式部署永久有效。
- Shared Atlas 的 collection/index 狀態必須 live 查證；不得靠舊快照推定，也不得未核准啟服觸發 autoIndex。

---

## 九、Repo-local skills

| Agent | Skill | 路徑與用途 |
|-------|-------|------------|
| Codex | `docs-maintainer` | `.agents/skills/docs-maintainer/SKILL.md`；文件盤點、對齊、去重 |
| Codex | `github-copy` | `.agents/skills/github-copy/SKILL.md`；GitHub Desktop / VS Code commit Summary + Description |
| Claude Code | 同名 skills | `.claude/skills/<skill>/SKILL.md` |

`.agents/skills/` 與 `.claude/skills/` 是不同 agent 的入口，不要假設內容逐字相同；使用前讀取該 agent 對應的完整 `SKILL.md`。
