# 安全規範

> 適用範圍：`backend/src/middleware/`、`backend/src/services/auth.service.js`、`backend/src/utils/`

---

## JWT 驗證流程

### Token 發放（登入時）
```
POST /api/v1/auth/login
  → auth.service 驗證 email + bcrypt.compare(password, passwordHash)
  → jwt.sign({ sub: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
  → 回傳 { token }
```

- payload 僅包含 `sub`（userId），不存放角色或敏感資料
- 有效期由 `JWT_EXPIRES_IN` 環境變數控制（預設 `7d`）

### Token 驗證（每次 API 請求）
```
Authorization: Bearer <token>
  → auth.middleware.js 的 authenticate()
  → jwt.verify(token, JWT_SECRET)
  → User.findById(payload.sub) 確認帳號仍存在且 isActive = true
  → req.user = toPublicUser(user)  // 過濾敏感欄位
```

- Token 無效或過期 → `AppError(401, 'INVALID_TOKEN')`
- 帳號不存在或停用 → `AppError(401, 'UNAUTHORIZED')`

### 角色授權
```js
// 在 route 層依序掛載 middleware
router.post('/', authenticate, requireRole('teacher', 'admin'), createCourse);
```

- `authenticate` 必須在 `requireRole` 之前
- 不要在 controller 或 service 層自行判斷 `req.user.role`，統一透過 `role.middleware.js`

---

## 密碼處理

- 儲存時使用 **bcryptjs**，預設 salt rounds = 10
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
  → 比對 header 值，不符合 → 回傳 400
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

目前 `app.js` 使用寬鬆的 `cors()`（允許所有來源），適用於 MVP 開發階段。進入生產環境前需限制為特定 origin：

```js
// 生產環境修改為
app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
```
