# FocusFlow 專案結構與進度摘要

更新日期：2026-07-31  
盤點基準：`main` / `bbb955e`  
盤點方式：Git metadata、Repository 結構、現況文件與實際程式碼交叉核對；未啟動服務、未連線 MongoDB、未呼叫 Gemini、未執行真實影片 Pipeline。

---

## 1. 專案定位與目前階段

FocusFlow 是 AI 教學影片問答系統。核心流程為：

```text
教師上傳影片
→ Backend 建立影片與 processing job
→ Python Pipeline 執行音訊抽取、STT、切段與 Embedding
→ MongoDB 保存可檢索片段
→ 學生透過網頁或 LINE 提問
→ Backend 向量檢索並產生附時間戳的答案
```

目前 Phase 1 MVP 主線已具備課程／影片管理、角色登入、STT Pipeline、文字向量檢索、網頁 QA、LINE QA、時間戳 Citation、通知與管理頁面等主要能力。近期開發已進入 Phase 2 基礎強化與 Phase 2-2 階層切段前置工作，但 Parent Chunk 尚未接入 Embedding、MongoDB 或 Retrieval。

## 2. Git 與版本狀態

| 項目 | 狀態 |
|---|---|
| 目前分支 | `main` |
| HEAD | `bbb955e`－擴大 AI 問答命中片段卡片的跳轉範圍 |
| `origin/main` | 與 HEAD 同步 |
| ahead / behind | `0 / 0` |
| 盤點前工作目錄 | 乾淨 |
| Merge conflict | 無 |

最近兩項直接影響目前架構的提交：

1. `e65c87a`：加入 deterministic Parent Chunk、獨立 `hierarchy` Stage、Hierarchy fingerprint、artifact validation 與 Resume 相容。
2. `bbb955e`：讓 Student QA 命中片段整張卡片皆可跳轉，補齊鍵盤操作與 focus/hover 無障礙提示。

## 3. Repository 高層結構

```text
focusflow/
├── STT_Whisper/              # Python AI Pipeline、Batch、Resume、Chunk 與 Embedding
│   ├── src/
│   ├── tests/
│   ├── tools/
│   └── data/                 # Runtime input/output；不視為程式碼 source of truth
├── backend/                  # Express REST API、MongoDB models、QA、LINE、管理功能
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── middleware/
│   │   └── config/
│   ├── tests/
│   └── docs/
├── frontend/
│   └── focus-flow/           # React 19 + Vite SPA
│       ├── src/components/
│       ├── src/pages/
│       ├── src/services/
│       └── tests/
├── database/                 # Collection/index setup、修復工具與 DB handoff
├── docs/                     # 系統文件、現況、決策、會議紀錄與歷史材料
├── scripts/                  # Repo-level helper scripts
├── tools/                    # Repo-level工具
└── .agents/                  # Repo-local AI agent skills
```

## 4. AI Pipeline 現況

### 4.1 單支影片 Pipeline

實際 Stage 順序由 `STT_Whisper/src/job_manager.py` 定義：

```text
scan
→ extract_audio
→ transcribe
→ normalize
→ chunk
→ hierarchy
→ text_embedding
→ audio_embedding
→ export
→ mongodb_upload
→ backend_webhook
```

主要能力：

- Job Manager：每次執行建立 run manifest，保存影片與各 Stage 狀態。
- Run-aware outputs：正式產物放在 `data/outputs/runs/<run_id>/`。
- Resume／Checkpoint：逐 Stage 驗證 artifact，從第一個無效 Stage 起重跑。
- MongoDB upload：使用 bounded `bulk_write(UpdateOne)` 與 idempotent upsert，並產生 `upload_summary.json`。
- Backend webhook：回報 processing start／complete／fail。
- Batch CLI：支援 bounded concurrency、item-level retry、同一 `run_id` Resume、batch manifest 與 summary。

### 4.2 Leaf Chunk

Leaf Chunk source of truth 仍為 `chunks.jsonl`，現有 ID 與 schema 未因階層功能改變：

```text
<video_id>_chunk_<四位流水號>
```

切段策略為 `adaptive_segment_overlap_v1`，受以下設定控制：

- `CHUNK_MAX_CHARS`
- `CHUNK_MAX_DURATION_SEC`
- `CHUNK_MAX_SEGMENTS`
- `CHUNK_OVERLAP_SEGMENTS`

Chunk config snapshot 與 SHA-256 fingerprint 已接入 manifest／run summary；設定改變會從 `chunk` 起失效所有下游 Stage。

### 4.3 Parent Chunk／Hierarchy

近期新增 `fixed_leaf_grouping_v1`：

- `HIERARCHY_ENABLED=false`，目前預設關閉且為 opt-in。
- Parent 由連續 Leaf deterministic 分組，不使用 LLM、topic detection 或 summary。
- 預設每組 3 個 Leaf，Parent overlap 預設 0。
- Parent ID：`<video_id>_parent_<四位流水號>`。
- 獨立產物：`parent_chunks.jsonl`。
- 保存 `child_chunk_ids`，另提供 child → parents 的記憶體 helper，不新增反向 mapping artifact。
- Hierarchy fingerprint 同時依賴 hierarchy config 與 Leaf Chunk fingerprint。
- Parent artifact 遺失、損壞或 config 改變時，可從 `hierarchy` Stage 重跑。

目前限制：Parent Chunk 尚未建立 Embedding、未上傳 MongoDB，也未被 Backend Retrieval 查詢。

### 4.4 Embedding 與 Multimodal

- Text embedding：Gemini `gemini-embedding-2-preview`，預期 3072 維。
- Audio embedding：主 Pipeline 有獨立 `audio_embedding` Stage。
- Video／multimodal：存在獨立 pipeline 與 `video_segments_video` 契約；Backend 已有初版 visual citation retrieval。
- 視覺片段仍缺 transcript／caption，不能視為完整 multimodal answer source。
- Image embedding：尚未形成獨立正式流程。

## 5. Backend 現況

Backend 採 `routes → controllers → services → models` 分層，主要能力包括：

- JWT、role-aware login、student／teacher 註冊與 RBAC。
- Course／Video CRUD、影片掛載／解除、processing state machine。
- 本機影片上傳後背景觸發 Python Pipeline。
- Internal processing webhook 與 retry endpoint。
- QA query embedding、Atlas／memory retrieval、答案生成與 citation contract。
- FAQ 兩層快取：完全相同文字與 embedding cosine 相似命中。
- LINE bind token、webhook、多輪對話與時間戳回覆。
- Teacher／Student／Admin stats。
- 站內通知與私有頭貼。
- YouTube URL API 與 feature-flagged YouTube auto-upload adapter。

### QA Retrieval 實況

- 主要 collection：`video_segments_text`。
- Vector field：`embedding`。
- Atlas index 名稱：`text_embedding_index`。
- Shared demo env 的 `QA_MATCH_LIMIT=15`；程式碼 fallback 預設仍為 3。
- Scope 可依 `courseId`／`videoId` 與 mixed `videos` bridge contract 限制。
- Context 依檢索 score 排序後送入 answer generation。
- 尚無正式 neighbor expansion、reranker、score threshold 或 retrieval evaluation harness。
- Parent Chunk 尚未進入 Backend model、vector index 或 Retrieval。

### Backend Batch 邊界

目前 Backend 上傳 middleware 仍使用 `upload.single('video')`，沒有真正的 Batch API、多檔 multipart endpoint、batch status API 或 batch resume API，也不會呼叫 `batch_main.py`。Python Batch CLI 與網頁多檔 UX 目前是兩條尚未整合的路徑。

## 6. MongoDB 與資料契約

目前文字 QA 以 camelCase `video_segments_text` 為主：

```text
courseId
segmentId
chunkId
videoId
startSec
endSec
text
corrections
embedding
createdAt
updatedAt
```

重要邊界：

- Text uploader 以 `chunkId` upsert。
- `videos` 是 app-owned 與 pipeline metadata 混存的 mixed collection。
- App-owned Video 的 `_id` 字串可能直接成為 segment `videoId`。
- `video_segments_video` 仍使用偏 snake_case 的 visual contract。
- Uploader 不會自動清除 Chunk strategy 改變後可能殘留的 stale tail chunks。
- Parent Chunk 目前完全不寫入 MongoDB，尚無 hierarchy schema／index／cleanup contract。
- `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` 只能作歷史參考。

## 7. Frontend 現況

前端為 React 19 + Vite，依角色切分 Student／Teacher／Admin 頁面。

已串接的主要流程：

- 登入、註冊、通知、Profile 與私有頭貼。
- 教師課程管理、影片上傳、影片掛載／解除。
- 學生課程播放、YouTube iframe、觀看進度與 QA。
- QA citations、命中片段預覽／展開與 timestamp 跳轉。
- LINE QR 綁定。
- Teacher／Student／Admin dashboards。

近期 QA UI 進展：

- `QA_MATCH_LIMIT=15` 時，預設只顯示前 3 筆命中，使用者可展開全部。
- 整張命中片段卡片可點擊並切換至對應影片時間。
- 支援 Enter／Space 操作以及 hover、focus 樣式。

### 多檔上傳邊界

Teacher Upload 已支援多檔選擇、清單、逐檔狀態、polling 與 `localStorage` 重新整理恢復；但 `videoUpload.js` 仍依序呼叫單支影片 API。這是「多檔前端操作體驗」，不是 Backend Batch Job。

## 8. 最近完成的主要 Sprint

| 功能 | 實際狀態 | 備註 |
|---|---|---|
| Pipeline Job Manager | 已完成 | Manifest 與 Stage 狀態持久化 |
| Run／Output Version | 已完成 | 每個 run 獨立輸出 |
| Resume／Checkpoint | 已完成 | 線性 checkpoint validation |
| MongoDB Upload Optimization | 已完成 | bulk write、summary、idempotent upsert |
| Segment-based Chunk Overlap | 已完成 | Adaptive overlap、config fingerprint |
| Deterministic Parent Chunk | 已完成、預設關閉 | 只產生 artifact，尚未接 Retrieval |
| Python Batch Manager | 已完成 | CLI、concurrency、retry、resume |
| Frontend 多檔 UX | 已完成 | 仍逐支呼叫 Backend API |
| Backend Batch Integration | 尚未完成 | 無 Batch API／status／resume |
| QA match limit 3 → 15 | 已完成 | env 主線已調整，程式 fallback 仍為 3 |
| QA Citation 卡片跳轉 | 已完成 | 整卡點擊與鍵盤操作 |
| Hierarchical Retrieval | 尚未開始 | Parent 尚未 embedding／入庫 |
| Retrieval Evaluation／Reranker | 尚未開始 | 只有規劃方向 |

## 9. 測試與驗證現況

Repository 目前具有：

- STT Pipeline：`unittest` 離線測試，現有程式碼可辨識 99 個 `test_*` 測試函式。
- Backend：Node `node:test`，現況文件最後記錄 2026-07-26 全測 262/262 通過。
- Frontend：已有 `node --test`；最新 QA 卡片提交記錄 9 項前端測試、ESLint 與 production build 通過。

本摘要製作過程沒有重新執行完整測試，因此上述結果是 Repository 既有測試數量與最近 commit／文件留下的驗證紀錄，不代表 2026-07-31 當下重新跑過。

## 10. 文件與實作差異

目前文件有以下同步債務：

1. `STT_Whisper/README.md` 已新增 Hierarchy 章節，但較前段的 Job Manager／Run Version 說明仍殘留「Resume 尚未實作」文字，與後段 Phase 2-3 及實際程式碼衝突。
2. 部分高層架構文件尚未納入 `hierarchy` Stage、`parent_chunks.jsonl` 與 hierarchy fingerprint。
3. Frontend README 的 Teacher Upload 主段落仍偏單支描述，未完整反映最新多檔選擇與批次進度 UI。
4. `docs/current-status.md` 與 `backend/docs/current-state.md` 仍是跨服務／Backend 現況入口，但最新 Parent Chunk 與 QA 卡片提交需要再同步進正式現況頁。
5. Atlas live collection 數量、index readiness 與資料筆數具有時間性；未實際連線時，不應把歷史快照當成當前 live 真相。

## 11. 主要風險與缺口

### 高優先

- Parent Chunk 尚未有 embedding、MongoDB schema、index、stale cleanup 與 Retrieval contract。
- QA／FAQ 快取不會因 `QA_MATCH_LIMIT`、模型或 prompt 變更自動失效。
- `QA_MATCH_LIMIT` 的 env 主線為 15，但程式 fallback 仍為 3，未載入正確 env 時行為不同。
- YouTube auto-upload 已有 adapter 與 OAuth 設定流程，但現況文件仍記錄 live upload smoke 待完成。

### 中優先

- Python Batch CLI、Backend 單支 API、Frontend 多檔 UX 尚未整合成真正 Batch Job。
- Uploader 不清除 strategy 改變後的 stale chunks。
- Retrieval 缺固定 QA benchmark、評估指標、neighbor expansion、threshold 與 reranker baseline。
- `videos` mixed collection ownership 仍是跨 Backend／DB 的長期邊界。

### 文件／維運

- STT README 內部有新舊狀態矛盾。
- OpenAPI 不是完整 API source of truth，部分 internal／stats／admin／PATCH／DELETE 契約仍須以 routes 與 current-state 為準。
- LINE live 曾驗證成功，但 callback、token 與正式運維紀錄仍屬部署時狀態。

## 12. 建議下一步

建議依下列順序推進：

1. **文件收斂**：把 Parent Chunk、最新 Frontend QA UX 與 Batch 真實邊界同步到 `docs/current-status.md`、`ARCHITECTURE.md` 與 STT／Frontend README。
2. **Hierarchy data contract**：定版 Parent embedding metadata、MongoDB namespace、unique key、schema version 與 stale Parent 清理規則。
3. **Retrieval evaluation baseline**：建立固定 QA dataset、Leaf-only baseline 與可量化指標，再導入 Parent Retrieval。
4. **Hierarchical Retrieval Sprint**：先做 Parent candidate retrieval → expand children → Leaf citation；不要直接用 Parent timestamp 取代 Leaf citation。
5. **Batch integration 決策**：確認是否需要 Backend Batch API；若需要，再統一 multipart、batch ID、status、resume 與前端 polling contract。
6. **Runtime hardening**：完成 YouTube auto-upload live smoke、FAQ configuration fingerprint／invalidation，以及 shared Atlas rollout 驗證。

## 13. 現況判斷

FocusFlow 已具備可展示的 Phase 1 端到端文字問答主線，並完成 Job／Resume、Chunk overlap、Batch CLI 與 deterministic Parent Chunk 等 Phase 2 基礎能力。最新 Parent Chunk 工作讓多層級檢索具備可重現、可追溯、可 Resume 的資料生成基礎；但目前仍只是離線 artifact，尚不能宣稱 Hierarchical Retrieval 已完成。

下一個技術重點應是先定版 Parent 資料與評估契約，再把 Parent 引入 Embedding、MongoDB 與 Retrieval；同時應先處理現況文件的矛盾，避免後續開發根據過期描述做錯決策。

---

## 參考來源

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `PROJECT.md`
- `ARCHITECTURE.md`
- `docs/current-status.md`
- `docs/decision-log.md`
- `backend/docs/current-state.md`
- `backend/docs/phase2-api-contract.md`
- `backend/docs/openapi.yaml`
- `STT_Whisper/README.md`
- `frontend/focus-flow/README.md`
- `STT_Whisper/src/`
- `backend/src/`
- `frontend/focus-flow/src/`
- Git commits `e65c87a`、`bbb955e`
