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
| `TOO_MANY_LOGIN_ATTEMPTS` | 429 | 同一 Email 連續登入失敗達上限（預設 15 分鐘內 5 次），暫時鎖定 15 分鐘 |
| `CURRENT_PASSWORD_INCORRECT` | 400 | 修改密碼時提供的目前密碼錯誤 |
| `PASSWORD_RESET_CODE_INVALID` | 400 | 忘記密碼驗證碼錯誤、過期、已使用或錯誤次數已達上限 |
| `PASSWORD_RESET_EMAIL_FAILED` | 502 | 忘記密碼驗證信寄送失敗（驗證碼已作廢） |
| `PASSWORD_RESET_UNAVAILABLE` | 503 | 未設定 SMTP 寄信帳號，忘記密碼功能未啟用 |
| `VALIDATION_ERROR` | 400 | 輸入參數不合規（含 Mongoose 驗證失敗） |
| `INVALID_ID` | 400 | MongoDB ObjectId 格式錯誤（CastError） |
| `NOT_FOUND` | 404 | 資源不存在 |
| `COURSE_NOT_FOUND` | 404 | 課程不存在 |
| `COURSE_ACCESS_DENIED` | 403 | 學生沒有 active Enrollment、課程未發布，或其他角色不具讀取權 |
| `COURSE_MANAGE_DENIED` | 403 | 呼叫者不是課程 owner teacher 或 admin |
| `STUDENT_NOT_FOUND` | 404 | 找不到符合完整 Email／id 的 active student |
| `ENROLLMENT_NOT_FOUND` | 404 | 找不到可撤銷的 active Enrollment |
| `VIDEO_NOT_FOUND` | 404 | 影片不存在 |
| `INVALID_VIDEO_BATCH_ID` | 400 | 批次 ID 不符合 `batch_YYYYMMDDhhmmss_xxxxxxxx` 格式 |
| `VIDEO_BATCH_FILES_REQUIRED` | 400 | 批次請求未包含 `videos` 檔案 |
| `VIDEO_BATCH_LIMIT_EXCEEDED` | 400 | 單一批次超過 10 支影片 |
| `VIDEO_BATCH_NOT_FOUND` | 404 | 影片批次不存在 |
| `VIDEO_BATCH_ITEM_NOT_FOUND` | 404 | 指定影片不屬於該批次 |
| `VIDEO_BATCH_ITEM_FAILED` | 500 | 批次中的單支影片因未預期錯誤失敗；不公開內部錯誤細節 |
| `VIDEO_BATCH_SCHEDULE_FAILED` | 500 | 批次 request 無法安全建立或啟動；已建立的影片會標記 processing failed |
| `VIDEO_BATCH_RETRY_IN_PROGRESS` | 409 | 同一批次仍有執行中的 worker，暫不可啟動手動重試 |
| `VIDEO_PROCESSING_RETRY_SOURCE_UNAVAILABLE` | 409 | 重試所需的本機來源檔不存在或不在允許的上傳目錄 |
| `DUPLICATE_RESOURCE` | 409 | 資源已存在（MongoDB 唯一索引衝突） |
| `DUPLICATE_VIDEO` | 409 | 同課程內已存在相同 YouTube 影片（同 `courseId + youtubeVideoId`） |
| `UPLOAD_ERROR` | 400 | 檔案上傳失敗（multer 錯誤） |
| `YOUTUBE_UPLOAD_NOT_CONFIGURED` | 503 | YouTube 自動上傳已啟用但 OAuth 憑證不完整 |
| `YOUTUBE_UPLOAD_FAILED` | 502 | YouTube OAuth 或影片上傳 API 失敗 |
| `YOUTUBE_UPLOAD_ALREADY_COMPLETED` | 409 | 影片已成功上傳，不可再排入重試 |
| `YOUTUBE_UPLOAD_RETRY_NOT_ALLOWED` | 409 | 目前不是 failed 狀態，不可重試 |
| `YOUTUBE_UPLOAD_RETRY_UNSAFE` | 409 | 可能已傳送影片 bytes，須先人工確認 YouTube Studio 以避免重複影片 |
| `YOUTUBE_UPLOAD_RETRY_LIMIT_REACHED` | 409 | 已達單支影片的有限重試上限 |
| `QUESTION_TOO_LONG` | 400 | 問題超過 `QA_MAX_QUESTION_LENGTH` 字數上限（預設 50 字） |
| `QA_DAILY_LIMIT_EXCEEDED` | 429 | 學生當天（台灣時間）提問次數已達 `QA_DAILY_ASK_LIMIT_PER_STUDENT`（預設 5 次，網頁與 LINE 合併；failed 不計） |
| `FAQ_INVALIDATION_FAILED` | 503 | 影片刪除／解除掛載前的 FAQ 清除失敗；mutation 未執行，可安全重試 |
| `SHORT_SCRIPT_NOT_FOUND` | 404 | 短影片腳本不存在 |
| `SHORT_SCRIPT_NO_CANDIDATE` | 422 | 自動選題後沒有候選通過過濾，不得降低門檻硬選 |
| `SHORT_SCRIPT_EVIDENCE_EMPTY` | 422 | 檢索不到足夠片段，無法凍結證據 |
| `SHORT_SCRIPT_ARC_NOT_APPLICABLE` | 422 | 證據包無轉折句，不適用 8 拍敘事弧線 |
| `SHORT_SCRIPT_STATE_INVALID` | 409 | 腳本狀態轉換不合法 |
| `SHORT_SCRIPT_CITATION_INVALID` | 502 | 生成結果引用了證據包外的 chunkId，重試上限內未通過 |
| `SHORT_SCRIPT_OUTPUT_INVALID` | 502 | 生成結果不是可解析的 JSON |
| `SHORT_SCRIPT_PROVIDER_NOT_CONFIGURED` | 500 | 腳本生成的 LLM provider 未設定 |
| `SHORT_ASSET_NOT_APPROVED` | 409 | 成品尚未通過審核，或審核的不是當前 `generationVersion`，不得上架 |
| `SHORT_ASSET_DISCLOSURE_REQUIRED` | 400 | 未確認 AI 揭露標示與教師數位分身書面同意（規格書 R-07 / 附錄 K.5） |
| `SHORT_ASSET_SOURCE_FILE_MISSING` | 409 | 上架時找不到教師上傳的本機影片檔，需重新上傳 |
| `FEEDBACK_NOT_FOUND` | 404 | 回報問題不存在 |
| `FEEDBACK_ATTACHMENT_NOT_FOUND` | 404 | 回報問題的附件不存在，或附件不屬於該筆回報 |
| `INVALID_FEEDBACK_ATTACHMENT_TYPE` | 400 | 附件不是 JPEG／PNG／WebP，或宣告的 MIME type 與實際檔案內容不符 |
| `FEEDBACK_ATTACHMENT_TOO_LARGE` | 413 | 單一附件超過 10 MiB |
| `FEEDBACK_ATTACHMENT_LIMIT_EXCEEDED` | 400 | 單筆回報超過 3 張附件 |
| `INVALID_CREDENTIALS` | 401 | 登入 Email 或密碼錯誤 |
| `ROLE_MISMATCH` | 403 | 登入時選的角色與帳號角色不符（密碼驗證通過後才比較），不發 token |
| `USER_INACTIVE` | 403 | 帳號已停用 |
| `USER_NOT_FOUND` | 404 | 使用者不存在 |
| `AVATAR_REQUIRED` | 400 | 上傳頭貼未附檔案 |
| `AVATAR_NOT_FOUND` | 404 | 使用者沒有頭貼 |
| `AVATAR_STORAGE_ERROR` | 500 | 頭貼寫入失敗 |
| `NOTIFICATION_NOT_FOUND` | 404 | 通知不存在或不屬於呼叫者 |
| `CONVERSATION_NOT_FOUND` | 404 | 網頁多輪問答的對話不存在 |
| `CONVERSATION_ACCESS_DENIED` | 403 | 對話不屬於呼叫者 |
| `MESSAGE_NOT_FOUND` | 404 | 要重試的使用者訊息不存在 |
| `MESSAGE_RETRY_NOT_ALLOWED` | 409 | 訊息目前不是可重試狀態 |
| `VIDEO_FILE_REQUIRED` | 400 | 上傳影片請求未附檔案 |
| `INVALID_FILE_TYPE` | 400 | 上傳的不是影片檔 |
| `INVALID_MEDIA_CONTAINER` | 400 | 影片容器結構損壞或不完整（例如 MP4 box header 截斷、box size 無效） |
| `VIDEO_PROCESSING_TRANSITION_INVALID` | 409 | 影片 processing 狀態轉換不合法（見 CLAUDE.md 狀態機） |
| `COURSE_DELETE_FAILED` | 500 | 課程刪除失敗（已 best-effort 還原本輪 ShortAsset 封存） |
| `INVALID_PAGE_TOKEN` | 400 | 分頁 cursor／pageToken 格式錯誤 |
| `INVALID_ENCODING` | 400 | QA 問題疑似非 UTF-8 編碼（壞字元），拒收 |
| `QA_QUOTA_EXCEEDED` | 429 | 超過全站月 token 預算或單一使用者月配額（`QA_MONTHLY_TOKEN_BUDGET`／`QA_USER_MONTHLY_TOKEN_QUOTA`） |
| `EMBEDDING_PROVIDER_ERROR` | 502 | Embedding provider 失敗或回傳無效向量 |
| `ANSWER_PROVIDER_ERROR` | 502 | 回答生成 provider 失敗（另有 `ANSWER_PROVIDER_EMPTY_RESPONSE`／`ANSWER_PROVIDER_INVALID_RESPONSE`） |
| `ANSWER_PROVIDER_NOT_CONFIGURED` | 500 | 回答生成 provider 缺 API key |
| `LINE_SIGNATURE_MISSING` | 401 | LINE webhook 缺 `X-Line-Signature` |
| `LINE_SIGNATURE_INVALID` | 401 | LINE webhook 簽章不符 |
| `LINE_RAW_BODY_MISSING` | 400 | 無法取得 LINE webhook 原始 body 以驗簽 |
| `LINE_NOT_CONFIGURED` | 500 | 未設定 `LINE_CHANNEL_SECRET` |
| `SHORT_ASSET_NOT_FOUND` | 404 | 短影片成品不存在 |
| `SHORT_SCRIPT_GENERATION_FAILED` | 502 | 腳本生成的 LLM provider 呼叫失敗 |
| `INTERNAL_SERVER_ERROR` | 500 | 未預期的伺服器錯誤 |

Phase 2-2 階層式檢索內部使用的 `PARENT_*` 錯誤碼（如 `PARENT_SEARCH_TIMEOUT`、`PARENT_INDEX_MISSING`）只寫入 `runtime.hierarchicalRetrieval` 診斷並觸發 Leaf fallback，不直接回給 client，定義見 `parentSearch.service.js`。

新增自訂錯誤碼時，使用 **SCREAMING_SNAKE_CASE**，並在此表格補充說明。

---

## OpenAPI 同步

- 新增、刪除或改 method／path 參數名稱時，同步 `backend/docs/openapi.yaml`；`tests/docs.routes.test.js` 會從 runtime router 比對，沒同步 `npm test` 會失敗
- 不公開的端點（例如只供 pipeline 呼叫的 internal webhook）不寫進 spec，改在該測試的 `UNDOCUMENTED_BY_DESIGN` 加一筆並附理由
- request／response schema 以 controller 與 service 的實際輸出為準，不套通用範本；改完跑 `npm run docs:lint`

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
