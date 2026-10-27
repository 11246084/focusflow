# recut：開發接手說明

這份文件讓接手的人或 AI（Codex、Claude Code）不必重讀對話就能開工或接續 recut。設計只看 [recut 設計決策](recut-design-decisions.md)（下稱「決策」）與[體驗設計決策](decisions.md)（UX-1～UX-19），功能狀態只看[目前狀態](../../current-status.md)；這裡只記錄工單、分支、人工確認點與下一步。功能完成時，在同一個 PR 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-10-27（建立工單，尚未開工）

## 必守規則

- **作者只有 Weihao**：用本機 Git 設定的身分；不加 `Co-Authored-By`、`Claude-Session`、`Generated with` 等任何 AI 署名。
- **小步 commit**：一個可獨立說明的修改一筆，每筆都要能通過相關測試。訊息用中文，沿用 repo 風格，例如 `feat(backend): 新增 recut 背景工作佇列與啟動恢復`。
- **不 push、不合併 `main`**：推到 `main` 會自動部署到 VM；push 與合併由使用者決定。
- **每張工單在自己的 git worktree 工作**，不要在主資料夾 `focusflow/` 切換分支；主資料夾有其他 session 同時在用。
- **不碰外部服務**：不連共用 Atlas、VM、YouTube、LINE、Gemini、Azure 或任何付費 API。資料庫用 `backend/tests/helpers/backendTestHarness.js` 的記憶體替身或本機 mongod；外部呼叫（Gemini、ffprobe、faster-whisper、HyperFrames、Azure）一律注入假的實作。真的呼叫只在 RC11 技術試跑，且要使用者當次授權。
- 第一次執行 Node.js 指令前先跑 `node -v`，須為 22.23.4 以上的 22 版（[決策第 8 項](recut-design-decisions.md)、[根 README 環境需求](../../../README.md#環境需求)）；不需要升 Node 24。
- **現有 8 拍腳本生成不動**（決策第 3 項）：它的程式與測試行為必須維持原樣。
- 不修改兩份決策文件的已定案內容；工單和決策矛盾時以決策為準，並在回報中說明。只有會讓結果實質不同的問題才停下來問。
- 實作時依決策第 70 項記錄演算法與取捨（名稱或明確步驟、解決什麼、輸入輸出、對應程式、替代方案、限制、測試證據），寫在 `backend/docs/` 或 `short_render/README.md` 中與程式對應的位置；新增 md 前先登記索引。

## 工單與分支

整合分支 `feat/recut` 從 `dev` 切出；每張工單從整合分支切出自己的 `wip/recut-rcN-*` 分支，審查通過後合併回整合分支。整合分支最後合併進 `dev`，由使用者 push。目標日期尚未排定（見「下一步」）。

| 工單 | 範圍 | 分支 | 前提 | 狀態 |
|---|---|---|---|---|
| [RC1 資料模型、狀態機與背景工作](work-orders/RC1-data-model-state.md) | 後端 | `wip/recut-rc1-data-model` | 無 | 未開工 |
| [RC2 連續視窗、原片檢查與視窗辨識](work-orders/RC2-window-asr.md) | 後端＋Python | `wip/recut-rc2-window` | RC1 合併 | 未開工 |
| [RC3 第一步選段](work-orders/RC3-step1-selection.md) | 後端 | `wip/recut-rc3-selection` | RC1 合併；系統設定 S1 的 `getSetting`（未合併時先用轉接函式，見工單） | 未開工 |
| [RC4 第二、三步：圖卡、字幕與整段檢查](work-orders/RC4-step2-3-cards-check.md) | 後端 | `wip/recut-rc4-cards` | RC3、RC5 合併 | 未開工 |
| [RC5 short_render 對齊決策](work-orders/RC5-short-render.md) | short_render | `wip/recut-rc5-render` | 無（可與 RC1 同時開工） | 未開工 |
| [RC6 程式碼圖卡](work-orders/RC6-code-card.md) | 後端＋short_render | `wip/recut-rc6-code-card` | RC4 合併；**開工前確認事項** | 未開工 |
| [RC7 worker 與渲染佇列](work-orders/RC7-worker-render.md) | 後端＋worker＋管理員頁 | `wip/recut-rc7-worker` | RC1、RC5 合併 | 未開工 |
| [RC8 審閱流程 API](work-orders/RC8-review-api.md) | 後端 | `wip/recut-rc8-review-api` | RC4 合併 | 未開工 |
| [RC9 教師審閱介面](work-orders/RC9-teacher-ui.md) | 前端 | `wip/recut-rc9-teacher-ui` | RC8 的 OpenAPI 定稿；第 57 項①啟發式評估完成 | 未開工 |
| [RC10 同意流程與撤回](work-orders/RC10-consent.md) | 後端＋前端 | `wip/recut-rc10-consent` | RC1 合併；與 YouTube 恢復與清理分支協調 | 未開工 |
| [RC11 技術試跑工具](work-orders/RC11-trial-tooling.md) | 後端腳本 | `wip/recut-rc11-trial` | RC1～RC9 合併；**執行**需使用者授權 | 未開工 |
| [RC12 合成語音版](work-orders/RC12-synthetic-voice.md) | 後端＋前端 | `wip/recut-rc12-tts` | 原音版通過技術試跑（決策第 80 項） | 未開工 |

可以同時進行的組合：RC1 與 RC5；RC1 合併後 RC2、RC3、RC10 可並行（RC3 先用 RC1 定好的句子格式與測試資料，不必等 RC2）；RC7 與 RC8 可並行。同時進行的工單若改到同一個檔案（例：`short-script.routes.js`、`backend/docs/openapi.yaml`），後合併的一方負責解衝突並重跑全套測試。

## 人工確認點

下列項目由人決定或看過才能往下走，Codex 只準備草稿與證據，不得自行視為通過。

| 確認點 | 來源 | 工單 | 誰確認、何時 |
|---|---|---|---|
| 三步 AI 指示、八種理由標籤定義、圖卡目錄的實際文字 | 待答 R1 | RC3、RC4 產出草稿 | 使用者或組員逐項看過，RC11 試跑前 |
| 「放不進去、合不起來、層層包含」三種新圖卡的參數與動畫 | 待答 R2、決策第 30 項 | RC5 產出原型截圖 | 使用者看過才加入給 AI 的圖卡目錄 |
| worker 回傳成品的 API 與驗證契約 | 待答 R3 | RC7 | 獨立審查時確認 |
| 教師同意條款文字 | 待答 R4、決策第 11、78、82 項 | RC10 產出草稿 | 使用者確認，RC11 試跑前 |
| 啟發式評估 | 決策第 57 項① | RC9 開工前 | 沒參與 recut 設計的組員，用 [評估素材](evidence/2026-10-21_recut-teacher-ux/heuristic-evaluation.md) |
| 試跑授權（讀 Atlas、呼叫 Gemini、費用） | 決策第 40 項 | RC11 執行時 | 使用者當次授權並確認目標 |
| 組員參考音的書面同意、Azure 條款原文 | 決策第 85、86 項 | RC12 | 使用者與組員，佈展前 |

## 每張工單完成時

1. 執行受影響子系統的測試：`backend/` 跑 `npm.cmd test` 全套，改到 OpenAPI 時另跑 `npm.cmd run docs:lint`；改到前端時在 `frontend/focus-flow/` 跑 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`；改到 short_render 時在 `short_render/` 跑 `npm.cmd test`；改到 Python 時用 `STT_Whisper/.venv` 跑 unittest。
2. 同步文件：後端工單更新 `backend/docs/todo.md`、`implementation-log.md`、`README.md`（使用者要求的後端收尾步驟）；新增或刪除 route 同步 `backend/docs/openapi.yaml`（否則 `tests/docs.routes.test.js` 失敗）與 `backend/docs/phase2-api-contract.md`；新增環境變數同步 `backend/.env.example`；[目前狀態](../../current-status.md)的「短影片自動產片」一行改寫成已完成哪些工單（仍標「開發中」，試跑前不稱完成）；最後一張工單依決策第 71 項同步系統手冊與圖。
3. 本文件「工單與分支」表的狀態欄更新。
4. 最後一則訊息回報：commit 清單、測試結果（已執行與未執行分開列）、和工單不同的地方與原因、留給後續工單的介面。
5. 由另一個 agent 依兩份決策文件逐條做獨立審查，通過後才合併回整合分支。

## 下一步

1. 使用者排定各工單目標日期（佈展前 11/24 功能全部完成，11/2～6 期中考）。
2. 使用者確認後，建立 `feat/recut` 與 RC1、RC5 的 worktree，交給 Codex 同時開工。
3. 系統設定 S1 合併進 `dev` 後，RC3 改用正式的 `getSetting`，移除轉接函式。
4. RC9 開工前完成第 57 項①的啟發式評估。
