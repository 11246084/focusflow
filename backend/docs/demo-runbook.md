# Demo Bootstrap / Smoke Runbook

最後更新：2026-04-15

## 目的

這份 runbook 只保留 phase-1 backend 目前真實可重現的 demo 與 smoke 路徑，不把未 ready 的 Atlas 或 live LINE 寫成理想版。

## Demo 前檢查

- 先確認現況口徑以 [current-state.md](./current-state.md) 為準
- 先決定今天是走只讀驗證，還是可寫入的專屬 demo DB
- phase-1 runtime 應仍是：

```env
DEMO_SEED_ENABLED=false
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_VECTOR_SEARCH_MODE=memory
QA_ANSWER_PROVIDER=gemini
```

- 必要 env：
  - `MONGODB_URI`
  - `JWT_SECRET`
  - `PROCESSING_WEBHOOK_SECRET`
- 依情境補：
  - `GEMINI_API_KEY`
  - `LINE_CHANNEL_SECRET`
  - `LINE_CHANNEL_ACCESS_TOKEN`
- 若是共享 MongoDB，不要先跑 `npm run seed`，也不要直接做會寫入 usage log / bind token 的 live smoke

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
- `data.runtime.line.readiness=degraded` 或 `ready`
- 若是 `degraded`，通常會同時看到 `data.runtime.line.deliveryMode=backend_only`

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
- `/api/v1/qa/ask`
- 視外部條件再做 LINE live smoke

## `/health` 判讀

- `runtime.qa.readiness=ready`
  - 代表 phase-1 QA runtime 可以接受提問
- `runtime.line.readiness=degraded`
  - 代表 backend 端 bind / switch / ask routing 可驗，但 live channel 條件還沒補齊
- `runtime.line.deliveryMode=backend_only`
  - 只能講 backend-only 驗證完成，不能講 live reply ready
- 任一段出現 `hard_fail`
  - 不要硬做 live demo
  - 先修正 env、provider、index 或外部條件，再重打 `/health`

## Demo 話術

- 開場：
  - 「phase-1 backend 主線已可展示登入、課程範圍、QA 回答與 LINE routing，但正式 runtime 仍是 memory mode，不是 Atlas semantic retrieval 正式上線版。」
- `/health` 正常時：
  - 「這裡先確認 QA 與 LINE runtime 狀態，避免 demo 把未 ready 的整合誤講成完成。」
- QA 走 fallback 時：
  - 「目前正式檢索主線仍是 memory；若回應裡出現 fallback 訊號，代表系統明確記錄了目前不是理想檢索條件。」
- LINE 是 backend-only 時：
  - 「backend 端 bind、切換課程與 QA routing 已打通，但 live channel 條件仍待外部設定補齊。」
- bridge course 沒 searchable segments 時：
  - 「這門課目前可能只有 bridge metadata，backend 會明確回 `no_searchable_segments`，不是假裝有內容卻回錯答案。」
- 收尾：
  - 「phase-1 backend 已可 demo、可驗收、可交接；Atlas、正式 embedding 對齊與 live LINE 仍是下一步協作事項。」

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
