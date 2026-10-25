# FocusFlow 後端現有程式資安審查（為「系統設定」功能預做）

- 日期：2026-10-21
- 範圍：`backend/src` 現有檔案（`dev` 分支 112b7ba 的 working tree），只讀；未改 repo、未連 Atlas、未呼叫 LINE 或外部 API、未跑測試。
- 行號以審查當下的檔案為準（`backend/` 開頭的路徑省略 `backend/`）。
- 標示 **【影響設計】** 的項目，是系統設定功能沿用現有寫法時會一起繼承的問題，設計階段就要處理。

## 最重要的 3 項

1. **額度檢查是「先數、再做」，不是原子操作**：並行請求可以超過每日次數與每月 token 額度。額度重置券若照同樣寫法，會被重複兌換。【影響設計】（第 1 項）
2. **JWT 無法撤銷**：改密碼、重設密碼都不會讓舊 token 失效；admin token 有效 7 天，且存在 `localStorage`。外洩後的 7 天內，持有者可以完整控制系統設定。【影響設計】（第 2 項）
3. **LINE postback 沒有防重放，webhook 事件也沒有去重**：只有一個全域的對話狀態欄位，舊按鈕可以再按。「使用重置券」「切換模型」不能直接沿用 `select_course` 的模式。【影響設計】（第 3 項）

---

## 發現（依嚴重度排序）

### 1. 額度與一次性憑證的競態（TOCTOU）—— 高【影響設計】

- 位置
  - `src/services/askLimits.service.js:50-77`：`countTodayAsks` 用 `countDocuments` 數出今天的提問數，判斷 `remaining <= 0`。只計入 `answered`／`no_match`，而這兩種狀態要等 AI 回答完成後才會寫入。
  - `src/services/costControl.service.js:39-112`：每月 token 額度同樣是先 count 再判斷；token 數也只是「次數 × `QA_ESTIMATED_TOKENS_PER_ASK`」的估計值，不是實際用量。
  - `src/services/line.service.js:238-277`、`301-353`：LINE 綁定碼先 `findOne`、做完事情後才 `deleteOne`，兩步之間沒有原子性。
- 情境：學生今天還剩 1 次，同時送出 20 個 `/qa/ask`（或網頁和 LINE 同時送）。這 20 個請求都會在任何一筆寫入之前完成檢查，全部放行，等於 20 次 AI 呼叫。綁定碼在兩次並行使用時，也可能被兌換兩次。
- 對系統設定的影響
  - 學生每日／每月 token 額度若沿用 count 模式，上限只是參考值。
  - 額度重置券若寫成 `findOne` → 檢查 → 更新，同一張券可以並行兌換多次。
- 建議修法
  - 額度改成「預扣」：提問前以單一原子操作扣用量，例如 `findOneAndUpdate({ userId, day, used: { $lt: limit } }, { $inc: { used: 1 } }, { upsert: true })`，並搭配 `{userId, day}` 唯一索引。系統失敗時再補回（可沿用目前「failed 不計」的語意）。每月 token 額度改用實際 usage（provider 回傳的 `usageMetadata`／`usage`），以預扣、結算兩步記帳。
  - 重置券用單一條件更新兌換：`findOneAndUpdate({ _id, ownerId, status: 'unused', expiresAt: { $gt: now } }, { $set: { status: 'used', usedAt, usedVia } })`，回傳 null 就視為失敗。綁定碼順手改成 `findOneAndDelete({ token, expiresAt: { $gt: now } })`。
  - 同一位使用者另加一個進行中請求的上限（例如同時最多 1 個提問），擋住並行灌量。

### 2. JWT 無法撤銷、admin token 有效 7 天 —— 高（對 admin）【影響設計】

- 位置
  - `src/services/auth.service.js:66-72`：payload 只有 `sub`，沒有 `tokenVersion`／`iat` 比對。
  - `src/config/env.js:110`：`JWT_EXPIRES_IN` 預設 `7d`，所有角色共用。
  - `src/services/auth.service.js:203-223`（`changePassword`）、`src/services/passwordReset.service.js:110-111`（`confirmPasswordReset`）：只更新 `passwordHash`，已簽出的 token 繼續有效。
  - `frontend/focus-flow/src/api.js:8-9`：token 存在 `localStorage`，前端若有 XSS 就能直接讀走。
  - 沒有伺服器端登出。
- 情境：admin 的 token 從共用電腦、瀏覽器擴充套件或 XSS 外洩。admin 發現後改密碼也無效，攻擊者在 7 天內仍能改模型、開關功能、把學生額度調成無上限、把別人升成 admin。
- 已確認正確的部分：`src/middleware/auth.middleware.js:17-27` 每個請求都重新查 User，`isActive=false` 和降級都會立即生效，角色取自資料庫而不是 JWT。
- 建議修法
  - User 加 `tokenVersion`（或 `passwordChangedAt`）。簽 token 時放進 `ver`；`authenticate` 比對不符就回 401。改密碼、重設密碼、管理員停用或降級時遞增。
  - 依角色設定有效期：admin 改成數小時（例如 8h），student 可以維持較長。
  - 「高風險操作重新輸入密碼」做成 step-up：驗證成功後簽一張短效 token（例如 5 分鐘，`scope: 'admin:sensitive'`，綁定 userId），高風險 API 只接受這張。不要讓每個 API 自己 `bcrypt.compare`。
  - step-up 的密碼驗證要有獨立的失敗鎖定（key 用 userId）。現有 `loginThrottle.service.js` 以 email 計數，可以沿用函式，但 key 要分開，否則 step-up 輸錯會順便把 admin 的登入也鎖住，或反過來。

### 3. LINE postback：無 nonce、無重放保護、事件不去重 —— 中【影響設計】

- 位置
  - `src/services/line.service.js:963-969`：`new URLSearchParams(event.postback.data)`，`action=select_course` 時直接把 `courseId` 傳下去，沒先驗 ObjectId 格式。
  - `src/services/line.service.js:562-571`：唯一的「防偽造」只檢查 `lineConversationState === 'awaiting_course_selection'`，而這是每位使用者單一的全域欄位。
  - `src/services/line.service.js:985-1015`：事件逐筆同步處理，包含十幾秒的 AI 回答，最後才回 200。沒有讀 `webhookEventId`、`deliveryContext.isRedelivery`。
  - `courseSelectionUpdate`（`line.service.js:65-77`）用 `new mongoose.Types.ObjectId(courseId)`。
- 威脅模型
  - 簽章驗證已擋住第三方偽造，postback data 只能來自 bot 自己送出的按鈕或圖文選單。
  - 實際風險是**重放**：使用者重按舊訊息上的按鈕；LINE 在 webhook 逾時後重送事件（Console 開了 redelivery 時）；同一個按鈕快速連點。
  - 現有的 `select_course` 每次都重新查 enrollment 與課程狀態（`line.service.js:573-585`），所以重放的後果只是切回一門本來就能看的課，影響很小。
- 情境
  - 「使用重置券」按鈕若寫成 `action=use_reset&voucherId=...`，舊訊息重按、連點，或 LINE 重送，都可能兌換多次（再加上第 1 項的競態）。
  - 「切換模型」若只靠一個全域 state 欄位，切換課程和切換模型兩個流程會互相覆蓋狀態。
  - `courseId` 格式錯誤時，`Course.findById` 會丟 CastError，被 `processWebhookEvents` 吞成 `internal_error`，使用者收不到任何回覆。
- 建議修法（新 postback 共用一個 parser）
  - 白名單 `action`，每個 action 宣告欄位與格式（ObjectId regex、模型 key 白名單），不符就回固定訊息；不要把參數直接丟進查詢。
  - 改變狀態的 action（兌換、切換模型）一律在伺服器端重新授權：券屬於這位使用者且未使用、模型在「學生可選」白名單內且已啟用。不信任 postback 帶來的任何值。
  - 一次性動作加短效 nonce：送出 Flex 時產生 `nonce` 存到資料庫（含 userId、action、到期時間），按下時原子消耗。
  - 依 `webhookEventId` 去重（TTL collection，保留約 1 天）。
  - 先回 200，再非同步處理耗時的 AI 呼叫，避免 LINE 逾時後重送。
  - 圖文選單要切換的值放在 postback data，不要用「傳送文字」型按鈕。文字可以被使用者自己打出來，例如現有的 `COURSE:<id>`（`line.service.js:955-957`），雖然有授權檢查，但這種模式不適合拿來做兌換。

### 4. `updateUser` 輸入驗證與 admin 自保 —— 中【影響設計】

- 位置：`src/services/admin.service.js:97-132`、`src/controllers/admin.controller.js:19-24`
  - `:110`：`update.isActive = Boolean(isActive)`，傳入字串 `"false"` 會變成 `true`（重新啟用帳號）；`app.js:39` 開了 `urlencoded`，form 送進來的值一定是字串。
  - `:102`：`String(name)` 對物件會存成 `"[object Object]"`。
  - 沒有防止「admin 把自己降級或停用」「停用、降級最後一位 admin」。
  - 角色變更與停用沒有稽核紀錄（誰在何時改了誰），也沒有 step-up。
  - 已確認正確：`role` 用 `USER_ROLE_VALUES.includes(role)` 嚴格比對；`dailyAskLimitOverride` 限 `Number.isInteger`、0～1000，null 代表回到預設。
- 情境：前端或腳本送 `isActive: "false"` 想停用帳號，結果帳號被啟用；唯一的 admin 誤把自己降成 teacher，系統設定就沒人能改，只能直接改資料庫。
- 建議修法
  - `isActive` 用 `typeof === 'boolean'` 檢查，`name` 用 `typeof === 'string'` 檢查，不合格就回 400。
  - 禁止修改自己的 `role`／`isActive`；降級或停用 admin 前，確認剩下的 active admin 數量 ≥ 1。
  - 升為 admin、停用 admin 要 step-up。
  - 寫稽核紀錄：沿用 `RuntimeSetting.history` 的格式（`from`/`to`/`changedBy`/`changedByEmail`/`changedAt`），或另建 `AdminAuditLog`。

### 5. 沒有通用速率限制 middleware —— 中【影響設計】

- 位置：`package.json` 沒有 `express-rate-limit` 之類的套件。現有限流只有：
  - `src/services/loginThrottle.service.js`：以 email 為 key，存在行程記憶體，只用在登入；註解寫明原因是 nginx 反向代理後，後端看到的 IP 都是 localhost。
  - `askLimits`、`costControl`：業務額度，不是請求速率限制，且有第 1 項的問題。
  - `app.js` 沒有 `app.set('trust proxy', ...)`，`req.ip` 會是 127.0.0.1。
- 情境：之後的「模型測試呼叫」「重新抓模型清單」若不限流，被盜用的 admin token 或前端 bug 可以連續打外部 API，把 Gemini／OpenAI 的配額或費用耗光。`/auth/register`、`/auth/password-reset/request` 目前也沒有 IP 層級的限流（後者有每 email 的驗證碼次數限制，詳見 passwordReset.service，本次沒細看）。
- 建議修法
  - 參考 `loginThrottle.service.js` 寫一個小型 in-memory limiter（例如 `rateLimit({ key: (req) => req.user.id, windowMs, max })`）。單一 pm2 fork 行程下正確，重啟會歸零可以接受，註解要寫明「改 cluster 要換 Mongo／Redis 計數」。
  - 測試呼叫：每位 admin 每分鐘約 5 次、全站同時最多 1～2 個請求，外部呼叫加 timeout（`AbortSignal.timeout`）。
  - 抓模型清單：結果快取（例如 10 分鐘），按「重新抓取」才繞過快取，同樣以 admin 為單位限流。
  - 若要用 IP 限流，先確認 nginx 有傳 `X-Forwarded-For`，再設 `app.set('trust proxy', 'loopback')`。不要設 `true`，否則用戶端可以自己偽造 header。

### 6. provider 錯誤原文進 log，非 production 時還會回給 client —— 中【影響設計】

- 位置
  - `src/services/answerGeneration.service.js:214-216`：OpenAI 失敗時，把 `response.text()` 原文整段放進 `AppError.details`。
  - `src/services/answerGeneration.service.js:336-338`、`344-357`：Gemini 失敗時，`details.responseBody` 是原文。
  - `src/middleware/error.middleware.js:8-10`：`console.error(error)` 會把整個 AppError（含 `details`）寫進 pm2 log。`:67-69` 在 `NODE_ENV !== 'production'` 時，`details` 會回給 client。
  - `src/services/answerGeneration.service.js:247-259`：Gemini 失敗只 log `summarizeTextForLog` 的預覽，做法比較好。
  - `src/services/youtubeUpload.service.js:190-193`、`243`：YouTube OAuth 錯誤原文（最多 300 字）存進 `credentialState.lastTokenError`，會出現在公開的 `/health`（見第 7 項）。
- 情境：OpenAI 金鑰錯誤時，回應會含部分遮罩的金鑰（`Incorrect API key provided: sk-...abcd`）；Gemini 錯誤會帶 project number、模型 ID、quota 細節。這些內容進到 pm2 log；若 VM 上某個環境不是 `NODE_ENV=production`，也會直接回給前端。新功能「測試呼叫」最容易把原文整段顯示到後台畫面。
- 建議修法
  - 新增共用的 `sanitizeProviderError({ provider, status, body })`，只保留 `status`、provider 的 `error.code`／`error.status`／`reason`、`requestId`，以及長度上限內、已遮蔽 `sk-[A-Za-z0-9_-]+`、`AIza[0-9A-Za-z_-]{35}`、`Bearer\s+\S+` 的 message。所有 provider 呼叫（含測試呼叫、抓模型清單）都經過它，才寫進 `details` 或 log。
  - 後台「測試結果」只顯示分類過的結果：成功／金鑰無效／模型不存在／配額不足／逾時／其他，加上過濾後的短訊息。
  - `error.middleware.js` 的 `console.error(error)` 改成只記 `name/code/statusCode/message/stack`，`details` 先經過 sanitize 才記。
  - 部署時當次確認 VM 的 `NODE_ENV=production`（本次沒查）。

### 7. `/health` 公開，內容太多 —— 低～中【影響設計】

- 位置：`src/routes/health.routes.js:16-37`（沒有 authenticate），`src/app.js:92`。回傳內容包括：
  - QA provider、向量模式、embedding contract、collection／index 名稱與 index 定義、`setupCommand`（`runtimeDiagnostics.service.js:269-312`、`377-412`）
  - 成本預算（`costControl`）
  - YouTube 外部錯誤原文、`lastPrivatizeVideoId`（`youtubeUpload.service.js:990-1025`）
  - 原片清理錯誤：`unlinkSync` 的錯誤訊息含本機絕對路徑（`youtubeUpload.service.js:411-416`）
  - Shorts 同步的 YouTube API 錯誤訊息（`shortsSync.service.js:270-272`）
- 金鑰本身沒有外洩：只回 `geminiConfigured`／`openaiConfigured` 等布林值，以及缺少的環境變數名稱。
- 情境：未登入的人可以得知系統用哪個 provider、預算上限、內部路徑與最近一次外部錯誤。系統設定上線後，若把「目前模型 ID、學生可選模型、額度」也放進 runtime snapshot，會一併公開。
- 建議修法
  - `/health` 公開版只保留 `status` 和各子系統的 `readiness`；詳細 snapshot 移到 admin 專用的 `/admin/system-status`（可以加 `?detail=1`）。CLAUDE.md 寫「服務是否可用看 `/health` 的 `runtime.*`」，維運文件要一起改。
  - 系統設定的值不要放進公開 snapshot。

### 8. 模型 ID 組 URL：目前安全，改成管理員設定後要補白名單 —— 資訊【影響設計】

- 現況
  - `src/services/answerGeneration.service.js:282`、`src/services/shortScriptGeneration.service.js:323`：`encodeURIComponent(env.geminiChatModel)`，不會被注入路徑或 query。
  - `src/services/queryEmbedding.service.js:113`：沒有 encode，但前面有 `isStableGeminiEmbeddingModel(model)` 鎖定只能用 `gemini-embedding-2`。
  - OpenAI 的模型 ID 放在 JSON body（`answerGeneration.service.js:196`、`queryEmbedding.service.js:70`），沒有 URL 問題。
  - Gemini 金鑰放在 `x-goog-api-key` header，不在 URL。
- 改由管理員設定後的風險
  - 打錯或填入不存在的模型時，Gemini 回答會靜默 fallback 成 template 回答（`answerGeneration.service.js:398-412`），學生只看到品質下降。
  - 可以填入很貴的模型。
  - `answerGeneration.service.js:424-431` 會把 provider 字串原樣放進錯誤訊息，而且是 AppError，production 也會回傳。
- 建議修法
  - 兩層驗證：格式白名單 `^[a-z0-9][a-z0-9.\-]{0,63}$`（Gemini 另允許 `models/` 前綴），而且必須出現在「最近一次抓到的模型清單」或程式內建的允許清單中。provider 只接受 `gemini|openai|template` 這類 enum。
  - **embedding provider／模型不要開放給管理員改**：查詢向量和已建索引的資料必須在同一個向量空間，改了會讓檢索靜默失準（`queryEmbedding.service.js:101-108` 的註解已說明）。設定頁只能唯讀顯示。
  - 「學生可選模型」用伺服器端的 key（例如 `fast`、`quality`）對應實際模型 ID；postback 與 API 只傳 key。
  - 之後新增「抓模型清單」時，金鑰一律放 header，不放 query string。現有 `shortsSync.service.js:76-81` 把 `YOUTUBE_API_KEY` 放在 query，是唯一的反例；它目前的錯誤處理只記 `error.message`，沒有外洩，但不要被沿用。

### 9. `env` 物件可變，金鑰和一般設定混在一起 —— 資訊【影響設計】

- 位置：`src/config/env.js:92-331` 匯出一般物件（沒有 freeze），`geminiApiKey`、`lineChannelSecret`、`jwtSecret` 和門檻值都在同一個物件。各 service 在呼叫當下讀 `env.X`。
- 風險：實作系統設定時，若用 `Object.assign(env, dbSettings)` 或「以 key 名稱覆寫 env」，只要 key 驗證稍有疏漏，管理員（或拿到 admin token 的人）就能覆寫金鑰或 `jwtSecret`，例如把 `geminiApiKey` 換成自己的、把 `lineChannelSecret` 清空。
- 建議修法：沿用 `src/services/youtubeLifecycleSettings.service.js:24-43` 的 `SWITCH_DEFINITIONS` 模式，每個可設定項目明確宣告 key、型別、範圍、預設值和對應的 env 上限；service 改呼叫 `getSetting('qa.answerModel')`，不碰 `env`。可以考慮 `Object.freeze(env)`（要先確認測試沒有直接改 env）。

### 10. 簽章與共用密鑰用一般字串比較 —— 低

- 位置：`src/middleware/lineSignature.middleware.js:38`（`expectedSignature !== signature`）、`src/middleware/internalProcessingAuth.middleware.js:8`。
- 風險：理論上可以靠時間差逐字猜測。經過網路和 nginx 之後實際很難利用，但修法很便宜。
- 建議修法：兩邊轉成 Buffer 並確認長度相同後，用 `crypto.timingSafeEqual` 比較。

### 11. LINE webhook 的 Content-Type 不是 JSON 時回 500 —— 低

- 位置：`src/app.js:33` 只對 `application/json` 用 `express.raw`；其他 Content-Type 會被 `express.urlencoded` 解析成物件，或維持 `{}`。`lineSignature.middleware.js:24-34` 把物件丟進 `hmac.update()`，丟出 TypeError，結果是 500 而不是 401。
- 建議修法：`if (!Buffer.isBuffer(rawBody)) return next(new AppError(..., 400, 'LINE_RAW_BODY_MISSING'))`。

### 12. `urlencoded({ extended: true })` 讓 body 可以是巢狀物件 —— 資訊【影響設計】

- 位置：`src/app.js:39`。
- 影響：新的設定 API 若用 `Number(x)`、`Boolean(x)`、`String(x)` 轉型，物件或陣列會被轉成意料之外的值（見第 4 項）；直接放進 Mongo 查詢時還可能形成 operator injection。
- 建議修法：設定值一律用 `typeof` 嚴格檢查，再依項目定義做範圍驗證；未知的 key 一律拒絕（400），不要忽略後繼續處理。

---

## 已確認沒問題的地方

- **admin 權限統一在 route 層套用**：`src/routes/admin.routes.js:11` 的 `router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN))` 涵蓋整個 `/admin/*`，新的 `/admin/settings` 掛在同一個 router 就會繼承。其他 router 也都在 route 層掛 `authenticate`／`authorizeRoles`，沒看到在 controller 自己判斷角色。
- **停用與降級即時生效**：`auth.middleware.js:17-27` 每個請求都查 User，檢查 `isActive`，`req.user.role` 取自資料庫。
- **JWT secret**：production 缺少或沿用預設值時拒絕啟動（`env.js:75-90`）；`jsonwebtoken` ^9 預設拒收 `alg: none`；payload 只放 `sub`。
- **登入暴力破解**：以 email 鎖定，存在與不存在的帳號回應一致（`loginThrottle.service.js`）。
- **CSRF**：token 走 `Authorization: Bearer` header，不靠 cookie，沒有 CSRF 風險（代價是 XSS 可以讀到 token，見第 2 項）。
- **LINE 簽章**：用 raw Buffer 計算 HMAC（`app.js:33` 在 `express.json` 之前）。缺 `userId`、群組或聊天室來源一律拒絕（`line.service.js:912-931`），避免 `findOne({ lineUserId: undefined })` 抓到第一個使用者。每次 `select_course`／`COURSE:` 都重新檢查 enrollment 與課程是否已發布（`:475-491`、`:573-602`）。
- **綁定碼**：`crypto.randomBytes(32)`，10 分鐘到期（`line.service.js:209-215`）；原子性問題見第 1 項。
- **錯誤回應**：production 時，非 AppError 的 5xx 一律回通用訊息，`details` 不回傳（`error.middleware.js:50-69`）。embedding 與短影片腳本的 provider 錯誤只回固定訊息（`queryEmbedding.service.js:72-78`、`shortScriptGeneration.service.js:338-340`）。
- **金鑰不在回應中**：`/health` 與 `/admin/system-status`（`systemStatus.service.js`）只回布林值、狀態字串和缺少的變數名稱，沒有回傳任何金鑰值。Gemini、OpenAI、LINE、YouTube OAuth 的金鑰都放在 header 或 POST body。
- **`toPublicUser` 白名單**（`utils/publicUser.js`）：不含 `passwordHash`、`lineUserId`。
- **`dailyAskLimitOverride` 與 `role` 驗證**正確（見第 4 項）。
- **可以直接沿用的設定模式**：`RuntimeSetting` model 加上 `youtubeLifecycleSettings.service.js`。
  - key 白名單，值做 `typeof` 檢查
  - env 當上限，env 不允許時 API 回 409
  - 每次使用都讀資料庫、不快取
  - 讀取失敗時視為關閉（fail-closed）
  - 稽核紀錄含 `changedBy`／`changedByEmail`／`changedAt`，最多保留 50 筆
  - 系統設定建議擴充這套，不要另起爐灶。已知限制：`from` 值在並行修改時可能不準，該檔 `:163-164` 的註解已說明。
- **安全標頭與 CORS**：`/api` 有 CSP、`X-Frame-Options: DENY`、`nosniff`；CORS 白名單由 `ALLOWED_ORIGINS` 控制。

## 本次未做

- 沒有跑任何測試，也沒有啟動服務；純讀程式。
- 沒有查 VM 實際的 `NODE_ENV`、`JWT_EXPIRES_IN`、LINE Console 是否開啟 webhook redelivery、nginx 是否傳 `X-Forwarded-For`。這些都會影響第 2、3、5、6 項的實際風險，部署前要當次查證。
- 沒有細看 `passwordReset.service.js` 的驗證碼次數限制、`short-script.routes.js` 的 guard、教師端與學生端的課程授權。
