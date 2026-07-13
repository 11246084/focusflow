# 資料庫規範

> 適用範圍：`backend/src/models/`、`STT_Whisper/src/mongodb_uploader.py`

---

## 技術背景

本專案使用 **MongoDB + Mongoose**（文件型資料庫），**沒有** SQL 式的 Migration 機制。Schema 變更透過 Mongoose Schema 定義直接生效，不需要遷移腳本。

---

## 集合（Collection）命名

Mongoose 會自動將 Model 名稱轉為**小寫複數**作為集合名稱：

| Model 名稱 | 集合名稱 |
|------------|----------|
| `User` | `users` |
| `Course` | `courses` |
| `Video` | `videos` |
| `VideoSegment` | 由 `VIDEO_SEGMENT_COLLECTION` 環境變數決定（預設 `video_segments_text`） |
| `Enrollment` | `enrollments` |
| `Clip` | `clips` |
| `UsageLog` | `usagelogs` |
| `LineBindToken` | `linebindtokens` |
| `Faq` | `faqs` |

目前 repo 內已有明確理由的例外：

- `VideoSegment`：collection 名稱由 `VIDEO_SEGMENT_COLLECTION` 環境變數決定（預設 `video_segments_text`，Schema 中直接使用 `collection: env.videoSegmentCollection`）。這是為了對齊 AI Pipeline 寫入的 collection 名稱，並允許部署時切換不同 collection。

若未來新增 Mongoose model，仍以預設小寫複數命名為優先，除非要對齊既有資料庫契約。

---

## Schema 欄位規範

### 命名
- 所有欄位使用 **camelCase**（與 JavaScript 一致）
- 關聯欄位命名為 `xxxId`（如 `courseId`、`uploadedBy`）

### 必要設定
```js
// 字串欄位加 trim，避免前後空白
name: { type: String, required: true, trim: true }

// Email 加 lowercase，統一存小寫
email: { type: String, lowercase: true, unique: true }

// 列舉值一律從 constants/enums.js 取得
role: { type: String, enum: USER_ROLE_VALUES, default: USER_ROLES.STUDENT }

// Schema 一律啟用 timestamps
}, { timestamps: true })
```

### 關聯
- 外鍵使用 `mongoose.Schema.Types.ObjectId` + `ref`
- 一律透過 `assertObjectId` 驗證傳入的 ID 格式，不信任原始字串

---

## Schema 變更流程（取代 Migration）

MongoDB 是無 Schema 資料庫，但仍需注意向下相容性：

1. **新增欄位**：在 Schema 加上 `default` 值，舊文件自動套用預設值
2. **重新命名欄位**：在 service 層同時讀取新舊欄位名稱，待確認所有文件更新後再移除舊欄位讀取
3. **移除欄位**：從 Schema 移除即可，MongoDB 不會報錯，舊資料會被忽略
4. **結構性變更**（如欄位型別更改）：需在 `demoSeed.service.js` 同步更新示範資料

變更 Schema 後務必更新對應的 `demoSeed.service.js` 與測試 harness（`tests/helpers/backendTestHarness.js`）。

---

## 索引（Index）使用原則

### 唯一索引
```js
// 用於需要唯一性保證的欄位
email: { type: String, unique: true }

// sparse: true 允許多筆 null 值（LINE userId 未綁定時為 null）
lineUserId: { type: String, unique: true, sparse: true }
```

### 一般索引
目前由 Mongoose 自動建立唯一索引。若新增查詢頻繁的欄位，在 Schema 層加入索引：
```js
// 單欄位索引
courseSchema.index({ teacherId: 1 });

// 複合索引（查詢同時過濾多欄位時使用）
videoSegmentSchema.index({ courseId: 1, startSec: 1 });
```

### 向量索引（Atlas Vector Search）
目前正式契約請參考：

- `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1.md`

正式 v1 契約採分 collection 設計：

- `video_segments_text.embedding` → `text_embedding_index`
- `video_segments_video.embedding` → `video_embedding_index`

舊版 `video_segments.vector_index` 視為 legacy。  
本機開發使用 `QA_VECTOR_SEARCH_MODE=memory`，不需要 Atlas Vector Search Index。

### 索引原則
- 不要為每個欄位都建索引，只對**高頻查詢的過濾/排序欄位**建立
- 唯一性需求優先使用 `unique: true`，不要在 service 層自行查重
- 避免在大集合上建立過多複合索引（影響寫入效能）

---

## 資料存取規範

- **所有資料庫操作在 service 層**，controller 不直接操作 Model
- 查詢結果勿直接回傳給前端，透過 `toPublicUser` 等 mapper 過濾敏感欄位
- 使用 `findById` 而非 `findOne({ _id: id })`，語意更清楚
- 需要 populate 時，在 service 層鏈式呼叫 `.populate('fieldName')`
