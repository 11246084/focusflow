---
paths:
  - "backend/src/middleware/**"
  - "backend/src/services/auth.service.js"
  - "backend/src/services/loginThrottle.service.js"
  - "backend/src/utils/**"
  - "backend/src/config/**"
  - "backend/src/app.js"
---

# 安全規範

> 適用範圍：`backend/src/middleware/`、`backend/src/services/auth.service.js`、`backend/src/utils/`

---

## JWT 驗證流程

### 憑證簽發與驗證

瀏覽器呼叫 `POST /auth/session`，腳本呼叫 `POST /auth/login`。後端驗證密碼後，先完成必要的 pending 流程，再以 `issueSession` 建立 authSessions、成功後簽發 `{ sub, typ: 'session', ver, sid, iat, exp }`。瀏覽器只收到 HttpOnly cookie；腳本只收到 body token，不設 cookie。

- `typ` 是 payload 欄位；session、pending、step-up 分別只經 `issueSession`、`signPendingToken`、`signStepUpToken` 簽發，JWT 不存角色或敏感資料。
- admin session 12 小時，教師與學生 7 天；不由 `JWT_EXPIRES_IN` 覆寫。pending 10 分鐘；step-up 最多 5 分鐘且不超過 session。
- `/auth/login` 拒絕 `Origin`、`Sec-Fetch-Site` 或 `Sec-Fetch-Dest`；不檢查 `Sec-Fetch-Mode`，保留 Node fetch 相容性。
- 正式 cookie 為 `__Host-ff_session`、`__Host-ff_pending`、`__Host-ff_stepup`、`__Host-ff_trusted`，皆 HttpOnly、Secure、SameSite=Strict、Path=/，不設 Domain。非 production 用無 `__Host-` 前綴的名稱、不加 Secure，只看 NODE_ENV。
- `authenticate` 有 Authorization 就只驗 Bearer，失敗不改用 cookie；JWT 只接受 HS256、typ=session、完整 ver 與 sid。每次重查啟用中的 User、目前 tokenVersion 與 authSessions 的 sid／userId／expiresAt，不靠 TTL 即時清除。
- 一般登出刪目前 sid，已失效仍冪等回 204；全裝置登出先 `$inc` 版本，再刪全部 session。自己改密碼重發新 sid，刪其他紀錄；版本遞增也清 pending 與信任裝置。
- 停用、降級及實際升為 admin 都遞增版本並撤銷全部憑證；升為 admin 的角色變更與版本遞增必須同次更新，目標帳號重新走 admin 登入與信箱驗證，不能沿用舊 7 天 session。角色未變的 admin 資料編輯不撤銷。
- 儲存查詢、寫入或刪除失敗回 503 AUTH_UNAVAILABLE，不得退回只驗 JWT。
- cookie 寫入須 Origin 完全符合 `CSRF_TRUSTED_ORIGINS`，且帶 `X-Requested-With: FocusFlow`。GET／HEAD／OPTIONS 免檢；影片批次 GET 的伺服器計算、冪等狀態同步是明確例外。
- 發 cookie 一律經 `setAuthCookie`，函式自行重驗可信 Origin。所有登入與驗證回應 no-store，瀏覽器端點不回 body JWT。
- step-up 與敏感操作拒絕任何 Authorization，核對 typ／scope／sub／ver／sid、目前 admin 角色及期限；升為 admin 必須 step-up。錯誤密碼以 userId 獨立計數，5 次鎖 15 分鐘。
- production 的 JWT_SECRET 必須是非範例值；`ALLOWED_ORIGINS`、`CSRF_TRUSTED_ORIGINS` 都必須設定，否則拒絕啟動。

### 角色授權
```js
// 在 route 層依序掛載 middleware
router.post('/', authenticate, requireRole('teacher', 'admin'), createCourse);
```

- `authenticate` 必須在 `requireRole` 之前
- 一般 route 以 `role.middleware.js` 授權；step-up 與角色修改等敏感服務另核對目前資料庫帳號。

---

## 密碼處理

- 儲存時使用 **bcryptjs**，預設 salt rounds = 10
- 註冊、修改、重設與 first_login 共用 `assertPassword`：至少 8 碼、至少一個英文字母，不得與目前密碼相同。
- 舊 User 缺 mustChangePassword 視為 true，不做遷移；匯入明確設 true。非 production 只略過信箱驗證與兩段式，仍須完成必要的首次改密碼。
- 驗證碼只存雜湊，以 timingSafeEqual 比對，原子佔用嘗試後再消耗；最多 5 次。pending 與忘記密碼分開計數，重寄無間隔、最多 5 次後帳號暫停該流程寄信 10 分鐘，重新登入不重置；寄信失敗不放行。
- admin 信任裝置 cookie 是隨機值，User 只存雜湊、版本及最少 metadata；最多 5 台、7 天，遞增版本時全部作廢。使用與建立都寫入 adminAuditLogs，不記密碼、JWT、cookie。
- 欄位名稱為 `passwordHash`，不叫 `password`
- **絕對不回傳 `passwordHash`**，透過 `toPublicUser()` 過濾

```js
// utils/publicUser.js 定義安全的回傳欄位白名單
const toPublicUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  // passwordHash 不在此白名單內
});
```

---

## 敏感資料遮蔽

### 回應中不得出現的欄位
| 欄位 | 原因 |
|------|------|
| `passwordHash` | 密碼雜湊 |
| `__v` | Mongoose 版本號（無意義暴露） |
| `lineUserId` | 使用者 LINE 識別碼 |

### 錯誤回應中的 `details`
- **非 production 環境**才回傳 `details`（`error.middleware.js` 自動處理）
- 不要在 details 中洩漏 stack trace 或 SQL/MongoDB 查詢語句
- production 環境中，非 `AppError` 且狀態碼為 5xx 的未預期錯誤一律回 `500 INTERNAL_SERVER_ERROR` 與通用訊息 `Internal server error.`，原始 message／code 只寫入 server log；`AppError`、`MulterError`、Mongoose 驗證／CastError、重複鍵與帶 4xx 狀態的錯誤維持原本的對外訊息

### 環境變數
- 所有金鑰、Secret 透過 `.env` 管理，**不能 hardcode 在程式碼中**
- `.env` 已加入 `.gitignore`，只有 `.env.example`（不含真實值）進版控

---

## LINE Webhook 簽章驗證

LINE Bot 的所有 Webhook 請求皆透過 `lineSignature.middleware.js` 驗證：

```
X-Line-Signature: <base64 HMAC-SHA256>
  → crypto.createHmac('sha256', LINE_CHANNEL_SECRET)
      .update(rawBody)
      .digest('base64')
  → 比對 header 值；缺 header → 401 LINE_SIGNATURE_MISSING，不符合 → 401 LINE_SIGNATURE_INVALID
```

- `app.js` 使用 `verify` 選項保留 `req.rawBody`，供簽章計算使用
- **不要跳過** LINE 簽章驗證，即使是測試環境（測試時使用假 secret）

---

## 內部 Processing Webhook

`POST /api/v1/internal/videos/:videoId/processing` 使用 **共享 Secret** 驗證（非 JWT）：

```
X-Processing-Secret: <PROCESSING_WEBHOOK_SECRET>
  → internalProcessingAuth.middleware.js 比對
  → 不符合 → 回傳 401
```

此端點**不對外開放**，不掛載 `authenticate` middleware，只驗證 Secret。

---

## 輸入驗證原則

- **所有使用者輸入在進入 service 前驗證**，不信任 `req.body` 的原始資料
- 字串一律 `.trim()`，並在空值時明確拋出 `VALIDATION_ERROR`
- MongoDB ObjectId 使用 `assertObjectId()` 驗證，不直接傳入未驗證的 ID
- 檔案上傳由 `upload.middleware.js`（multer）限制 MIME type 與檔案大小

```js
// 標準驗證寫法
const title = String(req.body.title || '').trim();
if (!title) {
  throw new AppError('Title is required.', 400, 'VALIDATION_ERROR');
}
assertObjectId(req.params.courseId, 'course');
```

---

## CORS

`app.js` 透過 `config/cors.js` 的 `buildCorsOptions()` 設定 CORS：

- `ALLOWED_ORIGINS`（逗號分隔；舊名 `ALLOWED_ORIGIN` 仍相容）有值時，只對白名單 origin 回 `Access-Control-Allow-Origin`，並啟用 `credentials`
- 未設定時維持開發期相容（允許所有來源），只適合本機
- 正式 VM 已設定（2026-09-23 外部實測：非白名單 Origin 的預檢請求不會拿到 `Access-Control-Allow-Origin`）。新增前端網域時要同步更新 VM 的 `backend/.env`，否則前端會被擋

## 安全標頭

- 後端 `middleware/securityHeaders.middleware.js` 回 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`，`/api/` 另加 CSP，並關閉 `X-Powered-By`
- 前端 HTML 由 nginx 提供；443 server block 另加 HSTS 等標頭（見[部署與連線排錯](../../docs/10_Operations/deployment/部署與連線排錯.md)）。整站 CSP 尚未加
