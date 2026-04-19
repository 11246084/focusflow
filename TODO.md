# FocusFlow TODO.md

> 根據 2026-04-17 程式碼 + MongoDB MCP 實地盤點結果建立；2026-04-19 依 LINE live smoke 驗證與 Gemini query embedding 接通後更新。
> 判斷依據分三級：
> - **Confirmed by Code** — 由 repository 程式碼/設定/測試直接驗證
> - **Confirmed by DB via MCP** — 由 MongoDB MCP 直接讀取 collection / documents / indexes 確認
> - **Need Confirmation** — repo 有跡象但 MCP / 程式碼都無法完整確認，或 MCP 權限不足
>
> 原則：
> - route 存在 ≠ 功能完成；mock / stub ≠ 功能完成
> - 「有 import script」≠「資料已匯入資料庫」
> - 「有 init script」≠「實際 DB 已完成初始化」
> - 「有 atlas mode 程式碼」≠「Atlas 現況可用」
> - 「repo 中定義某種 schema」≠「DB 中實際 documents 真的長那樣」
>
> 本文件不進版控（見 `.gitignore`），修改後請自行維護。

---

## Database Reality Check (via MCP)

> 最後更新：2026-04-19 透過 MongoDB MCP 重驗。以下為 DB 現況，**不是** repo 中程式碼的意圖。
> 2026-04-17 初版建立；2026-04-19 依組員 DB 修改重新驗證，標注各項狀態變化。

### 集合列表（MCP `list-collections`）

DB 名稱：`focusflow`（唯一一個 DB，size 約 11.7 MB）。

共 **12** 個 collection：
`courses`、`videos`、`users`、`enrollments`、`video_segments_text`、`video_segments_video`、`video_segments_audio`、`clips`、`transcripts_normalized`、`term_dictionary`、`usage_logs`、`line_bind_tokens`。

⚠️ `init_collections.js` 宣稱有 14 個集合 → MCP 實測只有 12 個，兩者落差 **`Need Confirmation`**（MCP 未見的 2 個集合為何）。

### Document counts（MCP `count`）

| Collection | 實測筆數 | 備註 |
|-----------|---------|------|
| `courses` | 3 | Demo QA / Demo Processing / Pipeline Bridge |
| `videos` | 9 | 6 pipeline-owned + 3 app demo（混用） |
| `users` | 3 | teacher / student / admin demo |
| `enrollments` | 2 | student 選了 Demo QA + Pipeline Bridge |
| `video_segments_text` | 105 | 102 筆 @ 3072 dim（`video_001`，courseId=Bridge）+ 3 筆 @ 0 dim（demo seed，embedding 已改為空陣列）⚠️ 2026-04-19 更新 |
| `video_segments_video` | 15 | 全為 `video_001` @ 3072 dim |
| `video_segments_audio` | **0** | 空集合，尚未有任何 audio segment |
| `clips` | 1 | 僅 demo seed 的 `focusflow-demo-segment-qa` |
| `transcripts_normalized` | 1 | 僅一筆 |
| `term_dictionary` | 14 | |

### Atlas Vector Search 索引（MCP `collection-indexes` 的 `searchIndexes`）

> 2026-04-19 重驗：**仍未建立，無變化。**

| Collection | `searchIndexes` | 2026-04-19 狀態 |
|-----------|----------------|----------------|
| `video_segments_text` | `[]` — **未建立** | Still broken |
| `video_segments_video` | `[]` — **未建立** | Still broken |
| `video_segments_audio` | `[]` — **未建立** | Still broken |

結論：`QA_VECTOR_SEARCH_MODE=atlas` 目前會直接 hard-fail（因 Atlas Vector Index 根本不存在），semantic retrieval 無法啟用。

### `videos` 集合實際資料形態（MCP `collection-schema` + `find`）

欄位池**嚴重混用 snake_case 與 camelCase**，同時存在兩種「所有權模型」：

**A. Pipeline-owned rows**（6 筆：`video_id=video_001..006`）
- 欄位：`video_id`、`file_name`、`video_source="local"`、`durationSec`（null）、`audio_path`（null）、`title`、`file_path`
- **缺少**：`courseId`、`uploadedBy`、`processing`、`sourceType`
- 這些是 pipeline 已知的影片 metadata，但與任何 `courses` 無關聯

**B. App-owned demo rows**（2 筆：`...201`、`...202`）
- 欄位：`courseId`、`uploadedBy`、`processing.status`、`sourceType="upload"`、`video_source="upload"`、`title`、`file_name`
- 有完整 app 層 ownership

**C. 混合型（bridge video）**（1 筆：`...203` = `focusflow-demo-video-pipeline-bridge`）
- 有 `video_id`、`title`、`file_name`，**沒有** `courseId`、`uploadedBy`、`processing`
- 看起來像 pipeline row，但卻被 `courses.videoIds` 列為 Bridge 課程的影片
- → ownership 邊界目前在 DB 實體上**混亂**

### `video_segments_text` 實際欄位（MCP `collection-schema`）

> 2026-04-19 重驗：欄位命名**仍然雙套共存**，但 pipeline 端已補上 `courseId`（ObjectId）；demo seed 端新增了 `video_id`（String）欄位但原有 camelCase 欄位未移除。

**目前欄位狀況（Confirmed by DB via MCP, 2026-04-19）**：
- pipeline 文件（102 筆）：`video_id`、`start_sec`、`end_sec`、`chunk_id`、`segment_id`（Null）、`text`、`embedding`、**`courseId`（新增，ObjectId）**
- demo seed 文件（3 筆）：`videoId`（ObjectId）、`startSec`、`endSec`、`transcript`（camelCase 仍存在）、`courseId`（ObjectId）、**`video_id`（新增，String）**、`embedding`（改為空陣列 `[]`）

兩套命名**仍然共存**，backend 的 normalize 相容性仍為必要（not an option）。Partially fixed — 兩端都補了對方的部分欄位，但完整統一尚未達成。

### Embedding 維度分佈（MCP `aggregate`，2026-04-19 更新）

| Count | Dim | video_id | courseId | 狀態 |
|------|-----|----------|---------|------|
| 102 | 3072 | `video_001` | `680000000000000000000103`（Bridge Course）| ✅ 已補 courseId |
| 3 | 0 | `focusflow-demo-video-published` | `680000000000000000000101` | ⚠️ embedding 已清空 |

> **2026-04-19 變化（Confirmed by DB via MCP）**：
> 1. 102 筆 pipeline segments（`video_001`）已補上 `courseId=ObjectId("680000000000000000000103")`（Bridge Course ID）。原本沒有 courseId，這是本次最大的 DB 修改。
> 2. 3 筆 demo seed 的 embedding 從 32 維改為空陣列（dim=0）。32 維 mock 向量已不存在。
> 3. 維度混用風險已部分緩解（32 維已消除），但 dim=0 的文件仍無法被 Atlas vector search 索引。

### Bridge Course 可搜段落（MCP 交叉比對，2026-04-19 更新）

- Bridge course `_id=680000000000000000000103`
- Bridge video `_id=680000000000000000000203`，`video_id=focusflow-demo-video-pipeline-bridge`

> **2026-04-19 MCP 實測結果（重大變化）**：
> - 以 `courseId=ObjectId("680000000000000000000103")` 查 `video_segments_text`（aggregate 確認）：**102 筆**（`video_001` pipeline segments）✅ 新增
> - 以 `courseId=...103`（string）查：**0 筆**（ObjectId 型別不符，查詢字串需帶 ObjectId）
> - 以 `video_id=focusflow-demo-video-pipeline-bridge` 查：**0 筆**（bridge video 本身仍無對應 segments）

> **判定：Partially Completed**
> - Bridge course 現在透過 courseId（ObjectId 查詢）可找到 102 筆 `video_001` 的 pipeline segments
> - 但 bridge video 的 `video_id=focusflow-demo-video-pipeline-bridge` 仍無對應 segments
> - QA 是否成功取決於 backend 用 courseId 或 video_id 查詢（**Need Confirmation**：非本次 MCP 可確認）

### Pipeline 輸出是否匯入 demo DB？

> 2026-04-19 重驗：以下結論**無變化**。

- `video_001` 的 text 與 video segments、transcript、term dictionary 都**有**匯入（DB 中確實存在）
- `video_002..006` **只有 videos metadata rows**，沒有任何 segments（MCP 確認 `video_segments_text` 與 `video_segments_video` 皆無對應文件）— Still broken
- `video_segments_audio` **整個集合為空** → audio pipeline 尚未匯入 demo DB — Still broken

### 其他可確認的 DB 現況

- `users`：teacher / student / admin 三筆 demo，email `*@focusflow.local`
- `enrollments`：student 選了 Demo QA 與 Pipeline Bridge 課程（各一筆，皆 `lineNotify=false`）
- `clips`：僅一筆（`focusflow-demo-segment-qa`，屬於 Demo QA Course）
- `usage_logs` / `line_bind_tokens`：MCP 本輪未逐筆掃描 → `Need Confirmation` 是否有資料污染

---

## Project Status Summary

| 子系統 | 實際完成度 | Demo 可用性 | 說明 | 判斷來源 |
|--------|-----------|------------|------|---------|
| **Backend** | ~95% | ✅ 可用 | JWT/Auth、QA、LINE 後端、課程影片、Health 全數完成並有測試 | Confirmed by Code（測試 2,669+ 行） |
| **Frontend** | ~5% | ❌ 不可用 | 只有 Three.js 動態登陸頁，零功能性 UI | Confirmed by Code |
| **AI Pipeline（程式）** | ~90% | ✅ 可用 | 完整 STT → Chunking → Gemini 嵌入流程，輸出檔案供 DB 組匯入 | Confirmed by Code |
| **AI Pipeline（資料）** | 部分匯入 | 🟡 有限 | `video_001` 已進 DB；`video_002..006` 只有 videos metadata，無 segments；audio 整個集合空 | Confirmed by DB via MCP |
| **Database & LINE Bot** | ~75% | 🟢 LINE live 已通 | 集合存在；Atlas vector index 未建立；video_001 pipeline segments 已補 courseId；LINE live smoke 已驗證通過（2026-04-19） | Confirmed by DB via MCP（2026-04-19）+ Confirmed by Code |

**MVP 最大缺口**：
1. Frontend 幾乎從零開始
2. Atlas vector search 索引尚未建立（Still broken，Confirmed by DB via MCP 2026-04-19）
3. Pipeline segments 尚未全面匯入 demo DB（video_002..006 仍空，Confirmed by DB via MCP 2026-04-19）
4. Bridge course QA：已確認可用於 memory mode，且 Gemini query embedding 已接通（scoringMode: vector，2026-04-19 live 驗證）
5. `videos` 與 `video_segments_text` 在 DB 層欄位命名混用（仍存在，Confirmed by DB via MCP 2026-04-19）
6. ~~LINE live reply 未完成~~ → ✅ 已完成（2026-04-19 live smoke 通過）

---

## Completed

以下功能有完整實作、通過測試，可視為完成。

### Backend（~2,669 行測試，所有測試通過） — Confirmed by Code

| 功能 | 判斷依據 |
|------|---------|
| JWT 登入 / 登出 / 取得自身資訊 | `auth.service.js` + `auth.routes.test.js` 129 行全通過 |
| RBAC 角色授權（teacher / student / admin） | `role.middleware.js` + 各路由測試覆蓋 |
| 課程 CRUD（建立、列表、詳情） | `course.service.js` + `course-video.routes.test.js` 770 行 |
| 影片上傳、處理狀態機（queued → processing → completed / failed / retry） | `videoProcessing.service.js` + 狀態流程測試全覆蓋 |
| QA 問答（memory 模式 + Gemini 3072 維語意搜尋 + Gemini answer） | `qa.service.js` + `queryEmbedding.service.js` embedWithGemini() + `qa.service.test.js` |
| Gemini query embedding（`gemini-embedding-2-preview`，3072 維，與 STT pipeline 對齊） | `queryEmbedding.service.js` + `runtimeDiagnostics.service.js`（2026-04-19 新增） |
| LINE Webhook 驗簽 + bind + switch course + ask question（後端邏輯） | `line.service.js` 450+ 行 + `line.routes.test.js` 491 行 |
| LINE bind-token 生成（10 分鐘過期） | service + route + tests |
| LINE live smoke 端對端驗證（bind → switch course → ask，真實 LINE 裝置） | 2026-04-19 實測通過；`/health` `line.readiness=ready`、`deliveryMode=live` |
| Health endpoint（`/health` 含 `runtime.qa` + `runtime.line` snapshot） | `health.routes.test.js` |
| Bridge course 邏輯（qaScopeOnly、metadataOnly 標記） | `bridgeScope.service.js` + 測試 |
| Demo seed / reset（`npm run seed` / `npm run seed:reset`） | `demoSeed.service.js` + `demo-seed.service.test.js` |
| Swagger / OpenAPI 文件（`/docs`） | `docs.routes.test.js` + `backend/docs/openapi.yaml` |
| 全路由 fail-fast / 明確錯誤訊號（misconfig、Atlas not ready、硬失敗） | `runtimeDiagnostics.service.js` + 多個測試驗證 |

### AI Pipeline（程式存在） — Confirmed by Code

> 注意：「程式存在」不代表「輸出已匯入 DB」。資料面請看上方 Database Reality Check。

| 功能 | 判斷依據 |
|------|---------|
| 影片掃描（`scan_videos.py`） | 完整實作 |
| 音訊抽取（`extract_audio.py`，FFmpeg + cache） | 完整實作 |
| Whisper 轉錄（`transcribe.py`，word-level timestamps） | 完整實作 |
| 逐字稿正規化（`normalize_transcript.py`，RapidFuzz） | 完整實作 |
| 分段（`chunking.py`，三重限制：word / segment / time） | 完整實作 |
| Gemini Embedding 2 文字嵌入（`embedding.py`，3072 維，含 checkpoint/retry） | 完整實作 |
| 影片多模態嵌入（`video_multimodal_pipeline.py`） | 完整實作 |
| 結果匯出（`export_outputs.py`） | 完整實作 |

### Database（程式存在） — Confirmed by Code

> 注意：腳本存在 ≠ 已在 DB 執行。執行結果請看上方 Database Reality Check。

| 功能 | 判斷依據 |
|------|---------|
| 集合初始化腳本（`init_collections.js`） | 檔案存在；repo 宣稱 14 collections，MCP 實測 DB 有 12（`Need Confirmation`：差異來源） |
| 索引建立腳本（`init_indexes.js`） | 檔案存在；classical indexes 已於 MCP 確認存在；Atlas search indexes **未建立** |
| 資料匯入腳本（videos / segments_text / segments_audio / segments_video / transcripts / term_dictionary） | 6 支 upsert 腳本存在於 repo；只有一部分實際反映在 DB（見下方 Partially Completed） |

### Database 現況 — Confirmed by DB via MCP

| 事實 | 判斷依據 |
|------|---------|
| `focusflow` DB 存在，含 12 collections | MCP `list-databases` + `list-collections` |
| 3 筆 demo users、3 筆 courses、2 筆 enrollments、1 筆 clip、1 筆 transcript 均已 seed | MCP `find` |
| 9 筆 videos 存在（pipeline-owned 6 + app demo 3） | MCP `find` |
| 102 筆 `video_001` 的 3072 維 text segments 已匯入 | MCP `aggregate` |
| 15 筆 `video_001` 的 3072 維 video segments 已匯入 | MCP `aggregate` |
| 14 筆 term_dictionary 已匯入 | MCP `count` |

---

## Partially Completed

以下功能有部分程式碼，但存在明確缺口。

### Atlas Vector Search（Backend + Database + RAG 共同缺口）

**MCP 驗證結論**（Confirmed by DB via MCP, 2026-04-17）：
- `focusflow.video_segments_text.searchIndexes = []`
- `focusflow.video_segments_video.searchIndexes = []`
- `focusflow.video_segments_audio.searchIndexes = []`
- Atlas Vector Search Index **目前完全不存在**，`QA_VECTOR_SEARCH_MODE=atlas` 不可用

**有什麼**（Confirmed by Code）：
- `qa.service.js` 已實作 `searchSegmentsWithAtlas()`，fail-fast 邏輯完整
- `.env.example` 有對應設定欄位

**缺口**：
- Atlas vector index 尚未在 MongoDB Atlas UI 手動建立（Confirmed by DB via MCP）
- index name（`text_embedding_index` / `video_embedding_index`）尚未跨組定版（Need Confirmation）
- filter fields 尚未確認（`Need Confirmation`：backend 程式相容 `courseId`、`videoId`、`video_id`，但 DB 層實際要 prefilter 哪一個未定）
- 就算建了 index，`video_segments_text` 內有 3 筆 dim=0（空陣列）的 demo seed 文件仍無法被索引，102 筆 3072 維正常。dim=0 文件不造成維度衝突，但也不會出現在搜尋結果（Confirmed by DB via MCP 2026-04-19）

**負責組**：Database（建立 index + 清資料）+ Backend（設定 env）+ RAG（維度對齊）

### Query Embedding 對齊（✅ 已完成，2026-04-19）

**MCP 驗證結論**（Confirmed by DB via MCP，2026-04-19）：
- `video_segments_text.embedding` 102 筆均為 3072 維（pipeline / `video_001`）
- ~~3 筆為 32 維~~ → 已改為 dim=0（空陣列），32 維文件已消除
- dim=0 的 3 筆文件仍無法被 Atlas vector search 索引（不影響 memory mode）

**完成內容**（Confirmed by live smoke, 2026-04-19）：
- `queryEmbedding.service.js` 新增 `embedWithGemini()`，呼叫 `gemini-embedding-2-preview`，產生 3072 維 query vector
- `runtimeDiagnostics.service.js` 新增 gemini provider 合法性檢查與 key 缺失 hard-fail
- `.env` 已設定 `QA_QUERY_EMBEDDING_PROVIDER=gemini`
- live smoke 確認：`scoringMode: vector`，FocusFlow Pipeline Bridge Course 102 segments 正常命中

**仍未完成**（不影響 memory mode demo）：
- Atlas vector search 仍未啟用（index 不存在，需 Database 組建立）

### LINE Live Delivery（✅ 已完成，2026-04-19）

**完成內容**（Confirmed by live smoke, 2026-04-19）：
- `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` 已設定於 `backend/.env`
- LINE Developer Console webhook URL 已設定（ngrok http 4000）
- live smoke 已在真實 LINE 裝置通過：bind → switch course → ask，回傳答案含時間戳
- `/health` `runtime.line.readiness=ready`、`deliveryMode=live`

**仍需持續注意**：
- ngrok 每次重啟 URL 會變，需手動更新 LINE Console → 正式部署後才能固定
- 學生綁定代碼目前需透過 API 手動取得 → 需前端登入 + QR Code 頁面

### Bridge Course QA 覆蓋率

**判定：Confirmed usable — memory mode（2026-04-19 code reading 驗證）**

**查詢鏈路（Confirmed by Code）**：
`qa.service.js: askQuestion()` → `collectScopedVideos(course)` → `buildCourseSegmentScope()` → `buildSegmentLookupQuery(scope)` → `VideoSegment.find(query)`

`buildSegmentLookupQuery` 對 `video_segments_text` 發出 `$or` 查詢：
- `{ courseId: "680000000000000000000103" }` — `videoSegment.model.js` 宣告 `courseId: ObjectId`，Mongoose 自動轉型字串為 ObjectId → **命中 102 筆** ✅
- `{ videoId: { $in: [...bridge video IDs...] } }` — 0 筆（102 筆的 video_id 是 "video_001"）
- `{ video_id: { $in: [...bridge video IDs...] } }` — 0 筆（同上）

`normalizeSegment()` 後：`courseId` 轉為字串，`text` 欄位 map 到 `transcript`；`segmentMatchesScope()` 以 `allowedCourseIds.has(segment.courseId)` 判斷 → 102 筆全部通過 ✅

`loadScopedSearchableSegments` 最終回傳 **102 筆可搜尋 segments** ✅

**現況細節**：
- `QA_VECTOR_SEARCH_MODE=memory`：可用，走 lexical fallback（degraded 但有答案）
- `QA_QUERY_EMBEDDING_PROVIDER=mock`：query vector 為空 → lexical fallback（非問題，等 RAG 組對齊後升級）
- Atlas mode：仍 hard-fail（index 不存在，與 memory mode 無關）
- Bridge video 本身（`focusflow-demo-video-pipeline-bridge`）仍無對應 segments → 資料模型瑕疵，但不阻塞 demo（courseId 路徑已覆蓋）

**負責組**：已完成（DB 補 courseId + backend Mongoose 自動轉型）；後續升級需 RAG + Database 對齊 embedding

### Pipeline 資料匯入覆蓋率

**MCP 驗證結論**（Confirmed by DB via MCP）：
- 已匯入：`video_001` 的 text segments（102）、video segments（15）、transcripts_normalized（1）、term_dictionary（14）
- **未匯入**：`video_002..006` 的所有 segments（`videos` 集合裡只有 metadata row，沒有任何對應的 `video_segments_*`）
- **未匯入**：任何 audio segments（`video_segments_audio` 整個 collection 為空）

**有什麼**（Confirmed by Code）：
- `import_video_segments_text.py` / `import_video_segments_audio.py` / `import_video_segments_video.py` 等腳本存在

**缺口**：
- 完成 `video_002..006` 的 STT + chunking + embedding → 匯入 DB
- 執行 `import_video_segments_audio.py` 讓 `video_segments_audio` 不再為空
- 確認這些 pipeline segments 是否應該綁到某個 course（目前沒有 `courseId`）

**負責組**：RAG（跑完 pipeline）+ Database（匯入）

### Frontend 整體功能

**有什麼**（Confirmed by Code）：Three.js 動態登陸頁（視覺效果完整，功能性為零）。

**缺口**：見 Remaining Work Frontend 區段。

---

## Remaining Work

### Backend Only

| Title | Priority | Owner | Dependency | Why it matters | Suggested next step |
|-------|----------|-------|------------|---------------|---------------------|
| ~~切換至正式 Gemini query embedding~~ | ✅ Done | Backend | — | 2026-04-19：`embedWithGemini()` 已實作，`QA_QUERY_EMBEDDING_PROVIDER=gemini`，live smoke scoringMode: vector | — |
| 啟用 Atlas vector search（`QA_VECTOR_SEARCH_MODE=atlas`） | P1 | Backend | DB 組建立 Atlas index 並回報 index name | MCP 已確認 index 根本不存在，目前只有 memory mode | 在 Atlas UI 建立 index 後，更新 `QA_ATLAS_VECTOR_INDEX_NAME` |
| 決定 demo DB 策略（共享 vs. 專屬） | P0 | Backend 協調 | 所有組別 | 共享 DB 有 usage log / bind token 污染風險，影響 demo 穩定度 | 討論並決定：提供唯讀 Atlas 給 demo，或提供隔離 demo instance |
| 澄清 `videos` 所有權模型（app-owned vs. pipeline metadata） | P1 | Backend | Database | MCP 實證 DB 現況混用：有些 row 有 `courseId/uploadedBy/processing`、有些沒有，bridge video 為中間狀態 | 在 Schema 層加 `sourceType` 或拆分集合，backend service 明確判斷 |

### Frontend Only

| Title | Priority | Owner | Dependency | Why it matters | Suggested next step |
|-------|----------|-------|------------|---------------|---------------------|
| 登入 / 登出頁面（含 JWT 儲存） | **P0** | Frontend | 後端 `POST /auth/login` 已就緒 | 無登入就無法進入任何功能頁面 | 新增 `/login` route + form + token 寫入 localStorage |
| Protected Route 架構（React Router） | **P0** | Frontend | 登入完成 | 未受保護的頁面直接暴露，無法做 RBAC | 安裝 react-router-dom，建立 `<PrivateRoute>` wrapper |
| API client 設定（axios/fetch + 認證 header） | **P0** | Frontend | 無 | 目前零 API 呼叫 | 建立 `src/api/client.js`，統一設定 `Authorization: Bearer` |
| 課程列表頁（學生 / 教師視角） | **P0** | Frontend | `GET /api/v1/courses` 已就緒 | MVP 核心頁面 | 建立 `/courses` 頁面，串接 API |
| 課程詳情 + 影片列表頁 | P0 | Frontend | `GET /api/v1/courses/:id/videos` 已就緒 | 學生需要選擇影片才能提問 | 建立 `/courses/:courseId` 頁面 |
| QA 問答介面（輸入 + 顯示答案 + 時間戳記） | **P0** | Frontend | `POST /api/v1/qa/ask` 已就緒 | MVP 核心功能，無此功能無法 demo | 建立 QA 輸入框，顯示 `answer`、`matches`（含 `startSec`） |
| 教師影片上傳表單 | P1 | Frontend | `POST /api/v1/videos/courses/:id/videos` 已就緒 | 教師新增課程影片的入口 | 建立 multipart form，顯示處理進度 |
| 影片處理狀態顯示（polling） | P1 | Frontend | `GET /api/v1/videos/:videoId/processing` 已就緒 | 讓教師知道影片是否已準備好 | 對 processing API 做 polling，更新 UI 狀態 |
| LINE 帳號綁定頁（顯示 bind token） | P1 | Frontend | `POST /api/v1/line/bind-token` 已就緒 | 無此頁面使用者無法綁定 LINE 帳號 | 建立 `/settings/line` 頁面，顯示一次性 token |
| Bridge course 呈現策略（QA-only badge 標示） | P1 | Frontend | 與 Backend 確認 `qaScopeOnly` 欄位語義 | Bridge QA memory mode 已確認可用（2026-04-19 code reading）；course 的 `qaScopeOnly=true`、`bridgeMode=qa_scope_only` 已由 backend 正確輸出。Frontend 只需實作 badge 或 filter | 實作時讀取 `qaScopeOnly` 欄位，顯示「課程內容來自 Pipeline Bridge」badge 或類似標示 |
| Degraded / backend-only 狀態提示 | P2 | Frontend | `GET /health` 已就緒 | demo 時讓觀眾理解系統狀態 | 可選：dashboard 顯示 health badge |
| ESLint 設定與 CI lint check | P2 | Frontend | 無 | 目前 `npm run lint` 設定已存在，但無 CI 強制 | 加入 GitHub Actions lint job |

### Database & LINE Bot Only

| Title | Priority | Owner | Dependency | Why it matters | Suggested next step |
|-------|----------|-------|------------|---------------|---------------------|
| 建立 Atlas Vector Search Index（手動，MongoDB Atlas UI） | **P0** | Database | 無（需要 Atlas 管理員權限） | MCP 確認所有 segment collection 的 `searchIndexes=[]`；atlas mode 現在 hard-fail | 登入 Atlas，對 `video_segments_text` 建立 `text_embedding_index`（3072 維），對 `video_segments_video` 建立 `video_embedding_index` |
| 處理 `video_segments_text` 內 dim=0 文件（原 32 維，已改為空陣列） | P1 | Database | Atlas index 建立前 | 2026-04-19 MCP 確認：32 維已清除，改為 dim=0（空陣列）；維度衝突風險已消除。dim=0 文件無法被 vector search 索引，但不影響 ANN 正確性 | 視需要重建 demo seed embeddings 為正式 3072 維，或接受這 3 筆不可搜尋 |
| 確認並回報 Atlas index name 給 Backend | **P0** | Database → Backend | Atlas index 建立完成 | Backend `QA_ATLAS_VECTOR_INDEX_NAME` 需要正確值才能啟用 | 建立後截圖確認 index 名稱，通知 Backend 更新 `.env` |
| 確認 Atlas filter fields（`video_id` / `videoId` / `courseId`） | P1 | Database + Backend | Atlas index 確認後 | MCP 確認 `video_segments_text` 同時存在 snake_case 與 camelCase 欄位，prefilter 需選定一套 | 對齊 `video_segments_text` canonical 欄位後更新 backend env |
| 匯入 `video_002..006` 的 pipeline segments | **P0** | Database | RAG 組輸出 JSONL | MCP 確認 DB 內只有 `video_001` 的 segments；其餘影片只有 videos metadata | 執行 `import_video_segments_text.py` + `import_video_segments_video.py` |
| 匯入 audio segments | P1 | Database | RAG 組輸出 JSONL | MCP 確認 `video_segments_audio` 完全為空 | 執行 `import_video_segments_audio.py` |
| ~~將 pipeline segments 綁定到實際 course~~ ~~確認 QA 查詢路徑~~ → ✅ 已完成（2026-04-19） | — | — | — | DB 補 courseId + Mongoose ObjectId 自動轉型 → Bridge QA memory mode 已可運作（102 筆）。剩餘：升級到 Gemini embedding 後可做語義搜尋 | 無需後續動作；升級路徑見 RAG 組 P0 項目 |
| 確認 videos 所有權邊界（app-owned vs. pipeline metadata） | P1 | Database + Backend | 無 | MCP 確認 DB 中 `videos` 混用兩種 row 格式，bridge video 為中間狀態 | 加 `sourceType` 欄位或拆分集合 |
| ~~取得 LINE token + 設定 webhook URL~~ | ✅ Done | Database & LINE Bot | — | 2026-04-19：LINE_CHANNEL_SECRET/ACCESS_TOKEN 已設定，webhook URL 已指向 ngrok | — |
| ~~執行 LINE live smoke test~~ | ✅ Done | Database & LINE Bot | — | 2026-04-19：bind → switch course → ask 真實 LINE 裝置端對端通過 | — |
| 決定並執行 demo DB 隔離策略 | P1 | Database 協調 | 與所有組別對齊 | 共享 DB 若允許 demo seed 寫入，會留下測試痕跡（MCP 本輪未掃 usage_logs / line_bind_tokens，`Need Confirmation`） | 評估：提供唯讀 demo DB 或建立隔離 demo instance |
| 確認 `init_collections.js` 宣稱 14 collections 與 MCP 實測 12 的落差 | P2 | Database | 無 | 避免後續腳本依賴不存在的 collection | 比對 `init_collections.js` 的清單 vs MCP 實際 collection 列表 |

### RAG Only

| Title | Priority | Owner | Dependency | Why it matters | Suggested next step |
|-------|----------|-------|------------|---------------|---------------------|
| 確認 Gemini Embedding 2 模型名稱與維度（3072）給 Backend | **P0** | RAG | 無 | MCP 確認 pipeline 已產生 3072 維向量（`video_001`），query 端需對齊 | 確認 `GEMINI_EMBEDDING_MODEL_NAME` 後通知 Backend 更新 `.env` |
| 完成 `video_002..006` 的 pipeline 輸出 | **P0** | RAG | 無 | MCP 確認只有 `video_001` 有 segments | 執行 `python src/main.py`，確認 `data/outputs/` 有每支影片的 JSONL |
| ~~決定 pipeline segments 如何綁定 course~~ ~~確認查詢相容性~~ → ✅ 已完成（2026-04-19） | — | — | — | DB 補 courseId=ObjectId("...103")；backend `videoSegment.model.js` 宣告 courseId 為 ObjectId，Mongoose 自動轉型，查詢相容性已確認。Bridge QA memory mode 可用 | 無需後續動作 |
| 確認 `video_segments_text` canonical 欄位（`video_id` vs `videoId`、`start_sec` vs `startSec`） | P1 | RAG + Database | 無 | MCP 確認 DB 內兩套命名實體共存；backend 現在靠 normalize 相容，但長期維護困難 | 決定一套命名，更新 `import_video_segments_text.py` 與 backend normalize 邏輯 |
| 明確 `clips` vs `video_segments_video` 的正式分工 | P2 | RAG + Backend | 無 | MCP 確認 `clips` 僅 1 筆 demo seed、`video_segments_video` 有 15 筆 pipeline 輸出，定位分歧 | 定義哪個集合是 clip 的 source of truth，更新文件 |
| Audio / Video embedding 的 QA 整合路徑 | P2 | RAG + Backend | Phase-2 | MCP 確認 `video_segments_audio` 為空、`video_segments_video` 未進 QA pipeline | 規劃 multimodal retrieval 策略（phase-2 再處理） |

### Cross-functional / Shared（需跨組協作的整合點）

| Title | Priority | Owner | Collaborators | Dependency | Why it matters | Suggested next step |
|-------|----------|-------|---------------|------------|---------------|---------------------|
| Phase-1 契約 Freeze 會議 | **P0** | Backend 發起 | 所有組別 | 無 | Atlas index name、filter fields、videos ownership、query embedding provider、pipeline→course 綁定策略 五件事未定版 | 排一次同步會議，逐點確認並寫入文件 |
| Frontend × Backend API 整合測試 | **P0** | Frontend | Backend | Frontend 登入頁完成 | 確認前端串後端實際可行（CORS、token 流程、response format） | 先跑 auth flow，再逐步擴展到 courses / QA |
| Demo 環境策略決定（DB 隔離 / seed 策略） | **P0** | 全體 | 全體 | 無 | MCP 已看到 DB 內有混合資料（pipeline + demo seed），不隔離則 demo 當天可能有資料污染 | 確認：是否提供專屬 demo MongoDB instance |
| QA 端到端流程驗證（Frontend → Backend → DB → QA → 回傳） | **P0** | Frontend + Backend | Database, RAG | 前端 QA UI + Atlas / 正式 embedding 就緒 | MVP 核心 demo flow 必須跑通 | 先用 memory mode + mock embedding 打通前後端；再換正式 provider |
| LINE live demo 驗收（外部 smoke test） | P1 | Database & LINE Bot | Backend, Frontend | LINE token + webhook 設定 + Frontend LINE 綁定頁 | 確認 LINE bot 整合完整流程可展示 | token 就緒後，Backend + LINE Bot 組聯合執行 live smoke |
| Frontend × Bridge Course 呈現策略實作 | P1 | Frontend | Backend | Frontend 開始實作課程列表前 | 2026-04-19 code reading 確認：Bridge QA memory mode 已可用（102 筆 via courseId）。Backend 回傳 `qaScopeOnly=true`、`bridgeMode=qa_scope_only`，Frontend 直接讀取這兩個欄位實作顯示邏輯 | Backend 說明 `qaScopeOnly`/`bridgeMode` 欄位後，Frontend 實作 badge 或篩選邏輯 |

---

## Code Risks / Technical Debt

| 風險 / 技術債 | 嚴重程度 | 主要負責組 | 說明 | 判斷來源 |
|--------------|---------|-----------|------|---------|
| Frontend 從零開始，時程壓力最大 | 🔴 高 | Frontend | 全部功能性 UI 缺失，是 MVP demo 最關鍵的未完成項 | Confirmed by Code |
| Atlas Vector Search 索引**完全未建立** | 🔴 高 | Database | 三個 segment collection 的 `searchIndexes=[]`；atlas mode 目前 hard-fail | Confirmed by DB via MCP |
| Pipeline segments 僅覆蓋 1 支影片（`video_001`） | 🔴 高 | RAG + Database | MCP 確認 `video_002..006` 沒有 segments；demo 可用影片僅一支真實內容 | Confirmed by DB via MCP |
| Bridge course QA（memory mode 已可用） | 🟢 低 | RAG + Backend | 2026-04-19 code reading 確認：courseId 查詢命中 102 筆，Mongoose 自動轉型，memory mode 已可正常運作。剩餘瑕疵：bridge video_id 本身 0 筆（不阻塞 demo）；升級 Gemini embedding 後可提升到語義搜尋 | Confirmed usable，Confirmed by Code 2026-04-19 |
| `video_segments_text` 雙欄位命名（`video_id` / `videoId`、`start_sec` / `startSec`） | 🟡 中 | Database + Backend | MCP 確認兩套命名同時存在於不同文件 → backend normalize 是必要，不是選項 | Confirmed by DB via MCP |
| `videos` 集合混用 pipeline metadata 與 app-owned row | 🟡 中 | Database + Backend | MCP 確認 DB 中 9 筆 row 至少 3 種形狀（pipeline / app / 中間型 bridge） | Confirmed by DB via MCP |
| `video_segments_text` embedding 維度不一致（3072 vs 0） | 🟢 低 | RAG + Database | 2026-04-19 MCP 確認：32 維已消除，改為 dim=0（空陣列）。dim=0 不會造成 ANN 維度衝突，但這 3 筆仍無法被 vector search。整體風險已下降 | Partially fixed，Confirmed by DB via MCP 2026-04-19 |
| `video_segments_audio` 完全空 | 🟡 中 | RAG + Database | MCP 確認集合存在但 0 documents | Confirmed by DB via MCP |
| ~~Query embedding 與 pipeline 維度不對齊~~ | 🟢 已解決 | Backend | 2026-04-19：`embedWithGemini()` 接通，query 維度 3072 與 pipeline 對齊，`scoringMode: vector` 確認 | Confirmed by live smoke 2026-04-19 |
| ~~LINE live reply 未測試~~ | 🟢 已解決 | Database & LINE Bot | 2026-04-19：live smoke 通過，`deliveryMode=live` | Confirmed by live smoke 2026-04-19 |
| ngrok URL 每次重啟會變 → LINE Webhook URL 需手動更新 | 🟡 中 | 全體 | 短期展示可接受；正式部署需固定 HTTPS 網址 | 已知限制（2026-04-19） |
| 共享 MongoDB 可能留下 usage log / bind token 痕跡 | 🟠 低中 | Database | 本輪 MCP 未逐筆掃描 `usage_logs` / `line_bind_tokens` | Need Confirmation |
| Frontend 缺少狀態管理架構 | 🟠 低中 | Frontend | 從零建立時需決定 Context / Zustand / Redux | Confirmed by Code |
| `clips` 集合定位不明確 | 🟢 低 | RAG + Backend | MCP 僅 1 筆 demo seed；phase-2 前不影響主流程 | Confirmed by DB via MCP |
| 前端缺少自動化測試 | 🟢 低 | Frontend | phase-1 MVP 可以只跑 lint + build | Confirmed by Code |
| CORS 目前是 `cors()`（允許所有來源） | 🟢 低 | Backend | MVP 可接受；生產環境前需鎖定 `ALLOWED_ORIGIN` | Confirmed by Code |
| `init_collections.js` 宣稱 14 collections vs MCP 實測 12 | 🟢 低 | Database | 落差來源未查證 | Need Confirmation |

---

## Recommended Execution Order

從「MVP 可 demo」與「整合風險最低」的角度排序：

### Sprint 1：打通端到端主流程（立即）

1. **[全體] Phase-1 契約 Freeze 會議**（P0）
   - 確認：Atlas index name、filter fields、videos ownership、query embedding provider、pipeline→course 綁定策略
   - 輸出：更新 `backend/docs/handoff-known-issues.md` 與各組 README

2. **[Database] 建立 Atlas Vector Search Index**（P0）
   - 在 MongoDB Atlas UI 建立 `text_embedding_index`（3072 維）
   - 前置：確認 dim=0 的 3 筆 demo seed 文件是否需重建為 3072 維（32 維已於 2026-04-19 由 DB 組清除，目前為空陣列，不影響 ANN 維度但無法被 vector search）
   - 回報 index name 給 Backend

3. **[RAG] 完成 `video_002..006` pipeline 輸出並確認維度**（P0）
   - 確認 `data/outputs/` 每支影片有正確格式的 segments
   - 告知 Database 組與 Backend 組模型名稱

4. **[Database] 匯入 pipeline segments 到 demo DB**（P0）
   - 執行 `import_video_segments_text.py`（對 `video_002..006`）
   - 執行 `import_video_segments_audio.py`（第一次）
   - 與 RAG / Backend 確認 pipeline segments 要如何 attach 到 course

5. ~~**[Database & LINE Bot] 取得 LINE token 並設定 webhook**~~ ✅ 已完成（2026-04-19）
   - token 已設定；webhook URL 已指向 ngrok；live smoke 通過

### Sprint 2：Frontend 核心 UI（立即平行推進）

6. **[Frontend] 建立 API client + 登入頁 + Protected Route**（P0）
   - 這三件事是所有其他前端工作的 prerequisite

7. **[Frontend] 課程列表頁 + 課程詳情頁**（P0）

8. **[Frontend] QA 問答介面**（P0）
   - 先用 memory mode + mock embedding 打通前後端
   - 確認 `answer`、`matches`、`startSec` 正確顯示

### Sprint 3：完整整合與 demo 準備

9. ~~**[Backend + RAG] 切換 query embedding 至 Gemini**~~ ✅ 已完成（2026-04-19）
   - `embedWithGemini()` 已實作，`.env` 已切換，live smoke 確認 `scoringMode: vector`

10. **[Backend] 啟用 Atlas vector search**（P1）
    - Atlas index 就緒後更新 `QA_VECTOR_SEARCH_MODE=atlas`

11. **[Frontend] 影片上傳表單 + 處理狀態顯示**（P1）

12. **[Frontend] LINE 帳號綁定頁**（P1）

13. **[全體] QA 端到端整合驗收**（P0）
    - Frontend → Backend → DB → semantic retrieval → answer 全流程跑通

14. ~~**[Database & LINE Bot + Backend] LINE live smoke test**~~ ✅ 已完成（2026-04-19）

### Sprint 4：優化與收尾（demo 前）

15. **[全體] 決定 demo DB 隔離策略**
16. **[Frontend] Bridge course 呈現策略實作**
17. **[Frontend] Degraded / backend-only 狀態提示**（選做）
18. **[Backend] CORS 限定 origin**（生產前必做）

---

*最後更新：2026-04-19（LINE live smoke 驗證通過；Gemini query embedding 接通；TODO 對應項目標為完成）*
*2026-04-19 前次更新：backend code reading 確認 Bridge Course QA memory mode 可用；DB 現況經 MongoDB MCP 重驗*
*2026-04-18 更新：依 `backend/.env` 實際 token 狀態劃掉已完成項目*
*原始建立：2026-04-17（DB 現況經 MongoDB MCP 驗證）*

---

## Recent Updates

### 2026-04-19 — LINE live smoke 通過 + Gemini query embedding 接通

> LINE 組員完成設定，並在真實 LINE 裝置端對端驗證 bind → switch course → ask 全流程。

- ✅ **LINE live smoke 通過**：真實 LINE 裝置 bind → switch course（Pipeline Bridge Course）→ ask，Gemini 回傳答案含影片時間戳
- ✅ **`embedWithGemini()` 新增至 `queryEmbedding.service.js`**：呼叫 `gemini-embedding-2-preview`，3072 維，與 STT pipeline 對齊
- ✅ **`runtimeDiagnostics.service.js` 更新**：`gemini` 加入合法 provider 清單，補 `GEMINI_API_KEY_MISSING_FOR_QUERY_EMBEDDING` hard-fail
- ✅ **`scoringMode: vector` 確認**：102 個 Pipeline Bridge Course segments 正常命中（非 lexical fallback）
- ✅ **`/health` 確認**：`line.readiness=ready`、`deliveryMode=live`、`qa.readiness=ready`
- ✅ **`.env` 修正**：`PROCESSING_WEBHOOK_SECRET` 改回正確 secret 字串；`QA_QUERY_EMBEDDING_PROVIDER=gemini`
- ⏸ **ngrok URL 不固定**：每次重啟需手動更新 LINE Console（短期限制，正式部署後消除）
- ⏸ **學生綁定需前端支援**：目前僅能透過 API 手動取得代碼

---

### 2026-04-19 — backend 查詢鏈路 code reading（Bridge Course QA 確認）

> 閱讀 `qa.service.js`、`bridgeScope.service.js`、`videoSegment.model.js`，確認 Bridge Course QA 在目前 DB 狀態下是否實際可用。

- ✅ **Bridge Course QA — Confirmed usable（memory mode）**：`buildSegmentLookupQuery` 發出 `{ courseId: "...103" }`；`videoSegment.model.js` 宣告 `courseId: ObjectId`，Mongoose 自動轉型 → 命中 102 筆 pipeline segments
- ✅ **`normalizeSegment` + `segmentMatchesScope` 正確處理 pipeline 文件**：`text` 欄位 map 到 `transcript`；`courseId` 字串化後通過 Set 比對
- ⚠️ **Degraded（lexical fallback）**：目前 `QA_QUERY_EMBEDDING_PROVIDER=mock` → query vector 為空 → lexical scoring，仍可回傳答案但非語義搜尋
- ⏸ **Atlas mode 仍 hard-fail**：與 Bridge QA 可用性無關；需 DB 組建立 index 才能啟用
- ℹ️ **Bridge video_id 0 筆**：`focusflow-demo-video-pipeline-bridge` 本身無段落，屬資料模型瑕疵，不阻塞 memory mode demo

### 2026-04-19 — MongoDB MCP 重驗（組員 DB 修改後）

> 組員聲稱未修改 repo 程式碼，僅修改 DB 內容。以下為 MCP 實測結論。

- ✅ **courseId 已補至 pipeline segments**：102 筆 `video_001` 的 `video_segments_text` 文件，均已加上 `courseId=ObjectId("680000000000000000000103")`（Bridge Course ID）。這是本次最大的 DB 修改。
- ✅ **32 維 mock embedding 已清除**：3 筆 demo seed 的 embedding 從 32 維改為空陣列（dim=0），32 維維度衝突風險消除。
- ✅ **Bridge course QA DB 端改善（courseId 路徑已通）**：透過 courseId 可找到 102 筆 segments；bridge video 的 `video_id=focusflow-demo-video-pipeline-bridge` 仍無對應文件（資料模型瑕疵，不阻塞）。結合 backend 查詢鏈路驗證，Bridge Course QA 在 memory mode **Confirmed usable（2026-04-19 code reading）**。
- ⏸ **Atlas Vector Search indexes：無變化**：三個 collection 的 `searchIndexes` 仍為 `[]`，atlas mode 仍 hard-fail。
- ⏸ **video_002..006 segments：無變化**：`video_segments_text` 與 `video_segments_video` 對 video_002..006 仍各為 0 筆。
- ⏸ **video_segments_audio：無變化**：整個集合仍為 0 筆。
- ⏸ **欄位命名雙套仍存在**：demo seed 3 筆仍有 camelCase；pipeline 102 筆仍為 snake_case。demo seed 端新增了 `video_id` 字串欄位，pipeline 端新增了 `courseId`，但統一命名未完成。
- ⏸ **videos 集合 ownership 混亂：無變化**：pipeline rows 仍無 `courseId`/`uploadedBy`；bridge video 203 仍無 `sourceType`。

### 2026-04-18 — `backend/.env` token 盤點
- ✅ `LINE_CHANNEL_ACCESS_TOKEN` 已設定
- ✅ `LINE_CHANNEL_SECRET` 已設定
- ✅ `GEMINI_API_KEY` 已設定（`QA_ANSWER_PROVIDER=gemini` 可用）
- ✅ `MONGODB_URI` 指向 Atlas
- ✅ `DEMO_SEED_ENABLED=false`（減少 Atlas demo 資料污染）
- ⏸ `QA_VECTOR_SEARCH_MODE=memory`（Atlas Vector Index 尚未建立，維持 memory mode 正確）
- ⏸ `QA_QUERY_EMBEDDING_PROVIDER` 仍待切換為 `gemini`（需 RAG 組先凍結模型名稱）
- ⏸ LINE Developer Console webhook URL 尚未驗證
- ⏸ LINE live smoke test 尚未執行
