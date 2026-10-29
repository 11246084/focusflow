# LINE 帳號綁定設計決策

這份文件記錄以官方 LINE Login 取代「學生把 64 字元綁定碼傳給 Bot」的設計討論，讓學生幾乎不必操作就完成綁定。2026-10-29 起，LINE 相關功能改由組員百陶實作：技術架構的大方向由 Weihao 定案，實作與小細節由百陶決定。目前**尚無任何定案**；Weihao 先回答 A 類 Q1～Q11，開發計畫見 [HANDOFF.md](HANDOFF.md)，功能完成與驗收只看[目前狀態](../../current-status.md)。

## 分工與定案方式

| 類別 | 誰決定 | 範圍 |
|---|---|---|
| A 類：需 Weihao 定案 | Weihao | 目的與範圍、時程；**凡是影響資料結構、安全（state／nonce、cookie、帳號綁定衝突）、正式 LINE 後台設定與 webhook 的事項** |
| B 類：交給百陶 | 百陶 | 畫面與文案、按鈕位置、程式寫法、測試寫法；不違反 A 類定案與下列限制即可 |

B 類做法在實作中可以調整；只要發現會碰到 A 類範圍，就先找 Weihao 討論（見 [HANDOFF.md](HANDOFF.md)「遇到這些情況要先找 Weihao 討論」）。定案後在「已定案」表格補一列，寫明理由與來源。

**LINE Login** 是讓 LINE 驗證學生的 LINE 帳號，再把結果交給 FocusFlow 的授權流程；**provider** 是 LINE Developers Console 裡管理 channel 的單位；**channel** 是一個 LINE 服務的設定，例如現有 Bot 用的 Messaging API channel。

目標流程例：學生已登入 FocusFlow 網頁 → 按「連結 LINE」→ 手機上 LINE 自動登入，按同意、按加好友 → 回到網頁顯示「已綁定」，LINE 聊天室出現歡迎訊息。全程不必複製或貼上任何東西。

## 已定案與前提

| # | 決策 | 理由 |
|---|---|---|
| — | 尚無定案 | — |

已成立、不必再討論的前提：

- **httpOnly cookie 已上線**：2026-10-25 正式站驗收通過（[目前狀態](../../current-status.md)、[cookie 決策](../HttpOnly_Cookie/decisions.md)）。登入憑證是 `__Host-ff_session`（`HttpOnly; Secure; SameSite=Strict`），前端用同來源 `/api/v1` 呼叫；以 cookie 驗證的寫入請求須 `Origin` 符合 `CSRF_TRUSTED_ORIGINS`，並帶 `X-Requested-With: FocusFlow`（cookie 決策第 6、7、13 項）。正式驗收已含「LINE 內建瀏覽器進站恢復登入」。
- **LINE webhook 規則**沿用[系統設定決策](../System_Settings/decisions.md)：以 `webhookEventId` 去重、先回 200 再非同步處理、一次性動作帶短效 nonce。
- **人員**：百陶是現有 LINE provider 的管理員，負責建立測試用 LINE Login channel；開工前在正式 provider 的 Roles 用 Email 邀請 Weihao 為 **Admin**（不是 Member），Weihao 接受後才算完成，供審查設定與緊急處理。
- Jev 問題分流另見 [Jev 決策](../Jev_Judgment/decisions.md)。

## 目前這一輪待答題目

### A 類：需 Weihao 定案

#### Q1：目的與成功標準

**問題**：是否以提高試用學生的 LINE 綁定率為主、展覽展示為輔，讓已登入的學生不必複製貼上就能完成綁定？

**建議答案**：是。手機上從按下按鈕到完成綁定最多兩次點擊（同意、加好友），不輸入任何文字；完成頁顯示結果，聊天室出現歡迎訊息。PC（要用 LINE 掃 QR code 登入）、未登入 FocusFlow、尚未加好友等情況另列驗收，不保證都只要兩次點擊。成效看後台的 `lineBindRate`。

**理由**：目前要產生綁定碼、切換 App、傳送綁定碼，每一步都可能讓學生放棄。手機已登入 LINE App 時，開啟授權網址會自動登入（[Integrate LINE Login](https://developers.line.biz/en/docs/line-login/integrate-line-login/)），兩次點擊做得到。

#### Q2：只做 LINE Login，不做 Account Link

**問題**：是否只做網頁按鈕走 LINE Login，並帶 `bot_prompt` 在同一流程加好友，不做從 Bot 發起的官方 [Account Link](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)？Bot 遇到未綁定的學生時，只回一顆按鈕開啟 FocusFlow 的「連結 LINE」頁。

**建議答案**：是。

**理由**：上一場建議兩者都做，但查證後發現，Account Link 流程中學生仍要在 LINE 內建瀏覽器登入 FocusFlow，步驟沒有比較少，還要多處理 link token、`accountLink` webhook 事件與 nonce。LINE Login 一樣由 LINE 驗證帳號擁有者。只有一條綁定路徑，程式與測試只要一套，比較能在 11/10 前完成。

#### Q3：Provider 與 channel

**問題**：是否把正式的 LINE Login channel 建在現有 Messaging API channel 所在的 provider 底下？另外，本機測試是否另開一個測試用 provider，裡面放測試用官方帳號與測試用 LINE Login channel？

**建議答案**：是，兩者都照建議。正式 channel 由百陶在你同意後建立；測試 provider 由百陶自行建立。

**理由**：userId 按 provider 發放，同一個 provider 底下兩種 channel 拿到的 userId 相同（[Getting user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)），已綁定學生的 `lineUserId` 不必重綁；`bot_prompt` 也要求兩個 channel 在同一個 provider（[Link a bot](https://developers.line.biz/en/docs/line-login/link-a-bot/)）；channel 建立後不能搬到別的 provider（[Provider 管理建議](https://developers.line.biz/en/docs/line-developers-console/best-practices-for-provider-and-channel-management/)）。測試 channel 如果放在正式 provider，`bot_prompt` 會讓測試者加入**正式**官方帳號、觸發正式 webhook，違反「本機測試不碰正式 webhook」。

#### Q4：授權回呼與「是同一位學生」的確認（安全、cookie）

**問題**：是否採用以下流程？

1. 學生按「連結 LINE」→ 前端呼叫 `POST /api/v1/line/login/start`（cookie 驗證，帶 CSRF 標頭）。後端產生 `state`、`nonce` 與 PKCE `code_verifier`，存一筆短效紀錄並綁定目前的使用者，回傳授權網址，前端導向該網址。
2. `redirect_uri` 指向前端頁面 `/line/callback`。SPA 載入後用 cookie 呼叫 `POST /api/v1/line/login/complete`，送出 `code` 與 `state`。
3. 後端以一次原子操作取出並刪除 `state` 紀錄，確認紀錄的使用者等於目前 cookie 登入的使用者；再用 `code`＋`code_verifier` 換 token，驗證 ID token 的 `aud` 與 `nonce`，以 `sub` 作為 `lineUserId`。
4. 回呼時沒有登入（例如流程跳到另一個瀏覽器），顯示「請回到原本的瀏覽器重新連結」，不能只靠 `state` 綁定帳號。

**建議答案**：是。

**理由**：`SameSite=Strict` cookie 不會隨「從 LINE 導回」那一次頁面請求送出，但 SPA 載入後的同來源 `fetch` 會帶上，所以要由前端頁面接回呼。比對「`state` 綁定的使用者 = 目前登入的使用者」可以擋 login CSRF：攻擊者用自己的帳號產生授權網址騙學生點開，學生的 LINE 就會被綁到攻擊者帳號。`state` 防 CSRF、`nonce` 防重放、支援 PKCE（S256），見 [Integrate LINE Login](https://developers.line.biz/en/docs/line-login/integrate-line-login/)、[Verify ID token](https://developers.line.biz/en/docs/line-login/verify-id-token/)。新增的兩個 API 都要登入，不開放未登入的路由。

#### Q5：state／nonce 的保存（資料結構、安全）

**問題**：是否新增 collection `lineLoginStates`，欄位與規則如下？

- `_id` 存 `state` 的 SHA-256 雜湊（`state` 本身是 `crypto.randomBytes(32)` 的 base64url，只出現在授權網址）；另存 `userId`、`sid`（目前登入的 `authSessions` 紀錄）、`nonce`、`codeVerifier`、`courseId`（從「詢問助教」進來時才有）、`expiresAt`（10 分鐘）。
- 每位使用者同時只保留一筆，開始新的流程時刪掉舊的；消耗時用 `findOneAndDelete({ _id, userId, sid, expiresAt: { $gt: now } })`，拿不到就失敗。
- TTL index `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` 與 `{ userId: 1 }` 定義在 model；正式 Atlas 比照 `db:ensure-auth-sessions` 寫 ensure 腳本，部署當天經你授權後執行。

**建議答案**：是。

**理由**：只存雜湊，資料庫外洩時也拿不到可用的 `state`。綁定 `sid`，學生登出後未完成的流程就跟著失效。用單一條件刪除來消耗，可以避開目前綁定碼「先查、再刪」被重複兌換的問題（[系統設定](../System_Settings/decisions.md)資安審查第 1 項）。命名沿用 `authSessions` 的 camelCase。

#### Q6：帳號綁定衝突（安全）

**問題**：碰到衝突時是否這樣處理？

- (a) 目前的 FocusFlow 帳號已經綁定**另一個** LINE 帳號（例如換了 LINE 帳號）：直接改綁成新的。
- (b) 這個 LINE 帳號已經綁定**另一個** FocusFlow 帳號：**拒絕**，提示「這個 LINE 帳號已綁定其他 FocusFlow 帳號，請先從那個帳號解除綁定」。現行程式會自動解除舊帳號，這點要改掉。
- 判斷依賴 `lineUserId` 的 unique index：寫入時遇到重複鍵錯誤（E11000）一律當成 (b)。

**建議答案**：是。

**理由**：(a) 是本人登入後操作，風險低。(b) 若照舊自動搬移，一個 LINE 可以悄悄把綁定從同學的帳號搶走，之後的提問紀錄也會記到另一個人身上。每位學生只有一個由學校匯入的帳號，(b) 很少發生，拒絕不會造成困擾。

#### Q7：解除綁定

**問題**：是否只保留網頁上的「解除 LINE 綁定」（現有 `DELETE /api/v1/line/binding`），不在 LINE 端提供解除？歡迎訊息附上「可在 FocusFlow 網頁的 LINE 提問頁解除綁定」。學生封鎖官方帳號時不自動解除，解除封鎖後沿用原本的綁定。

**建議答案**：是。

**理由**：LINE 官方要求讓使用者隨時能解除，並在綁定時告知（[Linking accounts](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)）。網頁端已經有這個功能，在 LINE 端做解除會多一個要防重放的動作。不存 LINE 的 access token，解除時也就沒有 token 要撤銷。

#### Q8：舊綁定碼的退場時程

**問題**：是否分兩次部署？

- **第一次（11/10 完成後、11/16 部署凍結前，由你部署）**：網頁改成以「連結 LINE」為主，綁定碼收進「改用綁定碼」的小連結當備援；後端暫時保留綁定碼。
- **第二次（11/27 凍結結束後的第一次部署）**：移除綁定碼的網頁、`POST /line/bind-token`、Bot 的綁定碼判斷與 `BIND:…:COURSE:…` 格式。`line_bind_tokens` 不手動刪除，讓 TTL 自然清空。

**建議答案**：是。

**理由**：11/24 佈展期間不能部署，如果正式 LINE Login 出問題，備援可以讓學生照舊綁定。不手動刪資料，就不必另外申請刪除授權；綁定碼本來就 10 分鐘過期，TTL 會自動清掉。

#### Q9：正式 LINE 後台、webhook 與部署的授權關卡

**問題**：以下每一關都要你在對話或訊息中明確同意，才能執行，是否同意這樣分工？

| 關卡 | 誰操作 |
|---|---|
| 在正式 provider 建立 LINE Login channel（App type 選 Web app）、連結官方帳號、登記回呼網址 `https://focusflow.ntub.edu.tw/line/callback`、OpenID 不申請 email | 百陶 |
| 把正式 Login channel 從 Developing 改成 Published（**無法退回**） | 百陶 |
| VM 的 `.env` 新增 LINE Login channel ID／secret | Weihao |
| 正式 Atlas 建立 `lineLoginStates` 的 index | Weihao |
| 部署（推到 `main` 會自動部署） | Weihao |

另外，webhook URL 不改；Bot 的回覆內容（未綁定時的按鈕）會隨部署一起變更。

**建議答案**：是。

**理由**：Published 無法退回（[Getting started](https://developers.line.biz/en/docs/line-login/getting-started/)）；正式憑證、Atlas 與部署原本就由 Weihao 管理。百陶有 Console 權限，可以操作，但要先取得同意。

#### Q10：圖文選單依綁定狀態切換

**問題**：是否在本功能只提供「綁定完成」「解除綁定」兩個事件給 [S4](../System_Settings/work-orders/S4-line.md) 使用，圖文選單本身（未綁定顯示「連結帳號」、已綁定顯示四格選單）由 S4 一起做？

**建議答案**：是。

**理由**：圖文選單屬於正式 LINE 後台設定，S4 已經有建立腳本與退回步驟；本功能不重複建立。系統設定決策裡「圖文選單依學生狀態切換」仍待討論，兩邊一起定案。

#### Q11：同樣改 LINE 的其他工作交給誰、何時做

**問題**：下面「同樣改 LINE 的相關工作」三件，是否都交給百陶？順序：兩件小修改先做，LINE Login 第二，S4 等 LINE Login 合併、系統設定 S1 合併後才開工（S4 不在 11/10 的範圍內）。

**建議答案**：是。

**理由**：四件都會改 [line.service.js](../../../backend/src/services/line.service.js)，同一個人依序做最不容易衝突。S4 還依賴系統設定 S1，壓在 11/10 前會排擠 LINE Login。

### B 類：交給百陶決定

#### B1：加好友提示與歡迎訊息

**建議做法**：`bot_prompt=aggressive`。綁定後用這次拿到的 access token 查一次 `GET /friendship/v1/status`：已是好友就 push 一則歡迎訊息；不是好友就在完成頁顯示「加入官方帳號」按鈕。access token 用完就丟。

**限制**：不把 access token 或 refresh token 存進資料庫（要存就屬於 A 類）；「已綁定」與「已加好友」在畫面與測試中分開判斷；每次綁定最多 push 1 則，計入官方帳號每月訊息則數。

**理由**：只有已認證的 provider，`normal` 才會預設勾選加好友；`aggressive` 會在同意之後另外跳出加好友頁（[Link a bot](https://developers.line.biz/en/docs/line-login/link-a-bot/)）。

#### B2：其他實作細節

按鈕位置（「LINE 提問」頁、課程的「詢問助教」）、完成頁與錯誤文案、`/line/callback` 在 SPA 裡怎麼接（現在 [main.jsx](../../../frontend/focus-flow/src/main.jsx) 依路徑判斷）、從「詢問助教」進來時綁定後直接切到該課程、測試寫法，都由百陶決定；細節可以用 grilling skill 和他的 AI 逐題確認。

## 同樣改 LINE 的相關工作

| 工作 | 來源 | 與本功能的關係 |
|---|---|---|
| LINE 回覆移除 `[MVP…]` 開發用字樣，時間改成「分:秒」 | Notion 待辦 | 位置在 `buildQuestionSummaryLines` 與 QA 錯誤訊息（`line.service.js` 約 616～703 行），目前顯示成 `片段：75s - 120s`。無相依，可以先做 |
| 教師統計頁分開顯示網頁與 LINE 提問數 | 複評意見 3-3 | 提問都存在 `questions`，以 `source` 欄位區分（網頁為 `api`、LINE 為 `line`），改 [teacherStats.service.js](../../../backend/src/services/teacherStats.service.js) 與 `TeacherDashboard.jsx`，不改資料結構。可佐證 Q1 的成效。無相依，可以先做 |
| LINE 圖文選單按鈕與防重放 | [系統設定工單 S4](../System_Settings/work-orders/S4-line.md) | S4 寫明「LINE 綁定定案前不要開工」。S4 的 postback 解析器與 `webhookEventId` 去重，也會用在 Bot 端的「連結 LINE」按鈕上 |

## 依據與來源

2026-10-29 唯讀核對程式：[LINE routes](../../../backend/src/routes/line.routes.js) 是 `POST /line/bind-token` 與 `DELETE /line/binding`；[LINE service](../../../backend/src/services/line.service.js) 的綁定碼 10 分鐘有效，以 `findOne` 後 `deleteOne` 兌換，同一個 LINE 綁到新帳號時會自動解除舊帳號；`BIND:<綁定碼>:COURSE:<課程 id>` 由「詢問助教」產生（[StudentCourses.jsx](../../../frontend/focus-flow/src/pages/StudentCourses.jsx)），綁定頁是 [StudentLineBot.jsx](../../../frontend/focus-flow/src/pages/StudentLineBot.jsx)。

LINE 官方規則於 2026-10-21 查證：[Getting user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)、[Provider 管理建議](https://developers.line.biz/en/docs/line-developers-console/best-practices-for-provider-and-channel-management/)、[Link a bot](https://developers.line.biz/en/docs/line-login/link-a-bot/)、[Integrate LINE Login](https://developers.line.biz/en/docs/line-login/integrate-line-login/)、[Verify ID token](https://developers.line.biz/en/docs/line-login/verify-id-token/)、[Getting started](https://developers.line.biz/en/docs/line-login/getting-started/)、[Linking accounts](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)。官方沒有寫明回呼網址是否接受 `http://localhost`，[Auth.js](https://authjs.dev/reference/core/providers/line)、[django-allauth](https://django-allauth.readthedocs.io/en/latest/socialaccount/providers/line.html) 等第三方指南都用它做本機開發，建立測試 channel 時要實測。Console、VM 與 live webhook 的現況本輪都沒有查。
