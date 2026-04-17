# docs/current-status.md — FocusFlow 目前進度

最後更新：2026-04-17

> 這份文件是跨服務的動態進度頁。後端詳細狀態見 [backend/docs/current-state.md](../backend/docs/current-state.md)。

---

## Phase-1 整體完成度

| 服務 | 狀態 | 說明 |
|------|------|------|
| **Backend** | ✅ 主線穩定 | auth / courses / videos / qa / LINE 已可用，runtime 固定在 `mock + memory + gemini` |
| **Frontend** | ⚠️ 展示型 | 登入頁（Three.js 3D 場景）已完成，主介面（課程列表、問答 UI）待開發 |
| **AI Pipeline** | ✅ 可執行 | STT → chunking → embedding → MongoDB 主流程完整，無正式自動化測試 |

---

## Backend 目前 Runtime（2026-04-15 定版）

```
QA_QUERY_EMBEDDING_PROVIDER = mock
QA_VECTOR_SEARCH_MODE       = memory
QA_ANSWER_PROVIDER          = gemini
DEMO_SEED_ENABLED           = false  （需手動 npm run seed）
```

- `/health` 可直接觀察 `runtime.qa` 與 `runtime.line` 狀態
- QA misconfig 與 Atlas not ready 已 fail-fast，不靜默降級
- LINE Bot backend routing 已完成；live delivery 需補 secret + callback 設定

---

## 已完成

- auth / JWT / RBAC 主線
- courses / videos / processing 狀態流程
- `/api/v1/qa/ask`：answer、matches、時間資訊、runtime 訊號
- LINE：bind-token、webhook verify、bind、switch course、ask routing
- `GET /health`：qa + line runtime 可觀察性
- backend tests：7 個測試檔，in-memory store，不依賴真實 MongoDB

---

## 未完成 / 缺口

### 跨組待定版（Phase-1 Blocker）

| 項目 | 負責方 | 說明 |
|------|--------|------|
| Atlas vector index name | DB / MongoDB 組 | `text_embedding_index` / `video_embedding_index` 尚未確認 |
| Query embedding 與 pipeline 維度對齊 | AI Pipeline 組 | pipeline 3072 維，query side 仍是 mock |
| `videos` ownership 邊界 | Backend + DB 組 | app-owned video vs pipeline metadata 混存 |
| Live LINE smoke | Backend + 外部 | 需要 secret、access token、callback 設定證據 |
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

- Atlas vector retrieval **尚未上線**
- Query embedding **尚未與 pipeline 3072 維對齊**
- `video_segments_video` **尚未接手** clip source
- Live LINE **尚未完成** 完整外部驗證
