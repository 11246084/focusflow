# recut：開發接手說明

這份文件讓接手的人或 AI（Codex、Claude Code）不必重讀對話就能開工或接續 recut。設計只看 [recut 設計決策](recut-design-decisions.md)（下稱「決策」）與[體驗設計決策](decisions.md)（UX-1～UX-19），功能狀態只看[目前狀態](../../current-status.md)；這裡只記錄工單、分支、時程、人工確認點與下一步。功能完成時，在同一個 PR 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-10-27（排定時程：11/5 先在本機產出短片並以網頁審閱；尚未開工）

## 必守規則

- **作者只有 Weihao**：用本機 Git 設定的身分；不加 `Co-Authored-By`、`Claude-Session`、`Generated with` 等任何 AI 署名。
- **小步 commit**：一個可獨立說明的修改一筆，每筆都要能通過相關測試。訊息用中文，沿用 repo 風格，例如 `feat(backend): 新增 recut 背景工作佇列與啟動恢復`。
- **不 push、不合併 `main`**：推到 `main` 會自動部署到 VM；push 與合併由使用者決定。
- **每張工單在自己的 git worktree 工作**，不要在主資料夾 `focusflow/` 切換分支；主資料夾有其他 session 同時在用。
- **不碰外部服務**：開發與測試不連共用 Atlas、VM、YouTube、LINE、Gemini 或任何付費 API。資料庫用 `backend/tests/helpers/backendTestHarness.js` 的記憶體替身，或 RC11a 提供的本機 MongoDB（Docker 中既有的 `mongo:7`，決策第 92 項）；外部呼叫（Gemini、ffprobe、faster-whisper、HyperFrames、語音引擎）一律注入假的實作。只有 RC11a、RC11b 的**實際執行**會唯讀複製 Atlas 資料與呼叫 Gemini，每次都要使用者當次授權。
- 第一次執行 Node.js 指令前先跑 `node -v`，須為 22.23.4 以上的 22 版（決策第 8 項、[根 README 環境需求](../../../README.md#環境需求)）；不需要升 Node 24。
- **現有 8 拍腳本生成不動**（決策第 3 項）：它的程式與測試行為必須維持原樣。
- **草稿由子 agent 審**（決策第 87、89 項）：指示文字、新圖卡原型、同意條款、啟發式評估，都在工單內另開子 agent 依決策逐條檢查，結果附在回報；不等人確認。團隊審的是最終短片。
- 不修改兩份決策文件的已定案內容；工單和決策矛盾時以決策為準，並在回報中說明。只有會讓結果實質不同的問題才停下來問。
- 實作時依決策第 70 項記錄演算法與取捨（名稱或明確步驟、解決什麼、輸入輸出、對應程式、替代方案、限制、測試證據），寫在 `backend/docs/` 或 `short_render/README.md` 中與程式對應的位置；新增 md 前先登記索引。

## 工單、分支與時程

整合分支 `feat/recut` 從 `dev` 切出；每張工單從整合分支切出自己的 `wip/recut-*` 分支。整合分支最後合併進 `dev`，由使用者 push。

**目標**：11/5（週四）以前，從一個主題一路做出真的短片，並在本機網頁上審閱。11/5 前的工單**先合併進 `feat/recut`，11/6 起統一做獨立審查**；11/6 之後的工單照常審查通過才合併。期中考週（11/2～6）由 Codex 繼續實作，使用者只看回報與合併。

| 工單 | 範圍 | 分支 | 前提 | 目標日 | 狀態 |
|---|---|---|---|---|---|
| [RC1 資料模型、狀態機與背景工作](work-orders/RC1-data-model-state.md) | 後端 | `wip/recut-rc1-data-model` | 無 | 10/29 | 未開工 |
| [RC5 short_render 對齊決策](work-orders/RC5-short-render.md) | short_render | `wip/recut-rc5-render` | 無 | 10/29 | 未開工 |
| [RC2 連續視窗、原片檢查與視窗辨識](work-orders/RC2-window-asr.md) | 後端＋Python | `wip/recut-rc2-window` | RC1 | 11/1 | 未開工 |
| [RC3 第一步選段](work-orders/RC3-step1-selection.md) | 後端 | `wip/recut-rc3-selection` | RC1；系統設定 S1 未合併時用轉接函式 | 11/1 | 未開工 |
| [RC8 審閱流程 API](work-orders/RC8-review-api.md) | 後端 | `wip/recut-rc8-review-api` | RC1（RC4 合併後接上重跑入口） | 11/1 | 未開工 |
| [RC4 第二、三步：圖卡、字幕與整段檢查](work-orders/RC4-step2-3-cards-check.md) | 後端 | `wip/recut-rc4-cards` | RC3、RC5 | 11/3 | 未開工 |
| [RC9 教師審閱介面](work-orders/RC9-teacher-ui.md) | 前端 | `wip/recut-rc9-teacher-ui` | RC8 的 OpenAPI | 11/3 | 未開工 |
| [RC6 程式碼圖卡](work-orders/RC6-code-card.md) | 後端＋short_render | `wip/recut-rc6-code-card` | RC4 | 11/4 | 未開工 |
| [RC11a 單題試產指令與本機資料庫](work-orders/RC11a-single-topic-run.md) | 後端腳本 | `wip/recut-rc11a-run` | RC1～RC5 | 11/4 | 未開工 |
| [RC7 worker 與渲染佇列](work-orders/RC7-worker-render.md) | 後端＋worker＋管理員頁 | `wip/recut-rc7-worker` | RC1、RC5 | 11/11 | 未開工 |
| [RC10 同意流程與撤回](work-orders/RC10-consent.md) | 後端＋前端 | `wip/recut-rc10-consent` | RC1；與 YouTube 恢復與清理分支協調 | 11/11 | 未開工 |
| [RC11b 正式技術試跑工具](work-orders/RC11-trial-tooling.md) | 後端腳本 | `wip/recut-rc11b-trial` | RC1～RC11a；**執行**需使用者授權 | 11/18 | 未開工 |
| [RC12 合成語音版](work-orders/RC12-synthetic-voice.md) | 後端＋前端 | `wip/recut-rc12-tts` | 原音版通過技術試跑（決策第 80 項） | 11/22 | 未開工 |

同時進行的工單若改到同一個檔案（例：`short-script.routes.js`、`backend/docs/openapi.yaml`），後合併的一方負責解衝突並重跑全套測試。11/5 前沒有 worker 佇列，渲染由 RC11a 直接呼叫 short_render 在本機執行。

## 需要人做的事

| 時間 | 事項 | 誰 |
|---|---|---|
| 10/28 起 | 把各工單的提示詞交給 Codex；每張完成時看回報、合併進 `feat/recut`、交下一張 | 使用者 |
| 11/4 | 授權 RC11a 從共用 Atlas 唯讀複製 2 門課資料到本機、呼叫 Gemini（RC11a 回報會列出筆數與預估呼叫次數）；挑 3～5 個主題 | 使用者 |
| 11/5 | 在本機網頁審閱短片，記下問題 | 團隊（扮演教師） |
| 11/6 起 | 觸發 11/5 前各工單的獨立審查（交給另一個 agent），依結果修正 | 使用者 |
| 11/17～18 | 授權 RC11b 正式試跑；填寫剪接自然度、修改量等人工指標 | 使用者與團隊 |
| RC12 開工時 | 同意 Codex 下載 sherpa-onnx 與 Kokoro 模型（約 310 MB）到 D 槽 | 使用者 |
| 全部審查通過後 | 決定何時把 `feat/recut` 合併進 `dev` 與 push | 使用者 |

已取消的人工步驟：草稿逐項確認（第 87 項）、組員做啟發式評估（第 89 項）、代理使用者測試（第 90 項）、組員錄參考音與 Azure 條款查證（第 88 項）。

## 每張工單完成時

1. 執行受影響子系統的測試：`backend/` 跑 `npm.cmd test` 全套，改到 OpenAPI 時另跑 `npm.cmd run docs:lint`；改到前端時在 `frontend/focus-flow/` 跑 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`；改到 short_render 時在 `short_render/` 跑 `npm.cmd test`；改到 Python 時用 `STT_Whisper/.venv` 跑 unittest。
2. 同步文件：後端工單更新 `backend/docs/todo.md`、`implementation-log.md`、`README.md`（使用者要求的後端收尾步驟）；新增或刪除 route 同步 `backend/docs/openapi.yaml`（否則 `tests/docs.routes.test.js` 失敗）與 `backend/docs/phase2-api-contract.md`；新增環境變數同步 `backend/.env.example`；[目前狀態](../../current-status.md)的「短影片自動產片」一行改寫成已完成哪些工單（仍標「開發中」，試跑前不稱完成）；最後一張工單依決策第 71 項同步系統手冊與圖。
3. 本文件「工單、分支與時程」表的狀態欄更新。
4. 最後一則訊息回報：commit 清單、測試結果（已執行與未執行分開列）、子 agent 的檢查結果、和工單不同的地方與原因、留給後續工單的介面。
5. 獨立審查：11/5 前的工單在 11/6 起統一審查；其他工單由另一個 agent 依兩份決策文件逐條審查，通過後才合併回整合分支。

## 下一步

1. 建立 `feat/recut` 與 RC1、RC5 的 worktree，交給 Codex 同時開工。
2. RC1 合併後，同時交出 RC2、RC3、RC8。
3. 系統設定 S1 合併進 `dev` 後，RC3 改用正式的 `getSetting`，移除轉接函式。
