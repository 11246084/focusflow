# LINE 帳號綁定設計決策

這份文件記錄以官方 LINE Login 取代「學生把 64 字元綁定碼傳給 Bot」的設計討論，讓學生更容易完成綁定。2026-10-29 起，LINE 相關功能改由組員百陶實作；本輪先確認大方向、組員與 AI 的討論邊界，以及 HTML 交接方式。2026-10-31 已定案交接方式、結果目標 L1 與 Weihao 保留的邊界，原 Q1～Q11 改為參考方案；開發接手見 [HANDOFF.md](HANDOFF.md)，給百陶看的說明頁見 [LINE綁定.html](../../07_HTML說明頁/LINE綁定.html)，功能完成與驗收只看[目前狀態](../../current-status.md)。

## 分工與定案方式

依[交接方式 G1](../Multimodal_Retrieval/decisions.md#交接方式2026-10-30多模態與-line-綁定共用)：Weihao 只定目標與範圍、帳號安全、正式資料與索引、跨功能契約、費用上限與時程；畫面與文案、程式寫法、測試設計、測試環境的選擇由百陶和他的 AI 決定。正式 LINE 後台、webhook、VM 與部署等外部操作，仍依 AGENTS.md 每次先取得 Weihao 明確同意。碰到 Weihao 範圍時依 [HANDOFF.md](HANDOFF.md)「什麼時候停下來找 Weihao」求援；新定案在下方表格補一列，寫明理由與來源。

**LINE Login** 是讓 LINE 驗證學生的 LINE 帳號，再把結果交給 FocusFlow 的授權流程；**provider** 是 LINE Developers Console 裡管理 channel 的單位；**channel** 是一個 LINE 服務的設定，例如現有 Bot 用的 Messaging API channel。

目標流程例：學生已登入 FocusFlow 網頁 → 按「連結 LINE」→ 手機上 LINE 自動登入，按同意、按加好友 → 回到網頁顯示「已綁定」，LINE 聊天室出現歡迎訊息。全程不必複製或貼上任何東西。

## 已定案與前提

| # | 決策 | 理由 |
|---|---|---|
| G1～G6 | 決策邊界、HTML 說明頁、在 `dev` 開發、瞄準結果一次做完與外部裁判、說明頁位置、硬日期與求援方式，兩個功能共用，全文見[多模態決策的「交接方式」](../Multimodal_Retrieval/decisions.md#交接方式2026-10-30多模態與-line-綁定共用) | 2026-10-30 定案；LINE 的帳號安全、正式 LINE 後台、webhook 與部署屬於 Weihao 定案的範圍 |

已成立、不必再討論的前提：

- **httpOnly cookie 已上線**：2026-10-25 正式站驗收通過（[目前狀態](../../current-status.md)、[cookie 決策](../HttpOnly_Cookie/decisions.md)）。登入憑證是 `__Host-ff_session`（`HttpOnly; Secure; SameSite=Strict`），前端用同來源 `/api/v1` 呼叫；以 cookie 驗證的寫入請求須 `Origin` 符合 `CSRF_TRUSTED_ORIGINS`，並帶 `X-Requested-With: FocusFlow`（cookie 決策第 6、7、13 項）。正式驗收已含「LINE 內建瀏覽器進站恢復登入」。
- **LINE webhook 規則**沿用[系統設定決策](../System_Settings/decisions.md)：以 `webhookEventId` 去重、先回 200 再非同步處理、一次性動作帶短效 nonce。
- **人員**：百陶是現有 LINE provider 的管理員，負責建立測試用 LINE Login channel；開工前在正式 provider 的 Roles 用 Email 邀請 Weihao 為 **Admin**（不是 Member），Weihao 接受後才算完成，供審查設定與緊急處理。
- Jev 問題分流另見 [Jev 決策](../Jev_Judgment/decisions.md)。

### 結果目標 L1（2026-10-31 Weihao 定案）

依 G3b 以結果交辦。以下是 Weihao 寫給百陶與他的 agent 的結果目標，整理成條列，用字保留原意；HANDOFF 與 HTML 說明頁以此為準。

- **核心目標**：不是把 64 字元綁定碼換成一顆按鈕，而是讓 LINE 成為學生能輕鬆開始、安心使用、願意持續提問的學習入口，同時確保不同平台之間的帳號身分正確且安全。最終成果是打通「帳號連結 → 開始提問 → 取得答案 → 使用成效觀察」的完整體驗，而不是完成三項獨立功能。
- **低摩擦、安全的帳號連結**：已登入 FocusFlow 的學生按「連結 LINE」，進入 LINE 官方授權流程，依提示完成授權與加好友，不必複製綁定碼。優先採用 LINE Login 官方機制整合既有帳號，不重新設計登入系統。必須確保：LINE 身分經官方驗證，且只能綁定發起操作的 FocusFlow 帳號；一個 LINE 身分不得同時綁定多個 FocusFlow 帳號；重複綁定、帳號衝突、取消授權及過期請求都有明確處理；能安全解除綁定，不誤刪其他使用者的連結；手機與 PC 都能完成。不得用 LINE 顯示名稱、Email 或使用者自行輸入的 LINE ID 判斷身分。
- **清楚的帳號狀態**：網頁看得出 LINE 是否已連結、是否已加好友（以及狀態能否確認）、如何解除或處理異常。帳號連結、加好友與能否收到 Bot 訊息分開處理；所有結果都給具體、可採取行動的提示，不只顯示錯誤碼。
- **正式產品等級的 LINE 問答**（2026-10-31 依 LF 擴大為選單與回答卡片化）：移除開發、測試與 MVP 字樣；時間戳改為 `1:15`、`2:00`；引用簡潔、適合手機閱讀。回答與現有問答邏輯一致，不改 RAG 的回答與引用規則；只改善排版、引用可讀性、失敗提示與必要引導，不擴張成完整的 LINE 介面重設計。
- **可衡量的跨平台使用**：教師統計頁區分網頁與 LINE 的提問數；沿用既有提問紀錄與統計架構，計數規則一致，保留既有時間與課程篩選；不建置複雜的行為分析平台。
- **技術原則**：先盤點現有 webhook、使用者資料、綁定流程、問答回覆與統計 API，優先重用。**帳號連結安全性是不可妥協的交付條件**：用成熟的官方授權方式，正確處理 OAuth `state`、身分驗證、授權請求有效期、一次性使用、帳號唯一性與衝突檢查，依流程採用 PKCE 等保護。確認 LINE Login 與 Messaging API channel 的 provider 一致，以及現有 `lineUserId` 的相容性；既有已綁定帳號不能因新流程遺失。需要額外資料結構或狀態管理時，允許最小必要修改，不引入無關的身分管理框架。
- **驗證與交付**：在 `dev` 實際運作，不做大規模比較或冗長研究。驗證正常綁定、重複綁定、取消授權與解除綁定；跨帳號錯綁、已綁定衝突、過期或重放的授權請求；好友狀態與網頁顯示一致；Bot 回覆格式、引用與時間戳；兩種來源的統計。依 G3b 用獨立的攻擊情境測試清單驗證關鍵安全性，保留測試 channel 在手機與 PC 的端到端紀錄。交付完整程式、必要測試、精簡驗收結果與設定說明，不以大量文件代替實作。
- **必須在 `dev` 完成**：LINE 官方授權與安全帳號連結；綁定、好友狀態、解除綁定與錯誤處理介面；Bot 回覆與時間格式；教師提問來源統計；對應測試與驗收證據。
- **範圍外**：用 LINE 直接登入、註冊 FocusFlow 或合併帳號；圖文選單（交給 S4，本階段提供「綁定完成」「解除綁定」事件）；無關的問答架構重構或分析平台。
- **部署限制**：開發只用測試環境與測試 channel；正式設定、憑證與部署須通過後續核准關卡，不得自行修改正式設定或上線。
- **執行要求**：成果導向、最小必要變更、快速實作；不先產出龐大研究或規劃。發現影響帳號安全的設計問題時優先修正，不為進度跳過必要驗證。**成功標準：學生能輕鬆且安全地連結 LINE、自然地用 Bot 提問，教師能用可靠的數據觀察不同管道的使用情況。**

**理由**：Weihao 希望組員瞄準結果並自主選方案（G3b）；原 Q2～Q7 的提案改為參考方案。帳號安全的不變條件已寫在上面的「必須確保」，作為攻擊情境測試清單的依據。

### Weihao 保留的邊界（2026-10-31）

| # | 決策 | 理由 |
|---|---|---|
| LA | 在 L1「必須確保」之外補三條不變條件：①學生自己的帳號改綁新的 LINE，頁面須先明確確認「將取代目前的 LINE」才改綁；②不把 LINE 的 access token、refresh token 存進資料庫；③所有建立或改變綁定的 API 都要登入，不能只憑 `state` 完成綁定（例：流程跳到另一個瀏覽器時失敗）。攻擊情境清單由協調 session 在開工前寫好放在 HANDOFF，百陶的 agent 每一條都寫成測試 | 屬 G1 的帳號安全；①避免誤觸就換掉綁定，②少一份可被竊取的憑證，③擋 login CSRF（攻擊者用自己的帳號產生授權網址騙學生點開）。清單由 Weihao 這邊寫，才是 G3b 的外部裁判 |
| LB | 測試方式交給百陶與 AI 評估：可在本機用測試 provider，也可在正式 provider 測試。不論選哪種，正式 LINE Developers Console 的操作（建立 channel、連結官方帳號、回呼網址、改 Published、圖文選單）與 webhook URL 變更，仍依 AGENTS.md 每次先取得 Weihao 明確同意；第一步仍是在正式 provider 的 Roles 以 Email 邀請 Weihao 為 Admin | Weihao 2026-10-31 指定由組員評估。評估要考慮：正式 provider 的 Login channel 在 Developing 時只有 Admin、Tester 能登入；`bot_prompt` 要求兩個 channel 同一 provider，在正式 provider 測試會讓測試者加入正式官方帳號、事件送到正式 webhook；Published 無法退回 |
| LC | 圖文選單（S4）不再固定排在佈展後：百陶的 agent 實作 LINE 時要主動提醒，評估能否並行一起做；只做不依賴系統設定 S1～S3 的部分（例：未綁定顯示「連結帳號」、已綁定顯示切換課程與網頁版），換模型、本月額度等格子等 S2、S3 完成再加。正式建立圖文選單屬 LB 的正式後台操作 | Weihao 2026-10-31 指定。圖文選單與綁定狀態直接相關，並行可少改一次 `line.service.js`；S4 原工單依賴 S1，只能先做不需要設定核心的部分 |
| LP | 百陶的優先順序（G6 用來判斷趕不趕得上）：①安全的 LINE Login 綁定，含攻擊情境清單每一條的測試；②網頁上的綁定與好友狀態、解除綁定、錯誤提示；③選單與回答卡片化（LF），含移除開發用字樣、時間改成 `1:15`；④教師統計分開網頁與 LINE；⑤依 LC 評估圖文選單。④很小，可以穿插先做；排序只代表時間不夠時①一定先完成。2026-10-31 依 LF 把原本的③「Bot 回覆文字」擴大為卡片化 | L1 的核心是安全的連結，綁定不安全，其他改善都沒有意義；④與①無相依，先做可以早點熟悉程式 |
| LF | **暫定方向**（2026-10-31）：LINE 的選單與回答改用 Flex 卡片，手機與電腦版 LINE 都能使用，放寬 L1「不擴張成完整的 LINE 介面重設計」這一句。參考樣式：①選單卡，學生輸入「選單」或按手機圖文選單叫出，內含切換課程（Flex 輪播，取代最多 4 顆的 Buttons Template）、今天還能問幾次、開啟網頁版、使用說明、綁定狀態與連結或解除（解除導到網頁）；換模型、本月額度等 S2、S3 完成再加進同一張卡；②回答卡，上方課程、中間回答、下方最多 3 筆引用（例「第 2 支・1:15 - 2:00」＋「▶ 看這段」，有 YouTube 版本就開 YouTube 並跳到該秒，否則開網頁課程頁），卡片失敗時退回純文字；③S4 規劃的切換課程 Flex 卡片由百陶這次一起做，S4 之後只補模型與額度。**卡片包含哪些項目、版面、文案、連結行為與先後順序，由百陶與他的 agent 討論決定**，可以調整或推翻上述參考。不變的邊界：回答內容與引用規則不改；不為了跳回 FocusFlow 播放器去改 `StudentCourses.jsx`（庭語的章節也在改，屬跨功能，要做先找 Weihao）；切換課程仍要即時檢查修課權限 | Weihao 2026-10-31 提出，參考 NTUB 智能助理等 Flex 選單、輪播與通知卡片。查證：現行切換課程用 Buttons Template（`line.service.js`，最多 4 顆，程式註解寫電腦版只顯示替代文字），其他回覆是純文字；S4 已記錄電腦版不顯示圖文選單；Flex 卡片在電腦版 LINE 可顯示（Weihao 提供的截圖），快速回覆在電腦版的支援程度官方文件未寫明，需實測。學生頁目前不讀網址參數，沒有跳到影片某一秒的連結 |

### 實作採用的做法（2026-11-02，優先項目①）

百陶在開場討論前先要求開工，agent 以下方參考方案 Q4、Q5、Q7、B1 為基礎完成後端，只列和參考方案不同或參考方案沒寫的地方；百陶可以再調整，不得違反 L1 與 LA。

| # | 做法 | 理由 |
|---|---|---|
| LL1 | `state` 送進來就以 `_id` 單一條件取出並刪除，取出後才比對 `userId`、`sid`、期限，比對失敗時這個 `state` 也作廢（Q5 原本把條件放進刪除查詢） | 攻擊者騙學生授權後，學生的瀏覽器一打開回呼網址，攻擊者的流程就作廢，事後拿到回呼網址也完成不了（A1）；連結外流時寧可重新連結 |
| LL2 | 換 LINE 的確認在開始時送出（`replaceExisting`），存在紀錄裡，完成時再帶不生效；沒確認就回 `LINE_REPLACE_CONFIRMATION_REQUIRED`，前端問過學生再重新開始 | 符合 LA①，不必在 LINE 授權前後保留半完成狀態，也不能在完成時才補確認（A10） |
| LL3 | scope 用 `openid profile`，`bot_prompt=aggressive`。姓名、頭貼不讀不存；ID token 只接受 HS256、以 channel secret 驗證 | 查好友狀態的 API 要求 `profile` scope（2026-11-02 查 [LINE Login API](https://developers.line.biz/en/reference/line-login/)）；網頁登入的 ID token 固定 HS256（[Verify ID token](https://developers.line.biz/en/docs/line-login/verify-id-token/)）。Login channel 必須選 Web app，否則 ID token 改用 ES256，驗證會失敗 |
| LL4 | 舊綁定碼在退場前也走同一套規則：單一操作兌換、搶綁拒絕、不能略過確認改綁（原本會自動解除對方的綁定） | 綁定碼部署後仍是備援（P4～P6）；只修新流程的話，A9、A10、A12、A13 可以從舊路徑繞過 |
| LL5 | 用戶端不能指定導回網址，回呼網址只來自 `LINE_LOGIN_CALLBACK_URL`；課程只看開始時的紀錄，完成時重新檢查修課權限，不符合時綁定成功但不切換課程 | A18；綁定不該因為課程權限變動而失敗 |
| LL6 | 綁定後用當次 access token 查好友狀態，已加好友才推播一則歡迎訊息；查不到回 `unknown`，不影響綁定。`users.lineFriendStatus` 記下狀態（綁定結果、加好友與封鎖事件更新），`/auth/me` 只回狀態、不回 LINE ID；封鎖不解除綁定。部署前已綁定的學生沒有資料，顯示「無法確認」，等他們下次加好友或重新連結才更新。已綁定頁確認已加好友時不多顯示，未加或無法確認才出現提示與「加入官方帳號」 | 不存 LINE token（LA②），平時無法再向 LINE 查詢，要靠 webhook 事件；L1 要求網頁看得出好友狀態與能否確認 |
| LL7 | 前端：`/line/callback` 是獨立頁面，載入後先清掉網址上的 `code`、`state`，同一個 `state` 只送一次；未綁定的學生進 LINE 提問頁就直接前往 LINE 授權，不用再按按鈕（百陶 2026-11-02 決定：多按一次沒有意義，也不該讓學生自己複製綁定碼）；每個分頁只自動一次，在 LINE 取消、按返回或剛解除綁定時改顯示一顆「連結 LINE」，避免卡在迴圈。不顯示「改用綁定碼」。只有 LINE Login 不可用時（回 503，例如依 P2、P3 退回）才自動改走綁定碼：電腦版是左文字、右 QR code 與「在手機上開啟 LINE」，手機版只留說明與按鈕，綁定訊息自動帶入聊天室，學生按送出即可，不顯示步驟與綁定碼。已綁定頁維持原本版面（百陶 2026-11-02 指定），要換 LINE 就先解除綁定再重新連結；回呼頁仍會在帳號已綁定別的 LINE 時先確認取代（LA①）。「詢問助教」未綁定時多一顆「連結 LINE」，QR code 留著 | 授權碼不留在瀏覽紀錄；StrictMode 會執行兩次 effect，`state` 只能用一次；綁定碼仍是部署後的備援（P4～P6） |
| LL8 | 優先項目③第一部分（2026-11-03）：LINE 回答改成 Flex 回答卡，上方課程、中間回答、下方最多 3 筆引用（「影片名稱・1:15 - 2:00」＋「▶ 看這段」），有 YouTube 連結就跳到該秒，沒有就開網站課程頁；卡片被 LINE 拒收時改送純文字。`[MVP…]` 降級警示保留在卡片與純文字（百陶 2026-11-03：要的是修好降級，不是隱藏），問答失敗訊息維持原樣。未綁定的學生收到附「連結 LINE」按鈕的卡片，連到網站的 LINE 提問頁。網站網址取自 `LINE_LOGIN_CALLBACK_URL` 的網域，沒設定時退回純文字。引用列用影片名稱，不用「第 2 支」，因為問答結果沒有影片序號 | LF 的參考樣式；不改回答內容與引用規則，只改呈現。降級的根因另外修：呼叫 Gemini 加上逾時與重試（見[後端 README](../../../backend/README.md)）。影片序號要另外查課程影片順序，留待選單卡一起評估 |
| LL9 | 優先項目③第二部分（2026-11-03）：不做輸入「選單」叫出的選單卡（百陶決定）。「切換課程」改成 Flex 輪播，每門課一張卡、按「選這門課」送出原本的 postback，目前選的課標「目前選擇」；最多 12 張，超過時列前 11 門，最後一張寫還有幾門並連到網站課程頁。輪播被 LINE 拒收時退回原本的 Buttons Template。修課權限仍在點選時即時檢查 | 選單卡的項目和圖文選單（LM）的四格重複，電腦版打字輸入「切換課程」一樣叫得出來。Buttons Template 是 LINE 的格式限制，最多 4 顆按鈕，第 5 門以後的課看不到，電腦版也只顯示替代文字；Flex 輪播在電腦版可顯示，LINE 上限 12 張 |

### 圖文選單內容（2026-11-02，優先項目⑤）

| # | 做法 | 理由 |
|---|---|---|
| LM | 準備兩張 2500×843 的圖文選單：未綁定一格「連結帳號」，設為預設選單；已綁定四格「切換課程、今日額度、使用說明、網頁版」，綁定成功時用 Messaging API 指定給該學生，解除綁定時取消指定。綁定一次長期有效，指定跟著帳號留著，學生不必重綁，只有綁定、換 LINE、解除時才變更。上線時補指定一次給已綁定的舊同學；綁定時還沒加好友而指定失敗時，在 `follow` 事件補做；選單失敗不影響綁定。今日額度、使用說明要新增文字指令，否則文字會被當成提問。不放切換模型，接第二個模型再評估；S3 完成後把本月用量併入今日額度的回覆。電腦版不顯示圖文選單，保留文字指令 | 百陶 2026-11-02 定案。官方帳號後台的選單是所有人共用，依綁定狀態切換只能用 API。目前全站只用一個回答模型，學生沒有可切換的選項；每日提問上限已存在，今日額度不必等 S3。這四格與系統設定第 11 項、S4 工單的規劃不同。百陶同日表示圖文選單目前由百陶負責、不必再問 Weihao；LB 與 HANDOFF 仍寫正式操作要先取得 Weihao 同意，該邊界由 Weihao 更新，本項不改 LB |
| LM1 | 實作（2026-11-04）：按鈕送 postback（`action=switch_course`／`today_quota`／`help`），「網頁版」開 `<網址>/app`，「連結帳號」開 `<網址>/app/line`。文字指令「切換課程」「今日額度」「使用說明」保留給電腦版與官方帳號後台的舊選單。「使用說明」回 Flex 輪播（每一步一張卡片，附切換課程、今日額度、網頁版按鈕；未綁定時第一張改為連結帳號、不放需要綁定的按鈕），網站網址取自 `LINE_LOGIN_CALLBACK_URL` 的來源。選單用 `npm run line:rich-menu` 建立；後端只需 `LINE_RICH_MENU_BOUND_ID`。是否已指定記在 `users.lineRichMenuId`，和目前 ID 不同時，綁定、加好友或下一次傳訊息就補指定，所以上線前就綁定的同學不必另外批次處理 | 依安全審查第 70 行，切換用 postback，不用學生打得出來的文字。官方帳號後台建立的選單所有人共用，不能依綁定狀態切換；用 API 建立的預設選單優先於後台選單（依 LINE 圖文選單文件，本輪環境連不到 LINE 網站，未重新核對）。補指定用欄位記錄，避免每則訊息都多呼叫一次 LINE |
| LM2 | 2026-11-04 百陶實測後修正：①課程卡片的「選這門課」隨時都能按，包含較早送出的卡片，不必先輸入「切換課程」；每次仍重新檢查修課、課程發布與影片，課程 ID 格式不對時回固定訊息。②回答卡依原本的換行、「一、」「1.」「(1)」列點換段，段落超過 90 字再依句號切開，列點冒號前的小標題用粗體 | 實測時從舊卡片選另一門課會回「請先輸入切換課程」，要多按一次。原本的狀態檢查是為了防偽造按鈕，但 postback 只能來自 Bot 自己送出的按鈕（webhook 已驗簽），權限每次重查，所以拿掉不會放寬存取。回答整段擠在一起，手機上不好讀；回答內容與引用規則不變，只改排版 |
| LM3 | 已綁定選單改 2×2：`npm run line:rich-menu -- --only bound --apply` 只建新的已綁定選單、不動預設選單；把新 ID 填入 `LINE_RICH_MENU_BOUND_ID` 並重啟後，已綁定的人下一次傳訊息或加好友時自動換成新選單。舊的已綁定選單等大家換完再用 `--delete-menu <ID> --apply` 刪除，太早刪除時還沒換的人會暫時看到「連結帳號」 | 百陶 2026-11-04 實測一排四格後要求改 2×2。沿用 `users.lineRichMenuId` 與目前 ID 比對的補指定機制，不必批次處理每位學生 |
| LM4 | 正式站現況（2026-11-04）：未綁定預設選單 `richmenu-f3632a6b7775d055645c934e8f6c8686`；使用中的已綁定 2×2 `richmenu-692bed685f18e405cb9d003a200a5c48`（VM `LINE_RICH_MENU_BOUND_ID`）；保留未用的已綁定 1×4 `richmenu-a2f08f27bbfc3a06e6d8def489c85eab`。官方帳號後台原本的選單也保留，被 API 預設選單蓋過，2026-11-30 23:59 到期。2×2 或 1×4 待組員討論：改回 1×4 時只要把 `LINE_RICH_MENU_BOUND_ID` 換回 1×4 的 ID 並重啟，並把建立腳本改回 1×4；確定後再用 `--delete-menu` 刪除不用的那張與後台舊選單 | 百陶要和組員討論版面，先不刪除任何選單，方便隨時切換。選單 ID 不是密碼，記在這裡供退回與交接使用 |

## 目前這一輪待答題目

新的問題由百陶與他的 agent 在 G1 範圍內決定；碰到 G1 邊界時依 [HANDOFF](HANDOFF.md) 求援，定案後補進上方表格。目前待百陶決定：

- **測試環境（LB）**：本機測試 provider 或正式 provider。**建議**：本機測試 provider。**理由**：實機端到端要有 channel，測試 provider 不會讓測試者加入正式官方帳號，也不會把事件送到正式 webhook；回呼網址 `http://localhost` 要實測能不能用。
- **圖文選單（LC）**：已實作（LM1）。2026-11-04 百陶確認採分兩種選單（未綁定、已綁定），不改成一張共用；同日上線後改為已綁定選單用 2×2（2500×1686，`rich-menu-bound-large.png`），未綁定「連結帳號」維持 2500×843。原建議「等①～④完成再做」，2026-11-04 依使用者要求先做；①～④的順序不變。

## 參考方案（原 Q1～Q11 與 B1、B2，2026-10-31 改為參考）

以下是 2026-10-21～29 原本要 Weihao 逐題定案的提案，依 G1、G3b 改為參考方案：百陶與 agent 可以採用，也可以提出更好的做法，只有上方表格是定案。對照：Q1 由 L1 取代；Q2、Q4、Q5、Q7、B1、B2 是參考做法，但須符合 L1「必須確保」與 LA；Q3 的測試環境由 LB 交給百陶評估；Q6 的 (b) 拒絕已寫進 L1，(a) 改綁依 LA①須先確認；Q8 的兩次部署退場與 Q9 的正式關卡整理在 HANDOFF 的執行稿；Q10、Q11 由 L1 範圍外、LC 與 G6 取代。


### Q1：目的與成功標準

**問題**：是否以提高試用學生的 LINE 綁定率為主、展覽展示為輔，讓已登入的學生不必複製貼上就能完成綁定？

**建議答案**：是。手機上從按下按鈕到完成綁定最多兩次點擊（同意、加好友），不輸入任何文字；完成頁顯示結果，聊天室出現歡迎訊息。PC（要用 LINE 掃 QR code 登入）、未登入 FocusFlow、尚未加好友等情況另列驗收，不保證都只要兩次點擊。成效看後台的 `lineBindRate`。

**理由**：目前要產生綁定碼、切換 App、傳送綁定碼，每一步都可能讓學生放棄。手機已登入 LINE App 時，開啟授權網址會自動登入（[Integrate LINE Login](https://developers.line.biz/en/docs/line-login/integrate-line-login/)），兩次點擊做得到。

### Q2：只做 LINE Login，不做 Account Link

**問題**：是否只做網頁按鈕走 LINE Login，並帶 `bot_prompt` 在同一流程加好友，不做從 Bot 發起的官方 [Account Link](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)？Bot 遇到未綁定的學生時，只回一顆按鈕開啟 FocusFlow 的「連結 LINE」頁。

**建議答案**：是。

**理由**：上一場建議兩者都做，但查證後發現，Account Link 流程中學生仍要在 LINE 內建瀏覽器登入 FocusFlow，步驟沒有比較少，還要多處理 link token、`accountLink` webhook 事件與 nonce。LINE Login 一樣由 LINE 驗證帳號擁有者。只有一條綁定路徑，程式與測試只要一套，比較能在 11/10 前完成。

### Q3：Provider 與 channel

**問題**：是否把正式的 LINE Login channel 建在現有 Messaging API channel 所在的 provider 底下？另外，本機測試是否另開一個測試用 provider，裡面放測試用官方帳號與測試用 LINE Login channel？

**建議答案**：是，兩者都照建議。正式 channel 由百陶在你同意後建立；測試 provider 由百陶自行建立。

**理由**：userId 按 provider 發放，同一個 provider 底下兩種 channel 拿到的 userId 相同（[Getting user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)），已綁定學生的 `lineUserId` 不必重綁；`bot_prompt` 也要求兩個 channel 在同一個 provider（[Link a bot](https://developers.line.biz/en/docs/line-login/link-a-bot/)）；channel 建立後不能搬到別的 provider（[Provider 管理建議](https://developers.line.biz/en/docs/line-developers-console/best-practices-for-provider-and-channel-management/)）。測試 channel 如果放在正式 provider，`bot_prompt` 會讓測試者加入**正式**官方帳號、觸發正式 webhook，違反「本機測試不碰正式 webhook」。

### Q4：授權回呼與「是同一位學生」的確認（安全、cookie）

**問題**：是否採用以下流程？

1. 學生按「連結 LINE」→ 前端呼叫 `POST /api/v1/line/login/start`（cookie 驗證，帶 CSRF 標頭）。後端產生 `state`、`nonce` 與 PKCE `code_verifier`，存一筆短效紀錄並綁定目前的使用者，回傳授權網址，前端導向該網址。
2. `redirect_uri` 指向前端頁面 `/line/callback`。SPA 載入後用 cookie 呼叫 `POST /api/v1/line/login/complete`，送出 `code` 與 `state`。
3. 後端以一次原子操作取出並刪除 `state` 紀錄，確認紀錄的使用者等於目前 cookie 登入的使用者；再用 `code`＋`code_verifier` 換 token，驗證 ID token 的 `aud` 與 `nonce`，以 `sub` 作為 `lineUserId`。
4. 回呼時沒有登入（例如流程跳到另一個瀏覽器），顯示「請回到原本的瀏覽器重新連結」，不能只靠 `state` 綁定帳號。

**建議答案**：是。

**理由**：`SameSite=Strict` cookie 不會隨「從 LINE 導回」那一次頁面請求送出，但 SPA 載入後的同來源 `fetch` 會帶上，所以要由前端頁面接回呼。比對「`state` 綁定的使用者 = 目前登入的使用者」可以擋 login CSRF：攻擊者用自己的帳號產生授權網址騙學生點開，學生的 LINE 就會被綁到攻擊者帳號。`state` 防 CSRF、`nonce` 防重放、支援 PKCE（S256），見 [Integrate LINE Login](https://developers.line.biz/en/docs/line-login/integrate-line-login/)、[Verify ID token](https://developers.line.biz/en/docs/line-login/verify-id-token/)。新增的兩個 API 都要登入，不開放未登入的路由。

### Q5：state／nonce 的保存（資料結構、安全）

**問題**：是否新增 collection `lineLoginStates`，欄位與規則如下？

- `_id` 存 `state` 的 SHA-256 雜湊（`state` 本身是 `crypto.randomBytes(32)` 的 base64url，只出現在授權網址）；另存 `userId`、`sid`（目前登入的 `authSessions` 紀錄）、`nonce`、`codeVerifier`、`courseId`（從「詢問助教」進來時才有）、`expiresAt`（10 分鐘）。
- 每位使用者同時只保留一筆，開始新的流程時刪掉舊的；消耗時用 `findOneAndDelete({ _id, userId, sid, expiresAt: { $gt: now } })`，拿不到就失敗。
- TTL index `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` 與 `{ userId: 1 }` 定義在 model；正式 Atlas 比照 `db:ensure-auth-sessions` 寫 ensure 腳本，部署當天經你授權後執行。

**建議答案**：是。

**理由**：只存雜湊，資料庫外洩時也拿不到可用的 `state`。綁定 `sid`，學生登出後未完成的流程就跟著失效。用單一條件刪除來消耗，可以避開目前綁定碼「先查、再刪」被重複兌換的問題（[系統設定](../System_Settings/decisions.md)資安審查第 1 項）。命名沿用 `authSessions` 的 camelCase。

### Q6：帳號綁定衝突（安全）

**問題**：碰到衝突時是否這樣處理？

- (a) 目前的 FocusFlow 帳號已經綁定**另一個** LINE 帳號（例如換了 LINE 帳號）：直接改綁成新的。
- (b) 這個 LINE 帳號已經綁定**另一個** FocusFlow 帳號：**拒絕**，提示「這個 LINE 帳號已綁定其他 FocusFlow 帳號，請先從那個帳號解除綁定」。現行程式會自動解除舊帳號，這點要改掉。
- 判斷依賴 `lineUserId` 的 unique index：寫入時遇到重複鍵錯誤（E11000）一律當成 (b)。

**建議答案**：是。

**理由**：(a) 是本人登入後操作，風險低。(b) 若照舊自動搬移，一個 LINE 可以悄悄把綁定從同學的帳號搶走，之後的提問紀錄也會記到另一個人身上。每位學生只有一個由學校匯入的帳號，(b) 很少發生，拒絕不會造成困擾。

### Q7：解除綁定

**問題**：是否只保留網頁上的「解除 LINE 綁定」（現有 `DELETE /api/v1/line/binding`），不在 LINE 端提供解除？歡迎訊息附上「可在 FocusFlow 網頁的 LINE 提問頁解除綁定」。學生封鎖官方帳號時不自動解除，解除封鎖後沿用原本的綁定。

**建議答案**：是。

**理由**：LINE 官方要求讓使用者隨時能解除，並在綁定時告知（[Linking accounts](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)）。網頁端已經有這個功能，在 LINE 端做解除會多一個要防重放的動作。不存 LINE 的 access token，解除時也就沒有 token 要撤銷。

### Q8：舊綁定碼的退場時程

**問題**：是否分兩次部署？

- **第一次（11/10 完成後、11/16 部署凍結前，由你部署）**：網頁改成以「連結 LINE」為主，綁定碼收進「改用綁定碼」的小連結當備援；後端暫時保留綁定碼。
- **第二次（11/27 凍結結束後的第一次部署）**：移除綁定碼的網頁、`POST /line/bind-token`、Bot 的綁定碼判斷與 `BIND:…:COURSE:…` 格式。`line_bind_tokens` 不手動刪除，讓 TTL 自然清空。

**建議答案**：是。

**理由**：11/24 佈展期間不能部署，如果正式 LINE Login 出問題，備援可以讓學生照舊綁定。不手動刪資料，就不必另外申請刪除授權；綁定碼本來就 10 分鐘過期，TTL 會自動清掉。

### Q9：正式 LINE 後台、webhook 與部署的授權關卡

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

### Q10：圖文選單依綁定狀態切換

**問題**：是否在本功能只提供「綁定完成」「解除綁定」兩個事件給 [S4](../System_Settings/work-orders/S4-line.md) 使用，圖文選單本身（未綁定顯示「連結帳號」、已綁定顯示四格選單）由 S4 一起做？

**建議答案**：是。

**理由**：圖文選單屬於正式 LINE 後台設定，S4 已經有建立腳本與退回步驟；本功能不重複建立。系統設定決策裡「圖文選單依學生狀態切換」仍待討論，兩邊一起定案。

### Q11：同樣改 LINE 的其他工作交給誰、何時做

**問題**：下面「同樣改 LINE 的相關工作」三件，是否都交給百陶？順序：兩件小修改先做，LINE Login 第二，S4 等 LINE Login 合併、系統設定 S1 合併後才開工（S4 不在 11/10 的範圍內）。

**建議答案**：是。

**理由**：四件都會改 [line.service.js](../../../backend/src/services/line.service.js)，同一個人依序做最不容易衝突。S4 還依賴系統設定 S1，壓在 11/10 前會排擠 LINE Login。

### 原 B 類

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
