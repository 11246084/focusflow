# FocusFlow Agent 入口

## 工作邊界

- 修改前以 `git status --short` 確認既有異動。stage、commit、push 依使用者授權，提交沿用本人 Git 身分，commit 與 PR 省略 AI 署名。專案揭露依[系統手冊 README](docs/01_系統手冊/README.md)。
- 刪除檔案、清除資料、Shared Atlas 資料寫入、刪除或修改 index、live webhook、YouTube 發布與部署，均須明確授權及目標。避免驗證時啟動會觸發 Atlas autoIndex 的服務。
- Shared Atlas 可新增一般 index。建立前依 [mongodb-inspect](.claude/skills/mongodb-inspect/SKILL.md) 做 preflight，遇缺值或重複值停下回報。vector search index 的新增或修改仍需授權。
- 憑證與本機設定（含 `.env`、`CLAUDE.local.md`）不得作為團隊規範或揭露機密。`database/tools/legacy/` 只供舊 snake_case 工具使用，禁止用於更新現行 camelCase 集合。

## 按任務選讀

- 架構與產品範圍見 [ARCHITECTURE.md](ARCHITECTURE.md) 與 [PROJECT.md](PROJECT.md)。現況依序採信程式、schema、測試與 runtime，然後是 Git、維護中文件與歷史紀錄。
- Backend 維持 `routes → controllers → services → models`。API 契約變更須核對前端、LINE、FAQ 快取、OpenAPI 與路由測試。[API 規範](.claude/rules/api-design.md) · [技術索引](backend/docs/current-state.md) · [安全規範](.claude/rules/security.md)
- 資料與影音處理依[資料庫規範](.claude/rules/database.md)、[資料庫交接](database/docs/db-handoff-current.txt)、[STT 說明](STT_Whisper/README.md)及[處理狀態機](backend/docs/stt-integration.md)。[學生試用版](docs/04_Features/Student_Pilot_Backend/README.md)有獨立的文件優先順序。
- [前端](frontend/focus-flow/README.md)沿用既有元件，畫面文案以操作、導覽與狀態所需為限。部署依 [workflow](.github/workflows/deploy.yml) 與[排錯手冊](docs/10_Operations/deployment/部署與連線排錯.md)。
- 功能進度統一寫在 [current-status.md](docs/current-status.md)，新增 Markdown 前先登記於[文件索引](docs/README.md)。文件維護用 `docs-maintainer`，系統手冊用 `project-documentation`。依影響更新文件，無須變動時簡述原因。
- 設計討論用 `grilling`。定案、待答問題及建議答案記入該功能的 `decisions.md`。已有 `docs/07_HTML說明頁/` 的功能若變更決策或結果，同批先更新決策，再更新說明頁及頁尾日期。

## 驗證依變更影響選擇

每個 session 首次使用 Node.js 前執行 `node -v` 對照 [README 的環境需求](README.md#環境需求)。版本不足時提供升級指令並取得同意，再執行測試或 build。

| 變更 | 執行目錄與驗收 |
|---|---|
| 純文件 | 核對連結、路徑、日期與指令，執行 `git diff --check`。 |
| Backend、短片渲染器 | 在 `backend/` 或 `short_render/` 執行相關 `node:test`。更動 OpenAPI 時另於 `backend/` 執行 `npm.cmd run docs:lint`。 |
| 前端 | 在 `frontend/focus-flow/` 執行相關測試與 lint，畫面變更檢查該頁。涉及依賴、打包、入口或跨頁整合，再跑 build。 |
| STT | 在 `STT_Whisper/` 用 `.\.venv\Scripts\python.exe` 跑相關 unittest。交代外部模型與 FFmpeg 是否實測。 |
| 跨模組、共用測試工具、發布準備 | 跑受影響子系統全套。Node 子系統用 `npm.cmd test`，前端加 `npm.cmd run lint`、`npm.cmd run build`，STT 用 `-m unittest discover -s tests -p "test_*.py"`。 |
| DB、認證、上傳 | 另補隔離 Mongo 或 E2E；外部寫入仍須授權。 |

保留既有 CI 與任務驗收門檻。已通過的檢查只在有新修改、失敗或未解風險時重跑。正式站、feature flag、Atlas、webhook、provider 與 VM 狀態要有當次證據；回報已驗證結果及未驗證項目與原因。細節見[測試規範](.claude/rules/testing.md)。
