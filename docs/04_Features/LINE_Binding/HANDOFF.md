# LINE 帳號綁定：開發接手說明

這份文件給負責 LINE 功能的百陶，以及他使用的 AI（Claude Code 或 Codex），從現在一路規劃到 11/10 完成，不必讀過任何先前的對話。設計只看 [decisions.md](decisions.md)，功能狀態只看[目前狀態](../../current-status.md)；這裡只記錄階段、工單、完成判準與規則。功能完成時，在同一批 commit 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-10-29（等待 Weihao 回答 decisions.md 的 A 類 Q1～Q11，尚未開工）

## 要做什麼

把 LINE 綁定從「網頁產生 64 字元綁定碼 → 學生傳給 Bot」改成官方 LINE Login：學生在網頁按「連結 LINE」，手機上按同意、按加好友就綁定完成。另外順手完成三件也會改 LINE 的工作（見 [decisions.md](decisions.md)「同樣改 LINE 的相關工作」）。

例：學生在「LINE 提問」頁按「連結 LINE」→ LINE 畫面按「同意」、再按「加入好友」→ 回到網頁顯示「已綁定」→ LINE 聊天室收到歡迎訊息。

## 必守規則

- **先讀 repo 根目錄的 `AGENTS.md`**，所有規則都適用；第一次執行 Node.js 指令前先跑 `node -v`，對照[根 README 的環境需求](../../../README.md#環境需求)。
- **直接在 `dev` 上開發**：每次開工前先 `git pull`；一個可以獨立說明的修改一筆 commit，訊息用中文，例如 `feat(backend): 新增 LINE Login 起始與完成 API`。**push 前先跑該工單列出的測試**，全部通過才 push 到 `dev`。**不要推到 `main`**，推到 `main` 會自動部署到正式站。
- **作者只有自己**：用本機 Git 設定的身分，commit 與 PR 都不加 `Co-Authored-By`、`Generated with` 等 AI 署名。
- **只改工單列出的檔案**。需要改其他檔案、或發現有人（例如系統設定 S4）同時在改同一個檔案，先找 Weihao。
- **不碰正式環境**：本機只用測試用 LINE channel 與隔離的資料庫（測試用 `backend/tests/helpers/backendTestHarness.js` 的記憶體替身）。不連共用 Atlas、VM、正式 LINE channel 或正式 webhook；外部呼叫（LINE token、ID token 驗證、好友狀態、push）在測試中一律注入假的 `fetch`。
- **小細節用 grilling skill 確認**：repo 有 `.claude/skills/grilling` 與 `.agents/skills/grilling`。B 類細節請你的 AI 用這個方式逐題和你確認，定案後寫進 [decisions.md](decisions.md)。A 類題目不要自己定案。

## 遇到這些情況要先找 Weihao 討論

- 要新增或修改 collection、欄位、index，或做法和 decisions.md 的 Q5 不同。
- 任何和安全有關的改變：`state`／`nonce`／PKCE 的產生、保存與驗證，cookie 或 CSRF 的處理，帳號綁定衝突（Q4～Q6）。
- 想存 LINE 的 access token 或 refresh token。
- 要在**正式** LINE Developers Console 做任何設定（建立或發布 channel、改回呼網址、連結官方帳號、圖文選單），或要改 webhook URL、碰正式 webhook。
- 要改 VM、`.env`、正式 Atlas，或需要部署。
- 和系統設定 S4 或其他人改到同一個檔案，尤其是 [line.service.js](../../../backend/src/services/line.service.js)。
- 發現 decisions.md 的定案做不到、互相矛盾，或預估趕不上 11/10。

## 外部準備（階段 0 完成）

1. **第一步，開工前完成**：在 LINE Developers Console 打開正式 provider 的「Roles」，用 Weihao 的 LINE Developers 帳號 Email 邀請他，角色選 **Admin**（不是 Member）。Weihao 接受邀請、在 Roles 清單出現為 Admin，才算完成。目的是讓 Weihao 能審查設定與緊急處理。
2. 另開一個**測試用 provider**，裡面建立測試用官方帳號（Messaging API channel）與測試用 LINE Login channel，兩個 channel 必須在同一個 provider，才測得到加好友。測試 channel 維持 Developing，只有 Admin 或 Tester 角色能登入。
3. 測試 Login channel 登記本機回呼網址（例如 `http://localhost:5173/line/callback`）。LINE 官方文件沒寫明是否接受 `http://localhost`，實際試一次；不接受就找 Weihao 討論替代方式。
4. 測試用的 channel ID、secret、access token 只放在自己的 `backend/.env`，不寫進 repo、文件或 commit。

## 階段規劃

11/2～11/6 是期中考週，只排輕量工作。日期是預估，落後一天以上就通知 Weihao。

| 階段 | 預估日期 | 目標 | 完成判準 |
|---|---|---|---|
| 0 準備 | 10/29（四）～10/30（五） | Weihao 回答 Q1～Q11 並寫進 decisions.md；完成上面的外部準備 | Weihao 已是正式 provider 的 Admin；decisions.md「已定案」有 Q1～Q11；用測試帳號能登入測試 Login channel |
| 1 兩件小修改 | 10/31（六） | 工單 L1、L2 | 測試通過並 push 到 `dev` |
| 2 後端 LINE Login | 11/1（日）；11/2～11/6 只補測試、回覆審查 | 工單 L3 | 後端全套測試、`docs:lint` 通過 |
| 3 前端與 Bot 入口 | 11/7（六） | 工單 L4 | 前端 `test`、`lint`、`build` 通過 |
| 4 本機端到端與審查 | 11/8（日） | 用測試 channel 在手機與 PC 跑完整流程；另一個 AI 依 decisions.md 獨立審查 | 下方「端到端檢查」全部通過，審查意見已處理 |
| 5 收尾 | 11/9（一）～11/10（二） | 文件同步、整理部署清單交給 Weihao | 部署清單列出 Q9 每一關與退回方式 |
| 6 正式設定與部署 | 11/10～11/15（凍結前） | 依 Q9 逐關取得 Weihao 同意後執行 | 正式站完成一次真實綁定 |
| 7 移除綁定碼 | 11/28 之後 | 工單 L5（Q8 第二次部署） | 測試通過，交給 Weihao 部署 |
| S4 | LINE Login 與系統設定 S1 合併後 | 依 [S4 工單](../System_Settings/work-orders/S4-line.md) | 依 S4 工單 |

## 工單與給 AI 的指令

每張工單開始時，把「指令」整段貼給 AI。所有工單都要求 AI：先讀 `AGENTS.md` 與本文件的「必守規則」「遇到這些情況要先找 Weihao 討論」；只改列出的檔案；完成時回報 commit 清單、已執行與未執行的測試、和工單不同的地方與原因。

### L1：LINE 回覆移除開發用字樣、時間改成分:秒

- **檔案**：`backend/src/services/line.service.js`（`buildQuestionSummaryLines` 與 QA 錯誤訊息，約 616～703 行）、`backend/tests/line.routes.test.js`。
- **指令**：「移除 LINE 回覆中所有 `[MVP提示]`、`[MVP fallback]`、`[MVP hard-fail]` 字樣。fallback 的診斷訊息不再顯示給學生，錯誤訊息改成學生看得懂的中文，不提 `.env`、Atlas、`/health`。片段時間從 `75s - 120s` 改成 `1:15 - 2:00`（分:秒，秒數補兩位）。補上或更新測試。」
- **測試**：`node --test --experimental-test-isolation=none --test-concurrency=1 tests\line.routes.test.js`。

### L2：教師統計頁分開顯示網頁與 LINE 提問數

- **檔案**：`backend/src/services/teacherStats.service.js`、`backend/tests/teacherStats.service.test.js`、`backend/tests/stats.routes.test.js`、`frontend/focus-flow/src/pages/TeacherDashboard.jsx`，以及 `backend/docs/openapi.yaml` 中 `/stats/teacher` 的回應欄位。
- **指令**：「教師統計回傳的提問數，另外依 `questions.source` 分成網頁（`api`）與 LINE（`line`）兩個數字，總數維持原本的計算方式。前端教師首頁在總數旁顯示兩個來源的數字。不改資料結構。」
- **測試**：上面兩個後端測試、`npm run docs:lint`；前端 `npm test`、`npm run lint`。

### L3：後端 LINE Login

- **前提**：decisions.md 的 Q4～Q7、Q9 已定案。
- **檔案**：新增 LINE Login service 與 `lineLoginStates` model（依 Q5）、ensure index 腳本（比照 `db:ensure-auth-sessions`，**只寫不執行**）；修改 `line.routes.js`、`line.controller.js`、`line.service.js`（綁定衝突依 Q6、Bot 對未綁定學生回按鈕）、`backend/src/config/env.js`、`backend/.env.example`、`backend/docs/openapi.yaml`，以及對應測試。
- **指令**：「依 decisions.md Q4～Q7 實作 `POST /api/v1/line/login/start` 與 `POST /api/v1/line/login/complete`：PKCE S256、`state` 只存雜湊並以 `findOneAndDelete` 原子消耗、比對 `state` 綁定的使用者與 `sid` 等於目前 cookie 登入者、驗證 ID token 的 `aud` 與 `nonce`、以 `sub` 作為 `lineUserId`。依 B1 查好友狀態並 push 歡迎訊息，access token 不存資料庫。新增環境變數 LINE Login channel ID、secret、回呼網址，缺少時兩個 API 回 503。所有 LINE 呼叫注入假的 `fetch` 測試。」
- **至少要有的測試**：`state` 錯誤、過期、重複使用、屬於別的使用者或別的 `sid`；`nonce` 或 `aud` 不符；LINE token 交換失敗；Q6 的 (a) 改綁、(b) 拒絕與重複鍵錯誤；未加好友時不 push；缺環境變數回 503；寫入請求缺 CSRF 標頭被拒。
- **測試**：後端 `npm test` 全套、`npm run docs:lint`。

### L4：前端與 Bot 入口

- **前提**：L3 已 push。
- **檔案**：`frontend/focus-flow/src/pages/StudentLineBot.jsx`、`frontend/focus-flow/src/pages/StudentCourses.jsx`（「詢問助教」）、`frontend/focus-flow/src/main.jsx` 或新增回呼頁元件、`frontend/focus-flow/tests/` 中的對應測試。
- **指令**：「LINE 提問頁改成以『連結 LINE』按鈕為主，綁定碼收進『改用綁定碼』的小連結（Q8 第一次部署）。新增 `/line/callback` 頁：讀取 `code` 與 `state` 後呼叫 `/line/login/complete`，再清掉網址上的參數，並顯示成功、已綁定其他帳號、需回原瀏覽器、未加好友（附加好友按鈕）等結果。『詢問助教』在未綁定時走同一個流程，並帶上課程。」
- **測試**：前端 `npm test`、`npm run lint`、`npm run build`。

### L5：移除綁定碼（11/28 之後）

- **前提**：正式站 LINE Login 已穩定運作，Weihao 同意移除。
- **檔案**：`line.routes.js`、`line.controller.js`、`line.service.js`、`StudentLineBot.jsx`、`StudentCourses.jsx`、`openapi.yaml` 與對應測試。
- **指令**：「移除 `POST /line/bind-token`、Bot 的 64 字元綁定碼與 `BIND:…:COURSE:…` 判斷，以及網頁的『改用綁定碼』。`LineBindToken` model 與 `line_bind_tokens` collection 先保留，不刪資料。」
- **測試**：後端 `npm test`、`npm run docs:lint`；前端 `npm test`、`npm run lint`、`npm run build`。

## 端到端檢查（階段 4，用測試 channel）

1. 手機瀏覽器：未加好友的測試帳號 → 按「連結 LINE」→ 同意、加好友 → 網頁顯示已綁定，聊天室收到歡迎訊息，可以提問。
2. 手機上在 LINE 內建瀏覽器開 FocusFlow，重複第 1 步。
3. PC：用手機 LINE 掃 QR code 登入，完成綁定。
4. 已加好友的帳號：不出現加好友頁，綁定成功。
5. 學生在加好友頁按略過：網頁顯示已綁定、提示加好友。
6. 同一個 LINE 已綁定另一個 FocusFlow 帳號：被拒絕並顯示提示。
7. 「詢問助教」未綁定時：綁定後直接進入該課程。
8. 解除綁定後重新連結。

每一步截圖或記錄結果，寫進 `docs/04_Features/LINE_Binding/evidence/`（新增檔案前先在 [docs/README.md](../../README.md) 登記）。

## 完成時要同步的文件

`backend/docs/todo.md`、`backend/docs/implementation-log.md`、`backend/docs/README.md`（後端收尾步驟）、[API 契約](../../../backend/docs/phase2-api-contract.md)、`backend/.env.example`、[部署與連線排錯](../../10_Operations/deployment/部署與連線排錯.md)（LINE Login channel 設定與退回步驟）；狀態由 Weihao 更新到[目前狀態](../../current-status.md)。

## 下一步

1. Weihao 回答 [decisions.md](decisions.md) 的 Q1～Q11。
2. 百陶在正式 provider 的 Roles 以 Email 邀請 Weihao 為 Admin，Weihao 接受；再完成「外部準備」的其他項目。
3. 開始 L1、L2。
