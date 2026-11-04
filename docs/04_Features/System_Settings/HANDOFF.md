# 系統設定：開發接手說明

這份文件讓接手的人或 AI（Codex、Claude Code）不必重讀對話就能開工或接續。設計只看 [decisions.md](decisions.md)，功能狀態只看[目前狀態](../../current-status.md)；這裡只記錄工單、分支與下一步。功能完成時，在同一個 PR 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-10-27（建立工單，尚未開工）

## 必守規則

- **作者只有 Weihao**：用本機 Git 設定的身分；不加 `Co-Authored-By`、`Claude-Session`、`Generated with` 等任何 AI 署名。
- **小步 commit**：一個可獨立說明的修改一筆，每筆都要能通過相關測試。訊息用中文，沿用 repo 風格，例如 `feat(backend): 新增系統設定定義表與 getSetting`。
- **不 push、不合併 `main`**：推到 `main` 會自動部署到 VM；push 與合併由使用者決定。
- **每張工單在自己的 git worktree 工作**，不要在主資料夾 `focusflow/` 切換分支；主資料夾有其他 session 同時在用。
- **資料庫只用隔離的本機 Mongo**（測試用 `tests/helpers/backendTestHarness.js` 的記憶體替身，或本機 mongod）。不連共用 Atlas、VM、LINE、YouTube 或任何付費模型 API（[決策第 44 項](decisions.md)）。外部呼叫一律注入假的 `fetchImpl`。
- 第一次執行 Node.js 指令前先跑 `node -v`，對照[根 README 的環境需求](../../../README.md#環境需求)。
- 不修改 `decisions.md` 的已定案內容；發現設計矛盾或做不到時停下，在回報中說明。

## 工單與分支

整合分支 `feat/system-settings` 從 `dev` 切出；每張工單從整合分支切出自己的 `wip/system-settings-*` 分支，審查通過後合併回整合分支。整合分支最後合併進 `dev`，由使用者 push。

| 工單 | 分支 | 前提 | 目標日期（[第 43 項](decisions.md)） | 狀態 |
|---|---|---|---|---|
| [S1 設定核心](work-orders/S1-settings-core.md) | `wip/system-settings-s1-core` | 無 | 10/31 完成並審查 | 未開工 |
| [S2 模型與 provider](work-orders/S2-models-providers.md) | `wip/system-settings-s2-models` | S1 合併；**開工前確認事項**由使用者確認 | 11/4 | 未開工 |
| [S3 學生額度](work-orders/S3-quota.md) | `wip/system-settings-s3-quota` | S1 合併 | 11/4 | 未開工 |
| [S4 LINE 按鈕與防重放](work-orders/S4-line.md) | `wip/system-settings-s4-line` | S1 合併；[LINE 綁定](../LINE_Binding/decisions.md)定案 | LINE 綁定 10/30 前定案才排 11/5，否則凍結後 | 未開工 |
| [S5 建立教師帳號](work-orders/S5-teacher-accounts.md) | `wip/system-settings-s5-teachers` | **開工前確認事項**由使用者確認 | 10/28 開始，11/4 | 未開工 |

S2 與 S3 都會改問答流程（`qa.service.js`）：S2 改「用哪個模型、怎麼呼叫」，S3 改「呼叫前後怎麼扣額度」。兩者平行時，S3 只在呼叫模型的前後加預扣與結算，不改選模型的邏輯；後合併的一方負責解衝突並重跑全套測試。

## 每張工單完成時

1. `backend/` 執行 `npm.cmd test` 全套；改到 OpenAPI 時另跑 `npm.cmd run docs:lint`；改到前端時在 `frontend/focus-flow/` 跑 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`。
2. 同步 `backend/docs/todo.md`、`implementation-log.md`、`README.md`（使用者要求的後端收尾步驟），以及[決策第 37 項](decisions.md)的文件。
3. 最後一則訊息回報：commit 清單、測試結果（已執行與未執行的分開列）、和工單不同的地方與原因、留給下一張工單的介面。
4. 由另一個 agent 依 `decisions.md` 逐條做獨立審查，通過後才合併回整合分支。

## 部署前（11/4～11/5）

依[第 44 項](decisions.md)：本機後端切到共用 Atlas 做最後測試，唯讀檢查直接做；會寫入的步驟當天列清單、逐項請使用者授權；不得在共用 Atlas 存入測試用的設定值。上線前還要完成第 39 項剩下的整站 CSP（使用者到 VM 的 nginx 設定）。

## 下一步

1. 使用者確認後，建立 `feat/system-settings` 與 S1、S5 的 worktree，交給 Codex 同時開工。
2. S2 開工前，請使用者確認 [S2 工單](work-orders/S2-models-providers.md)「開工前確認事項」的三點。
3. 使用者授權過的額度估算（第 19、44 項）可在 S3 期間另外跑，結果寫進 `evidence/`。
