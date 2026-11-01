# LINE 學習入口與帳號綁定：開發接手說明

> 組員請先用瀏覽器打開 [docs/07_HTML說明頁/LINE綁定.html](../../07_HTML說明頁/LINE綁定.html)；這份 Markdown 是寫給 AI 讀的。

這份文件給組員百陶的 AI（Codex 或 Claude Code），讓它不必讀過先前的對話，就能從現在一路做到 11/10 在 `dev` 完成。設計依據只看 [decisions.md](decisions.md)，功能狀態只看[目前狀態](../../current-status.md)；這裡只寫結果目標、優先順序、規則、求援方式、攻擊情境清單與正式環境關卡。功能完成時，在同一批 commit 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-11-02（優先項目①②的程式完成，尚未用真的 LINE 實測，也尚未 commit；進度見 [evidence/進度.md](evidence/進度.md)）

## 第一步：邀請 Weihao 為 Admin

開工前，百陶在 LINE Developers Console 打開**正式** provider 的「Roles」，用 Weihao 的 LINE Developers 帳號 Email 邀請他，角色選 **Admin**（不是 Member）。Weihao 接受、在 Roles 清單出現為 Admin 才算完成。目的是讓 Weihao 能審查設定與緊急處理。

## 開場時 AI 要做的事

1. 讀完本文件，以及 decisions.md 的「結果目標 L1」「Weihao 保留的邊界」與「已定案與前提」。「參考方案」（原 Q1～Q11、B1、B2）需要時再查。
2. 用學生的例子（要複製 64 字元綁定碼、做到一半放棄）向百陶說明要解決什麼問題，請他用自己的話說出「要改什麼、怎樣算成功」，釐清誤解。
3. 先問他的想法，再拿參考方案比較，說明取捨；也請他評估測試環境要用本機測試 provider，還是正式 provider（decisions.md LB）。他選定、說「開始」之後，在同一個對話一路做到完成。
4. 主動提醒他評估圖文選單能不能並行做（decisions.md LC），並和他討論選單卡與回答卡要放哪些項目（decisions.md LF 是參考，可以調整）。
5. 如果 `evidence/進度.md` 已存在，先讀它接續。

## 結果目標

完整原文在 decisions.md L1。一句話：**學生按一次「連結 LINE」就能安全地綁定、自然地在 LINE 提問；任何人的 LINE 都不會被綁到別人的帳號；教師看得到網頁與 LINE 各有多少提問。** 最晚 **11/10** 在 `dev` 完成。

## 優先順序

依序做；④很小，可以穿插先做，但時間不夠時①一定先完成（decisions.md LP）。

| # | 結果 | 完成判準 |
|---|---|---|
| 1 | 安全的 LINE Login 綁定 | 下方攻擊情境清單每一條都有通過的測試；後端全套測試與 `docs:lint` 通過 |
| 2 | 網頁上的綁定狀態：是否已連結、是否已加好友、解除綁定、錯誤與衝突提示 | 前端測試、lint、build 通過；測試 channel 端到端紀錄涵蓋手機與 PC |
| 3 | 選單與回答卡片化（decisions.md LF，暫定方向，細節由你和 AI 決定）：Flex 選單卡（輸入「選單」叫出，含切換課程輪播）、Flex 回答卡（引用附「▶ 看這段」）；移除 `[MVP…]` 等開發字樣、時間改成 `1:15 - 2:00` | 手機與電腦版 LINE 都實測過；卡片失敗時退回純文字；對應測試通過；錯誤訊息不提 `.env`、Atlas、`/health` |
| 4 | 教師統計分開網頁（`questions.source = api`）與 LINE（`line`）提問數 | 總數算法不變；後端、前端測試通過；OpenAPI 同步 |
| 5 | 評估圖文選單（LC）：只做不依賴系統設定 S1～S3 的部分 | 決定做或不做並寫進 decisions.md；做的話只寫建立腳本，不執行 |

## 攻擊情境清單（外部裁判）

由 Weihao 這邊在開工前寫定（decisions.md LA）。百陶的 AI 每一條都要寫成自動測試，測試名稱標上編號；全部通過才算完成①。所有 LINE 呼叫在測試中注入假的實作。

| # | 情境 | 必須的結果 |
|---|---|---|
| A1 | 攻擊者用自己的 FocusFlow 帳號開始連結，把授權網址或回呼網址傳給受害者完成 | 不會把受害者的 LINE 綁到攻擊者帳號，也不會綁到受害者帳號 |
| A2 | 同一個 `state` 用第二次 | 失敗 |
| A3 | `state` 過期 | 失敗 |
| A4 | `state` 屬於另一位使用者或另一個登入 session | 失敗 |
| A5 | 缺少或偽造 `state` | 失敗 |
| A6 | 回呼時沒有登入（流程跳到另一個瀏覽器） | 失敗並提示回原瀏覽器重新連結，不建立綁定 |
| A7 | ID token 的 `aud`、`iss`、到期時間、`nonce` 任一不符，或簽章無效 | 失敗 |
| A8 | 授權碼重複使用，或向 LINE 換 token 失敗 | 失敗且不建立綁定，回傳可理解的錯誤 |
| A9 | 這個 LINE 已綁定另一個 FocusFlow 帳號 | 拒絕並提示先從那個帳號解除；另一個帳號的綁定不變 |
| A10 | 自己的帳號已綁定別的 LINE，沒有確認就改綁 | 不改變；明確確認後才改綁 |
| A11 | 解除綁定時在請求中帶別人的 userId | 只解除呼叫者自己的綁定 |
| A12 | 兩個請求同時用同一個 `state` 完成 | 只有一個成功 |
| A13 | 同一個 LINE 同時綁到兩個帳號 | 只有一個成功，另一個依 A9 拒絕 |
| A14 | cookie 驗證的寫入請求缺 `X-Requested-With: FocusFlow` 或 `Origin` 不在 `CSRF_TRUSTED_ORIGINS` | 拒絕 |
| A15 | 用戶端送來 LINE 顯示名稱、Email 或自填的 LINE ID | 不作為身分依據，沒有任何 API 接受用戶端傳入的 `lineUserId` |
| A16 | 完成綁定後檢查資料庫 | 沒有存 LINE access token、refresh token |
| A17 | 部署前已綁定的學生從 LINE 提問 | 仍對應到原本的帳號與課程 |
| A18 | 綁定完成後導回的網址或課程參數被竄改 | 只導回同來源、已驗證的頁面；課程須是學生已修的課 |
| A19 | 錯誤回應與 log | 不含 token、secret、授權碼 |

## 在 dev 上工作的規則

- 先讀 repo 根目錄的 `AGENTS.md`；第一次執行 Node.js 指令前先跑 `node -v`，對照[根 README 環境需求](../../../README.md#環境需求)。
- 直接在 `dev` 開發：開工前 `git pull`；一個可以獨立說明的修改一筆 commit，訊息用中文，例如 `feat(backend): 新增 LINE Login 起始與完成 API`；push 前跑該修改相關的測試，全部通過才 push 到 `dev`。**不要推 `main`**，推 `main` 會自動部署。
- 用本機 Git 設定的身分，commit 不加 `Co-Authored-By`、`Generated with` 等 AI 署名。
- 只改這次結果需要的檔案，範圍大致是：`backend/src/` 的 LINE routes、controller、service、新的 LINE Login service 與 model、`env.js`、`teacherStats.service.js`、`backend/.env.example`、`backend/docs/openapi.yaml`；`frontend/focus-flow/src/` 的 `StudentLineBot.jsx`、`StudentCourses.jsx`（只限「詢問助教」入口；為了跳到影片某一秒去改播放器屬跨功能，先求援）、`TeacherDashboard.jsx`、回呼頁與 `main.jsx`；對應測試與文件。**改 `qa.service.js` 或多模態、章節相關檔案前先求援**，那些屬於庭語與系統設定。
- 測試與資料庫只用隔離環境（`backend/tests/helpers/backendTestHarness.js` 的記憶體替身）；本機開發不連共用 Atlas 寫入。
- 測試指令見根目錄 `CLAUDE.md`「常用指令」；新增或刪除 route 要同步 OpenAPI 並跑 `npm run docs:lint`。

## 進度檔

每次 commit 後更新 `docs/04_Features/LINE_Binding/evidence/進度.md`（新增前先在 [docs/README.md](../../README.md) 登記），內容固定三段：做完什麼（附 commit）、下一步、卡在哪裡。額度用完或換工具時，新的對話讀這份檔接續。

依 G6，AI 每次更新進度檔時，用剩下的優先項目估算能不能在 11/10 前完成；**預估趕不上時，最晚 11/6 提醒百陶向 Weihao 求援**，不自行刪減範圍。

## 什麼時候停下來找 Weihao

只在三種情況停下（G3b）；停下的那一部分暫停，其他部分照做，請百陶傳一段話給 Weihao：

1. 任何正式環境操作：正式 LINE Developers Console（建立 channel、連結官方帳號、回呼網址、改 Published、圖文選單）、webhook URL、VM、正式 Atlas、部署。依 AGENTS.md 每次都要先取得同意，見下方關卡。
2. 方案必須越過 G1 邊界：改目標或範圍、改攻擊情境清單的必須結果、想存 LINE token、改其他功能的契約（問答回應、FAQ 快取、系統設定 S4 的介面）。
3. 做不到成功標準，或發現 L1 的要求互相矛盾。

## 正式環境關卡

每一關執行前，百陶把「要做什麼、設定值、怎麼退回」傳給 Weihao，Weihao 明確同意後才做；做完記在進度檔。

| # | 關卡 | 誰做 | 時間 | 退回方式 |
|---|---|---|---|---|
| P0 | 正式 provider 的 Roles 邀請 Weihao 為 Admin | 百陶邀請、Weihao 接受 | 開工前 | 移除角色 |
| P1 | 在正式 provider（與現有 Messaging API channel 同一個）建立 LINE Login channel：App type 選 Web app、連結現有官方帳號、登記回呼網址、不申請 Email 權限 | 百陶 | 11/10 後 | channel 維持 Developing、不連結即可停用 |
| P2 | VM 的 `.env` 加入 Login channel ID、secret 與回呼網址；需要新的集合或索引時，執行百陶寫好的 ensure 腳本 | Weihao | 11/14 部署前 | 移除變數，新 API 依缺設定回 503 |
| P3 | Login channel 改成 Published | 百陶 | 部署當天、P2 完成後 | **無法退回**；只能停用新流程並保留綁定碼 |
| P4 | 部署 `main`（第一次：進 LINE 提問頁直接前往 LINE 授權，LINE Login 回 503 時自動改走綁定碼當備援，見 decisions.md LL7） | Weihao | 11/14，11/15 緩衝 | 回退部署 |
| P5 | 正式站由團隊成員實際綁定一次，確認歡迎訊息、提問與教師統計 | 百陶與 Weihao | 部署後 | 依 P4 回退 |
| P6 | 第二次部署：移除綁定碼的網頁、`POST /line/bind-token`、Bot 的綁定碼判斷；`line_bind_tokens` 不手動刪除，讓 TTL 清空 | 百陶實作、Weihao 部署 | 11/28 之後 | 回退部署 |

正式回呼網址的網域以部署時 Weihao 確認為準（原提案 `https://focusflow.ntub.edu.tw/line/callback`）。百陶若依 LB 選擇在正式 provider 測試，測試期間的每一次正式 Console 操作也比照 P1 先取得同意。

## 交付與同步

- 11/10：在 `dev` 完成，交付測試結果、攻擊情境測試對照、測試 channel 的手機與 PC 端到端紀錄（`evidence/`）、部署需要的設定清單。
- 完成時同步：[API 契約](../../../backend/docs/phase2-api-contract.md)、`backend/.env.example`、OpenAPI、[部署與連線排錯](../../10_Operations/deployment/部署與連線排錯.md)（LINE Login channel 設定與退回步驟）、[說明頁](../../07_HTML說明頁/LINE綁定.html)；狀態由 Weihao 更新到[目前狀態](../../current-status.md)。
- 定案、選用的方案或結果改變時，同一批 commit 先更新 decisions.md，再更新說明頁與頁尾的更新日期（`AGENTS.md`）。
