# API 設計規範

> 適用範圍：`backend/src/routes/`、`backend/src/controllers/`、`backend/src/services/`

---

## 命名規則

### URL 路徑
- 使用**小寫 kebab-case**，名詞複數形式
- 資源巢狀深度不超過兩層

```
/api/v1/courses                        ✅
/api/v1/courses/:courseId/videos       ✅
/api/v1/courses/:courseId/videos/:videoId/segments/chunks  ❌ 太深
```

### JavaScript 變數與欄位
- 所有 JS 變數、函式名稱、JSON 欄位一律使用 **camelCase**
- MongoDB 文件欄位同樣使用 camelCase（Mongoose 預設）

```js
// ✅
const courseId = req.params.courseId;
res.json({ videoId, startSec, endSec });

// ❌
const course_id = req.params.course_id;
```

### HTTP 動詞對應
| 操作 | 動詞 | 範例 |
|------|------|------|
| 取得列表 | GET | `GET /api/v1/courses` |
| 取得單筆 | GET | `GET /api/v1/courses/:courseId` |
| 建立 | POST | `POST /api/v1/courses` |
| 完整更新 | PUT | `PUT /api/v1/courses/:courseId` |
| 部分更新 | PATCH | `PATCH /api/v1/courses/:courseId` |
| 刪除 | DELETE | `DELETE /api/v1/courses/:courseId` |
| 動作型操作 | POST | `POST /api/v1/videos/:videoId/processing/retry` |

---

## 統一 JSON 回應格式

所有回應必須透過 `utils/apiResponse.js` 中的 `sendSuccess` 或 `buildErrorResponse` 產出，**不可直接 `res.json()` 自訂格式**。

### 成功回應

```json
{
  "success": true,
  "message": "OK",
  "data": { ... },
  "meta": { "total": 42, "page": 1 }
}
```

- `data`：選填，單筆資源或陣列
- `meta`：選填，分頁或統計資訊
- `message`：簡短說明，英文

```js
// controller 內的寫法
return sendSuccess(res, {
  statusCode: 201,
  message: 'Course created.',
  data: course,
});
```

### 錯誤回應

```json
{
  "success": false,
  "message": "驗證失敗的說明",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": ["title is required"]
  }
}
```

- `details`：選填，開發環境才回傳（`error.middleware.js` 自動處理）

```js
// service 內拋出錯誤
throw new AppError('Course not found.', 404, 'COURSE_NOT_FOUND');
```

---

## 標準化錯誤碼（Error Codes）

| 錯誤碼 | HTTP 狀態 | 使用情境 |
|--------|-----------|----------|
| `UNAUTHORIZED` | 401 | 未提供 Token 或 Token 無效 |
| `INVALID_TOKEN` | 401 | Token 格式錯誤或已過期 |
| `FORBIDDEN` | 403 | 無此資源的操作權限 |
| `VALIDATION_ERROR` | 400 | 輸入參數不合規（含 Mongoose 驗證失敗） |
| `INVALID_ID` | 400 | MongoDB ObjectId 格式錯誤（CastError） |
| `NOT_FOUND` | 404 | 資源不存在 |
| `COURSE_NOT_FOUND` | 404 | 課程不存在 |
| `VIDEO_NOT_FOUND` | 404 | 影片不存在 |
| `DUPLICATE_RESOURCE` | 409 | 資源已存在（MongoDB 唯一索引衝突） |
| `DUPLICATE_VIDEO` | 409 | 同課程內已存在相同 YouTube 影片（同 `courseId + youtubeVideoId`） |
| `UPLOAD_ERROR` | 400 | 檔案上傳失敗（multer 錯誤） |
| `INTERNAL_SERVER_ERROR` | 500 | 未預期的伺服器錯誤 |

新增自訂錯誤碼時，使用 **SCREAMING_SNAKE_CASE**，並在此表格補充說明。

---

## 輸入驗證

- controller 層進行基本格式檢查（必填欄位、型別）
- 使用 `assertObjectId(id, 'resourceName')` 驗證 MongoDB ID
- 所有驗證失敗一律拋出 `AppError('...', 400, 'VALIDATION_ERROR')`

```js
// 範例
const trimmed = String(req.body.question || '').trim();
if (!trimmed) {
  throw new AppError('Question is required.', 400, 'VALIDATION_ERROR');
}
```

---

## Controller 撰寫規範

- 一律使用 `asyncHandler` 包裝，不要寫 try/catch
- 不包含業務邏輯，只負責 request 解構 → 呼叫 service → 回傳 response

```js
const createCourse = asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  const course = await courseService.createCourse({ user: req.user, title, description });
  return sendSuccess(res, { statusCode: 201, message: 'Course created.', data: course });
});
```
