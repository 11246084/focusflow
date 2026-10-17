# FocusFlow Agent 入口

FocusFlow 是 AI 教學影片問答系統，教師上傳影片後，學生可透過網頁或 LINE 取得有來源與時間戳的回答。這份文件統一代理的工作邊界與文件規則，避免誤用歷史資料或重複維護狀態。開始工作前，請先確認使用者授權範圍，再依下表選讀相關文件。

## 工作邊界

- 修改前查看 `git status --short`，保留既有異動；不回退無關檔案。不因實作完成就自行 stage、commit 或 push。
- 優先沿用既有資料夾、命名與程式分工，避免非必要的重新命名、結構搬動或無關重構。
- 刪除檔案或清除資料前，須有使用者明確授權，並確認影響範圍。
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
| 動態進度／完成範圍 | [唯一狀態正本](docs/current-status.md)；資料流與功能開關另見[後端技術索引](backend/docs/current-state.md) |
| Backend API | `backend/src/routes/index.js`、相關 routes/services/models；`.claude/rules/api-design.md`；`backend/docs/openapi.yaml`、`backend/docs/phase2-api-contract.md` |
| Schema／Atlas／匯入 | `.claude/rules/database.md`、`database/README.md`、`database/docs/db-handoff-current.txt` |
| Auth／密碼／CORS／webhook | `.claude/rules/security.md` |
| 測試／harness | `.claude/rules/testing.md` 與受影響模組的測試 |
| Frontend | `frontend/focus-flow/README.md`、相關 `src/` 檔案 |
| STT／batch／resume／hierarchy | `STT_Whisper/README.md`、[現行整合入口](backend/docs/current-state.md#stt-現行整合入口)；[舊交接](backend/docs/handoff-stt-pipeline-integration.md)只供追溯歷史 |
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

## 文件維護

### 文件規則

- 進度與狀態只寫在 [docs/current-status.md](docs/current-status.md)，其他文件一律用連結。
- 「方案」類交接文件在功能完成的同一個 PR 內封存；PR 是提出程式變更、供團隊審查與合併的請求。
- README 只放安裝與使用方式。
- 新增 md 檔前，先登記在 [docs/README.md](docs/README.md)。
- 依變更影響更新對應文件；不影響使用方式、執行行為或介面契約時可不改文件，回報時說明理由。
- 僅在使用者明確要求分階段時，每階段完成後停下回報，等待確認再繼續；其他工作應持續完成已授權範圍與必要驗證，不自行增加確認點。

### 文件寫作規則

- 讀者是剛學會 Node.js 的大學生；使用繁體中文、台灣用語。
- 第一段用三句話以內說明：這是什麼、為什麼需要、讀者要做什麼。
- 專有名詞第一次出現時，用一句白話解釋；不要自創複合名詞。
- 流程類內容附一個實際例子（輸入 → 輸出）。
- 一份文件只講一個主題。入口文件（README、索引）控制在約一頁；技術文件超過約 200 行，或混了兩個以上主題時再拆。歷史原件與盤點快照不受此限。
- 連結一律使用 repo 相對路徑，也就是從目前文件的位置指向專案內的目標檔案。

例：短影片功能完成 → 在同一個 PR 封存舊方案、更新狀態正本 → 交接文件只連到正本，不另寫一份完成狀態。

## Repo-local skills

- 文件分工／進度整理：各 agent 的 `docs-maintainer`。
- 系統手冊章節／製圖整合：各 agent 的 `project-documentation`；UML 規範共用 `.claude/skills/ooad-uml-diagramming/`。
- GitHub 提交文案：各 agent 的 `github-copy`；要求文案不代表授權提交。
- Codex 入口在 `.agents/skills`，Claude 入口在 `.claude/skills`；只載入實際需要的 skill。
