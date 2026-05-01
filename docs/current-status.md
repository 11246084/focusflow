# docs/current-status.md — FocusFlow 目前進度

最後更新：2026-05-01

> 這份文件是跨服務的動態進度頁。後端詳細狀態見 [backend/docs/current-state.md](../backend/docs/current-state.md)。

---

## Phase-1 整體完成度

| 服務 | 狀態 | 說明 |
|------|------|------|
| **Backend** | ✅ 主線穩定 | auth / courses（CRUD）/ videos / qa / LINE / stats / admin 已可用；共享環境設定為 `gemini + atlas + gemini`；LINE Bot 多輪對話歷史；提問自動寫入 `questions` |
| **Frontend** | ✅ 第一階段頁面完成 | 登入頁 + 11 頁面（Student/Teacher/Admin × 多頁）；API 整合進行中（教師建立課程、LINE QR 綁定、QA grounding 已串接） |
| **AI Pipeline** | ✅ 可執行 | STT → chunking → embedding → MongoDB 主流程完整；上傳影片後由 backend 自動 spawn |

---

## Backend 目前 Runtime（2026-05-01 更新）

```
QA_QUERY_EMBEDDING_PROVIDER = gemini
QA_VECTOR_SEARCH_MODE       = atlas
QA_ATLAS_VECTOR_INDEX_NAME  = text_embedding_index
QA_ATLAS_FILTER_MODE        = bridge_course_or_video
QA_ANSWER_PROVIDER          = gemini
GEMINI_CHAT_MODEL           = gemini-2.5-flash
DEMO_SEED_ENABLED           = false  （需手動 npm run seed）
```

- `/health` 可直接觀察 `runtime.qa` 與 `runtime.line` 狀態
- QA misconfig 與 Atlas not ready 已 fail-fast，不靜默降級
- **共享 Atlas 已被重置**（2026-05-01 驗證）：`videos` 1 筆、`video_segments_text` 9 筆，`text_embedding_index` 目前不存在；`.env` 仍寫 `atlas` mode，實務上需切回 `memory` 或重建 vector index 才能跑 QA
- LINE Bot 已端對端驗證；正式部署前 ngrok URL / Channel 設定須再確認

---

## 已完成

- auth / JWT / RBAC 主線
- courses CRUD（含 PATCH/DELETE）、videos CRUD、processing 狀態流程
- 影片上傳後自動 spawn STT pipeline（`video.service.js`），pipeline 透過 `/api/v1/internal/videos/:id/processing/{start,complete,fail}` 回報狀態
- `/api/v1/qa/ask`：answer、matches、時間資訊、runtime 訊號
- 提問自動寫入 `questions` collection（`questionRecording.service.js`，含 matches、runtime、`sourceUsageLogId` 連結）
- bridge-first API 契約已收斂：課程與 QA runtime 會提供 `isBridgeCourse`；`appOwnedVideoCount` / `metadataOnlyVideoCount` 是 `appVideoCount` / `bridgeVideoCount` 的 readability aliases；`resultCategory` 是 Phase-1 convenience field，細節仍以 `status` / `matchStatus` / `degradedReasons` 為準
- demo baseline / reset 路徑已收斂：`npm run seed` 預設只做 converge baseline；`npm run seed:reset` 會保守清除 demo-owned / demo-derived 痕跡後重建；bridge 課程基線目前定位為 pipeline-style demo baseline
- DB 同步腳本：`db:sync-atlas` 可用；`syncQuestionsToAtlas.js` 可直接用 node 執行但未掛 npm script；`db:ensure-questions`、`db:backfill-questions` 目前是 dangling scripts，對應檔案不存在
- LINE：bind-token、webhook verify、bind、switch course、ask routing；前端 LINE QR 綁定流程已串接（2026-04-30）
- LINE Bot 多輪對話歷史（2026-04-21）：每輪 Q&A 後將最新 6 筆紀錄（3 輪）存入 `User.lineConversationHistory`；下次提問時帶入 Gemini 作為 conversation context
- Dashboard 統計 API：`/api/v1/stats/teacher`、`/api/v1/stats/student`
- Admin 管理 API：`/api/v1/admin/{stats,users,videos,events,event-stats}`，包含使用者停用/角色更新、影片刪除、最近事件查詢
- `GET /health`：qa + line runtime 可觀察性
- backend Swagger / OpenAPI 已掛在 `/docs`；raw spec 在 `backend/docs/openapi.yaml`，但尚未涵蓋 stats/admin 路由，也缺 courses/videos 的 PATCH/DELETE，API 清單暫以實際 route files 與 README 為準
- backend tests：11 個測試檔（auth、course-video、qa.routes、qa.service、line.routes、health、docs、api-response、demo-seed.service、answer-generation.service、mvp.acceptance），in-memory store，不依賴真實 MongoDB
- Frontend 11 頁面（Student/Teacher/Admin 各角色 dashboard），登入、教師建立課程、QA grounding、LINE QR 綁定流程已開始串接

---

## 未完成 / 缺口

### 跨組待定版（Phase-1 Blocker）

| 項目 | 負責方 | 說明 |
|------|--------|------|
| Atlas vector index / future naming | DB / MongoDB 組 | 共享 Atlas 目前沒有 `text_embedding_index`；若要維持 atlas mode 需重建。後續若擴到 `video_segments_video` 仍需定版 |
| init collections 與 Atlas 實況差異 | Database + Backend | Atlas 13 collections；`init_collections.js` 列 15 個。init 多 `stt_cache` / `raw_transcripts` / `video_segments`，Atlas 多 `questions` |
| OpenAPI 對齊 | Backend | `backend/docs/openapi.yaml` 尚缺 stats/admin 與新增 PATCH/DELETE 端點 |
| Query embedding 與 pipeline 維度對齊 | AI Pipeline 組 | 目前已改用 Gemini query embedding；仍需持續確認 coverage 與長期契約 |
| `videos` ownership 邊界 | Backend + DB 組 | app-owned video vs pipeline metadata 混存 |
| Live LINE smoke / ops 記錄 | Backend + 外部 | 已有成功提問驗證；仍需保留 callback、channel 與 smoke 紀錄 |
| Demo 環境策略 | 全組 | 共享 DB 是否提供專屬 demo DB |

### Frontend 待完成（API 整合）

- 頁面 UI 已完成，尚待與後端 API 整合（登入、課程列表、QA 問答、LINE 綁定流程）
- LINE Bot 綁定 QR Code 頁面（需呼叫 `POST /api/v1/line/bind-token`，取得 token 後以 QR Code 顯示）
- 問答頁：YouTube 影片嵌入 + 時間戳跳轉（依教授建議採 YouTube 託管）

### Pipeline 待確認

- `clips` 與 `video_segments_video` 正式分工
- 哪些影片已有 searchable segments 覆蓋率（共享 Atlas 重置後目前僅剩 1 支影片 + 9 筆 segments，均屬 Pipeline Bridge Course；先前 105 筆快照已不再存在）

---

## 教授開會決議（2026-04-21）

以下為最近一次與指導教授開會確定的方向，對後續開發有影響：

| 決議事項 | 說明 |
|---------|------|
| 影片託管採 YouTube | 不自建串流伺服器；透過 YouTube embed API 追蹤觀看狀態（暫停、換分頁等）；LINE Bot 回覆影片連結時帶上時間戳 |
| 禁止學生直接上傳影片 | 避免版權問題；改為「分享連結」方式（如 YouTube URL）|
| LINE Bot 不完全整合進網頁 | 網頁負責影片觀看；LINE Bot 負責問答；各自角色獨立 |
| LINE 綁定流程 | 目前一次性 token 可接受；未來前端以 QR Code 顯示（課程ID帶入 QR）|
| 6月2日 demo 重點 | 展示完整工作流程（pipeline → 問答 → LINE 回覆影片時間戳），細節不盡完美亦可 |
| API 使用成本 | 每月約 2 美元，可正常使用 |

---

## 下一步優先順序

1. 前端 API 整合（登入 → 課程列表 → 問答 → LINE 綁定 QR Code）
2. YouTube embed 整合（替換現有影片顯示方式）
3. 決定 demo 環境策略（共享 DB or 獨立 demo DB）
4. 跨組 freeze phase-1 契約（`videos` ownership 邊界、demo seed 流程）

---

## 不能誤稱的邊界

- Atlas vector retrieval **曾在 2026-04-19 共享環境成功驗證，但 2026-05-01 共享 Atlas 已無 `text_embedding_index`，不能誤稱目前 atlas mode ready**
- Query embedding **已切到 Gemini，但仍需持續確認與 pipeline 資料覆蓋率的一致性**
- `video_segments_video` **尚未接手** clip source
- Live LINE **已有成功提問驗證，但尚未完成完整運維化紀錄**
- LINE webhook **已納入 OpenAPI 文件**，但 stats/admin 與部分 PATCH/DELETE 尚未納入；OpenAPI 目前不是完整 API 契約
