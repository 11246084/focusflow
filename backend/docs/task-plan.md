# Backend Task Plan

最後更新：2026-04-17

> 本文件為後端組員**個人執行版**任務清單。全組總覽請看 repo 根目錄 [TODO.md](../../TODO.md)。
> runtime 現況看 [current-state.md](./current-state.md)，協作缺口看 [handoff-known-issues.md](./handoff-known-issues.md)。

## 狀態語彙

- **Done** — 已實作並通過測試
- **Partial** — 主體已完成，尚有明確缺口待補
- **Pending** — 可立即推進的後端工作
- **Blocked** — 後端側準備好，等其他組交付才能收尾
- **Need Confirmation** — 資訊不足，需先確認才能排程

---

## 個人任務清單（僅後端）

以下項目均已按「主動發起 / 等待對方 / 可先做的事」三段結構整理，排序依 MVP demo 關鍵度。

---

### 1. 發起 phase-1 契約 Freeze 會議

- **狀態**：Pending（由我發起）
- **要 freeze 的議題**：
  - Atlas vector index name（`text_embedding_index` / `video_embedding_index` 是否定版）
  - Atlas filter fields 要用 `video_id` 還是 `videoId`、是否含 `courseId`
  - `videos` collection ownership 邊界（app-owned vs. pipeline metadata 要拆分還是加 `sourceType`）
  - query embedding provider（模型名稱 + 維度，RAG 已確認 pipeline 3072 維）
  - pipeline segments 如何綁定 course（加 `courseId` / 改查 `video_id` / 重跑 pipeline 三擇一）
- **我要主動做**：
  - 彙整上述五點為一頁議題單
  - 約 Database、RAG 兩組同步時間
  - 會後把結論寫進 [handoff-known-issues.md](./handoff-known-issues.md) 並同步 [current-state.md](./current-state.md)
- **等誰**：Database、RAG 兩組到齊
- **對方需先交付**：Database 帶 Atlas 現況說明、RAG 帶 pipeline 實際輸出格式
- **等待期間可先做**：起草議題單；把 backend 目前相容 `video_id` / `videoId` 的 normalize 範圍寫成備忘

---

### 2. 決定 demo DB 隔離策略

- **狀態**：Pending（我需協調各組拿出決定）
- **背景**：MCP 已確認 demo DB 混有 pipeline 與 demo seed 的資料。`usage_logs`、`line_bind_tokens` 本輪未掃描（Need Confirmation 是否有污染）。
- **我要主動做**：
  - 提議三選一：(a) 共享 Atlas 只讀 + 另開隔離 demo instance (b) 保留共享 Atlas 但 demo 前 reseed (c) 完全獨立 demo DB
  - 估算每個選項對 backend `.env`、seed script、CI 的影響
- **等誰**：Database 組 + 整體 demo 決策
- **對方需先交付**：Atlas 管理員可提供的 demo 環境選項
- **等待期間可先做**：盤點 `usage_logs` / `line_bind_tokens` 目前內容（MCP find），判斷污染風險

---

### 3. 啟用 Atlas vector search（env 切換）

- **狀態**：Blocked by Database
- **後端側準備**：Done
  - `qa.service.js` 的 `searchSegmentsWithAtlas()` 與 fail-fast 邏輯已實作
  - `.env.example` 有 `QA_VECTOR_SEARCH_MODE`、`QA_ATLAS_VECTOR_INDEX_NAME` 欄位
- **等誰**：Database
- **對方需先交付**：
  - Atlas UI 建立的 `text_embedding_index`（3072 維）＋ `video_embedding_index`
  - index 正式名稱
  - 已清除或隔離 `video_segments_text` 內 32 維 demo seed embeddings
- **我要主動做**（對方交付後）：
  - 更新 backend `.env`：`QA_VECTOR_SEARCH_MODE=atlas` + `QA_ATLAS_VECTOR_INDEX_NAME=<確認值>`
  - 跑 acceptance smoke + `qa.service` 測試
  - 更新 [current-state.md](./current-state.md) 移除 memory-only 標註
- **等待期間可先做**：
  - 確認目前 normalize 相容性：如果 Atlas prefilter 用 `video_id`，backend 查 `courseId` 的路徑要走哪條 index？先用註解寫成待驗證點
  - 檢查 `qa.service.test.js` 有沒有把 atlas fail-fast 路徑納入測試

---

### 4. 切換 query embedding 到正式 Gemini provider

- **狀態**：Blocked by RAG
- **後端側準備**：Done
  - `queryEmbedding.service.js` 已有 mock / openai / gemini 三種 provider
  - 維度動態配置（`QA_QUERY_EMBEDDING_DIM`）
- **等誰**：RAG
- **對方需先交付**：
  - freeze `GEMINI_EMBEDDING_MODEL_NAME` 與官方維度
  - 確認 query 端與 pipeline 端使用同一個 model version
- **我要主動做**（對方交付後）：
  - 更新 `.env`：`QA_QUERY_EMBEDDING_PROVIDER=gemini` + 對應 model + dim
  - 執行 `qa.service.test.js` 與 QA route 測試
  - 確認 `runtime.fallbacks` 是否仍會觸發（若 DB 尚未清 32 維，記得提醒 Database）
- **等待期間可先做**：
  - 檢查 `queryEmbedding.service.js` 對不同維度的錯誤訊息是否清楚
  - 增補 gemini provider 的單元測試（若缺）

---

### 5. 支援 Frontend × Backend API 整合

- **狀態**：Partial（後端 API Done，整合待 Frontend 推進）
- **後端側準備**：Done — 登入、課程、QA、影片、LINE bind、`/health` 全數可用
- **等誰**：Frontend
- **對方需先做**：API client、登入頁、Protected Route
- **我要主動做**：
  - 整合過程中快速回覆 CORS、response format、token 處理相關問題
  - 如果 Frontend 需要，補 Swagger 用法或 example payload 到 [current-state.md](./current-state.md)
- **等待期間可先做**：
  - 驗證 `/api/v1/courses`、`/api/v1/qa/ask`、`/api/v1/line/bind-token` 的 response shape 對前端好不好消化（欄位命名一致、錯誤碼對齊）
  - 確認 CORS 目前設定能讓 `http://localhost:5173` 打得通

---

### 6. 協助 Frontend 決定 bridge course 呈現策略

- **狀態**：Pending（需要我先把欄位語義寫清楚）
- **背景**：MCP 已確認 bridge course 目前零 searchable segments。前端若不標示會像壞掉。
- **後端已提供的訊號**：`qaScopeOnly`、`bridgeMode`、`bridgeContract`、`metadataOnly=true`、`matchStatus=no_searchable_segments`、`VIDEO_METADATA_ONLY=409`
- **我要主動做**：
  - 整理一份 bridge course 相關欄位語義表（fields × 何時出現 × 建議 UI 處理）給 Frontend
  - 決策完成後更新 [handoff-known-issues.md](./handoff-known-issues.md)
- **等誰**：Frontend 提出 UI 偏好（隱藏 / QA-only badge / metadata-only 呈現）
- **等待期間可先做**：把欄位語義表寫完；加一個 route test 確認 bridge video processing 路徑仍回 409

---

### 7. 支援 LINE live smoke test

- **狀態**：Blocked by Database & LINE Bot
- **後端側準備**：Done — bind / switch / ask、簽章驗證、error mapping、`/health` degraded 訊號全部已測試
- **等誰**：Database & LINE Bot 組
- **對方需先交付**：
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET`
  - LINE Developer Console webhook URL 設定完成證據
- **我要主動做**（對方交付後）：
  - 更新 `.env` 並啟動 backend
  - 與 LINE Bot 組一起跑 live smoke（bind → switch course → ask）
  - 驗收後把 `runtime.line.deliveryMode` 從 `backend_only` 改為 `live` 並同步 [current-state.md](./current-state.md)
- **等待期間可先做**：
  - 撰寫 LINE live smoke 的 step-by-step checklist
  - 確認 `line.service.js` 的錯誤訊息對 LINE 使用者友善

---

### 8. 澄清 `videos` 所有權模型

- **狀態**：Need Confirmation（策略未定，需要 Database 一起決定）
- **背景**：MCP 確認 DB 中 9 筆 `videos` 混用三種形狀（pipeline-owned / app-owned / bridge 中間型）。
- **我要主動做**：
  - 在 Phase-1 契約會議提出兩個方案：(a) Schema 加 `sourceType` 欄位，service 依此判斷 (b) 拆 `videos_app` / `videos_pipeline_metadata` 兩個 collection
  - 會後若定案，更新 `models/Video.js` + `video.service.js` + demo seed + 測試 harness
- **等誰**：Database 共同定案
- **等待期間可先做**：寫一段 normalize 備忘（目前 backend 哪些路徑依賴哪些欄位，會影響選項評估）

---

### 9. 確認 `video_segments_text` canonical 欄位

- **狀態**：Partial（backend 已相容，長期仍需 freeze）
- **背景**：MCP 確認 DB 同時存在 `video_id` / `videoId`、`start_sec` / `startSec`。Backend 目前靠 normalize 相容。
- **我要主動做**：
  - Phase-1 契約會議中提出 freeze 一套命名
  - 定案後若 RAG 改 `import_*` 腳本，我同步縮窄 backend normalize 範圍（保留一份向後相容期限）
- **等誰**：RAG + Database 決定 canonical fields
- **等待期間可先做**：把 backend 目前相容點列表（`qa.service.js`、normalize helper），附在議題單

---

### 10. `init_collections.js` 14 vs MCP 實測 12 的落差

- **狀態**：Need Confirmation（低優先）
- **背景**：repo 宣稱 14 collections，MCP 實測 12。與 backend 功能無直接關聯。
- **我要主動做**：在 Phase-1 會議順帶確認，由 Database 說明；結論寫進 [handoff-known-issues.md](./handoff-known-issues.md)
- **等待期間可先做**：無（不影響 backend 主線）

---

### 11. 生產環境前：CORS 限定 origin

- **狀態**：Pending（phase-1 MVP 可接受，demo/生產前必做）
- **背景**：`app.js` 目前使用寬鬆 `cors()`。
- **我要主動做**：
  - `.env.example` 補 `ALLOWED_ORIGIN`
  - `app.js` 改為 `cors({ origin: env.ALLOWED_ORIGIN })`
  - 加一個驗證 preflight 的 route test
- **等誰**：無（獨立可做，只是時機在 demo 前）
- **先決條件**：Frontend 確認正式部署的 origin

---

## 本輪刻意不碰

- Frontend 程式碼
- `database/` 內的 init / import 腳本（由 Database 組負責）
- `STT_Whisper/` pipeline 程式（由 RAG 組負責）
- MongoDB 內實際資料（不直接寫 Atlas，交由 Database 執行匯入）
- phase-2 功能：`video_segments_video` 正式 clip source、multimodal retrieval

---

## 規劃前提

- phase-1 正式 runtime 仍是 `mock + memory + template/gemini answer + explicit seed`
- 切換任何 provider 或 vector mode 前，先跑 `qa.service.test.js` 與 route 測試
- 跨組未 freeze 的議題先用 [handoff-known-issues.md](./handoff-known-issues.md) 口徑管住，不在 backend 單方面擴功能
- demo 口徑以 `/health` 與 API runtime 訊號為準
- 完成任一任務後同步更新 [task-plan.md](./task-plan.md)、[implementation-log.md](./implementation-log.md)、[README.md](./README.md) 的 Latest Update
