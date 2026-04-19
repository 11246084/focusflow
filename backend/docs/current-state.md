# Backend 目前狀態

最後更新：2026-04-19（atlas filter 兩處 bug 修正）

## 文件角色

這份文件是 phase-1 backend 現況唯一真相頁。要回答的只有五件事：

1. 目前正式 runtime 是什麼
2. phase-1 已完成到哪裡
3. `ready`、`degraded`、`hard_fail` 應怎麼解讀
4. 哪些邊界不能講錯
5. 目前已知限制是什麼

## Phase-1 runtime 現況

目前 backend `.env` 設定為：

- `QA_QUERY_EMBEDDING_PROVIDER=gemini`
- `QA_VECTOR_SEARCH_MODE=atlas`
- `QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`
- `QA_ATLAS_FILTER_MODE=bridge_course_or_video`
- `QA_ANSWER_PROVIDER=gemini`
- `GEMINI_CHAT_MODEL=gemini-2.5-flash`
- `DEMO_SEED_ENABLED=false`
- LINE live：`readiness=ready`、`deliveryMode=live`

這代表：

- query embedding 使用 Gemini（`gemini-embedding-2-preview`，3072 維），與 STT pipeline 一致
- retrieval 使用 Atlas vector search（`text_embedding_index`），非 memory mode
- answer generation 使用 Gemini（`gemini-2.5-flash`）
- demo 資料不自動建立，需明確執行 `npm run seed`
- 若要先清掉再重建，使用 `npm run seed:reset`
- LINE live 已可端對端接收訊息並回傳 AI 答案與影片時間戳

目前 QA bridge contract：

`course.videoIds -> videos._id -> videos.video_id -> video_segments_text.video_id`

## 資料庫實況（MCP 驗證，2026-04-19）

| Collection | 筆數 | 備註 |
|---|---|---|
| `courses` | 3 | Demo QA Course / Demo Processing Course / Pipeline Bridge Course |
| `videos` | 9 | 6 pipeline-owned（video_001~006）+ 3 app-owned（sourceType: upload）|
| `users` | 3 | |
| `video_segments_text` | 105 | 全部有 embedding；欄位為 snake_case（`video_id`、`start_sec`）；均有 `courseId` |
| `video_segments_video` | 15 | |
| `clips` | 1 | |
| `enrollments` | 2 | |
| `usage_logs` | 23 | 含 smoke test 痕跡 |
| `line_bind_tokens` | 0 | 乾淨 |
| `transcripts_normalized` | - | pipeline 產出 |
| `video_segments_audio` | - | pipeline 產出 |
| `term_dictionary` | - | pipeline 產出 |

**Collections 總計：12**（非 repo init 腳本宣稱的 14，差異由 Database 組確認）

## 已完成項目

- auth / JWT / RBAC 主線已可用
- courses / videos / processing 狀態流程已可用
- `/api/v1/qa/ask` 已能回 answer、matches、時間資訊與 runtime 訊號
- Gemini query embedding + Atlas vector search 已啟用（`text_embedding_index`，3072 維）
- QA misconfig、Atlas not ready、fallback 與 `no_searchable_segments` 已可明確觀測
- `POST /api/v1/line/bind-token`、webhook verify、bind、switch course、ask question routing 已完成
- LINE live smoke 已完成（2026-04-19）：真實 LINE 端對端 bind → switch course → ask 全程走通
- `queryEmbedding.service.js` 支援 `gemini-embedding-2-preview`（3072 維）
- LINE non-live、backend-only、QA hard-fail 訊號已補齊
- `GET /health` 已能直接顯示 `runtime.qa` 與 `runtime.line`
- backend-only acceptance smoke 已存在，可在不碰共享 MongoDB 的前提下重驗主線
- demo baseline 可用 `npm run seed` 收斂，`npm run seed:reset` 可保守清除後重建

## readiness / degraded / hard_fail 怎麼解讀

### `/health`

- `runtime.qa.readiness=ready`
  - QA runtime 已就緒，可以接受提問
- `runtime.qa.readiness=hard_fail`
  - QA runtime 設定不合法（缺 key、Atlas index 未設定、mode 不相容）
- `runtime.line.readiness=ready`
  - backend 與 live LINE 所需條件都已補齊
- `runtime.line.readiness=degraded`
  - backend routing 可驗證，但 live delivery 未 ready（最常見：`deliveryMode=backend_only`）
- `runtime.line.readiness=hard_fail`
  - LINE 必要條件不成立（驗簽或 channel 設定無法成立）

### `/api/v1/qa/ask`

- `runtime.status=ready` — 問答主線正常
- `runtime.status=degraded` — 走到 fallback 或非理想條件
- `runtime.matchStatus=matched` — 有找到可回答片段
- `runtime.matchStatus=no_relevant_match` — 有資料但沒有足夠相關片段
- `runtime.matchStatus=no_searchable_segments` — 只有 bridge metadata，沒有可搜尋文字片段

## 不能誤稱的邊界

- 不能把共享環境單次成功驗證，講成所有課程與資料都已 fully production-ready
- 不能忽略 Atlas index 狀態，直接假設 `QA_VECTOR_SEARCH_MODE=atlas` 在任何環境都可用
- 不能把 Gemini query embedding 已接上，誤講成所有 pipeline coverage 都已完全對齊
- 不能說 bridge course 的所有影片都已有 searchable segments
- 不能把 ngrok 暫時端點誤稱為固定正式部署網址
- 不能說 `video_segments_video` 已是正式 clip source

## 已知限制

- `videos` 仍是 mixed collection，pipeline-owned（video_001~006）與 app-owned（sourceType: upload）並存，ownership 邊界尚未定版
- `video_segments_text` 欄位：文件已確認只有 `video_id`（snake_case），`videoId`（camelCase）**不存在於文件中**；DB regular indexes 仍存在孤立的 `videoId_1`（索引了不存在的欄位，待 Database 組清除）；`segment_id` 值為 null，實際識別碼為 `chunk_id`；backend 的 normalize 相容路徑保留作為防護，atlas filter 只使用 vector index 支援的欄位
- `FocusFlow Pipeline Bridge Course` 是 pipeline-style demo baseline，不代表 live pipeline 已完整同步
- `clips` 目前只有 1 筆，`video_segments_video` 尚未接成正式片段來源
- `usage_logs` 有 23 筆含 smoke test 痕跡（共享 DB 不適合做全 live smoke）
- Atlas `text_embedding_index`：已確認 READY，105/105 筆 100% 索引，filter fields：`embedding`、`courseId`（ObjectId）、`video_id`（snake_case）；M0 vector index 配額 1/3 已用（2026-04-19 截圖驗證）
- `video_segments_text` regular indexes：`videoId_1`（15 次查詢）+ `video_id_1`（16 次查詢）；**`videoId_1` 為孤立索引**（文件直接確認無 `videoId` 欄位，該 index 索引一個不存在的欄位）；atlas filter 已修正，僅保留 vector index 支援的欄位（`courseId`、`video_id`）
- `video_segments_video`：有 embedding（Array 3072），但無 Atlas vector search index，multimodal QA 目前不可用
- Atlas filter 兩處 bug 已修（`qa.service.js`）：① courseId String→ObjectId cast；② 剔除非 vector index filter field 的 `videoId`（camelCase）條件
- ngrok 每次重啟 URL 會變，LINE Developers Console Webhook URL 須手動更新
- 學生綁定代碼目前需透過 API 手動取得，正式場景需前端登入 + QR Code 頁面
- Collections 實際為 12，與 init 腳本宣稱的 14 有落差，差異由 Database 組說明

## 一句話結論

截至 2026-04-19，backend 主線為 `gemini query embedding + atlas vector search（text_embedding_index）+ gemini answer（gemini-2.5-flash）+ LINE live`；LINE 已在真實裝置端對端驗證成功（bind → switch course → ask），`video_segments_text` 共 105 筆 segments 全部有 embedding。Atlas filter 兩處 bug（courseId 型別、videoId 非法 filter field）已修正。文件確認 `video_id`（snake_case）為 canonical，`videoId` 不存在於文件中，`videoId_1` 為孤立索引待 Database 組清除，`segment_id` 值為 null（實際識別碼為 `chunk_id`）。已知短期限制：ngrok URL 不固定、學生綁定需前端支援。
