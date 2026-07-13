# FocusFlow MongoDB 學習筆記

## 一、資料表格（13 個 Collection）

| # | Collection | 筆數 | 說明 |
|---|---|---|---|
| 1 | `users` | 3 | 帳號 |
| 2 | `courses` | 3 | 課程 |
| 3 | `videos` | 16 | 影片 |
| 4 | `enrollments` | 2 | 選課關係 |
| 5 | `questions` | **56** | 問答紀錄 |
| 6 | `clips` | 1 | 影片片段（預留） |
| 7 | `usage_logs` | 247 | 用量紀錄 |
| 8 | `line_bind_tokens` | 0 | LINE 綁定 token |
| 9 | `video_segments_text` | **130** | 逐字稿片段＋文字向量（QA 核心） |
| 10 | `video_segments_video` | 16 | 影片向量（多模態，預留） |
| 11 | `video_segments_audio` | 0 | 音訊向量（預留） |
| 12 | `transcripts_normalized` | 17 | 正規化逐字稿（pipeline 產出） |
| 13 | `term_dictionary` | 14 | 術語字典 |

> ⚠️ 真實名稱是 `usage_logs`、`line_bind_tokens`（snake_case），別講成 `usagelogs`。
> 前 8 個有 Mongoose model（backend 管理）；後面 `video_segments_*` / `transcripts_normalized` / `term_dictionary` 主要由 Python STT pipeline 寫入。

---

## 二、`users`（使用者帳號）

**用途：** 存放所有使用者帳號資料，包含學生、教師、管理者三種角色。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆文件唯一 | **MongoDB 自動生成**（插入時若沒指定就自動配一個 ObjectId） |
| `email` | 登入帳號（唯一、自動轉小寫） | 註冊/seed 時寫入；schema 設 `unique: true, lowercase: true` |
| `__v` | Mongoose 的版本鍵（version key） | **Mongoose 自動加的**，平常用不到 |
| `activeCourseId` | 這位學生在 **LINE Bot 目前選中的課程** | LINE Bot 切換課程時由 backend 更新；預設 `null` |
| `createdAt` | 建立時間 | **Mongoose `timestamps` 自動產生**，插入當下寫入 |
| `isActive` | 帳號是否啟用 | 預設 `true`；登入時會檢查，停用帳號無法通過驗證 |
| `lineBindAt` | 綁定 LINE 的時間 | 學生完成 LINE 綁定流程時寫入；未綁定為 `null` |
| `lineConversationState` | LINE 對話狀態機目前狀態 | LINE Bot 對話流程中更新（如選課程時會切到別的狀態）；預設 `idle` |
| `lineUserId` | 這位使用者的 **LINE 識別碼** | LINE 綁定時從 webhook 取得寫入；唯一、未綁定為 `null`（敏感欄位，**不應回傳前端**） |
| `name` | 顯示名稱 | 註冊/seed 時寫入 |
| `passwordHash` | **密碼的 bcrypt 雜湊**，不是明文 | 註冊時用 `bcryptjs` 對明文密碼加鹽雜湊（salt rounds=10）；**絕不回傳前端** |
| `role` | 角色，決定權限 | 預設 `student`，可為 `teacher` / `admin`；授權時用它判斷 |
| `updatedAt` | 最後更新時間 | **Mongoose `timestamps` 自動維護**，每次存檔更新 |
| `lineConversationHistory` | LINE 最近 6 筆對話訊息 | LINE Bot 每次互動 append，保留最近 6 筆給 AI 當上下文 |

### `passwordHash` 怎麼來的 —— bcrypt 密碼處理

FocusFlow 用 **`bcryptjs`** 套件處理密碼，集中在 `backend/src/services/auth.service.js`。核心原則：**資料庫永遠只存雜湊，不存明文密碼**。流程分兩個方向。

#### 1️⃣ 註冊／建立帳號時 — 產生雜湊

`auth.service.js:45`

```js
const passwordHash = await bcrypt.hash(rawPassword, 10);
```

- `rawPassword`：使用者輸入的明文密碼（註冊前已先驗證長度 ≥ 8，見 `auth.service.js:33`）
- `10`：**salt rounds（cost factor）**，符合 `.claude/rules/security.md`「預設 salt rounds = 10」
- 結果存進 `passwordHash` 欄位（**不叫 `password`**），明文不進資料庫

bcrypt 內部自動：產生隨機 **salt** → 用 Blowfish-based 演算法跑 2¹⁰ 次迭代 → 輸出一段**同時包含「演算法版本 + cost + salt + 雜湊值」**的字串：

```
$2a$10$N9qo8uLOickgx2ZMRZoMye  IjZAgcfl7p92ldGxad68LJZdL17lhWy
└┬┘ └┬┘ └──────── salt ────────┘└────────── 實際雜湊值 ──────────┘
 │   └ cost factor = 10
 └ 演算法版本
```

因為 salt 隨機，**同一組密碼每次雜湊結果都不同**。

#### 2️⃣ 登入時 — 比對雜湊

`auth.service.js:80`

```js
const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
```

- 不必另外取出 salt——bcrypt 會**從 `user.passwordHash` 字串裡讀出當初的 salt 與 cost**，用同一組重新雜湊輸入的 `password` 再比對
- 比對失敗一律回 `401 INVALID_CREDENTIALS`，且「找不到帳號」與「密碼錯誤」的訊息**刻意一致**，避免**帳號列舉**（attacker 試出哪些 email 有註冊）

#### 3️⃣ Demo seed 也用同一套

`demoSeed.service.js:152` 種示範使用者時同樣是 `bcrypt.hash(demoUser.password, 10)`，跟正式註冊一致的雜湊規格（明文只在 seed 設定裡，不進 DB）。

#### 三個關鍵名詞

| 名詞 | 是什麼 | 防的是什麼 |
|---|---|---|
| **salt**（隨機、每帳號不同） | 混進密碼再雜湊的隨機字串，內嵌在雜湊字串中 | **彩虹表**、看出兩人用相同密碼 |
| **cost factor**（= salt rounds = `10`） | 控制運算慢度，每 +1 耗時翻倍（2ⁿ 次迭代） | **暴力破解**（故意算慢，拖垮攻擊者） |
| **單向性** | bcrypt 無法從 `passwordHash` 還原明文 | 即使 DB 外洩也拿不到原密碼 |

#### 比對通過後為什麼還有後續流程？

`bcrypt.compare` 只證明「**這一次請求**你是本人」，但 **HTTP 是無狀態的**，伺服器不會記得你。所以登入成功後還要：

```js
const token = signToken(user);              // 發 JWT 通行證（payload 只放 { sub: userId }）
await recordUsage({ ... });                 // 記一筆登入事件，供稽核/統計
return { token, user: toPublicUser(user) }; // 回傳 token + 過濾後的使用者資料
```

- **`signToken`**：發一張 JWT token 當「通行證」，之後每個請求帶 `Authorization: Bearer <token>`，伺服器 `jwt.verify` 一驗就知道是你，**不用每次重打密碼**（有效期 `JWT_EXPIRES_IN`，預設 7 天）。
- **`toPublicUser`**：回傳前**白名單過濾**——只手動挑出安全欄位，`passwordHash` / `__v` / `lineUserId` 因為沒被挑進來，前端永遠拿不到（見 `utils/publicUser.js`，`.claude/rules/security.md` 規定）。
- **`recordUsage`**：寫登入紀錄到 `usage_logs`，純營運/稽核需求。

#### ⚠️ 這條路只服務「網頁登入」

email + 密碼 + bcrypt + JWT 是**網頁 SPA** 的登入（`POST /api/v1/auth/login`）。**LINE Bot 不走這條**——它不用密碼，靠 LINE 平台給的 `lineUserId` + Webhook 簽章驗證認身分（見第十一節綁定流程）。

#### 評審如果問「密碼怎麼存？安全嗎？」

> 「密碼用 bcrypt 加鹽雜湊（salt rounds=10）存成 `passwordHash`，絕不存明文也無法還原；salt 每帳號隨機、內嵌在雜湊字串裡防彩虹表，cost factor 控制運算成本防暴力破解。登入比對成功後發 JWT 讓後續請求免重打密碼，回傳前再用 `toPublicUser` 白名單過濾掉 `passwordHash` 等敏感欄位。這套只用於網頁登入，LINE 走另一條簽章驗證。」

### 0️⃣ 資料定義（決定一筆 user 有哪些欄位）

`backend/src/models/user.model.js` —— 這就是截圖那 **14 個欄位**的來源。`timestamps: true` 產生 `createdAt`/`updatedAt`，Mongoose 預設再加 `__v`。

### 1️⃣ 這筆 `Demo Student` 怎麼被「種」出來的

截圖的 `student@focusflow.local` 不是真人註冊，是 demo seed 寫進去的。

`backend/src/services/demoSeed.service.js:42` —— 定義這個人：

```js
{
  name: 'Demo Student',
  email: 'student@focusflow.local',
  password: 'Student123!',         // ← 明文只在 seed 設定裡，不會進資料庫
  role: USER_ROLES.STUDENT,
  lineUserId: 'demo-line-student-001',
},
```

`backend/src/services/demoSeed.service.js:150` —— 實際寫入資料庫：

```js
async function seedDemoUsers() {
  for (const demoUser of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(demoUser.password, 10);  // ← 明文密碼在這裡被雜湊
    await User.findOneAndUpdate(
      { email: demoUser.email },          // 以 email 找
      { $set: {                           // 找到就更新、沒有就新建（upsert）
        name: demoUser.name,
        email: demoUser.email,
        passwordHash,                     // ← 存的是雜湊，不是明文
        role: demoUser.role,
        isActive: true,
        lineUserId: demoUser.lineUserId,
        lineBindAt: null,
        activeCourseId: null,
        lineConversationState: 'idle',
      }},
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}
```

> 截圖裡的 `passwordHash: "$2a$10$..."`、`role: "student"`、`lineConversationState: "idle"` 就是這段種出來的。（截圖裡 `lineBindAt` 和 `lineUserId` 後來變成真實 LINE 值，代表這帳號後來又被拿去做 LINE 實測覆蓋過。）

### 2️⃣ 一般使用者註冊（真人怎麼新增一筆 user）

`backend/src/services/auth.service.js:21`

```js
async function register({ name, email, password, role }) {
  // ...先驗證 name / email 格式 / 密碼至少 8 碼 / role 是否允許自助註冊
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) throw new AppError('Email is already registered.', 409, 'DUPLICATE_RESOURCE');

  const passwordHash = await bcrypt.hash(rawPassword, 10);   // ← 同樣 bcrypt 雜湊
  const user = await User.create({                           // ← 真正寫入 users collection
    name: trimmedName,
    email: normalizedEmail,
    passwordHash,
    role: targetRole,
  });

  const token = signToken(user);              // 發 JWT
  return { token, user: toPublicUser(user) }; // 回傳時過濾敏感欄位
}
```

### 3️⃣ 登入（用這筆 user 驗證身分）

`backend/src/services/auth.service.js:68`

```js
async function login({ email, password }) {
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  if (!user.isActive) throw new AppError('User is inactive.', 403, 'USER_INACTIVE');  // ← isActive 在這裡把關

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);  // ← 比對明文 vs 雜湊
  if (!isPasswordValid) throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');

  const token = signToken(user);             // payload 只放 { sub: userId }
  return { token, user: toPublicUser(user) };
}
```

### 4️⃣ 每次 API 請求驗證（用 token 反查這筆 user）

`backend/src/middleware/auth.middleware.js:7`

```js
async function authenticate(req, res, next) {
  // 取 Authorization: Bearer <token>
  const payload = jwt.verify(token, env.jwtSecret);   // 驗 token
  const user = await User.findById(payload.sub);      // ← 用 token 裡的 userId 反查 users
  if (!user || !user.isActive) return next(new AppError('User is not available.', 401, 'UNAUTHORIZED'));
  req.user = { id: String(user._id), ...toPublicUser(user) };  // 掛到 req 給後續使用
  return next();
}
```

### 5️⃣ 回傳前端時的安全過濾（白名單）

`backend/src/utils/publicUser.js` —— 白名單機制，`passwordHash` / `__v` / `lineUserId` 都被擋在外面，前端拿不到。

### 跟 users collection 相關的程式碼（分層）

照「資料定義 → 怎麼產生 → 怎麼被驗證使用」串起來。

| 層 | 檔案 | 對 `users` 做什麼 |
|---|---|---|
| **Route** | `routes/auth.routes.js` | 定義 `/login`、`/register`、`/me` |
| **Controller** | `controllers/auth.controller.js` | 解析 req.body，呼叫 service |
| **Service** | `services/auth.service.js` | 真正讀寫 `users`、bcrypt、發 JWT |
| **Middleware** | `middleware/auth.middleware.js` | 每次請求用 token 反查 `users` |
| **Model** | `models/user.model.js` | 定義欄位 |
| **Seed** | `services/demoSeed.service.js` | 種出 `Demo Student` |
| **Util** | `utils/publicUser.js` | 回傳前過濾敏感欄位 |

---

## 三、`__v` 是什麼

### 白話

`__v` 是 **Mongoose 自動加的「版本鍵」（versionKey）**，不是你寫的、也不是 MongoDB 原生的，是 Mongoose 這個 ORM 幫每筆文件加的。

- 預設值 `0`
- 用途：**處理陣列的併發更新衝突**（optimistic concurrency）。文件裡有陣列欄位、兩個操作同時改它時，Mongoose 用 `__v` 判斷「我讀到的版本是不是最新的」。
- 實務上**大多用不到**，靜靜存在。

### 是不是每個 collection 都有？

**不是。** 只有「經由 Mongoose 建立的文件」才有 `__v`。

| 有 `__v` ✅ | 沒有 `__v` ❌ |
|---|---|
| backend 用 Mongoose 寫的：`users`、`courses`、`videos`、`questions`、`enrollments`、`clips`、`usage_logs`、`line_bind_tokens` | Python pipeline 用 pymongo 寫的：`transcripts_normalized`、`video_segments_video`、`video_segments_audio`、`term_dictionary` |

`video_segments_text` 比較特別 —— 兩邊都會寫，所以同一個 collection 裡可能**有些文件有 `__v`、有些沒有**，這正常，不是 bug。

### 相關程式碼（兩塊）

**1. Schema 定義 —— 沒關掉所以存在**（`user.model.js`）

```js
const userSchema = new mongoose.Schema(
  { /* 欄位 */ },
  {
    timestamps: true,   // 自動產生 createdAt / updatedAt
    // 沒寫 versionKey → Mongoose 用預設 → 自動加 __v
  },
);
// 等同於沒寫但生效的：{ timestamps: true, versionKey: '__v' }
```

想完全不要 `__v`：加 `versionKey: false`（通常不建議關）。

**2. 回傳前端時過濾掉**（`utils/publicUser.js`）—— 白名單機制，只挑安全欄位回傳，`__v`/`passwordHash`/`lineUserId` 都不在清單裡，前端拿不到。

### 評審如果問

> 「`__v` 是 Mongoose 自動加的版本控制欄位，做陣列併發更新保護。只有 backend 經由 Mongoose 寫入的文件才有；Python pipeline 直接寫入的沒有。它不影響業務邏輯，回傳前端時也會跟 `passwordHash` 一起過濾掉。」

---

## 四、Schema 欄位設定選項（Mongoose）

每個欄位用 `{}` 包一組規則，告訴資料庫「這欄位長什麼樣、有什麼限制」。

### email 欄位範例

```js
email: {
  type: String,        // 型別是字串
  required: true,      // 必填，缺了報錯
  trim: true,          // 自動去前後空白
  lowercase: true,     // 自動轉小寫
  unique: true,        // 唯一，不能重複
}
```

| 選項 | 意思 | 例子 |
|---|---|---|
| `type: String` | 只能存字串 | `"student@focusflow.local"` |
| `required: true` | 必填 | 沒填 → `VALIDATION_ERROR` |
| `trim: true` | 去前後空白 | `" a@b.com "` → `"a@b.com"` |
| `lowercase: true` | 轉小寫 | 避免 `A@x.com` 和 `a@x.com` 被當兩個帳號 |
| `unique: true` | 不可重複 | 同 email 註冊第二次 → `DUPLICATE_RESOURCE` |
| `default: x` | 預設值 | 沒指定就自動填 |

### role 欄位範例

```js
role: {
  type: String,
  enum: USER_ROLE_VALUES,        // 只能是 ['admin','teacher','student']
  default: USER_ROLES.STUDENT,   // 沒給就填 'student'
}
```

### 關聯欄位：`type: mongoose.Schema.Types.ObjectId`

```js
activeCourseId: {
  type: mongoose.Schema.Types.ObjectId,   // 型別是「另一筆文件的 _id」
  ref: 'Course',                          // 指向 Course model
  default: null,
}
```

- 這是**關聯欄位**，相當於關聯式資料庫的**外鍵（foreign key）**。
- `ObjectId` 是 MongoDB 那種 `ObjectId('69fb4d...')` 的特殊 ID 型別。
- 這欄位**不存課程完整資料，只存課程的 `_id`**，要用時再去 `courses` 撈。
- `ref: 'Course'` 讓 Mongoose 知道對應的是 Course，可用 `.populate()` 自動帶出整筆課程。

> 比喻：`ObjectId` 關聯就像通訊錄只存「電話號碼」，不是把整個人複製一份；需要時用號碼找人。

專案裡的 ObjectId 關聯欄位：

| 欄位 | 指向 | 意思 |
|---|---|---|
| `activeCourseId` | `User` → `Course` | 學生在 LINE 目前選的課 |
| `teacherId` | `Course` → `User` | 課程的老師 |
| `courseId` | `Video` → `Course` | 影片屬於哪堂課 |
| `uploadedBy` | `Video` → `User` | 影片誰上傳 |

### 評審如果問「怎麼做資料驗證？」

> 「用 Mongoose schema 在資料層就做驗證：必填 `required`、email 自動小寫加唯一性、角色用 `enum` 限定。欄位關聯用 `ObjectId + ref`，類似外鍵，需要時再 `populate` 帶出完整資料。」

---

## 五、`enum` 是什麼

### 白話

`enum` 是 **enumeration（列舉）** 的縮寫，意思是**限定這個欄位只能是清單裡的其中一個值，填別的就報錯**。像**下拉選單 / 單選題**。

```js
role: {
  type: String,
  enum: ['admin', 'teacher', 'student'],   // 只准這三個
}
```

| 填的值 | 結果 |
|---|---|
| `'student'` | ✅ 通過 |
| `'teacher'` | ✅ 通過 |
| `'boss'` | ❌ 報錯（不在清單） |
| `'Student'`（大寫S） | ❌ 報錯（大小寫要完全一樣） |

### 比喻

- **沒有 enum**：空白填空題，使用者亂寫「老師」「teacher」「TEACHER」，資料庫一團亂。
- **有 enum**：是非題只能選 A/B/C，強制統一。

### 好處

1. **防呆** —— 擋掉打錯字或亂填，髒資料進不來。
2. **資料一致** —— 不會同時出現 `'student'`、`'Student'`、`'學生'`。
3. **自我說明** —— 看 schema 就知道有哪幾種可能。

### 在專案裡的寫法

```js
role: {
  type: String,
  enum: USER_ROLE_VALUES,        // = ['admin','teacher','student']，來自 enums.js
  default: USER_ROLES.STUDENT,
}
```

---

## 六、`constants/enums.js` 是什麼

### 角色

專案的**「選項總表 / 共用字典」**，也就是**單一資料來源（single source of truth）**。把所有「只能是固定幾種選項」的東西集中定義在一個地方。

> ❌ 不是「父親 / 繼承」（程式裡繼承是另一回事）
> ✅ 是「字典 / 詞彙表 / 單一資料來源」

### 上半部：定義 7 組固定選項清單

| 清單名稱 | 用在哪 | 選項（白話） |
|---|---|---|
| `USER_ROLES` | 使用者角色 | 管理員 / 老師 / 學生 |
| `COURSE_STATUSES` | 課程狀態 | 草稿 / 已發布 / 已封存 |
| `VIDEO_SOURCE_TYPES` | 影片來源 | 上傳 / 外部網址 / YouTube |
| `VIDEO_PROCESSING_STATUSES` | 影片處理進度 | 排隊 / 處理中 / 完成 / 失敗 |
| `USAGE_LOG_EVENTS` | 使用行為 | 登入 / 觀看 / 提問 / 看片段 |
| `QUESTION_STATUSES` | 問答結果 | 已回答 / 找不到答案 / 失敗 |
| `QUESTION_SOURCES` | 問題來源 | 網頁API / LINE / 除錯 |

每組長這樣（左邊程式用的代號，右邊存進資料庫的值）：

```js
const USER_ROLES = {
  ADMIN: 'admin',      // 程式裡寫 USER_ROLES.ADMIN，資料庫存 'admin'
  TEACHER: 'teacher',
  STUDENT: 'student',
};
```

### 下半部：`module.exports`（匯出給別人用）

```js
module.exports = {
  USER_ROLES,                                   // 整張清單（物件）
  USER_ROLE_VALUES: Object.values(USER_ROLES),  // 只取值的陣列 ['admin','teacher','student']
  // ...其他每組都成對匯出
};
```

每組匯出**兩種形式**：

| 形式 | 長相 | 用途 |
|---|---|---|
| `USER_ROLES` | `{ ADMIN:'admin', ... }` | 指定某個值時用：`default: USER_ROLES.STUDENT` |
| `USER_ROLE_VALUES` | `['admin','teacher','student']` | `enum` 限定範圍時用：`enum: USER_ROLE_VALUES` |

`Object.values(...)` = 把物件的值抽出來變成陣列，自動產生第二種形式。

### 為什麼這樣設計

> 「把所有固定選項集中當作**單一資料來源**。好處：① 不會在不同檔案各自寫死字串、打錯字；② 要改時只改一個地方，所有 model 自動同步。」

例：要把 `'student'` 改成 `'learner'`，**只改 enums.js 一行**，所有用到的 model 全部跟著變。

---

## 七、`require` vs `enum` 關鍵釐清

**常見誤會：以為 `enum` 這個字會連到 `enums.js` 檔案。錯！**
真正連接檔案的是 **`require`**，`enum` 只是 Mongoose 的「限定範圍」功能，跟檔案無關（只是名字剛好像）。

```js
// 這一行才是「連接到」enums.js 檔案的關鍵
const { USER_ROLE_VALUES, USER_ROLES } = require('../constants/enums');

// 使用時：
role: {
  type: String,
  enum: USER_ROLE_VALUES,        // 只是「使用」上面拿到的變數，不是在連接檔案
  default: USER_ROLES.STUDENT,
}
```

### 拆三步

| 步驟 | 程式碼 | 在做什麼 |
|---|---|---|
| 1️⃣ 連接檔案 | `require('../constants/enums')` | 打開 enums.js，拿它匯出的東西 |
| 2️⃣ 取出要用的 | `const { USER_ROLE_VALUES } = ...` | 從拿到的東西挑出這個變數 |
| 3️⃣ 使用它 | `enum: USER_ROLE_VALUES` | 把變數（陣列）餵給 enum 當限定範圍 |

### 關鍵

- `require(...)` = 連接/載入檔案 ← **這個才是連接**
- `enum` = Mongoose 欄位規則，意思是「限定值」，**不會自己去找檔案**
- `USER_ROLE_VALUES` = 從檔案拿出來的變數，剛好放在 `enum:` 後面

直接寫死也完全可以（沒用到 enums.js）：

```js
enum: ['admin', 'teacher', 'student']   // 沒連任何檔案
```

改成 `enum: USER_ROLE_VALUES` 是為了**從共用字典拿值**，但**負責連接的是 `require`，不是 `enum`**。

### 比喻

> `require` 像**打電話叫外送**（把東西從別處拿來）；`enum` 像**規定「這位子只能坐這幾個人」**。
> 先打電話拿到名單（require），才能拿名單去規定位子（enum）。

---

## 八、`clips`（影片精華片段）

**用途：** 存放影片的精華片段／重點剪輯，附帶可跳轉到影片特定秒數的連結與重點摘要。目前是預留功能（1 筆 demo）。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆唯一 | **MongoDB 自動生成** |
| `segmentId` | 對應的逐字稿片段 ID（**必填、唯一**） | 建立時寫入；`required: true, unique: true` |
| `clipUrl` | 精華片段影片連結（**必填**） | 建立時寫入；`required: true` |
| `courseId` | 屬於哪堂課（**關聯 Course**） | `ObjectId + ref: 'Course'`；預設 `null` |
| `hitCount` | 被點擊／命中次數 | 預設 `0`，被使用時 +1；`min: 0` 不可為負 |
| `jumpUrl` | 跳轉影片特定秒數的連結（如 `?t=18`） | 建立時寫入；預設 `null` |
| `keyPoints` | 重點條列（**字串陣列**） | 建立時寫入；預設 `[]` |
| `createdAt` / `updatedAt` | 建立／更新時間 | **timestamps 自動產生** |
| `__v` | Mongoose 版本鍵 | **Mongoose 自動加** |

### 0️⃣ 資料定義

`backend/src/models/clip.model.js` —— 截圖那些欄位的來源。注意 `segmentId` 設了 `unique: true`，保證**一個片段只會有一筆 clip**。

### 1️⃣ 這筆 clip 怎麼被「種」出來的

截圖的 clip 是 demo seed 種的。

`backend/src/services/demoSeed.service.js:138` —— 定義內容：

```js
const DEMO_CLIP = {
  segmentId: DEMO_SEGMENTS[0].segmentId,                         // 對應第一個 demo 片段
  clipUrl: 'https://focusflow.local/demo-clips/qa-overview.mp4',
  jumpUrl: 'https://focusflow.local/demo-watch/...?t=18',        // ← t=18 = 跳到第18秒
  keyPoints: ['QA API', 'video snippet', 'timestamp'],
};
```

`backend/src/services/demoSeed.service.js:465` —— 實際寫入：

```js
await Clip.findOneAndUpdate(
  { segmentId: DEMO_CLIP.segmentId },     // 以 segmentId 找
  {
    $set: {                               // 找到就更新
      segmentId, courseId: publishedCourse._id,
      clipUrl, jumpUrl, keyPoints,
    },
    $setOnInsert: { hitCount: 0 },        // ← 只有「第一次新建」才設 hitCount:0，避免重種時把累積次數歸零
  },
  { upsert: true, new: true, setDefaultsOnInsert: true },  // 沒有就新建
);
```

> 💡 `$setOnInsert` 是亮點：重新跑 seed 時，`hitCount` 不會被洗掉，保留真實累積的點擊數。

### 程式碼分層

| 層 | 檔案 | 對 `clips` 做什麼 |
|---|---|---|
| **Model** | `models/clip.model.js` | 定義欄位 |
| **Seed** | `services/demoSeed.service.js` | 種出 demo clip |
| **QA** | `services/qa.service.js` | 問答時可關聯片段（預留整合） |

### 評審如果問

> 「`clips` 是影片精華片段，每筆綁一個逐字稿 `segmentId`，存了可跳轉到影片秒數的 `jumpUrl`——這正是我們『答案附影片時間戳』的資料基礎。目前是預留功能，QA 主線先走 `video_segments_text`。」

---

## 九、`courses`（課程）

**用途：** 存放課程資料，記錄屬於哪位老師、包含哪些影片、發布狀態。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆唯一 | **MongoDB 自動生成** |
| `title` | 課程標題（**必填**） | 老師建課時寫入；`required: true, trim: true` |
| `description` | 課程說明 | 建立時寫入；預設空字串 `''` |
| `teacherId` | 授課老師（**關聯 User**，必填） | `ObjectId + ref: 'User'`；帶入老師 userId |
| `videoIds` | 包含哪些影片（**ObjectId 陣列**） | `ref: 'Video'`；上傳影片時 append；預設 `[]` |
| `status` | 課程狀態 | `enum` 限定 `draft`/`published`/`archived`；預設 `draft` |
| `deletedAt` | 軟刪除時間 | 刪除時寫入；未刪除為 `null` |
| `createdAt` / `updatedAt` | 建立／更新時間 | **timestamps 自動產生** |
| `__v` | Mongoose 版本鍵 | **Mongoose 自動加** |

### 0️⃣ 資料定義

`backend/src/models/course.model.js` —— `status` 用 `enum` 限定三種狀態，`teacherId`/`videoIds` 用 `ObjectId` 做關聯。

### 1️⃣ 老師怎麼建立一堂課（真人操作）

`backend/src/services/course.service.js:50`

```js
async function createCourse({ title, description, teacherId, status, creator }) {
  const ownerId = await resolveCourseTeacherId({ teacherId, creator, requiredForAdmin: true }); // 決定老師是誰
  const course = await Course.create({              // ← 寫入 courses
    title,
    description,
    teacherId: ownerId,
    ...(status ? { status } : {}),                  // 沒給 status 就用預設 draft
  });
  const createdCourse = await Course.findById(course._id)
    .populate('teacherId', 'name email role isActive');  // ← populate 把老師完整資料帶出來
  return buildCoursePresentation(createdCourse);
}
```

> 💡 `.populate('teacherId', ...)` 就是把 `ObjectId` 關聯**自動換成真正的老師資料**（名字、email），回傳前端時就不只是一串 ID。

### 2️⃣ 讀取課程（依角色給不同範圍）

`backend/src/services/course.service.js:67` —— 同一支 `listCourses`，**不同角色看到的課不同**：

```js
if (isAdmin(user))   courses = await Course.find();                          // 管理員：全部
else if (isTeacher)  courses = Course.find({ $or:[{teacherId:user.id},{status:'published'}] }); // 老師：自己的＋已發布
else if (isStudent)  courses = await Course.find({ status: 'published' });   // 學生：只看已發布
```

### 3️⃣ 刪除課程（軟刪除 + 連帶清理）

`backend/src/services/course.service.js:160`

```js
async function deleteCourse(courseId, user) {
  // 權限：admin 可刪任何課；老師只能刪自己的
  const isOwnerTeacher = isTeacher(user) && String(course.teacherId) === String(user.id);
  if (!isAdmin(user) && !isOwnerTeacher) throw new AppError('...', 403, 'FORBIDDEN');

  // 連帶清掉：該課的影片、片段、選課關係
  await Video.deleteMany({ courseId });
  await Enrollment.deleteMany({ courseId });
  // 但「歷史紀錄」(UsageLog/Question) 刻意保留，不隨課程刪
  await User.updateMany({ activeCourseId: courseId }, { $unset: { activeCourseId: 1 } });
  await Course.deleteOne({ _id: courseId });
}
```

> 💡 設計決策：**問答和用量是歷史紀錄，不跟著課程一起刪**——可追溯。

### 程式碼分層

| 層 | 檔案 | 對 `courses` 做什麼 |
|---|---|---|
| **Route** | `routes/course.routes.js` | 定義 CRUD 端點 |
| **Controller** | `controllers/course.controller.js` | 解析請求、呼叫 service |
| **Service** | `services/course.service.js` | 建立/查詢/更新/刪除課程 |
| **Access** | `services/courseAccess.service.js` | 判斷使用者能不能看這堂課 |
| **Model** | `models/course.model.js` | 定義欄位 |

### 評審如果問「權限怎麼控管？」

> 「課程依角色控管：學生只看 `published`、老師看自己的＋已發布、admin 看全部。刪除時老師只能刪自己的課，並會連帶清理影片和選課關係，但問答歷史刻意保留。」

---

## 十、`enrollments`（選課關係）

**用途：** 記錄「哪個學生選了哪堂課」與學習進度，是學生與課程的**多對多橋接表**。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆唯一 | **MongoDB 自動生成** |
| `studentId` | 哪位學生（**關聯 User**，必填） | `ObjectId + ref: 'User'`；選課時帶入 |
| `courseId` | 哪堂課（**關聯 Course**，必填） | `ObjectId + ref: 'Course'`；選課時帶入 |
| `enrolledAt` | 選課時間 | 預設 `Date.now`，選課當下寫入 |
| `progress` | 學習進度（0~100） | 預設 `0`；看影片時更新；`min:0, max:100` |
| `watchedVideoIds` | 看過哪些影片（**ObjectId 陣列**） | 看完影片時 append；預設 `[]` |
| `lineNotify` | 是否開 LINE 通知 | 預設 `false`（布林值） |
| `createdAt` / `updatedAt` | 建立／更新時間 | **timestamps 自動產生** |
| `__v` | Mongoose 版本鍵 | **Mongoose 自動加** |

### 0️⃣ 資料定義

`backend/src/models/enrollment.model.js` —— 最後一行有**複合唯一索引**：

```js
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
// ← 保證「同一學生不能重複選同一堂課」
```

### 1️⃣ 學生選課（自動建立 enrollment）

`backend/src/services/course.service.js:101`

```js
async function ensureStudentEnrollment(studentId, courseId) {
  return Enrollment.findOneAndUpdate(
    { studentId, courseId },        // 以「學生+課程」找
    { $setOnInsert: {               // 只有第一次選課才寫
        studentId, courseId,
        enrolledAt: new Date(),
    }},
    { new: true, upsert: true, setDefaultsOnInsert: true },  // 沒有就新建
  );
}
```

> 💡 用 `upsert + $setOnInsert`：學生第一次互動就自動建選課關係，**重複呼叫也不會重複建**（配合唯一索引雙重保險）。

### 2️⃣ 進度怎麼算出來的（截圖的 `progress: 14`）

`backend/src/services/course.service.js:188`

```js
async function markVideoWatched({ user, courseId, videoId }) {
  if (!isStudent(user)) throw new AppError('...', 403, 'FORBIDDEN');  // 只有學生能記觀看

  const enrollment = await ensureStudentEnrollment(user.id, courseId);
  const watched = new Set((enrollment.watchedVideoIds || []).map(String));
  watched.add(String(videoId));                            // 把這部影片加進「看過」集合

  const totalVideos = (course.videoIds || []).length || 1;
  const watchedInCourse = [...watched].filter(id => courseVideoIds.includes(id));
  const progress = Math.min(100, Math.round((watchedInCourse.length / totalVideos) * 100)); // ← 進度公式

  await Enrollment.findOneAndUpdate(
    { studentId: user.id, courseId },
    { $set: { watchedVideoIds: [...watched], progress } },  // 更新看過清單和進度
  );
}
```

> 💡 進度 = **(看過的影片數 ÷ 課程總影片數) × 100**。截圖 `progress: 14`、`watchedVideoIds: Array(1)`，就是這段算出來的。用 `Set` 避免同一部影片重複計算。

### 1️⃣b demo 的選課怎麼種出來

`backend/src/services/demoSeed.service.js:486` —— 種一筆「學生選了已發布課程、進度 15」的選課關係，邏輯跟上面 `ensureStudentEnrollment` 一樣（`findOneAndUpdate + upsert`）。

### 程式碼分層

| 層 | 檔案 | 對 `enrollments` 做什麼 |
|---|---|---|
| **Service** | `services/course.service.js` | 選課、算進度、刪課時連帶清理 |
| **Seed** | `services/demoSeed.service.js` | 種 demo 選課 |
| **Model** | `models/enrollment.model.js` | 定義欄位＋唯一索引 |

> 注意：enrollment **沒有獨立的 route/controller**，它是被「選課、看影片」等動作**附帶建立／更新**的，不是直接 CRUD 的對象。

### 評審如果問「進度怎麼算？學生會重複選課嗎？」

> 「進度 = 看過影片數 ÷ 課程總影片數 × 100，用 `Set` 去重避免重算。重複選課由**複合唯一索引** `{studentId, courseId}` 在資料庫層擋掉，加上 `upsert` 寫法，確保一個學生對一堂課只有一筆選課紀錄。」

---

## 十一、`line_bind_tokens`（LINE 綁定一次性憑證）

**用途：** 存放「網頁帳號 ↔ LINE 帳號」綁定用的**一次性臨時 token**。它是綁定流程中間的橋接憑證，用完即刪、10 分鐘自動過期。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆唯一 | **MongoDB 自動生成** |
| `token` | 64 字元隨機十六進位字串（**必填、唯一**） | `crypto.randomBytes(32).toString('hex')` 產生 |
| `userId` | 這個 token 屬於哪個系統使用者（**關聯 User**） | `ObjectId + ref: 'User'`；申請綁定時帶入 |
| `createdAt` | 建立時間 | 預設 `Date.now` |
| `expiresAt` | 過期時間（**必填**） | service 設為「建立時間 + 10 分鐘」 |

> ⚠️ 注意：這個 model **沒有 `timestamps: true`**（只有手寫的 `createdAt`），所以也**沒有 `updatedAt`**。collection 名稱用第三參數明確指定為 `line_bind_tokens`（避免 Mongoose 自動轉成 `linebindtokens`）。

### 為什麼這張表完全沒有資料（3 個原因疊加）

**1. 用完即刪** —— 綁定成功後馬上刪除 token：

```js
// line.service.js:160
await LineBindToken.deleteOne({ token });   // 綁定成功 → 立刻刪掉
```

**2. 過期自動刪（TTL index）** —— token 只活 10 分鐘，過期由 MongoDB 自動清掉：

```js
// lineBindToken.model.js
const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分鐘後過期
// TTL index：到了 expiresAt 那一刻，MongoDB 自動刪除這筆文件
lineBindTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

**3. 它是「過程資料」不是「結果資料」** —— 綁定的結果存在 `users`（`lineUserId`、`lineBindAt`），token 只是達成綁定的中間媒介。

> 所以這張表**正常狀態本來就接近 0**——只有「某人剛申請綁定、還沒掃碼、且 10 分鐘內」這個短暫窗口才會有資料。空表代表生命週期管理正常，不是漏資料。
>
> 比喻：它像**飯店臨時房卡 / 用過就丟的票根**，存在的價值在「綁定的那 10 分鐘」，不在「平常有沒有資料」。

### 完整綁定流程（QR Code + LIFF + 一次性 token）

你們的實際綁定已經做到「DB 一次性 token + QR Code + LIFF 自動綁定」的組合，比單純複製貼上 token 更完整：

```
第一次使用（只做一次）：
  StudentLineBot 頁面點「取得綁定碼」
  → 後端產生 bindToken，存進 line_bind_tokens      ← 這張表在這裡用到
  → 前端把 token 包成 QR：liff.line.me/{LIFF_ID}?token={bindToken}
  → 手機掃碼 → LIFF 頁面自動拿到 token + LINE userId
  → POST /api/v1/line/liff-bind → 後端查 line_bind_tokens 驗證 token
  → 把 lineUserId 寫進 users → 綁定成功 → 刪掉 token
  → Bot 主動推送課程選單 → 選課 → 開始提問

之後隨時提問：
  直接開 LINE Bot 傳訊息
  → 系統靠 users.lineUserId 認出身份 + users.activeCourseId 知道課程 → 回答
```

### 釐清：QR、JWT、bind token 三者各做什麼（不是互相取代）

| 東西 | 在做什麼 | 跟 `line_bind_tokens` 的關係 |
|---|---|---|
| **QR Code（LIFF）** | 把綁定碼包成掃碼流程，掃了自動完成綁定 | **QR 裡裝的就是這張表的 token**（`?token={bindToken}`），是美化使用方式，不是取代表 |
| **JWT** | 網頁登入後的 **API 身份驗證**（每次請求帶 token） | 沒關係，是另一條線（登入認證，不是 LINE 綁定） |
| **bind token（這張表）** | LINE 綁定的一次性憑證 | 就是這張表本身 |

> 重點：有 QR ≠ 不需要這張表。**QR 裝的就是它**，所以有 QR 反而證明這張表正在被用。

### 這張表能不能刪除？（design decision）

**以實作來說：不能直接刪。** 它是承重牆——綁定流程的每一步都在讀寫它：

```js
await LineBindToken.create({ token, userId, expiresAt }); // 產生綁定碼 → 寫入
const record = await LineBindToken.findOne({ token });    // 掃碼綁定 → 讀出驗證
await LineBindToken.deleteOne({ token });                 // 成功/過期 → 刪掉
```

若直接 drop collection 但程式碼還在，`findOne` 永遠找不到 token → **所有綁定都會失敗**。

**唯一能真正拿掉它的方式：改成 JWT 無狀態簽章**（token 不落地，靠驗章綁定）：

```js
const token = jwt.sign({ sub: userId }, secret, { expiresIn: '10m' }); // 不寫 DB
const payload = jwt.verify(token, secret);   // 驗章就綁，不需要這張表
```

但代價是失去兩個安全特性：

| 比較 | DB token（現在） | JWT 無狀態 |
|---|---|---|
| 主動撤銷 | ✅ 可隨時 `deleteOne` 作廢 | ❌ 只能等它過期 |
| 用完即刪防重放 | ✅ 綁定後立刻刪 | ❌ 未過期前可重複使用 |

**MVP 結論：不建議刪。** 現在的 DB token 換來「可撤銷 + 用完即刪 + 防重放」，這些安全性對綁定這種敏感操作有價值，省一張小表不划算。

### 安全亮點

token 是 `crypto.randomBytes(32)` 產生的 64 字元隨機碼、設 `unique`、10 分鐘失效、用完即刪——這是防止別人猜 token 盜綁帳號的設計。

### 評審如果問

> 「`line_bind_tokens` 存的是 LINE 綁定用的一次性 token。流程是：網頁產生綁定碼存進這張表、包成 LIFF QR code，使用者掃碼後 LIFF 自動帶 token 和 LINE userId 回後端驗證、綁定，用完即刪、過期由 TTL index 自動清。JWT 是另一條線，負責網頁登入的 API 認證。所以這張表雖然平常是空的，但它是綁定流程的核心憑證——空代表機制運作正常，而且因為綁定流程正在用它，不能直接刪。」

### 相關程式碼分層

| 層 | 檔案 | 對 `line_bind_tokens` 做什麼 |
|---|---|---|
| **Route** | `routes/line.routes.js` | `/liff-bind` 等端點（不需 JWT auth） |
| **Controller** | `controllers/line.controller.js` | `liffBind` 接收 token + lineUserId |
| **Service** | `services/line.service.js` | 產生 token、驗證、綁定、刪除 |
| **Model** | `models/lineBindToken.model.js` | 定義欄位 + TTL index |

---

## 十二、`videos`（影片）

**用途：** 存放影片資料——支援檔案上傳與貼 YouTube URL 兩種來源，並用 `processing` 子物件記錄 STT 處理進度（狀態機）。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆唯一 | **MongoDB 自動生成** |
| `courseId` | 屬於哪堂課（**關聯 Course**，必填） | `ObjectId + ref: 'Course'` |
| `title` | 影片標題（**必填**） | 上傳/建立時寫入 |
| `sourceType` | 影片來源類型 | `enum`：`upload` / `external_url` / `youtube` |
| `sourceUrl` / `videoUrl` | 影片網址 | 貼 URL 時寫入；上傳檔案為 `null` |
| `youtubeVideoId` | YouTube 影片 ID | 貼 YouTube URL 時解析出來（如 `yWhzdAefaQU`） |
| `videoId` | pipeline 對接用的字串 ID（唯一、sparse） | 處理流程產生；是 QA 串接的橋接 key |
| `fileName` / `filePath` / `audioPath` | 上傳檔案的路徑 | 上傳檔案時寫入；貼 URL 為 `null` |
| `durationSec` | 影片長度（秒） | 處理完成後寫入（如 `120.001`） |
| `uploadedBy` | 誰上傳的（**關聯 User**，必填） | `ObjectId + ref: 'User'` |
| `processing` | **處理狀態子物件**（見下方狀態機） | 由 `videoProcessing.service.js` 維護 |
| `deletedAt` | 軟刪除時間 | 未刪除為 `null` |
| `createdAt` / `updatedAt` | 建立／更新時間 | **timestamps 自動產生** |
| `__v` | Mongoose 版本鍵 | **Mongoose 自動加** |

`processing` 子物件欄位：`status`、`errorMessage`、`errorCode`、`queuedAt`、`startedAt`、`completedAt`、`failedAt`、`attemptCount`。

### 處理狀態機（State Machine）

影片處理由 `videoProcessing.service.js` 強制狀態轉換，非法轉換回 `409 VIDEO_PROCESSING_TRANSITION_INVALID`：

| 操作 | 前置狀態 | 目標狀態 |
|---|---|---|
| retry | `failed` | `queued` |
| start webhook | `queued` | `processing` |
| complete webhook | `processing` | `completed` |
| fail webhook | `queued` 或 `processing` | `failed` |

> 💡 你截圖那筆 `processing.status: "completed"`、`attemptCount: 1`、有 `queuedAt`/`startedAt`/`completedAt` 三個時間戳——代表這部 YouTube 影片排隊→處理→完成，跑了一次成功。

### `videos` 是 mixed collection（重要邊界）

`videos` 同時住兩種文件：

- **App-owned video**：有 `courseId`、`uploadedBy`、`title`、`processing.status`（backend 管理的）
- **Pipeline metadata**：有 `video_id` 或 `videoId`，但不是 app-owned（Python pipeline 寫的）

判斷依據是 `course/upload/processing` 欄位，不是只看 `videoId`。model 裡有 `isAppOwnedRecord` / `isPipelineMetadataRecord` 兩個 static 方法做區分。

### 評審如果問

> 「`videos` 支援上傳檔案和貼 YouTube URL 兩種來源，用 `processing` 子物件搭配狀態機管理 STT 處理進度（queued→processing→completed/failed），非法轉換會被擋下。它也是 app 影片和 pipeline metadata 共用的 collection，靠 course/upload/processing 欄位區分。」

### 程式碼分層

| 層 | 檔案 | 對 `videos` 做什麼 |
|---|---|---|
| **Route** | `routes/video.routes.js`、`routes/internalVideo.routes.js` | 影片 CRUD、內部 processing webhook |
| **Service** | `services/videoProcessing.service.js` | 強制狀態機轉換 |
| **Model** | `models/video.model.js` | 定義欄位 + app/pipeline 判斷 |

---

## 十三、`video_segments_text`（逐字稿片段＋向量）★ QA 核心

**用途：** 存放影片逐字稿切成的小片段，每段帶一個 **embedding 向量**。這是 AI 問答做**語意搜尋**的核心資料，也是整個系統的招牌。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆唯一 | **MongoDB 自動生成** |
| `videoId` | 屬於哪部影片（字串，對接 `videos.videoId`） | pipeline 寫入；QA 串接的橋接 key |
| `chunkId` | 片段的唯一識別（如 `..._chunk_0001`） | pipeline 切片時產生 |
| `segmentId` | 片段 ID（部分文件為 `null`） | pipeline 視情況寫入 |
| `text` | 這段的逐字稿文字 | STT 語音辨識產出 |
| `startSec` / `endSec` | 這段對應影片的起訖秒數 | STT 對齊時間軸產出（→ 影片時間戳來源） |
| `embedding` | **語意向量**（你截圖是 `Array(3072)`） | Gemini embedding 模型把 `text` 轉成向量 |
| `corrections` | 修正資料（Mixed 陣列） | 預留 |
| `createdAt` / `updatedAt` | 建立／更新時間 | **timestamps 自動產生** |

> 💡 你截圖的 `embedding: Array(3072)` = Gemini embedding 的 3072 維向量；`text` 是「好 ok 各位我們今天要開始進入影像的部分…」這段逐字稿；`startSec: 4.53 / endSec: 32.22` 就是它在影片裡的時間位置。

### 它怎麼被用來做問答（向量搜尋）

QA 支援兩種搜尋模式（`QA_VECTOR_SEARCH_MODE`）：

**1. memory 模式（本機開發）** —— 在記憶體用 cosine 相似度比對：

```js
// qa.service.js
const segments = await VideoSegment.find(buildSegmentLookupQuery(scope)).lean();
// .lean() 跳過 Mongoose hydration —— 對含 3072 維 embedding 的 segments 極關鍵，省記憶體
const cosine = computeCosineSimilarity(queryVector, segment.embedding);  // 算相似度分數
```

**2. atlas 模式（正式環境）** —— 用 MongoDB Atlas Vector Search：

```js
const results = await VideoSegment.aggregate([
  { $vectorSearch: {
      index: env.qaAtlasVectorIndexName,   // text_embedding_index
      path: 'embedding',
      filter: atlasFilter,                 // 用 courseId / videoId 限定範圍
  }},
]);
```

> 流程：學生問題 → 轉成 query 向量 → 跟這些 segment 的 `embedding` 算相似度 → 取最相關的幾段 → 回傳 `text` + `startSec`/`endSec`（時間戳）給生成模型。

### 資料串接鏈（QA bridge contract）

```
course.videoIds → videos._id → videos.videoId → video_segments_text.videoId
```

找到片段後回傳的 `startSec`/`endSec` 就是「答案附影片時間戳」的來源。

### ⚠️ 誠實邊界

- 共享 Atlas 上的 `text_embedding_index`：**2026-06-05 連 Atlas 實查為「存在且 status=READY」**（3072 維、130 筆片段）。早期曾驗證為不存在；狀態以連 Atlas 實查（`listSearchIndexes`）為準。若哪天又掉了才需重建，否則 atlas 模式會 fail-fast。
- demo 實際走哪個模式由 `.env` 的 `QA_VECTOR_SEARCH_MODE` 決定（目前預設 `memory`）。memory 與 atlas 兩種程式碼**都已實作**、靠環境變數切換：別把 memory 講成「沒做雲端」，也別把 memory demo 講成「正在用 Atlas」。
- 這個 collection 兩邊都會寫（backend Mongoose + Python pipeline），所以有些文件有 `__v`、有些沒有，正常。

### 評審如果問（招牌題，一定要會）

> 「`video_segments_text` 是 QA 核心：影片逐字稿切成片段，每段用 Gemini embedding 轉成 3072 維向量存進來。學生提問時，我們把問題也轉成向量，跟這些片段算語意相似度，找出最相關的段落丟給生成模型，並回傳對應的影片時間戳。本機用記憶體 cosine、正式環境用 Atlas Vector Search，可切換。」

---

## 十四、`questions`（問答紀錄）

**用途：** 記錄每一次學生提問（網頁 API 或 LINE Bot），完整保留命中的片段、AI 答案、影片時間戳與 runtime 資訊，可回溯。

| 欄位 | 是什麼 | 怎麼產生的 |
|---|---|---|
| `_id` | MongoDB 主鍵，每筆唯一 | **MongoDB 自動生成** |
| `userId` | 哪位使用者問的（**關聯 User**，必填） | `ObjectId + ref: 'User'` |
| `courseId` | 針對哪堂課（**關聯 Course**，必填） | `ObjectId + ref: 'Course'` |
| `question` | 學生的問題（必填） | 提問時寫入 |
| `answer` | AI 生成的答案 | QA 流程產出 |
| `status` | 問答結果 | `enum`：`answered` / `no_match` / `failed` |
| `source` | 問題來源 | `enum`：`api` / `line` / `debug` |
| `matchCount` | 命中幾個片段 | QA 搜尋後寫入（如 `3`） |
| `topSegmentId` | 最相關片段的 ID | QA 搜尋後寫入 |
| `matches` | **命中的片段陣列**（含分數、時間戳） | 見下方子結構 |
| `runtime` | 用哪個 embedding/生成模型等執行資訊（Mixed） | QA 流程寫入 |
| `sourceUsageLogId` | 關聯的用量紀錄（唯一、sparse） | 有些情境寫入 |
| `askedAt` | 提問時間 | 預設 `Date.now` |
| `createdAt` / `updatedAt` | 建立／更新時間 | **timestamps 自動產生** |
| `__v` | Mongoose 版本鍵 | **Mongoose 自動加** |

`matches` 陣列每筆子物件：`segmentId`、`videoId`、`videoTitle`、`startSec`、`endSec`、`score`。

> 💡 你截圖那筆：問題「openCV是甚麼?」、答案「目前資料庫片段不足以回答這個問題。」、`status: answered`、`matchCount: 3`、`matches[0].score: 0.6487`——代表系統有找到 3 個片段（最高相似度 0.6487），但判斷不夠充分，誠實回答「資料不足」。這正是**避免亂掰**的設計。

### 它怎麼被寫入

`qa.service.js` 的 `askQuestion()` 是入口：搜尋 `video_segments_text` → 組出 `matches` → 呼叫生成模型 → 把整個過程（問題、答案、命中片段、runtime）寫進 `questions`。QA 和 LINE Bot 提問都會寫入同一個 collection。

### 索引（效能 + 查詢）

model 定義了多個索引支援常見查詢：

```js
questionSchema.index({ courseId: 1, askedAt: -1 });          // 某課程最新問答
questionSchema.index({ userId: 1, askedAt: -1 });            // 某使用者最新問答
questionSchema.index({ courseId: 1, status: 1, askedAt: -1 });
questionSchema.index({ question: 'text', answer: 'text' });  // 全文搜尋
```

### 評審如果問

> 「每一次提問我們都完整留痕：問題、AI 答案、命中哪些影片片段＋相似度分數＋時間戳、用哪個模型，都存進 `questions`。網頁和 LINE 提問共用這個 collection。像截圖這題相似度只有 0.65、片段不足，系統就誠實回『資料不足』而不是亂編答案——這是我們刻意的可信度設計。」

### 程式碼分層

| 層 | 檔案 | 對 `questions` 做什麼 |
|---|---|---|
| **Route** | `routes/qa.routes.js` | 提問端點 |
| **Service** | `services/qa.service.js` | 向量搜尋、生成答案、寫入紀錄 |
| **Model** | `models/question.model.js` | 定義欄位 + 多個索引 |

---

## 十五、觀念：MongoDB 是「結構你定義、內容程式產生」

常見誤會：「只要建好表格和關聯，資料就會自己出現？」

**不會。** 建好 schema 和關聯後，還要寫 service 程式去 create/read/update，資料才會被產生。分三層看：

| 項目 | 你要做的事 | 在哪做 |
|---|---|---|
| 表格結構（schema） | 定義欄位 | model 檔案（寫一次） |
| 關聯 | 定義 `ObjectId + ref` | model 檔案 |
| **內容（documents）** | **寫產生/讀取內容的程式邏輯** | service 檔案 |
| 內容的實際資料 | ❌ 不用手填，程式跑就會進去 | 執行時自動 |

重點觀念：

- MongoDB 是 **schemaless（無結構）**，不像 SQL 要先 `CREATE TABLE`。結構由 **Mongoose 在 model 檔案**定義。
- collection **不用先建**——第一次有資料寫進去時，MongoDB 自動生出來。
- 內容**不是手動在資料庫一筆筆填**，而是程式在執行時寫進去的：

| 內容怎麼來 | 由誰寫 |
|---|---|
| 使用者註冊 → 新增 user | `auth.service.js` 的 `register()` |
| 學生提問 → 新增 question | `qa.service.js` 的 `askQuestion()` |
| 影片逐字稿 → 新增 segment | Python STT pipeline |
| demo 假資料 | `demoSeed.service.js` |

> 比喻：schema 像**蓋好有格局的房子**（幾房幾廳、房間怎麼連通）；家具要不要搬進來、怎麼擺，是住進去後（程式執行時）由程式邏輯決定，不是蓋房子時就擺好。

---

## 十六、`ObjectId + ref` 是什麼（MongoDB 版的外鍵）

做「表格之間關聯」的標準寫法，`ObjectId` 和 `ref` 搭配使用。

### `ObjectId` = 存「另一筆文件的 ID」

`ObjectId` 是每筆文件 `_id` 的型別（如 `ObjectId('69fb4d4c...')`）。欄位 `type` 設成 `ObjectId`，表示「這欄位存的是某一筆文件的 `_id`」。

### `ref` = 標註「這個 ID 指向哪張表」

```js
teacherId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',          // ← 這個 ID 指向 User 這張表
}
```

合起來：「`teacherId` 存的是一個 ID，這個 ID 指向 `users` 表裡的某一筆。」

### 用 SQL 類比 = 外鍵

| 概念 | SQL | MongoDB（Mongoose） |
|---|---|---|
| 關聯欄位 | `teacher_id INT` | `teacherId: { type: ObjectId }` |
| 指向哪張表 | `FOREIGN KEY ... REFERENCES users(id)` | `ref: 'User'` |

### 為什麼只存 ID、不存整筆資料？

避免重複、好維護：

```js
// ❌ 不好：把整個老師資料複製進課程（老師改名要改所有課程）
course = { title: '...', teacher: { name: '王老師', email: '...' } }

// ✅ 好：只存老師 ID，要用時再撈（老師資料只有一份）
course = { title: '...', teacherId: ObjectId('69dbcc...') }
```

> 比喻：`teacherId` 像通訊錄只存「電話號碼」，不是把整個人複製一份；要找人時用號碼去查。

### 怎麼把關聯資料撈出來？→ `populate`

```js
const course = await Course.findById(id).populate('teacherId', 'name email');
// 撈之前：teacherId = ObjectId('69dbcc...')
// 撈之後：teacherId = { name: '王老師', email: '...' }   ← 自動換成完整資料
```

### 專案裡的關聯欄位

```js
// course.model.js
teacherId: { type: ObjectId, ref: 'User' }      // 課程 → 老師
// video.model.js
courseId:   { type: ObjectId, ref: 'Course' }   // 影片 → 課程
uploadedBy: { type: ObjectId, ref: 'User' }     // 影片 → 上傳者
// enrollment.model.js
studentId: { type: ObjectId, ref: 'User' }      // 選課 → 學生
courseId:  { type: ObjectId, ref: 'Course' }    // 選課 → 課程
```

### ⚠️ 跟 SQL 外鍵的重要差異

MongoDB 的 `ref` **不會強制檢查**——存一個不存在的 ID，MongoDB 不會報錯。要不要驗證 ID、要不要 populate，都要程式自己處理。所以專案用 `assertObjectId()` 驗證傳入的 ID 格式。

---

## 十七、釐清：`ObjectId + ref`（關聯）vs 向量索引

**這是兩個完全不同的東西**，容易混淆，評審也可能戳。

| | `ObjectId + ref`（關聯） | 向量索引（vector index） |
|---|---|---|
| 用途 | **連結不同表**（誰屬於誰） | **語意相似度搜尋** |
| 像什麼 | 外鍵 / 通訊錄存電話 | Google 搜尋「意思相近」 |
| 作用欄位 | `teacherId`、`courseId` 這種 ID 欄位 | `embedding` 那個向量欄位 |
| 怎麼用 | `.populate()` 撈出完整資料 | `$vectorSearch` 算相似度 |

它們**沒有依賴關係**：

```js
// 這是「關聯」(ObjectId + ref) —— 跟向量無關
courseId: { type: ObjectId, ref: 'Course' }   // 這段片段屬於哪堂課

// 這才是「向量」—— 跟關聯無關
embedding: { type: [Number] }                 // 3072 維語意向量，向量索引建在這欄位上
```

### 但它們在 QA 時會「合作」

關聯負責「縮小範圍」，向量負責「找最像的」：

```
學生問問題（針對某堂課）
  ↓
① 用「關聯」過濾：course → video → segment，只挑「這堂課的片段」
   （用 courseId / videoId，就是 ObjectId 關聯）
  ↓
② 在這些片段裡，用「向量索引」算語意相似度，找最相關的幾段
   （用 embedding，就是向量搜尋）
  ↓
回傳答案 + 時間戳
```

Atlas 向量搜尋程式碼剛好同時用到兩者：

```js
$vectorSearch: {
  path: 'embedding',        // ← 向量索引（找最像的）
  filter: atlasFilter,      // ← 用 courseId/videoId 過濾（這是關聯欄位）
}
```

> 比喻（圖書館找書）：
> **關聯** = 先走到「正確的書架區」（這堂課的片段）；
> **向量索引** = 在那個書架上找「內容最相關的書」（語意最像的片段）。
> 先用關聯縮範圍，再用向量找答案——兩個都需要，但做的是不同的事。

## 十八、評審問答攻防（1–10 題）

> 每題格式：**Q**（評審問什麼）→ **A**（怎麼答）→ ⚠️ 誠實邊界。🔴 = 高風險／誠實陷阱題，答錯方向會扣分。

---

### 1. 向量搜尋（招牌題）🔴

**Q：** 你們說 QA 用 Atlas Vector Search 做語意搜尋——demo 當下真的跑在 Atlas 上嗎？我記得 `text_embedding_index` 已經不存在了，demo 到底走 atlas 還是 memory？怎麼證明？

**A（30 秒版）：** memory 和 atlas **兩種都已實作**，靠 `QA_VECTOR_SEARCH_MODE` 一個環境變數切換。demo 預設走 **memory**（資料只有 130 筆、毫秒級、又不依賴共享 Atlas 索引狀態，較穩）；但 atlas 這條路我們 **已實測可跑**。走哪個不用猜——每次問答的 `runtime.searchBackendUsed` 會記 `memory`/`atlas`，那是鐵證。

⚠️ **誠實邊界**：不能說「demo 正在用 Atlas」；要說「兩種都做、可切換，demo 走 memory，atlas 已驗證可跑」。

#### 深入版 ①：到底在「搜尋」什麼？

電腦不懂意思、只懂數字：每個片段的文字事先被 Gemini 轉成 **3072 個數字**（embedding 向量）＝語意座標；學生問題當下也轉成 **一個** 3072 維 query 向量（整句轉一個，不切開）；「找最像的」＝找哪個片段的數字跟問題的數字 **最接近**。

> 比喻：每段話是地圖上一個點，問題也是一個點，找 **離問題最近的點** 就是答案。

#### 深入版 ②：memory vs atlas 差在「誰來算距離」

| | memory（demo 預設） | atlas（雲端） |
|---|---|---|
| 誰算相似度 | 後端 Node.js 自己算 | MongoDB Atlas 雲端算 |
| 怎麼做 | 片段撈進記憶體，迴圈逐一算 | 丟 `$vectorSearch`，Atlas 用索引直接回 |
| 需要 Vector Index | ❌ 不需要 | ✅ 需要（`text_embedding_index`）|
| 適合 | 資料少、本機、demo 求穩 | 資料多、正式上線、要快 |

⚠️ 兩者是 **二選一的開關**，**不是兩個同時跑**。兩套程式碼都已實作，切換不用改 code。

#### 深入版 ③：memory 實際流程（對照程式碼）

1. **撈出「這堂課」的片段**（[qa.service.js:327](../../backend/src/services/qa.service.js#L327)）：`VideoSegment.find(...).lean()`，整包撈進後端記憶體。`.lean()` 跳過 Mongoose 包裝（hydration），實測 51 筆 8.8s→1s。
2. **逐一算 cosine**（[qa.service.js:277](../../backend/src/services/qa.service.js#L277)）：迴圈算每個片段跟問題的餘弦相似度（0~1，越接近 1 越像）。
3. **排序取前幾名**：由高到低排序，取最相關幾段＋時間戳丟給生成模型。

> 💡 「取前 3」的 `QA_MATCH_LIMIT=3` 兩種模式共用，但位置不同：memory 是後端算完再 `.slice(0,3)`（[qa.service.js:305](../../backend/src/services/qa.service.js#L305)）；atlas 是把 `limit:3` 寫進 `$vectorSearch`、由雲端回前 3，還多了 `numCandidates:15` 先挑候選（ANN 作法，memory 沒有）（[qa.service.js:408](../../backend/src/services/qa.service.js#L408)）。

#### 深入版 ④：「符合範圍（scope）」怎麼抓？—— bridge 接力鏈

片段 **身上沒有 courseId**（pipeline 寫的，只記 `videoId`），所以不能直接 `find({ courseId })`，必須隔著「影片」這層接力：

```
course.videoIds → videos._id → videos.videoId → video_segments_text.videoId
   (這堂課)          (找到影片)       (影片字串ID)          (片段認這個ID)
```

程式碼在 [bridgeScope.service.js](../../backend/src/services/bridgeScope.service.js)，因 backend/pipeline 命名不一致（`videoId`/`video_id`/`_id`）會同時比對多種 key 並去重。**關聯負責縮範圍，向量負責找最像的。**

#### 深入版 ⑤：目前已驗證狀態（2026-06-05）★

| 項目 | 舊筆記說 | 實查結果 |
|---|---|---|
| `text_embedding_index` | 不存在、需重建 | ✅ **存在且 status=READY**（3072 維、130 筆）|
| atlas 模式能不能跑 | 不能 | ✅ **實測通過** |

實測打「openCV 是什麼?」：`searchBackendUsed: atlas`、`scoringMode: vector`、命中 3 段、最高 **0.90**、答案附時間戳。→「索引不存在、atlas 不能跑」是 **過時資訊**。

---

### 2. 答案可信度（門檻 / 防硬掰）

**Q：** 那題相似度只有 0.65 就回「資料不足」。門檻是多少？寫死的嗎？萬一相關片段都只有 0.5 左右，怎麼避免模型硬掰一個看似合理但錯的答案？

**A：系統沒有「相似度 ≥ 0.x」的數字門檻，靠兩段把關。**

**第 1 關（搜尋）— 只看 `score > 0`**（[qa.service.js:303](../../backend/src/services/qa.service.js#L303)）
```js
.filter((item) => item.score > 0)                 // 只要分數 > 0 就保留
.sort((left, right) => right.score - left.score)  // 由高到低
.slice(0, env.qaMatchLimit)                       // 取前 3
```
→ 唯一的「數字」是 `QA_MATCH_LIMIT=3`，**不是相似度門檻**。0.6487、0.5、0.9 全都通過這關。

**第 2 關（生成）— 交給 LLM 判斷**（[answerGeneration.service.js:47](../../backend/src/services/answerGeneration.service.js#L47)）

prompt 給 Gemini 的規則（原始檔行內編號）：
> 1. 只能根據「可用資料庫片段」回答。
> 2. 不可以使用外部知識、常識、推測或補充說明。
> 5. 如果片段沒有直接支持答案，請只回答：「目前資料庫片段不足以回答這個問題。」

→「資料不足」**不是分數低被擋下**，而是 LLM 讀完判斷「沒有直接回答到」，照規則 5 主動說。**是語意判斷，不是數字門檻。**

> 💡 鐵證：同一題「openCV」，舊紀錄 0.6487 回資料不足、atlas 實測用真 Gemini embedding 拿到 **0.90** 就正常答出 → 分數低多半是 embedding 或內容涵蓋問題，不是門檻擋掉。

⚠️ **誠實邊界**：別說「門檻設 0.x」（根本沒有這數字），要說「top-3 + LLM grounding 規則防硬掰」。

---

### 3. 密碼安全（bcrypt cost factor）

**Q：** cost factor 用 10 怎麼決定的？實際量過幾毫秒嗎？10 在 2026 還夠嗎？

**A：依「業界建議區間 + 實測」決定，且 cost 是可調參數。**

- **依據**：OWASP/業界慣例單次雜湊落在 **~50–250ms** 合理；`bcryptjs` 預設也是 10。
- **實測（本機 2026-06-05）**：

```
cost=10 → 62.0 ms   ← 我們用的
cost=11 → 117.0 ms
cost=12 → 237.2 ms
cost=13 → 466.8 ms
compare(10) → 58.8 ms
```

每 +1 約 **翻倍**（2ⁿ）；cost=10 的 62ms 正落在建議區間下緣。
- **夠不夠**：對教學平台足夠；硬體變快就把 10→11→12（成本翻倍），不動架構。權衡點是登入端 CPU 負載。

⚠️ **誠實邊界**：目前 cost **寫死 10**（[auth.service.js:45](../../backend/src/services/auth.service.js#L45)），未做動態調整 / 登入 re-hash 升級；實測數字來自開發機。

---

### 4. JWT 撤銷（停權 / 登出怎麼讓 token 失效）🔴

**Q：** JWT 效期 7 天、payload 只放 userId。使用者被停權或登出，那張沒過期的 token 怎麼作廢？有撤銷機制嗎，還是只能等 7 天？

**A：分兩種層級，不是一句「只能等 7 天」。**

**✅ 帳號層級（停權/刪帳號）→ 幾乎即時** — `authenticate` **每個請求都回 DB 撈 user 並查狀態**（[auth.middleware.js:18](../../backend/src/middleware/auth.middleware.js#L18)）：
```js
const payload = jwt.verify(token, env.jwtSecret); // ① 先驗章
const user = await User.findById(payload.sub);    // ② 再回 DB 撈本人
if (!user || !user.isActive) { /* 401 UNAUTHORIZED */ }
```
admin 把 `isActive` 設 false → 他**下一個請求**就被擋；帳號被刪 → `findById` 回 null → 一樣立刻擋。

#### 深入：這其實是「半狀態化的 JWT」

純無狀態 JWT 的理念是「**只驗章、不查 DB**」——快，但代價是 token 一旦發出，效期內無法收回。你們刻意**多走了第 ② 步（每請求查 DB）**，等於把 JWT 退化成「**用 token 當索引去查一次 session**」。這個取捨值得講清楚：

| | 純無狀態 JWT | 你們的做法（驗章 + 查 DB） |
|---|---|---|
| 速度 | 最快，零 DB | 每請求一次 `findById` |
| 帳號撤銷 | ❌ 只能等過期 | ✅ 下一個請求即時生效 |
| 水平擴展 | 完美（不依賴共享狀態） | 仍可，但每節點都要連 DB |
| 適合 | 超大流量、可容忍延遲撤銷 | 中小規模、要即時控管權限 |

→ 所以「7 天效期」聽起來很長，但因為**每個請求都重新對 DB 驗 `isActive`**，帳號層級的安全控制其實是即時的，7 天只影響「**沒被停權、token 又外洩**」這個情境。

**❌ 單張 token 層級（個別撤銷 / 登出立即失效）→ 目前沒做**

沒有 token 黑名單、沒有 server 端 logout、沒有 `tokenVersion`。「登出」是前端丟掉 token；被偷的未過期 token 無法只撤一張，只能停權該 user（他**所有**裝置一起失效）或等過期。

#### 深入：補強方向與各自代價

- **`tokenVersion` / `passwordChangedAt`**：user 文件存一個版本號，簽進 token；改密碼/登出時 +1，middleware 比對不符就拒。**幾乎零成本**（反正已經在查 DB），是這裡 CP 值最高的補法。
- **Redis jti 黑名單**：存「已撤銷 token 的 id 直到過期」。能精準撤單張，但**多一個 Redis 依賴**。
- **縮短效期 + refresh token**：access token 改 15 分、refresh 7 天。撤銷窗口小，但要實作 refresh 流程。

⚠️ **誠實邊界**：① 「單獨作廢某張未過期 token / 登出即時失效」沒做。② `env.jwtSecret` 預設值是 `'change-me-in-local-env'`（[env.js:13](../../backend/src/config/env.js#L13)）——**正式部署一定要用環境變數覆蓋成高熵密鑰**，否則簽章可被偽造，整套驗證形同虛設。

> **一句話（評審版）**：我們不是純無狀態 JWT，而是「驗章 + 每請求查 DB 的 `isActive`」，所以**帳號停權/刪除是即時生效**的；只差「個別 token 撤銷」，補一個 `tokenVersion` 就能解，因為查 DB 的成本本來就付了。

---

### 5. 授權 vs 認證（role 怎麼拿、代價）

**Q：** JWT payload 刻意不放 role。每次請求要判斷「是不是老師」時怎麼拿到角色？代價是什麼？

**A：role 不放進 JWT，每次請求從 DB 即時撈。**

#### 深入：先分清「認證」和「授權」是兩件事

- **認證（Authentication，你是誰）**：`authenticate` 驗 token + `findById` → 確認身分，把完整 user 掛上 `req.user`（含 `role`）。
- **授權（Authorization，你能做什麼）**：`requireRole(...roles)` 只是一個 guard，檢查 `req.user.role` 在不在允許清單（[role.middleware.js:9](../../backend/src/middleware/role.middleware.js#L9)）。

route 上的掛載順序固定是 **`authenticate` → `requireRole`**——必須先知道你是誰，才能判斷你能不能做。`role` 全程來自**那一次的 DB 讀取**，不是來自 token。

#### 深入：為什麼「role 不放 token」是刻意的

如果把 `role` 簽進 token，會有個經典漏洞：**admin 把某人從 teacher 降成 student 後，他手上那張舊 token 仍寫著 `role: teacher`，效期內可繼續用老師權限**。把 role 留在 DB、每請求現撈，就**從根本避免「stale role」**——降權下一個請求立刻生效。

| | role 放 token | role 放 DB（你們） |
|---|---|---|
| 改角色生效 | ❌ 要等 token 過期 | ✅ 立即 |
| 每請求成本 | 0（token 自帶） | 一次 DB 查詢 |
| 偽造風險 | 靠簽章保護 | 不存在（不在 token 裡） |

- **代價**：每請求多一次 DB 查詢——但這查詢 `authenticate` **本來就要做**（為了驗 `isActive`），順手把 `role` 一起拿回來，等於**沒有額外成本**。這跟第 4 題是同一個設計：用「每請求查 DB」一次換來「即時撤銷 + 即時改權」兩個好處。
> 💡 **釐清：是「查一次 DB」，不是「查兩個東西／查兩次」。** `findById(payload.sub)` 一次就撈回 **整筆 user 文件**（`name`、`email`、`role`、`isActive`… 全部欄位一起回來）。`isActive` 和 `role` 只是這筆文件上的 **兩個欄位、兩種用途**：
> - `isActive` → 決定「**能不能進來**」，`authenticate` 當場檢查，false 就擋 401。
> - `role` → 決定「**能做什麼**」，留給之後的 `requireRole` 判斷權限。
>
> 撈資料 **一次**，用途 **兩個**——這就是「成本一次、好處兩個（即時撤銷＋即時改權）」的由來。
> 比喻：刷門禁卡時，系統用卡號撈出你 **整張員工檔（一次查詢）**，同時看到「在職狀態」（=`isActive`，離職就擋在門口）和「職級」（=`role`，要進高權限房間時才用）。


⚠️ **誠實邊界**：① 無法純靠驗章離線授權（一定要連 DB）。② 目前**學生對課程的存取是放寬的**——`courseAccess.service.js` 裡 enrollment-only 的學生限制被註解掉、暫時 `return true`（demo 期間方便測試），正式上線應恢復「學生只能存取已選課程」。授權的**角色層**是嚴謹的，但**資源層（哪個學生能看哪堂課）目前偏寬**，這點要誠實講。

> **一句話**：認證和授權拆開，role 每次從 DB 現撈以避免 stale role、改權即時生效，成本與認證共用一次查詢；但學生的課程級存取目前為 demo 放寬，需上線前收緊。

---

### 6. 向量維度成本（memory 能撐多少 / `.lean()` 解決什麼）

**Q：** embedding 3072 維、片段 130 筆。memory 把全部撈進記憶體算 cosine——能撐到幾筆？1 萬、10 萬筆會怎樣？`.lean()` 解決了什麼、又沒解決什麼？

**A：memory 是暴力法（brute-force / 線性掃描），撐得住現在但不撐規模；`.lean()` 治標不治本。**

#### 深入：先算清楚成本量級

每次提問，memory 模式要做的事：

```
① 把範圍內所有片段的 embedding 載進記憶體   → 記憶體 = n 筆 × 3072 × 8 bytes(float)
② 對每一筆算一次 cosine（O(3072) 點積）     → 計算 = O(n × 3072)
```

cosine 的實作（[qa.service.js:80-99](../../backend/src/services/qa.service.js#L80)）就是「點積 ÷ (兩邊模長相乘)」，**每筆都要把 3072 個數字乘加一遍**。換算記憶體：

| 片段數 | 記憶體（約） | 單次計算 | 體感 |
|---|---|---|---|
| 130（現在） | ~3 MB | 13 萬次乘加 | 毫秒級 ✅ |
| 1 萬 | ~240 MB | 3000 萬次 | 開始慢、吃 RAM ⚠️ |
| 10 萬 | ~2.4 GB | 3 億次 | 記憶體＋延遲爆 ❌ |

而且這是**每一次提問都重來一遍**（沒有快取片段向量、也沒快取 query 向量）。

#### 深入：`.lean()` 到底治了哪一段、沒治哪一段

- **治的**：`.lean()` 省掉 Mongoose 的 hydration（把每筆 3072 數字包成「功能完整物件」的開銷），實測 51 筆 8.8s→1s。它優化的是上面流程的 **①「撈出來的處理成本」**。
- **沒治的**：它**沒有**減少「要載入多少資料」和「要算多少次」。瓶頸隨資料量上升會從 hydration 轉移到 **記憶體佔用 + O(n) 線性掃描**，`.lean()` 對這兩個無能為力。
- 另外還有一段沒被 `.lean()` 影響的成本：**每次提問都要呼叫 Gemini 把問題轉成向量**（實測 ~780ms 的網路往返），這跟片段數無關，但也是延遲來源。

#### 深入：為什麼規模化的答案是 atlas 而不是「再優化 memory」

memory 的天花板是「**逐一比對**」這個演算法本質（線性）。Atlas Vector Search 用的是 **ANN（近似最近鄰）索引**，預先把向量組織成特殊結構，查詢時**不用掃過全部**就能找到最近的幾個（次線性）——這才是百萬級資料的正解。所以正確結論是「**換引擎（atlas）**」，不是「把 memory 調快」。

⚠️ **誠實邊界**：memory 對現在的 130 筆是最佳解（快、穩、零依賴），但它是 O(n) 暴力法；規模化必須切 atlas 的 ANN 索引，`.lean()` 只是讓小資料下夠用，不是擴展性解法。

> **一句話**：memory 是線性暴力比對，130 筆毫秒級但每請求重算、記憶體與時間都隨 n 線性成長；`.lean()` 省的是 hydration、救不了載入量與掃描次數，真正擴展靠 atlas 的 ANN 索引。

---

### 7. Mixed collection 風險（為何不拆 / 忘了過濾會怎樣）

**Q：** `videos` 同住 app-owned 和 pipeline metadata，靠欄位區分。為何不拆兩個 collection？查詢忘了加區分條件會怎樣？

**A：不拆是為對齊 pipeline 寫入；風險靠 model 的 static 判斷方法集中控管。**

#### 深入：兩種文件到底長什麼樣、怎麼區分

[video.model.js:16-28](../../backend/src/models/video.model.js#L16) 用兩個 static 函式做判斷，依據是「**有沒有 app 該有的那組欄位**」：

```js
isAppOwnedVideoRecord(v) =
  v.courseId && v.uploadedBy && v.title && v.processing?.status   // 四個都要有
isPipelineMetadataRecord(v) =
  (v.videoId || v.video_id) && !isAppOwnedVideoRecord(v)         // 有字串 id、但不是 app 的
```

- **App-owned**：老師上傳/貼 URL 產生，有完整的 `courseId`/`uploadedBy`/`title`/`processing`。
- **Pipeline metadata**：Python 寫的，只帶 `videoId`/`video_id`（還偏 snake_case），缺 app 那組欄位。

#### 深入：為什麼「忘了過濾」其實沒想像中危險

關鍵觀察：**pipeline metadata 沒有 `courseId`**。所以最常見的查詢 `Video.find({ courseId })`（QA bridge、列課程影片都用這個）**天然就過濾掉了 pipeline 文件**——它們根本不符合條件。真正會出事的是**無條件查詢**：

```js
Video.find({})        // ⚠️ 這種會把兩種文件一起撈出來
```

例如後台「列出所有影片」若不加判斷，就可能把 pipeline metadata 當成 app 影片顯示（出現沒有 title/processing 的怪列）或讓統計灌水。`admin.service.js` 的影片清單就用 `v.videoId || String(v._id)` 當 key、`v.title || v.fileName || 'Untitled'` 兜底，正是在處理這種混住。

#### 深入：還有一層歷史包袱的清理

[server.js](../../backend/src/server.js) 啟動時會做一次性遷移：把舊的 `video_id` 改名成 `videoId`、並把 app-owned 文件的 `videoId: null` `$unset` 掉（避免佔用 sparse unique index 的位置）。這說明「mixed collection」不只是讀取要小心，連**索引唯一性**都要特別處理。

#### 深入：一部影片只有「一筆」紀錄 —— pipeline 是補進同一筆，不是再開一筆

常見誤解：「上傳 + pipeline = 在 videos 寫兩筆」。**正常流程其實是一部影片一筆**，pipeline 只是把資料補進**同一筆**：

```
① 老師上傳（mp4 或 YouTube）
   → 後端 Video.create 建「一筆」，processing.status = queued
② 後端觸發 Python pipeline 做 STT
③ pipeline 回寫：
   ├─ 切片 + 向量 → 寫進「另一個 collection」video_segments_text（不是 videos）
   └─ 同一筆 video 的 processing.status → queued → processing → completed
```

→ `videos` 裡那部影片**始終是一筆**：app 部分（`courseId`/`title`/`processing`）和橋接用的 `videoId` 都在同一筆上；真正的內容（切片）放在 `video_segments_text`。**狀態機是「更新原本那筆」，不是新增。**

**關鍵程式碼：**

| 步驟 | 檔案 | 做什麼 |
|---|---|---|
| 上傳建一筆（檔案） | [video.service.js:152](../../backend/src/services/video.service.js#L152) | `Video.create({... processing.status: queued})` |
| 上傳建一筆（貼 URL） | [video.service.js:232](../../backend/src/services/video.service.js#L232) | 同上，另一條來源路徑 |
| queued → processing | [videoProcessing.service.js:100](../../backend/src/services/videoProcessing.service.js#L100) | `findByIdAndUpdate` 更新**同一筆** |
| processing → completed | [videoProcessing.service.js:120](../../backend/src/services/videoProcessing.service.js#L120) | 更新同一筆狀態 + 寫入 `videoId` 橋接 key |

> 💡 **系統還主動「防重複」**：完成處理要寫 `videoId` 時，會先把「**其他**也用這個 videoId 的紀錄」的 `videoId` `$unset` 掉，確保一個 videoId 只掛在一筆上（[videoProcessing.service.js:143-147](../../backend/src/services/videoProcessing.service.js#L143)）。啟動時的 `video_id → videoId` 遷移（[server.js:15-22](../../backend/src/server.js#L15)）也是把橋接 key 正規化到 app-owned 那筆——都是在**維持「一部影片一筆」**。

> 所以「混住兩種文件」是指**萬一**有 pipeline 自己多寫的殘留紀錄（pipeline-only）才會多一筆；**正常上傳→處理流程不會**。

⚠️ **誠實邊界**：這是「為了相容 pipeline 既有寫入而接受的技術債」。更乾淨的長期做法是**拆成兩個 collection**，或加一個明確的 `kind: 'app' | 'pipeline'` 欄位，而不是靠「有沒有某組欄位」隱性判斷。目前用 static 方法把判斷**集中在 model**，至少避免每個 service 各寫各的、各漏各的。

> **一句話**：共用 collection 是為對齊 pipeline 寫入；因 pipeline 文件沒 `courseId`，正常的帶條件查詢天然排除它，風險主要在無條件 `find({})`，我們用 model 的 static 判斷方法集中控管，並在啟動時做欄位/索引遷移。

---

### 8. 資料一致性（孤兒片段會怎樣）🔴

**Q：** 串接鏈 course → videos → videoId → segments，且 `ref` 不強制檢查。影片被刪但 segment 還在、或 videoId 對不上，QA 會怎樣？會回傳孤兒片段嗎？

**A：因為 scope 是「從影片反推」，孤兒片段天然被排除，不會被當答案。三層防護。**

#### 深入：第一層 — scope 的方向決定了孤兒進不來

QA 的搜尋範圍是**從 `videos` 出發**建的（course → videos → 收集 videoId → 撈 segments）。所以邏輯上：

```
影片記錄還在 → 它的 videoId 會被收進 scope → 它的 segment 才會被搜尋
影片記錄被刪 → 收不到那個 videoId → 它的 segment 根本進不了 scope（= 被無視）
```

換句話說，**孤兒片段（有 segment、但對應的 video 不存在）不會被納入搜尋**，因為 scope 不是「列出所有 segment」，而是「列出**現存影片**的 segment」。這是設計上就避開了孤兒，不是靠事後過濾。

#### 深入：第二層 — 刪影片時連帶清理（從源頭不留孤兒）

[admin.service.js:201-216](../../backend/src/services/admin.service.js#L201) 的 `deleteVideo` 是**連帶刪除**：

```js
await VideoSegment.deleteMany({ videoId: segmentKey });                       // 刪片段
await db.collection('transcripts_normalized').deleteMany({ video_id: segmentKey }); // 連逐字稿也刪
await Video.deleteOne({ _id: videoId });
await Course.findByIdAndUpdate(video.courseId, { $pull: { videoIds: video._id } }); // 從課程移除引用
```

→ 影片、片段、正規化逐字稿、課程裡的 `videoIds` 引用**一起清**，從源頭就不製造孤兒。（但**刻意保留** UsageLog/Question 歷史紀錄，見下。）

#### 深入：第三層 — 歷史紀錄的「內容已下架」標記

問答歷史（`questions`/`usage_logs`）不隨影片刪除，所以**舊紀錄可能引用到已不存在的片段**。後台 `getRecentEvents`（[admin.service.js:150-170](../../backend/src/services/admin.service.js#L150)）用一個 regex 解析 `segmentId` 裡的 videoId、批次查 Video 是否還在，**標記 `contentMissing: true`**——讓「答案的來源影片已下架」這件事在後台被誠實呈現，而不是裝沒事。

#### 深入：保險絲 — scope 空了也不硬湊

就算極端情況 scope 是空的（影片都沒了但 segment 還在），`qa.service.js` 有 `if (!scopedVideos.videos.length)` → 直接回 `no_searchable_segments`，**不會把孤兒片段塞給 LLM 當依據**。

⚠️ **誠實邊界**：MongoDB 的 `ref` 確實不強制外鍵，理論上仍可能存在「videoId 對不到任何 video」的真孤兒片段（例如 pipeline 寫了 segment 但 app 端沒有對應 video）。但因為 scope 從 video 端建立，這些片段**進不了搜尋**，最壞結果是「**查無相關資料**」，**不會變成錯誤答案**——這是這個設計最關鍵的安全性質。

> **一句話**：scope 從影片端建立（孤兒天然被無視）＋刪影片連帶刪片段/逐字稿（源頭不留孤兒）＋歷史紀錄標「內容已下架」＋空範圍保險絲，四層讓孤兒片段最多造成「查不到」，絕不會回錯答案。

---

### 9. LINE 綁定安全（QR 攔截 / token 在 URL）🔴

**Q：** `line_bind_tokens` 一次性、10 分過期。綁定那刻怎麼確定「掃碼這支 LINE」是本人而非攔截 QR 的人？token 在 URL 傳遞會洩漏嗎？

**A：`lineUserId` 由 LINE 加密背書（不可偽造），真正的弱點是 token 是 bearer token、洩漏會綁錯人；用四重機制把窗口與損害壓到很小。**

#### 深入：綁定連接的是「兩個身分」，信任來源不同

綁定本質是建立對應：**系統帳號 `record.userId` ↔ LINE 帳號 `lineUserId`**。

| 身分 | 哪來的 | 為什麼可信 |
|---|---|---|
| `record.userId`（系統帳號） | 產生 token 時寫入（[line.service.js:117](../../backend/src/services/line.service.js#L117)）| 登入中的學生點「取得綁定碼」才產生 → **JWT 認證背書** |
| `lineUserId`（LINE 帳號） | LINE 平台給 | **LINE 背書**：LIFF 路徑由 LIFF SDK 取得；傳 token 給 Bot 的路徑由 **webhook 簽章** 保護 |

→ 所以「冒充 `lineUserId`」很難（兩條路都由 LINE 加密背書）。評審問的「會不會被別人冒充」，答案是**身分本身難冒充**，弱點在 token。

#### 深入：真正的威脅 — bearer token 模型

綁定 token 是 **bearer token（持有即有權）**：誰拿到那 64 字元、誰就能完成綁定，系統不會再問「你是不是當初產生它的人」。攻擊情境：

```
1. 受害者（登入中）產生 token → 包進 QR URL
2. 攻擊者在 10 分鐘內拿到 token（肩窺 QR、URL 從歷史/截圖外洩、側錄…）
3. 攻擊者用「自己的 LINE」掃碼/傳 token
4. 綁定結果 = 受害者的系統帳號 ↔ 攻擊者的 LINE   ← 綁錯人
5. 攻擊者的 LINE 能以受害者身分透過 Bot 提問
```

#### 深入：程式碼裡的四重防護

| 防護 | 程式碼 | 擋什麼 |
|---|---|---|
| 256-bit 隨機 | `crypto.randomBytes(32)`（[:118](../../backend/src/services/line.service.js#L118)）| 暴力猜 token 不可能 |
| 10 分過期 | `expiresAt` + TTL index（[:119](../../backend/src/services/line.service.js#L119)、[:135](../../backend/src/services/line.service.js#L135)）| 壓縮攔截窗口 |
| 一次性即刪 | `deleteOne({ token })`（[:160](../../backend/src/services/line.service.js#L160)）| 防重放 |
| 唯一綁定（踢舊） | `updateMany({ lineUserId, _id:{$ne} }, {$unset})`（[:143](../../backend/src/services/line.service.js#L143)）| 一支 LINE 只能綁一個帳號，換綁自動解除舊的 |

> 💡 那個 `updateMany` 是亮點：綁定前先把「這支 `lineUserId` 綁在別帳號」的舊紀錄 `$unset` 掉，保證 `lineUserId` 唯一（配合 schema `unique+sparse`），不留髒資料；受害者也能用它**重綁回自己的 LINE 踢掉攻擊者**。

#### 深入：為什麼 MVP 可接受、損害有限

1. **正常窗口極小**：學生在自己螢幕產生 QR、用自己手機幾秒掃完，token 從沒離開掌控。
2. **損害侷限**：綁錯只給「Bot 提問權」，**不是網頁帳號接管**——攻擊者無法登入網頁、改密碼（那是另一條 JWT）。
3. **可補救**：重綁機制踢掉攻擊者。

⚠️ **誠實邊界**：沒驗證「掃碼者 = 產生 token 者」（bearer token 先天限制）；token 走 URL 可能經瀏覽器歷史/Referer/截圖外洩；沒有 out-of-band 二次確認。更強做法：改用 LINE Login OIDC `id_token` 直接拿已驗證 `lineUserId`（少一個 token 在外流動）、綁定後對網頁端推確認、token 綁發起裝置。

> **一句話**：`lineUserId` 由 LINE/LIFF 與 webhook 簽章背書、冒充很難；真正風險是 bearer token 在 10 分內洩漏會綁錯人，我們用 256-bit 隨機＋10 分過期＋一次性即刪＋唯一綁定踢舊把窗口和損害壓到很小，且綁錯也只是 Bot 提問權、非帳號接管。

---

### 10. 多模態的真實進度 🔴

**Q：** 你們提到 `video_segments_video`、`video_segments_audio`。這兩個真的接進 QA 了嗎，還是只建了 collection？目前其實只用文字片段對吧——「多模態」會不會言過其實？

**A：誠實說——目前 QA 只用文字片段，影片/音訊向量只是預留 schema，還沒接進 QA。**

#### 深入：用證據說話

- **程式碼證據**：全 backend `grep` 過，**完全沒有任何檔案引用** `video_segments_video` / `video_segments_audio`。QA 的搜尋（memory 與 atlas 兩條路）都只跑 `video_segments_text`。
- **資料證據**：`video_segments_video` 16 筆（pipeline 寫的影片向量）、`video_segments_audio` 0 筆（空）。它們有 schema、有資料表，但**沒有被任何問答流程讀取**。
- **契約證據**：v1 資料庫契約刻意採**分 collection 設計**（text/video/audio 各自的 embedding + 各自的向量索引），這是**為未來多模態鋪的路**，不是「已經是多模態」。

#### 深入：怎麼講才精準（不過頭也不貶低自己）

| 講法 | 可不可以 |
|---|---|
| 「我們的**資料底層已為多模態鋪好路**（text/video/audio 分 collection 存向量）」 | ✅ 可以，這是事實 |
| 「Phase 1 MVP 的 QA **主線只用文字片段**，影片/音訊是下一階段才接」 | ✅ 誠實 |
| 「我們**現在就是多模態問答**」 | ❌ 言過其實 |
| 「`video_segments_video` 已是正式 multimodal QA source」 | ❌ CLAUDE.md 明文禁止 |

#### 深入：為什麼這樣設計仍有價值

把 text/video/audio **拆開存、各建索引**，比塞進同一個 collection 更好——未來要接影片或音訊向量時，**不用改動現有文字 QA 的結構**，只要在搜尋層多查一個 collection、再做結果融合（fusion）即可。所以「預留」不是空話，是**有意義的架構鋪墊**，只是實作排在 Phase 1 之後。

⚠️ **誠實邊界**（CLAUDE.md 明文禁止）：不能說 `video_segments_video` 已成為正式 multimodal QA source。講「架構支援多模態、目前實作只做文字」可以；講「已經是多模態問答」不行。

> **一句話**：目前是「**架構支援多模態、實作只做文字**」——資料層用分 collection 為多模態鋪好路（且已有影片向量 16 筆），但 QA 主線只讀 `video_segments_text`，影片/音訊向量尚未接入問答，這點絕不誇大。
