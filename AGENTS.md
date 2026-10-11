# FocusFlow Agent 入口

FocusFlow 是 AI 教學影片問答系統。教師上傳影片，pipeline 產生逐字稿與 embedding，學生透過網頁或 LINE 取得有來源與時間戳的回答。

## 工作邊界

- 修改前查看 `git status --short`，保留既有異動；不回退無關檔案。不因實作完成就自行 stage、commit 或 push。
- 依使用者要求完成範圍內的修改與必要驗證。已授權的本地、隔離檢查可繼續修正與重跑受影響項目，不逐步要求確認；檢查是否真的隔離，不能把所有測試一概視為無外部存取。
- Shared Atlas 寫入／index 變更、資料清除、live webhook、YouTube 發布與部署，需使用者已授權且目標明確。不要為了驗證而啟服觸發 Atlas autoIndex。
- `.env`、`CLAUDE.local.md` 與 credentials 不作團隊共用規範；不得把 secret 寫入回報。
- Backend 維持 `routes -> controllers -> services -> models`。response contract 變更需檢查前端、LINE、FAQ cache hit path、OpenAPI 與相關 route tests。
- `database/tools/legacy/` 是歷史工具，不可拿舊 snake_case importer 更新目前 camelCase collection；pipeline 與 database uploader 使用前確認來源及目標契約。
- 建立已授權的 commit 時用本人的 Git 身分，不加 `Co-Authored-By: Claude`、`Claude-Session` 等 AI trailer；AI 使用揭露依 [系統手冊 README](docs/00_Deliverables/System_Manual/README.md) 記錄。

## 按任務選讀

只讀本次決策需要的文件與程式，不要求每次通讀以下清單。現況來源依序為目前程式／schema／測試／runtime、相關 Git diff/history、維護中的狀態文件，最後才是歷史紀錄。各種證據只能支持其實際查證的層級。

| 任務 | 入口 |
|---|---|
| 初次上手／產品範圍 | `README.md`、`PROJECT.md` |
| 架構與跨服務資料流 | `ARCHITECTURE.md` |
| 動態進度／完成範圍 | `docs/current-status.md`、`backend/docs/current-state.md` |
| Backend API | `backend/src/routes/index.js`、相關 routes/services/models；`.claude/rules/api-design.md`；`backend/docs/openapi.yaml`、`backend/docs/phase2-api-contract.md` |
| Schema／Atlas／匯入 | `.claude/rules/database.md`、`database/README.md`、`database/docs/db-handoff-current.txt` |
| Auth／密碼／CORS／webhook | `.claude/rules/security.md` |
| 測試／harness | `.claude/rules/testing.md` 與受影響模組的測試 |
| Frontend | `frontend/focus-flow/README.md`、相關 `src/` 檔案 |
| STT／batch／resume／hierarchy | `STT_Whisper/README.md`；需要交接時讀 `backend/docs/handoff-stt-pipeline-integration.md` |
| 學生試用版後端工作 | `docs/30_Features/Student_Pilot_Backend/README.md`，依其任務權威順序 |
| 部署／憑證 | `.github/workflows/deploy.yml`、`CLAUDE.md` 對應段落、`docs/40_Operations/deployment/2026-09-10_Lets_Encrypt憑證申請紀錄.md` |

主要入口：Backend `backend/src/server.js`；Frontend `frontend/focus-flow/src/main.jsx`；Pipeline `STT_Whisper/src/main.py`／`src/batch_main.py`。本機 outputs、uploads、dist、venv、log 不是架構來源。

## 驗證依變更影響選擇

| 變更 | 本地驗證 |
|---|---|
| 純文件／文字（不論在哪個資料夾） | 檢查改動的連結、指令、日期與路徑，`git diff --check`；不因此跑整套程式測試 |
| 單一 Backend 行為 | 對應 `node:test` 測試；單檔命令見 `.claude/rules/testing.md`。改 `backend/docs/openapi.yaml` 另跑 `npm.cmd run docs:lint` |
| Frontend 行為／元件 | 對應測試、適用 lint；涉及打包、依賴、入口或跨頁整合時跑 build，畫面變更做相關頁面檢查 |
| Pipeline 行為 | 對應 unittest／artifact contract；外部模型與 FFmpeg smoke 另標示是否執行 |
| 跨模組／共用 harness／發布準備 | 受影響子系統全套；Backend `npm.cmd test`，Frontend `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`，STT 用既有 venv 執行 unittest discover |
| DB／auth／upload 高風險 | 除單元測試外補對應隔離 Mongo 或 E2E；實際外部寫入仍遵守授權 |

保留既有 CI 與任務專屬驗收門檻。若檢查已通過，只有新修改、失敗或未解風險才擴大或重跑。

## 完成回報與 runtime 邊界

- 分開列本輪已執行、歷史結果、未執行的驗證及原因。單元測試通過不代表 Atlas、外部 provider、正式部署或人工驗收完成。
- Feature flag、active generation、collection/index、webhook URL、provider 及 VM 設定需當次查證；舊 live smoke 不代表永久有效。
- 對外稱試用、正式上線或 production-ready，必須有對應驗收證據；code 已存在或單次產片不能證明已整合／發布。
- 舊程式地圖、測試數字與功能快照已移到 [歷史資料](docs/90_Archive/agent-context-2026-10-10.md)，僅在追查歷史時讀。

## Repo-local skills

- 文件分工／進度整理：各 agent 的 `docs-maintainer`。
- 系統手冊章節／製圖整合：各 agent 的 `project-documentation`；UML 規範共用 `.claude/skills/ooad-uml-diagramming/`。
- GitHub 提交文案：各 agent 的 `github-copy`；要求文案不代表授權提交。
- Codex 入口在 `.agents/skills`，Claude 入口在 `.claude/skills`；只載入實際需要的 skill。
