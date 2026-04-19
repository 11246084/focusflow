# Demo Bootstrap / Smoke Runbook

最後更新：2026-04-19

## 目的

這份 runbook 只保留 phase-1 backend 目前真實可重現的 demo 與 smoke 路徑。共享環境主線走 Gemini + Atlas，但仍不把未驗證條件寫成理想版。

目前 demo baseline 可透過 `npm run seed` 收斂；若需要先清除 demo-owned / demo-derived 痕跡再重建，使用 `npm run seed:reset`。
bridge 課程基線目前是 pipeline-style demo baseline，用來讓展示可重現，不代表已與真實 pipeline fully synchronized。

## Demo 前檢查

- 先確認現況口徑以 [current-state.md](./current-state.md) 為準
- 先決定今天是走只讀驗證，還是可寫入的專屬 demo DB
- 共享環境常用 runtime：

```env
DEMO_SEED_ENABLED=false
QA_QUERY_EMBEDDING_PROVIDER=gemini
QA_VECTOR_SEARCH_MODE=atlas
QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index
QA_ATLAS_FILTER_MODE=bridge_course_or_video
QA_ANSWER_PROVIDER=gemini
GEMINI_API_KEY=<已填入>
LINE_CHANNEL_SECRET=<已填入>
LINE_CHANNEL_ACCESS_TOKEN=<已填入>
```

> ⚠️ `QA_VECTOR_SEARCH_MODE=atlas` 需要 Atlas `text_embedding_index` 已建立且狀態 READY。
> 若 index 未就緒，`/health` 會顯示 `hard_fail`，應對方式見 [handoff-known-issues.md](./handoff-known-issues.md)。

- 必要 env：
  - `MONGODB_URI`
  - `JWT_SECRET`
  - `PROCESSING_WEBHOOK_SECRET`
  - `GEMINI_API_KEY`（query embedding + answer generation 均需）
  - `LINE_CHANNEL_SECRET`
  - `LINE_CHANNEL_ACCESS_TOKEN`
- LINE live demo 前額外確認：
  - ngrok 已執行（`ngrok http 4000`），取得最新 URL
  - LINE Developers Console Webhook URL 已更新為最新 ngrok URL
- 若是共享 MongoDB，不要先跑 `npm run seed`，但可以做 LINE live smoke（bind token 有 TTL 自動過期）

## 先判斷驗證路徑

### 路徑 A：共享 DB，只做只讀或 backend-only 驗證

適用情境：

- 共用 demo DB
- 不希望新增 usage logs、bind tokens、enrollment 等痕跡
- 只需要證明 backend 主線可重驗

建議做法：

1. `npm start` + `GET /health`
2. `tests\\mvp.acceptance.test.js`
3. 視需要補 `auth.routes`、`course-video.routes`、`qa.routes`、`qa.service`、`line.routes`

### 路徑 B：有專屬 demo DB，可接受寫入痕跡

適用情境：

- DB 不是共享資料庫
- 可以接受 seed 與 live smoke 產生的資料痕跡

建議做法：

1. `npm run seed`
   - 預設只做 converge baseline，不主動清除既有 demo 痕跡
   - 若需要乾淨重建，改用 `npm run seed:reset`
2. `npm start`
3. login / me / courses / QA
4. 視外部條件決定是否做 live LINE smoke

## Demo 流程

### 1. 啟動 backend 並先看 `/health`

```powershell
cd backend
npm start
curl http://127.0.0.1:4000/health
```

phase-1 預期：

- `200 OK`
- `data.runtime.qa.readiness=ready`
- `data.runtime.qa.queryEmbeddingProvider=gemini`
- `data.runtime.qa.vectorSearchMode=atlas`
- `data.runtime.qa.atlasVectorIndexConfigured=true`
- `data.runtime.line.readiness=ready`
- `data.runtime.line.deliveryMode=live`

### 2. 先跑 acceptance smoke，鎖住 backend 主線

```powershell
cd backend
node --test --experimental-test-isolation=none --test-concurrency=1 tests\\mvp.acceptance.test.js
```

這支會覆蓋：

- `/health`
- `auth / me`
- courses list
- QA ask 主線
- LINE bind -> switch -> ask 的 backend-only 路徑

### 3. 需要單點重驗時，再拆 route tests

```powershell
cd backend
node --test --experimental-test-isolation=none --test-concurrency=1 tests\\auth.routes.test.js
node --test --experimental-test-isolation=none --test-concurrency=1 tests\\course-video.routes.test.js
node --test --experimental-test-isolation=none --test-concurrency=1 tests\\qa.routes.test.js
node --test --experimental-test-isolation=none --test-concurrency=1 tests\\qa.service.test.js
node --test --experimental-test-isolation=none --test-concurrency=1 tests\\line.routes.test.js
```

### 4. 若有專屬 demo DB，再走 live API path

- login / me
- `/api/v1/courses`
- bridge course 與 `metadataOnly` / `qaScopeOnly` 呈現
  - 這門 bridge 課程是 pipeline-style demo baseline，預期主要用來展示 bridge / QA-only / metadata-only contract
- `/api/v1/qa/ask`
- 視外部條件再做 LINE live smoke

## `/health` 判讀

- `runtime.qa.readiness=ready`
  - 代表 phase-1 QA runtime 可以接受提問
- `runtime.line.readiness=ready`
  - 代表 LINE live 條件已就位，可以直接做端對端 demo
- `runtime.line.deliveryMode=live`
  - 訊息會真正送出到 LINE 使用者
- `runtime.line.readiness=degraded`（若 TOKEN 遺失時出現）
  - 代表 backend-only 驗證可走，但 live reply 不會送出
- 任一段出現 `hard_fail`
  - 不要硬做 live demo
  - 先修正 env、provider、index 或外部條件，再重打 `/health`

## Demo 話術

- 開場：
  - 「phase-1 backend 主線已可展示登入、課程範圍、Atlas QA 回答與 LINE routing；實際 readiness 仍以 `/health` 與 Atlas index 狀態為準。」
- `/health` 正常時：
  - 「這裡先確認 QA 與 LINE runtime 狀態，避免 demo 把未 ready 的整合誤講成完成。」
- QA 走 fallback 時：
  - 「目前共享環境主線是 Atlas；若回應裡出現 fallback 訊號，代表系統明確記錄了目前不是理想檢索條件。」
- LINE live demo 時：
  - 「LINE live 已完整驗證：使用者在 LINE 傳問題，backend 經 Gemini 3072 維語意搜尋後，將答案與影片時間戳直接回傳到 LINE 對話視窗。」
- ngrok URL 改變時：
  - 「ngrok 是本地展示用的暫時通道，每次重啟 URL 會變；正式部署後會換成固定網址，這個步驟就不再需要手動更新。」
- bridge course 沒 searchable segments 時：
  - 「這門課目前可能只有 bridge metadata，backend 會明確回 `no_searchable_segments`，不是假裝有內容卻回錯答案。」
- 收尾：
  - 「phase-1 backend 已可 demo、可驗收、可交接；後續重點是 Atlas vector search 啟用、固定 HTTPS 部署與前端綁定 UI。」

## degraded / hard_fail 應對

- 若是 `degraded`
  - 照實講出原因
  - 繼續 demo 可接受的 phase-1 路徑
  - 對外只講 backend-only 或 fallback 已可觀測，不講 fully ready
- 若是 `hard_fail`
  - 先停 live path
  - 先修 env 或切回允許的 phase-1 runtime
  - 若當下不能修，改走 acceptance smoke 與 route tests 證明 backend 主線

## 哪些話不能講錯

見 [current-state.md → 不能誤稱的邊界](./current-state.md)。
