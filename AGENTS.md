# FocusFlow Agent 入口

FocusFlow 是 AI 教學影片問答系統：教師上傳影片，學生在網頁或 LINE 提問，取得附來源與時間戳的回答。這份文件是所有 agent 的共用規則；開始前先確認使用者的授權範圍，再依「按任務選讀」找需要的文件。

## 工作邊界

- 修改前看 `git status --short`，保留既有異動、不回退無關檔案；實作完成不自行 stage、commit 或 push。
- 刪除檔案、清除資料、Shared Atlas 寫入或 index 變更、live webhook、YouTube 發布與部署，都需使用者明確授權且目標明確；不要為了驗證而啟動服務觸發 Atlas autoIndex。
- `.env`、`CLAUDE.local.md` 與 credentials 不作團隊規範，secret 不寫入回報。
- 已授權的 commit 用本人 Git 身分，不加 `Co-Authored-By`、`Claude-Session` 等 AI trailer；AI 使用揭露記在[系統手冊 README](docs/01_系統手冊/README.md)。
- 沿用既有資料夾、命名與程式分工，不做非必要的改名、搬移或重構。
- Backend 維持 `routes -> controllers -> services -> models`；改 response contract 要檢查前端、LINE、FAQ 快取命中路徑、OpenAPI 與 route tests。
- `database/tools/legacy/` 是舊 snake_case 工具，不可用來更新目前的 camelCase 集合。
- 在授權範圍內持續完成修改與必要驗證，不自行增加確認點；使用者要求分階段時，才在每階段停下回報。

## 按任務選讀

只讀本次需要的文件。判斷現況時依序採信：程式／schema／測試／runtime、Git 紀錄、維護中的文件，最後才是歷史紀錄。

| 任務 | 入口 |
|---|---|
| 產品範圍、架構與資料流 | `README.md`、`PROJECT.md`、`ARCHITECTURE.md` |
| 功能進度與完成範圍 | [docs/current-status.md](docs/current-status.md)（唯一狀態正本）、[後端技術索引](backend/docs/current-state.md) |
| Backend API | `backend/src/routes/index.js`、`.claude/rules/api-design.md`、`backend/docs/openapi.yaml`、`backend/docs/phase2-api-contract.md` |
| Schema／Atlas／匯入 | `.claude/rules/database.md`、`database/README.md`、`database/docs/db-handoff-current.txt` |
| Auth／密碼／CORS／webhook | `.claude/rules/security.md` |
| 測試 | `.claude/rules/testing.md` 與受影響模組的測試 |
| Frontend | `frontend/focus-flow/README.md` |
| STT／batch／hierarchy | `STT_Whisper/README.md`、`backend/docs/stt-integration.md` |
| 學生試用版後端 | `docs/04_Features/Student_Pilot_Backend/README.md`，依其任務權威順序 |
| 部署／憑證 | `.github/workflows/deploy.yml`、`docs/10_Operations/deployment/部署與連線排錯.md` |
| 系統手冊、文件整理 | skills：`project-documentation`、`docs-maintainer` |

## 驗證依變更影響選擇

| 變更 | 本地驗證 |
|---|---|
| 純文件／文字 | 檢查改動的連結、指令、日期與路徑，`git diff --check`；不跑整套程式測試 |
| 單一 Backend 行為 | 對應 `node:test` 測試；改 `backend/docs/openapi.yaml` 另跑 `npm.cmd run docs:lint` |
| Frontend 行為／元件 | 對應測試與 lint；涉及打包、依賴、入口或跨頁整合時跑 build，畫面變更檢查相關頁面 |
| Pipeline 行為 | 對應 unittest；外部模型與 FFmpeg smoke 標示是否執行 |
| 跨模組／共用 harness／發布準備 | 受影響子系統全套：Backend `npm.cmd test`；Frontend `npm.cmd test`、`lint`、`build`；STT 用既有 venv 跑 unittest discover |
| DB／auth／upload 高風險 | 另補隔離 Mongo 或 E2E；實際外部寫入仍遵守授權 |

保留既有 CI 與任務驗收門檻；檢查已通過時，只有新修改、失敗或未解風險才重跑。

## 回報與文件

- 分開列出本輪已執行、未執行的驗證及原因。單元測試通過不代表 Atlas、外部服務、正式部署或人工驗收完成；對外稱試用或上線須有驗收證據。
- Feature flag、collection／index、webhook URL、provider 與 VM 設定要當次查證，舊結果不代表現況。
- 進度與狀態只寫在 [docs/current-status.md](docs/current-status.md)，其他文件用連結；新增 md 前先登記在 [docs/README.md](docs/README.md)。
- 設計討論的已定案事項、目前這一輪的待答題目與建議答案，寫在該功能的 `docs/04_Features/<功能>/decisions.md`，不只留在對話裡；換 session 或換 agent（Claude Code、Codex）時，以文件為準接續。
- 改功能時依影響更新對應文件；不需要更新時，回報說明理由。撰寫文件依[文件寫作規則](.claude/skills/docs-maintainer/references/writing-style.md)。
