# LINE 帳號綁定設計決策

這份文件記錄以官方 LINE Login 取代複製綁定碼的設計討論，供逐題定案使用。2026-10-23 已整理第一輪五題及建議；尚未獲使用者同意，回呼設計須先等 cookie 方案定案。功能完成與驗收只看[目前狀態](../../current-status.md)。

## 已定案與前提

本功能尚無新增定案。沿用[系統設定](../System_Settings/decisions.md)的帳號安全與 LINE webhook 規則；[cookie 討論](../HttpOnly_Cookie/decisions.md)是 Q4 的前提，Jev 分流另見[Jev 決策](../Jev_Judgment/decisions.md)。

**LINE Login** 是由 LINE 驗證帳號、再讓 FocusFlow 接收結果的授權流程；**provider** 是 LINE Console 裡管理 channel 的單位。是否同 provider、管理權與發布狀態均須實際查 Console，本輪未查。

目標流程例：已登入 FocusFlow → 按「連結 LINE」→ LINE 授權與加好友 → 回網頁確認綁定，無須複製或貼上綁定碼。

## 目前這一輪待答題目

### Q1：目的與成功標準

**問題**：是否以提高試用學生綁定率為主、展覽展示為輔，讓已登入的學生不必複製貼上即可完成？

**建議答案**：是。手機上以授權與加好友最多兩次點擊、無額外文字輸入為目標，完成頁清楚顯示結果；可推播時聊天室出現歡迎訊息。PC、未登入 FocusFlow、LINE 未登入或非好友情況另列驗收，不把兩次點擊當成所有情境保證。

**理由**：減少目前產碼、切換 App、傳碼的中斷，並以後台綁定率及完成流程作觀察依據。

### Q2：只做 LINE Login，還是加做 Account Link

**問題**：是否只做方案 A（網頁 LINE Login），Bot 未綁定入口也導向同一頁，不另做方案 B（Messaging API Account Link）？

**建議答案**：是，選 A。Bot 加好友或收到未綁定訊息時，提供開啟 FocusFlow 綁定頁的按鈕；兩個入口走同一條完成流程。Account Link 的另一路徑先不納入。

**理由**：最後一輪比較指出 B 仍需登入 FocusFlow，又多一組 link token、nonce 與 accountLink webhook；先維持一套流程與測試。這是範圍建議，不代表兩者在所有情境安全性或便利性相同。

### Q3：沿用現有 provider

**問題**：是否在既有 Messaging API channel 的 provider 下建立 LINE Login channel，優先保留既有綁定？

**建議答案**：是。先查實際 provider、擁有者與 Admin 權限；若是個人成員管理，先把管理權風險列明，再確認沿用，不逕行搬移或重建。既有綁定能否直接對應，要以官方規則及實際測試帳號核對。

**理由**：歷史查證以同 provider 的 userId 對應為前提，切換 provider 可能使既有對應失效。Console 現況不能從 repo 推定；建立與發布另須明確授權。

### Q4：回呼處理與同一位學生的身分綁定（等待 cookie 定案）

**問題**：授權回到網頁後，如何確認完成授權的是原先發起的 FocusFlow 使用者，並防止綁錯帳號？

**原建議與失效前提**：前端 `/line/callback` 取得 code／state，再帶 JS 可讀 JWT 呼叫 `POST /api/v1/line/login/complete`，後端比對 state 的 userId，另採 PKCE S256。這是以 localStorage token 為前提，不能在 cookie 遷移後照抄。

**目前建議答案**：先等待 cookie Q1～Q9 定案；若採同來源 Strict cookie，保留前端回呼頁的候選方向，由 SPA 載入後用 cookie 呼叫完成端點，核對目前登入身分與伺服器一次性 state，寫入請求遵守 CSRF；保留 PKCE S256。跨瀏覽器或失去登入時，顯示重新登入／重新發起流程，不能只憑 state 綁帳號。state、nonce、效期與失敗回復在下一輪依定案細化，本輪不選定實作。

**理由**：不能為了接授權回呼重新暴露 JS token；也不能僅用攻擊者能轉傳的授權網址判定 FocusFlow 身分。外部導回、Strict cookie 與回呼方式需整體驗證。

### Q5：加好友提示與歡迎訊息

**問題**：是否選 `bot_prompt=aggressive`，完成後查好友狀態，依結果歡迎或提示加好友？

**建議答案**：是。已是好友才推播一次歡迎訊息，未加好友時在完成頁提供按鈕；本次 LINE access token 用完不存 DB。訊息用量與推播失敗須納入驗收，不能把「已綁定」等同「已加好友」。

**理由**：降低學生漏勾加好友的機會，又讓綁定與接收 Bot 訊息的結果分別可見。provider 認證與實際畫面仍需 Console／裝置驗證。

## 下一輪依前提展開

state／nonce 的保存與一次性消耗、既有改綁衝突、解除綁定、舊綁定碼退場、前端入口、依狀態切換圖文選單、測試與 Console 設定授權。這些尚未形成可定案的完整題目，不先假定答案。

## 本輪程式依據與歷史查證來源

2026-10-23 唯讀核對：[LINE routes](../../../backend/src/routes/line.routes.js)仍是 bind-token／解除綁定，[LINE service](../../../backend/src/services/line.service.js)的綁定碼為 10 分鐘、兌換尚非原子；綁定相同 LINE 時目前會先解除另一帳號的對應。新的衝突處理必須明確定案，不能無聲沿用。

上一輪曾查閱 [userId](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)、[provider 管理](https://developers.line.biz/en/docs/line-developers-console/best-practices-for-provider-and-channel-management/)、[加好友](https://developers.line.biz/en/docs/line-login/link-a-bot/)、[Login 整合](https://developers.line.biz/en/docs/line-login/integrate-line-login/)、[Account Link](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)。本輪僅接回設計紀錄，未重新驗證官方規則、Console、VM 或 live webhook；實作前須再查。
