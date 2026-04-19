# docs/current-status.md — FocusFlow 目前進度

最後更新：2026-04-19

> 這份文件是跨服務的動態進度頁。後端詳細狀態見 [backend/docs/current-state.md](../backend/docs/current-state.md)。

---

## Phase-1 整體完成度

| 服務 | 狀態 | 說明 |
|------|------|------|
| **Backend** | ✅ 主線穩定 | auth / courses / videos / qa / LINE 已可用，共享環境主線已切到 `gemini + atlas + gemini` |
| **Frontend** | ⚠️ 展示型 | 登入頁（Three.js 3D 場景）已完成，主介面（課程列表、問答 UI）待開發 |
| **AI Pipeline** | ✅ 可執行 | STT → chunking → embedding → MongoDB 主流程完整，無正式自動化測試 |

---

## Backend 目前 Runtime（2026-04-19 更新）

```
QA_QUERY_EMBEDDING_PROVIDER = gemini
QA_VECTOR_SEARCH_MODE       = atlas
QA_ANSWER_PROVIDER          = gemini
DEMO_SEED_ENABLED           = false  （需手動 npm run seed）
```

- `/health` 可直接觀察 `runtime.qa` 與 `runtime.line` 狀態
- QA misconfig 與 Atlas not ready 已 fail-fast，不靜默降級
- 共享 Atlas index 已建立，QA 可走 `text_embedding_index`
- LINE Bot 已有成功提問驗證；完整外部設定仍以當下 channel / callback 為準

---

## 已完成

- auth / JWT / RBAC 主線
- courses / videos / processing 狀態流程
- `/api/v1/qa/ask`：answer、matches、時間資訊、runtime 訊號
- bridge-first API 契約已收斂：課程與 QA runtime 會提供 `isBridgeCourse`；`appOwnedVideoCount` / `metadataOnlyVideoCount` 是 `appVideoCount` / `bridgeVideoCount` 的 readability aliases；`resultCategory` 是 Phase-1 convenience field，細節仍以 `status` / `matchStatus` / `degradedReasons` 為準
- demo baseline / reset 路徑已收斂：`npm run seed` 預設只做 converge baseline；`npm run seed:reset` 會保守清除 demo-owned / demo-derived 痕跡後重建；bridge 課程基線目前定位為 pipeline-style demo baseline
- LINE：bind-token、webhook verify、bind、switch course、ask routing
- `GET /health`：qa + line runtime 可觀察性
- backend Swagger / OpenAPI 已掛在 `/docs`；raw spec 在 `backend/docs/openapi.yaml`，且 LINE webhook 已納入文件但只應視為 integration-facing endpoint
- backend tests：7 個測試檔，in-memory store，不依賴真實 MongoDB

---

## 未完成 / 缺口

### 跨組待定版（Phase-1 Blocker）

| 項目 | 負責方 | 說明 |
|------|--------|------|
| Atlas vector index / future naming | DB / MongoDB 組 | `video_segments_text` 已使用 `text_embedding_index`；後續若擴到 `video_segments_video` 仍需定版 |
| Query embedding 與 pipeline 維度對齊 | AI Pipeline 組 | 目前已改用 Gemini query embedding；仍需持續確認 coverage 與長期契約 |
| `videos` ownership 邊界 | Backend + DB 組 | app-owned video vs pipeline metadata 混存 |
| Live LINE smoke / ops 記錄 | Backend + 外部 | 已有成功提問驗證；仍需保留 callback、channel 與 smoke 紀錄 |
| Demo 環境策略 | 全組 | 共享 DB 是否提供專屬 demo DB |

### Frontend 待開發

- 課程列表頁
- 影片管理介面
- 問答 UI（提問框、答案卡、影片時間戳跳轉）

### Pipeline 待確認

- `video_segments_text` canonical 欄位口徑（`video_id` vs `videoId`）
- `clips` 與 `video_segments_video` 正式分工
- 哪些影片已有 searchable segments 覆蓋率

---

## 下一步優先順序

1. 跨組 freeze phase-1 契約（Atlas index、embedding 維度、`videos` ownership）
2. 決定 demo 環境策略（專屬 DB or 只讀 smoke）
3. 前端主介面開發（課程列表、問答 UI）
4. 若需要 live LINE demo：先拿到設定證據，再安排 smoke

---

## 不能誤稱的邊界

- Atlas vector retrieval **已在共享環境成功驗證，但不能直接誤稱所有資料都 fully production-ready**
- Query embedding **已切到 Gemini，但仍需持續確認與 pipeline 資料覆蓋率的一致性**
- `video_segments_video` **尚未接手** clip source
- Live LINE **已有成功提問驗證，但尚未完成完整運維化紀錄**
- LINE webhook **已納入 OpenAPI 文件**，但這不等於 live production flow 已完整驗證
