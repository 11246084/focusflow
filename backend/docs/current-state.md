# Backend 目前狀態

最後更新：2026-05-01（新增 question recording、teacher/student stats、admin 管理 API、Atlas 同步腳本）

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
- `.env` 目前設定使用 Atlas vector search（`text_embedding_index`），但共享 Atlas 上該 index 已不存在；除非重建 index，否則需切回 `QA_VECTOR_SEARCH_MODE=memory` 才能穩定 QA
- answer generation 使用 Gemini（`gemini-2.5-flash`）
- demo 資料不自動建立，需明確執行 `npm run seed`
- 若要先清掉再重建，使用 `npm run seed:reset`
- LINE live 已可端對端接收訊息並回傳 AI 答案與影片時間戳

目前 QA bridge contract：

`course.videoIds -> videos._id -> videos.videoId -> video_segments_text.videoId`

## 資料庫實況（共享 Atlas, MCP + UI 驗證，2026-05-01）

> 連線目標：`百陶's Org` → `focusflow` cluster → `focusflow` DB（共享 Atlas）。
> 資料相較 2026-04-19 快照已被更動：先前 105 筆 segments / 9 筆 videos 的內容已移除，目前僅留下 1 支新上傳影片與其 9 個 chunks。

| Collection | 筆數 | 備註 |
|---|---|---|
| `courses` | 3 | FocusFlow Pipeline Bridge Course / Demo QA Course / Demo Processing Course |
| `videos` | 1 | 1 筆 app-owned（`sourceType: upload`、`videoSource: local`、`processing.status: completed`），掛在 Bridge Course |
| `users` | 3 | Demo Teacher / Student / Admin |
| `video_segments_text` | 9 | 全部 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`），對應同一支上傳影片，`embedding` 為 3072 維 |
| `video_segments_video` | 16 | DB 文件仍為 snake_case（`video_id`、`clip_id`、`start_sec`），尚未接 QA |
| `video_segments_audio` | 0 | Pipeline 預留 |
| `questions` | 1 | **新增**，每次 QA 提問自動寫入；含 matches/runtime/`sourceUsageLogId` 連結 |
| `clips` | 1 | Legacy |
| `enrollments` | 1 | |
| `usage_logs` | 7 | login / watch / ask / clip_view |
| `line_bind_tokens` | 0 | TTL 自動清除 |
| `transcripts_normalized` | 1 | Pipeline 產出 |
| `term_dictionary` | 14 | Pipeline 產出 |

**Collections 總計：13**（含 2026-04-30 新增的 `questions`；先前快照為 12）

**與 init 腳本差異（2026-05-01）：**

- `database/tools/setup/init_collections.js` 目前列 15 個 collection，不是舊文件寫的 14 個
- init 有、Atlas 目前沒有：`stt_cache`、`raw_transcripts`、`video_segments`
- Atlas 有、init 目前沒有：`questions`
- 結論：問題不是單純 collection 數量差，而是 init 腳本與共享 Atlas 實況清單不同步；後續需由 Database/Backend 決定要補 init 腳本、建立缺漏 collection，或把 legacy collection 從 init 移除

**已知 index 狀態：**

- `video_segments_text`：5 個 classic indexes（`_id_`、`courseId_1`、`segmentId_1`、`videoId_1`、`courseId_1_videoId_1`）；**目前 cluster 無任何 Atlas Search / Vector Search Index**（Atlas UI Indexes 分頁與 MCP `searchIndexes: []` 一致）。先前文件描述的 `text_embedding_index` READY 狀態屬於舊快照，此 cluster 目前不存在
- `questions`：13 個 classic indexes，包含 `courseId`、`status`、`source`、`topSegmentId`、`askedAt`、複合索引（`courseId_1_askedAt_-1`、`userId_1_askedAt_-1`、`courseId_1_status_1_askedAt_-1`、`courseId_1_topSegmentId_1`）、text index（`question_text_answer_text`）、`sourceUsageLogId` 唯一稀疏索引

**對 runtime 的影響：**

- `.env` 仍設定 `QA_VECTOR_SEARCH_MODE=atlas` + `QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`，但 cluster 上索引已不存在，啟動或第一次 `/api/v1/qa/ask` 會走 fail-fast 路徑（`runtime.qa.readiness=hard_fail` 或 aggregate 報錯）
- 短期方案：切回 `QA_VECTOR_SEARCH_MODE=memory`（9 筆 segments 仍可走 in-memory cosine）
- 中期方案：在 Atlas 重建 `text_embedding_index`（3072 維 cosine，filter fields：`courseId` ObjectId、`videoId` camelCase）

## 已完成項目

- auth / JWT / RBAC 主線已可用
- courses CRUD（含 PATCH/DELETE）、videos CRUD（含 DELETE）、processing 狀態流程已可用
- `/api/v1/qa/ask` 已能回 answer、matches、時間資訊與 runtime 訊號
- 提問自動寫入 `questions` collection（2026-04-30）：`questionRecording.service.js` 在 QA 與 LINE Bot 路徑都會落庫；含 matches、runtime、`sourceUsageLogId` 連結至對應 `usage_logs`
- Teacher / Student dashboard 統計 API（2026-04-30）：`/api/v1/stats/teacher`、`/api/v1/stats/student`，由 `teacherStats.service.js` 聚合
- Admin 管理 API（2026-04-30）：`/api/v1/admin/{stats,users,videos,events,event-stats}`，可停用使用者、變更角色、刪除影片、查看最近事件
- Gemini query embedding 已接上；Atlas vector search 仍由 `.env` 指向 `text_embedding_index`，但目前共享 Atlas 缺少該 index，需重建 index 或切回 memory mode
- QA misconfig、Atlas not ready、fallback 與 `no_searchable_segments` 已可明確觀測
- `POST /api/v1/line/bind-token`、webhook verify、bind、switch course、ask question routing 已完成
- LINE live smoke 已完成（2026-04-19）：真實 LINE 端對端 bind → switch course → ask 全程走通
- LINE Bot 多輪對話歷史（2026-04-21）：每輪 Q&A 結束後將最新 6 筆紀錄（3 輪）寫入 `User.lineConversationHistory`；下次提問時帶入 Gemini 作為 `contents` history，支援上下文連貫問答
- LINE QR 綁定 + 課程交接流程修正（2026-04-30，commit `c87fdad`）
- QA grounding / matched video 標籤改善（2026-04-30，commit `c819bca`）
- STT Pipeline 自動化整合（2026-04-27）：影片上傳後 `video.service.js` 自動 spawn STT pipeline；pipeline 透過 `POST /api/v1/internal/videos/:id/processing/start|complete|fail` 回報狀態；pipeline 結束後自動執行 `mongodb_uploader.py` 寫入 `video_segments_text`
- `queryEmbedding.service.js` 支援 `gemini-embedding-2-preview`（3072 維）
- LINE non-live、backend-only、QA hard-fail 訊號已補齊
- `GET /health` 已能直接顯示 `runtime.qa` 與 `runtime.line`
- backend-only acceptance smoke 已存在，可在不碰共享 MongoDB 的前提下重驗主線
- demo baseline 可用 `npm run seed` 收斂，`npm run seed:reset` 可保守清除後重建
- DB 同步 / 維運 scripts 現況：
  - `npm run db:sync-atlas` 可用，實際執行 `src/scripts/syncLocalMongoToAtlas.js`，以 upsert-by-`_id` 將 local MongoDB 同步到 Atlas，清單包含 `questions`
  - `src/scripts/syncQuestionsToAtlas.js` 可單獨同步 questions 到 Atlas（含 course 補齊與 local user → Atlas user 對應），但目前未掛 npm script
  - `npm run db:ensure-questions` 與 `npm run db:backfill-questions` 是 dangling scripts：`src/scripts/ensureQuestionsCollection.js`、`src/scripts/backfillQuestionsFromUsageLogs.js` 目前不存在，執行會失敗
- OpenAPI 現況：`backend/docs/openapi.yaml` 已掛在 `/docs`，但尚未涵蓋 stats/admin 路由，也缺 courses/videos 的 PATCH/DELETE；API 清單暫以實際 route files 與 README 表格為準

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

- `videos` 仍是 mixed collection（`videoId` 欄位 unique+sparse，pipeline-owned 與 app-owned 共存於同一 collection），ownership 邊界尚未定版
- `video_segments_text` 欄位：已全面統一為 camelCase（`videoId`、`startSec`、`endSec`、`chunkId`、`segmentId`）；`segmentId` 值通常為 null，實際識別碼為 `chunkId`（如 `<videoObjectId>_chunk_0001`）
- `video_segments_video` 文件仍為 snake_case（`video_id`、`clip_id`、`start_sec`、`end_sec`），與 `video_segments_text` 不一致；尚未接 QA
- `video_segments_video`：有 embedding，但無 Atlas vector search index，multimodal QA 目前不可用
- 當前 MCP 連線目標 DB 上沒有任何 vector search index；若要在此 DB 走 atlas mode，需在 Atlas 端建立 `text_embedding_index`
- `FocusFlow Pipeline Bridge Course` 是 pipeline-style demo baseline，不代表 live pipeline 已完整同步；目前 9 個 segments 對應同一支上傳影片
- Video model 仍未補 `youtubeVideoId` 欄位；YouTube 自動上傳與時間戳跳轉連結組合尚未實作
- ngrok 每次重啟 URL 會變，LINE Developers Console Webhook URL 須手動更新
- CORS 目前是寬鬆 `cors()`；正式環境前需限縮為 `ALLOWED_ORIGIN`
- Collections 實際為 13；`init_collections.js` 列 15 個，且與 Atlas 清單不同步（init 多 `stt_cache` / `raw_transcripts` / `video_segments`，Atlas 多 `questions`）

## 一句話結論

截至 2026-05-01，backend 主線為 `gemini query embedding + gemini answer（gemini-2.5-flash）+ LINE live + 多輪對話歷史 + STT Pipeline 自動觸發 + 提問自動落庫到 questions + Admin/Stats 管理 API 上線`。`video_segments_text` 欄位已全面 camelCase；但共享 Atlas 目前缺少 `text_embedding_index`，atlas mode 需重建 index 或暫切 memory。短期限制：YouTube 整合與 `youtubeVideoId` 尚未補、ngrok URL 不固定、CORS 仍寬鬆、OpenAPI 尚未補 stats/admin 與 PATCH/DELETE、`video_segments_video` 仍為 snake_case 且無 vector index。
