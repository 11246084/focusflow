# 測試規範

> 適用範圍：`backend/tests/`

---

## 測試框架

本專案後端使用 **Node.js 內建測試框架**（`node:test`），**不使用** Jest、Vitest 或 Mocha。

```bash
# 執行全部測試
cd backend && npm test

# 執行單一測試檔（修改特定路由或 service 時使用）
cd backend && node --test --experimental-test-isolation=none --test-concurrency=1 tests/<file>.test.js
```

---

## 檔案命名與位置

| 類型 | 位置 | 命名格式 |
|------|------|----------|
| 後端測試 | `backend/tests/` | `<module>.test.js` |
| 測試輔助工具 | `backend/tests/helpers/` | `<name>.js` |

**現有測試檔一覽：**
- `auth.routes.test.js` — 登入、取得自身資訊
- `course-video.routes.test.js` — 課程與影片 CRUD 路由
- `qa.routes.test.js` — QA 問答 API 路由
- `qa.service.test.js` — QA service 邏輯（向量搜尋、詞彙搜尋）
- `line.routes.test.js` — LINE Webhook 處理
- `api-response.test.js` — apiResponse 工具函式
- `demo-seed.service.test.js` — 示範資料植入邏輯

---

## 測試架構

### 共用 Harness（`tests/helpers/backendTestHarness.js`）

所有測試透過此 helper 運作，特點：

1. **Monkey-patch Mongoose models**：以 in-memory store 取代真實 MongoDB，測試不依賴外部資料庫
2. **啟動真實 Express app**：使用 `app.listen(0)` 取得隨機可用埠，route 測試打真實 HTTP 請求
3. **固定測試 ID**：`ids` 物件提供預設的 ObjectId 常數，確保跨測試一致性
4. **`resetStore()`**：每個 `it` 區塊前呼叫，重置 in-memory 資料到初始狀態

```js
const { startServer, stopServer, loginAs, resetStore, ids } = require('./helpers/backendTestHarness');

describe('POST /api/v1/courses', () => {
  let server, baseUrl;

  before(async () => { ({ server, baseUrl } = await startServer()); });
  after(async () => stopServer(server));
  beforeEach(() => resetStore());

  it('教師可建立課程', async () => {
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    // ...
  });
});
```

### Route 測試（整合測試）
- 使用 `jsonRequest()` 發送 HTTP 請求
- 驗證 `status`（HTTP 狀態碼）和 `body.success`、`body.error.code`
- 測試覆蓋：成功路徑 + 常見失敗路徑（未授權、無權限、資源不存在）

### Service 測試（單元測試）
- 直接 `require` service 函式，不透過 HTTP
- Mock 依賴的其他 service（如 `queryEmbedding.service`）

---

## 測試覆蓋率要求

目前**沒有強制的覆蓋率門檻**，以功能正確性為優先：

- 每個新 API 路由至少需要：成功情境 + 未授權情境 + 主要失敗情境
- 新增 service 函式時，若含有複雜邏輯（如 QA 搜尋的評分策略），需撰寫 service 單元測試
- 前端與 AI Pipeline 目前無自動化測試，修改後至少手動執行 `lint` 和 `build`

---

## 測試撰寫慣例

```js
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('模組名稱', () => {
  it('應該做某件事', async () => {
    assert.equal(actual, expected);
    assert.deepEqual(actualObj, expectedObj);
  });
});
```

- 測試描述使用**中文**，清楚說明情境（「教師可建立課程」、「未登入時回傳 401」）
- 每個 `it` 只測一件事，不在同一個 `it` 中混合多個驗證點
- 測試期間在 `backend/uploads/` 寫入的檔案會帶 `test-upload-` 前綴，`cleanupTestUploads()` 會自動清理

---

## 不需要測試的情況

- `constants/enums.js`（純資料）
- `config/env.js`（環境變數讀取）
- `models/`（Mongoose Schema 定義，由 in-memory store 覆蓋）
- `middleware/error.middleware.js`（透過 route 測試間接驗證）
