# Phase 2-2 — Hierarchy Data Contract Design v1

## 2026-08-09 Stable Parent Embedding implementation

目前 production contract 已更新為：Gemini `gemini-embedding-2`、3072 維、
`taskType=null`、Parent instruction `title: none | text: <parent_text>`、
instruction version `gemini_embedding_2_asymmetric_retrieval_v2`、generation version
`text_search_generation_v2`、normalization `unit_l2_v1`、contract version
`gemini_embedding_2_text_v2`。Parent artifact schema 為 `parent_embedding_v2`，輸出檔為
`embeddings_parent_gemini_stable.jsonl`。

Fingerprint 依賴 Hierarchy fingerprint、provider、model、dimension、null task type、
instruction、instruction version、generation version、normalization、contract version、
role、schema 與 preprocessing version。Preview artifact 保留供 audit，但 stable resume、
validator 與 uploader 均拒絕混用。本次只完成 offline/mock implementation；live stable
vectors 與 Atlas Parent 更新尚未執行。

> 狀態：2026-08-09 Backend Query 與 STT Parent production contract 已切換 stable；live Parent artifact／Atlas vectors 尚未遷移。Backend 詳細契約見 [backend/docs/embedding-search-contract.md](../backend/docs/embedding-search-contract.md)。
> 範圍：Sprint 2A Parent Embedding、Sprint 2B Parent Storage、Sprint 3 Hierarchical Retrieval、Sprint 4 Retrieval Evaluation  
> 原則：不改寫既有 Leaf Chunk、不污染 Leaf-only QA、Citation 最終仍指向 Leaf。

## 1. 文件目的與決策標籤

本文件是 Phase 2-2 後續四個 Sprint 的資料契約 Source of Truth，將目前 Parent Artifact、Leaf Embedding、MongoDB 與 Backend QA 現況，收斂成可分工、可驗證、可回滾的 v1 設計。

本文使用以下標籤：

- **[Confirmed by current code]**：Repository 目前已實作或明確宣告。
- **[Proposed for v1]**：後續 Sprint 的建議契約，尚未實作。
- **[Backend review required]**：需 Backend owner 確認或執行。
- **[Database review required]**：需 Database owner 確認或執行；不代表 live DB 已具備。
- **[Joint decision required]**：跨組決策尚未定版。
- **[Deferred]**：不納入目前 MVP。

2026-08-08 cross-group gate：`gemini-embedding-2-preview` 與 stable `gemini-embedding-2` 不可混用；兩者同為 3072 維也不能視為同一向量空間。以下仍標記為「目前程式」的 Pipeline／Database 欄位，若尚未更新為 stable text-search contract，只能作為 legacy 現況，不是 Backend 可啟用的 active compatibility 證據。

## 2. Repository 與 Git 基線

- **[Confirmed by current code]** 檢查日期為 2026-07-31；目前 branch 為 `main`，HEAD `bbb955e`，與 `origin/main` ahead/behind 為 `0/0`。
- **[Confirmed by current code]** Sprint 1 Parent Chunk 已由 `e65c87a` 提交；QA Citation 卡片跳轉已由 `bbb955e` 提交。
- **[Confirmed by current code]** Pipeline stage 順序為 `scan → extract_audio → transcribe → normalize → chunk → hierarchy → text_embedding → audio_embedding → export → mongodb_upload → backend_webhook`。
- **[Confirmed by current code]** 本次檢查無 staged、unstaged、merge conflict；另有前一任務留下的 untracked `docs/project-progress-summary-2026-07-31.md`，不屬於本 Sprint，也不在本文件變更範圍。
- **[Confirmed by current code]** `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` 僅供歷史參考，不是現況真相。

## 3. 現況資料流

```text
Video
  → STT / normalize
  → Leaf Chunk
  → optional deterministic Parent Chunk
  → Leaf text embedding
  → existing Leaf MongoDB upload
  → Backend Leaf vector search
  → Leaf citation
```

- **[Confirmed by current code]** Parent 目前只產生本機 JSONL，沒有 Parent Embedding、MongoDB collection、Atlas Vector Index 或 Backend retrieval。
- **[Proposed for v1]** 後續資料流為 `Parent Artifact → Parent Embedding Artifact → Parent Storage → Parent Search → Child Expansion → Leaf Context → Leaf Citation`。
- **[Proposed for v1]** Parent 是 retrieval routing document，不是最終 citation document，也不取代 Leaf。

## 4. 現況 Leaf Chunk Contract

- **[Confirmed by current code]** Leaf 是 `ChunkRecord`，既有 `chunks.jsonl` 與 in-memory chunks 是 Parent generation 與 Leaf embedding 的來源。
- **[Confirmed by current code]** Leaf identity 使用 `chunk_id`；Parent `child_chunk_ids` 直接引用它。
- **[Confirmed by current code]** Leaf 包含 `video_id`、`start_sec`、`end_sec`、`text`，另帶 `course_name`、`week`、`lesson` 等教學 metadata。
- **[Confirmed by current code]** Leaf chunk fingerprint 由 chunk strategy/config 決定，Hierarchy fingerprint 對它有 dependency。
- **[Proposed for v1]** Phase 2-2 不改 Leaf ID、Leaf artifact、Leaf embedding artifact 或 Leaf MongoDB schema。

## 5. 現況 Parent Artifact Contract

### 5.1 Stage 與開關

- **[Confirmed by current code]** `hierarchy` 位於 `chunk` 與 `text_embedding` 之間。
- **[Confirmed by current code]** `HIERARCHY_ENABLED=false` 為預設；disabled 時 stage 標記 skipped，不要求 Parent artifact，且 legacy manifest 可繼續 Leaf-only 流程。
- **[Confirmed by current code]** enabled 時 run-specific artifact 是 `data/outputs/runs/<run_id>/parent_chunks.jsonl`；目前不建立 latest compatibility copy。

### 5.2 Parent JSONL Schema

| 欄位 | 現況契約 |
|---|---|
| `parent_id` | `<video_id>_parent_<四位數>` |
| `video_id` | 與 child Leaf 相同 |
| `hierarchy_level` | 固定 `1` |
| `document_type` | 固定 `parent_chunk` |
| `start_sec` / `end_sec` | 第一個 child 起點／最後一個 child 終點 |
| `text` | child text 以 `\n` 依序串接 |
| `child_chunk_ids` | 有序 Leaf ID 陣列 |
| `child_count` | 必須等於 child ID 數量 |
| `order` | 每支影片從 `1` 連續遞增 |
| `course_name` / `week` / `lesson` | 取第一個 child 的 metadata，可為 null |

以上皆為 **[Confirmed by current code]**。

### 5.3 Generation、Fingerprint 與驗證

- **[Confirmed by current code]** strategy 是 `fixed_leaf_grouping_v1`，schema version `1`，text joiner version `newline_v1`。
- **[Confirmed by current code]** group size 預設 `3`、允許 `2..8`；overlap 預設 `0`、允許 `0..2` 且小於 group size；step 為 `group size - overlap`。
- **[Confirmed by current code]** overlap 可使一個 child 映射到多個 Parent；generator 會避免只剩 overlap child 的尾端 Parent。
- **[Confirmed by current code]** Hierarchy fingerprint 是 hierarchy config、Leaf chunk fingerprint 與 schema version 的 deterministic SHA-256；不含 run ID、時間或路徑。
- **[Confirmed by current code]** artifact validator 驗證 required fields、Parent ID 唯一、level/type、child 存在與同 video、順序、count、timestamp、text joiner 與 per-video order。
- **[Confirmed by current code]** enabled resume 只有在 fingerprint 與 artifact 同時有效時 reuse；不符則由 `hierarchy` 起重跑。disabled legacy manifest 不要求 hierarchy metadata。

## 6. 現況 Leaf Embedding Contract

- **[Confirmed by current code]** `text_embedding` 呼叫 `embed_chunks(chunks, config)`，輸入是 Leaf，不讀 Parent。
- **[Confirmed by current code]** run-specific artifact 為 `embeddings_text_gemini.jsonl`。
- **[Confirmed by current code]** record 欄位為 `chunk_id`、`video_id`、`start_sec`、`end_sec`、`text`、`embedding`、`embedding_model`、`embedding_modality`、`embedding_dim`、`embedding_timestamp`、`embedding_status`、`embedding_error`、`embedding_request_id`。
- **[Implemented 2026-08-09]** STT text/Parent Pipeline 預設 stable `gemini-embedding-2`、3072 維、`taskType=null`、versioned document instruction 與 unit normalization；既有 preview artifacts 仍不可混用。
- **[Confirmed by current code]** runtime config 的 batch default 是 `16`；`.env.example` 是 `1`、README 範例是 `8`，真正 runtime source of truth 是 `PipelineConfig` 加當次環境值。
- **[Confirmed by current code]** 只有 quota/429 類錯誤依 `GEMINI_MAX_RETRIES` 與 backoff retry；失敗 batch 會輸出空 vector 與 failure status，其他 batch 可繼續，形成 partial artifact。
- **[Confirmed by current code]** checkpoint reuse 會驗證 ID、text、model、modality、dimension 與非空 vector；目前沒有獨立 embedding config snapshot 或 embedding fingerprint。
- **[Confirmed by current code]** text 與 audio embedding 共用同一模組與部分模式，但有不同函式、record 與 artifact；Parent 不可塞入 Leaf artifact。

## 7. Parent Embedding Contract v1

### 7.1 Stage 方案比較與決策

| 方案 | 優點 | 風險 | 決策 |
|---|---|---|---|
| A：`hierarchy → parent_embedding → text_embedding` | dependency 最直觀；Parent failure、artifact、resume、fingerprint 完全隔離 | 啟用 Parent 後，Parent failure 會先於本次 Leaf embedding | **[Proposed for v1] 採用** |
| B：合併進 `text_embedding` | stage 少 | 混合兩種 ID/schema/artifact，failure 與 resume 難隔離 | **[Deferred] 不採用** |
| C：`text_embedding → parent_embedding` | Leaf checkpoint 優先完成 | dependency 圖較不直觀，仍需新增 stage，且會改既有 hierarchy→text 相鄰關係 | **[Deferred] 備選** |

- **[Proposed for v1]** 新順序為 `chunk → hierarchy → parent_embedding → text_embedding → audio_embedding`。
- **[Proposed for v1]** `parent_embedding` 必須是獨立 stage、獨立 artifact、獨立 config snapshot、獨立 fingerprint 與獨立 resume validation。
- **[Proposed for v1]** `parent_embedding` 維持 linear pipeline 的 blocking stage，但只有 `PARENT_EMBEDDING_ENABLED=true` 才執行；不改成 non-blocking stage，也不引入 DAG。
- **[Proposed for v1]** `PARENT_EMBEDDING_ENABLED=false` 時無條件 skip Parent embedding，不要求 Parent Embedding metadata/artifact；`HIERARCHY_ENABLED` 只控制 Parent Chunk generation，不再隱含啟用 Parent Embedding。
- **[Proposed for v1]** Parent embedding 不寫入 Leaf embedding artifact；Leaf-only QA 不讀 Parent artifact。Parent failure 不刪除或覆蓋已發布 Leaf data。
- **[Proposed for v1]** explicit opt-in 的 Parent Embedding run 若失敗，整個 run 標記 failed 並停止 downstream stages；這是實驗 run 失敗，不等於既有已發布 Leaf-only QA 失敗。

### 7.2 Feature Gates and Failure Policy

#### 三層 Feature Gate

| Gate | Owner / Sprint | 預設 | 唯一責任 |
|---|---|---:|---|
| `HIERARCHY_ENABLED` | AI Pipeline / Sprint 1 | `false` | 是否產生 deterministic Parent Chunk、執行 `hierarchy` stage |
| `PARENT_EMBEDDING_ENABLED` | AI Pipeline / Sprint 2A | `false` | 是否執行 `parent_embedding` stage |
| `HIERARCHICAL_RETRIEVAL_ENABLED` | Backend / Sprint 3 | `false` | 是否使用 Parent Search → Child Expansion；關閉時維持 Leaf-only retrieval |

- **[Proposed for v1]** 三層 rollout 順序固定為 `Parent Generation → Parent Embedding → Hierarchical Retrieval`；上一層資料存在，不代表下一層自動啟用。
- **[Proposed for v1]** `HIERARCHICAL_RETRIEVAL_ENABLED` 不屬 Sprint 2A 的 Pipeline config；由 Backend 在 Sprint 3 定義，預設 `false`，且必須保留 Leaf-only fallback。

#### Sprint 2A Config Contract

```env
HIERARCHY_ENABLED=false
PARENT_EMBEDDING_ENABLED=false
```

- **[Proposed for v1]** `PARENT_EMBEDDING_ENABLED` 是 boolean，預設 `false`；Source of Truth 是 `PipelineConfig`，支援 environment variable 與 `with_overrides()`，沿用既有嚴格 boolean parsing。
- **[Proposed for v1]** snapshot 只保存 boolean 與 deterministic embedding config，不保存 API key、MongoDB URI 或 runtime path。
- **[Proposed for v1]** `PARENT_EMBEDDING_ENABLED=true` 必須同時滿足 `HIERARCHY_ENABLED=true`；否則 config validation 在任何 stage 執行前 fail-fast：`PARENT_EMBEDDING_ENABLED requires HIERARCHY_ENABLED=true`。

| `HIERARCHY_ENABLED` | `PARENT_EMBEDDING_ENABLED` | `hierarchy` | `parent_embedding` | Leaf `text_embedding` |
|---:|---:|---|---|---|
| false | false | skipped | skipped | 正常執行／reuse |
| true | false | 執行／reuse | skipped | 正常執行／reuse |
| true | true | 執行／reuse | 執行／reuse | Parent stage 成功後執行 |
| false | true | config invalid | 不執行 | 整個 run 不開始 |

#### Failure、Publication 與隔離策略

- **[Proposed for v1]** Sprint 2A 採 `explicit opt-in + blocking stage`：只有主動啟用的實驗 run 承擔 Parent Embedding failure。
- **[Proposed for v1]** disabled 時 stage=`skipped`，不建立 artifact/fingerprint，不影響 Leaf embedding、legacy resume 或 Leaf-only QA。
- **[Proposed for v1]** enabled 時所有 required Parent 必須 100% success 或合法 reuse；任一最終 failure 使 stage/run failed，partial generation 不可標記 completed、不可進 Sprint 2B、不可發布。
- **[Proposed for v1]** failure 不刪除 Leaf chunks/embeddings/artifacts，不改 MongoDB Leaf documents，不建立 Parent DB generation，也不啟用 Hierarchical Retrieval；已發布 Leaf-only QA 繼續服務。
- **[Proposed for v1]** 「Pipeline Run failed」與「已發布 Leaf-only QA unavailable」是不同狀態；Sprint 2A 不連 MongoDB，因此實驗 run failure 不會撤回既有 QA 資料。
- **[Deferred]** Parent Embedding 獨立 job、branch-aware publication 與 DAG/non-blocking stage；待正式並行發布需求出現再設計。

### 7.3 Artifact

- **[Implemented stable contract]** 檔名：`embeddings_parent_gemini_stable.jsonl`；舊檔名保留作 preview audit。
- **[Proposed for v1]** 路徑：`data/outputs/runs/<run_id>/embeddings_parent_gemini.jsonl`；Sprint 2A 不建立 latest copy。
- **[Implemented stable contract]** artifact schema version：`parent_embedding_v2`。
- **[Proposed for v1]** empty Parent input 產生合法空 JSONL、count `0`、stage completed；若 hierarchy disabled 則 stage skipped 且不要求檔案。
- **[Proposed for v1]** partial failure 保留每筆 status/error；只有非空、維度正確、success/reused 的 vector 可進 Sprint 2B storage。

建議 record：

| 欄位 | Required | 說明 |
|---|---:|---|
| `parent_id` | 是 | Parent identity |
| `video_id` | 是 | scope 與 join key |
| `hierarchy_level` | 是 | v1 固定 1 |
| `document_type` | 是 | v1 固定 `parent_chunk` |
| `start_sec`, `end_sec`, `text` | 是 | 從 Parent artifact 原樣帶入，供 validation/storage |
| `child_chunk_ids`, `child_count`, `order` | 是 | retrieval expansion 所需 |
| `embedding` | 是 | success 時為正確維度 vector，failure 時空陣列 |
| `embedding_provider` | 是 | `gemini` |
| `embedding_model` | 是 | runtime model |
| `embedding_dimension` | 是 | runtime dimension |
| `embedding_task_type` | 是 | stable `gemini-embedding-2` 應為 `null`；現有 preview artifact 的 `RETRIEVAL_DOCUMENT` 只作 legacy audit，未遷移前不可發布 |
| `embedding_status`, `embedding_error` | 是 | partial failure contract |
| `embedding_timestamp`, `embedding_request_id` | 否 | 稽核欄位，不進 fingerprint |
| `embedding_schema_version` | 是 | `parent_embedding_v2` |
| `embedding_instruction` | 是 | canonical document instruction template |
| `embedding_instruction_version` | 是 | `gemini_embedding_2_asymmetric_retrieval_v2` |
| `embedding_generation_version` | 是 | `text_search_generation_v2` |
| `embedding_contract_version` | 是 | `gemini_embedding_2_text_v2` |
| `embedding_role` | 是 | `document` |
| `hierarchy_fingerprint` | 是 | Parent source generation |
| `source_leaf_fingerprint` | 是 | 上游 Leaf generation |
| `parent_embedding_fingerprint` | 是 | 本 stage deterministic contract |

- **[Proposed for v1]** manifest 的 `parent_embedding` 保存 `enabled`、`status`、config snapshot、fingerprint、artifact relative path、total/success/reused/failed counts、model、dimension、schema version與 compact failure summary。
- **[Proposed for v1]** disabled 時保存 `enabled=false`、`status=skipped`，artifact/fingerprint 為 null 或依既有 manifest null convention 省略，但不得建立檔案。
- **[Proposed for v1]** status 僅允許 `skipped/completed/failed`；Sprint 2A 不把 `partial` 視為 publishable terminal status。
- **[Proposed for v1]** run summary只保存 enabled/status/count aggregates，不複製 API key、完整 provider error payload 或 vector。

## 8. Parent Embedding Fingerprint

- **[Proposed for v1]** Parent Embedding config snapshot 必含 `enabled`、provider、model、dimension、task type、schema version、preprocessing version、normalization version。
- **[Proposed for v1]** deterministic Parent Embedding fingerprint 只在 `PARENT_EMBEDDING_ENABLED=true` 時計算；`enabled` 也納入 payload，Hierarchy fingerprint 是必要 dependency。
- **[Proposed for v1]** fingerprint payload 必含：Hierarchy fingerprint、provider、model、dimension、task type、embedding schema version、preprocessing version、normalization/output encoding version。
- **[Proposed for v1]** v1 preprocessing version 為 `parent_text_passthrough_v1`；輸入 text 必須等於 Parent artifact text，不另加 prefix、title 或 summary。
- **[Proposed for v1]** normalization version 為 `unit_l2_v1`，與既有 Leaf cosine 使用方式一致。
- **[Proposed for v1]** 不含 run ID、timestamp、OS path、absolute output path、API key、MongoDB URI 或 random value。
- **[Proposed for v1]** 使用 canonical JSON（sorted keys、固定 separators）計算 SHA-256。

## 9. Parent Storage Strategy Decision

| 方案 | Minimal change | Leaf 風險 | Rollback/ownership | 建議 |
|---|---:|---:|---|---|
| A：獨立 `video_segments_parent` | 中 | 最低 | 最清楚 | **[Proposed for v1] Sprint 2B 正式候選** |
| B：與 Leaf 共用 `video_segments_text` | 表面低、實際高 | 高；所有 Leaf query 必須補 filter | migration/index/model 複雜 | **[Deferred] 不採用** |
| C：Sprint 2A 僅 artifact | 最高 | 無 | 最容易 | **[Proposed for v1] Sprint 2A 唯一範圍** |

- **[Proposed for v1]** Sprint 2A 完全不連 MongoDB；先完成 offline artifact、validation、fingerprint、resume 與 mock tests。
- **[Proposed for v1]** Sprint 2B 以獨立 `video_segments_parent` 為候選，避免修改或誤查 `video_segments_text`。
- **[Database review required]** collection、validation、indexes、Atlas Vector Index、migration、cleanup 與 live smoke 皆由 Database owner 審核／執行。
- **[Backend review required]** Backend 需新增獨立 model/query adapter，不將 Parent 套入既有 `VideoSegment` model。

## 10. Parent MongoDB Candidate Contract

### 10.1 Candidate document

| 欄位 | MVP | 來源／規則 | Owner |
|---|---:|---|---|
| `parentId` | 必填 | `parent_id` | Pipeline |
| `videoId` | 必填 | `video_id`；canonical string | Pipeline/Backend review |
| `courseId` | retrieval 前必填 | 由 app-owned Video metadata / upload context 解析，禁止由 `course_name` 猜測 | Backend + Database review |
| `hierarchyLevel` | 必填 | `1` | Pipeline |
| `documentType` | 必填 | `parent_chunk` | Pipeline |
| `startSec`, `endSec`, `text` | 必填 | Parent artifact | Pipeline |
| `childChunkIds`, `childCount`, `order` | 必填 | Parent artifact | Pipeline |
| `embedding` | 必填 | 只接受成功且維度正確 vector | Pipeline |
| `embeddingProvider`, `embeddingModel`, `embeddingDimension` | 必填 | Parent embedding artifact | Pipeline |
| `embeddingSchemaVersion` | 必填 | `parent_embedding_v1` | Pipeline |
| `hierarchyFingerprint`, `sourceLeafFingerprint` | 必填 | manifest/artifact | Pipeline |
| `parentEmbeddingFingerprint` | 必填 | Parent embedding stage | Pipeline |
| `documentSchemaVersion` | 必填 | `parent_document_v1` | Joint |
| `generationVersion`, `isActive` | 正式 generation 策略需要 | 見 Cleanup | Database |
| `createdAt`, `updatedAt` | 必填 | DB adapter 管理 | Database |

### 10.2 Identity 與欄位決策

- **[Proposed for v1]** Parent 不使用 `segmentId` 或 `chunkId`；唯一語意 ID 是 `parentId`，避免與 Leaf namespace 混淆。
- **[Proposed for v1]** deterministic Parent ID 可支援同 generation idempotent upsert；若需多 generation 共存，unique key 不可只用 `parentId`。
- **[Joint decision required]** MVP 若採單一 active generation，可 unique `parentId`；若採 generation switch，建議 unique `{ parentId, generationVersion }`。
- **[Confirmed by current code]** Pipeline bridge 可用 `target_video_id` 對接 Backend `Video._id` 字串；現況另存在 pipeline-style `video_id`，兩者映射仍需明確。
- **[Proposed for v1]** `videoId` 必須保存 Backend retrieval 實際使用的 canonical string，不允許 uploader 靜默混用兩種 ID。
- **[Proposed for v1]** `courseId` 由 uploader 以 target Video／Backend job context 解析；standalone artifact 可沒有 `courseId`，但不得進行 course-scoped Parent retrieval。
- **[Proposed for v1]** `course_name` 僅可作 provenance/debug，不可轉成 `courseId`，MVP Parent document不必保存。
- **[Proposed for v1]** `childChunkIds` v1 不需 index；Parent candidate 已包含它，擴展時用既有 Leaf unique lookup。只有 reverse lookup use case 出現才評估 multikey index。
- **[Proposed for v1]** fingerprint 與 embedding metadata逐筆保存，支援稽核、dimension guard 與 cleanup。
- **[Database review required]** timestamps 建議 `$setOnInsert.createdAt`、每次成功 upsert 更新 `updatedAt`；實作需與 Mongoose timestamps／raw uploader 一致。

## 11. Collection 與 Index Candidate Contract

- **[Proposed for v1]** Collection：`video_segments_parent`。
- **[Proposed for v1]** ownership：Pipeline 產生資料與 uploader adapter；Database 管 collection/index/schema；Backend 唯讀 retrieval（除非共同核准 lifecycle API）。
- **[Backend review required]** 新增獨立 `VideoSegmentParent` model 並固定 collection binding；不得重用 `VideoSegment` schema。

必要 regular indexes 候選：

1. **[Database review required]** unique：單 generation `{ parentId: 1 }`；generation 模式 `{ parentId: 1, generationVersion: 1 }`。
2. **[Database review required]** scope：`{ courseId: 1, videoId: 1, isActive: 1 }`；未採 `isActive` 時移除該欄。
3. **[Database review required]** cleanup/audit：`{ videoId: 1, hierarchyFingerprint: 1 }`。

Atlas Vector Index 候選：

```json
{
  "name": "parent_embedding_index",
  "path": "embedding",
  "numDimensions": 3072,
  "similarity": "cosine",
  "filterFields": [
    "courseId",
    "videoId",
    "hierarchyLevel",
    "documentType",
    "generationVersion",
    "isActive"
  ]
}
```

- **[Database review required]** dimension 必須跟正式 Parent model 相符；若 model/dimension 改變，需新 index 或受控 rebuild，不可混存不同維度。
- **[Database review required]** `courseId` 與 `videoId` 是 retrieval security/scope 必要 filter；level/type 是 defensive filter；generation/isActive 只有正式採用才加入。
- **[Confirmed by current code]** Repo 文件記載既有 Leaf `text_embedding_index` 為 path `embedding`、3072、cosine、filter `courseId`/`videoId`；本 Sprint 未連 live Atlas，不能把 Parent index 或現場狀態寫成已完成。

## 12. Stale Parent Cleanup Contract

會造成 stale Parent 的變更包括 Leaf fingerprint、Parent leaf count/overlap、hierarchy schema/text joiner、Parent embedding model/dimension、Parent document schema。

| 方案 | Partial upload | Rollback | Retrieval safety | 決策 |
|---|---|---|---|---|
| A：完整 upsert 後依 `currentParentIds` 刪 stale | 需 guard | 中 | 高 | **[Database review required] 可作單 generation interim** |
| B：只以 hierarchy fingerprint 分組 | 不刪資料 | 中 | 必須 filter current fingerprint | **[Deferred] 單獨不足** |
| C：`generationVersion` + `isActive` switch | 最佳 | 最佳 | 最佳 | **[Proposed for v1] 正式推薦** |
| D：不自動刪，只留 metadata/manual | 最低寫入風險 | 手動 | 未 filter 時不安全 | **[Proposed for v1] Sprint 2B storage smoke 起點** |

- **[Proposed for v1]** Sprint 2B 第一階段採 D：只驗證 isolated storage/upsert，不啟用 hierarchical retrieval；任何 stale 資料不得進 production query。
- **[Proposed for v1]** 正式 retrieval 前升級為 C：先寫完整新 generation → 驗證 count/fingerprint/vector → 原子或受控切換 active → 保留上一 generation 供 rollback → 再依 retention 清理。
- **[Proposed for v1]** 若 MVP 時程只能採 A，必須「全批 upsert 成功且驗證通過後」才刪 `{videoId, parentId: {$nin: currentParentIds}}`；partial upload 絕不 cleanup。
- **[Database review required]** delete、transaction、retention、rollback script、權限與 live execution 均需 Database owner 核准；本文件不授權刪除。

## 13. Hierarchical Retrieval Contract

```text
User Question
  → Query Embedding
  → scoped Parent Vector Search
  → Parent Candidates
  → ordered childChunkIds expansion
  → Leaf scope validation + dedupe
  → Leaf Context Assembly
  → Answer Generation
  → Leaf Citation
```

### 13.1 Parent retrieval input/output

- **[Proposed for v1]** input：query embedding、`courseId`、optional `videoId`、match limit、numCandidates、`hierarchyLevel=1`、`documentType=parent_chunk`、active/current generation filter、`retrievalStrategyVersion=parent_child_v1`。
- **[Proposed for v1]** output：`parentId`、`videoId`、`courseId`、vector score、ordered `childChunkIds`、timestamps、order、hierarchy fingerprint、generation version。
- **[Backend review required]** Parent search 必須沿用既有 course/video access scope；缺 `courseId` 的 Parent 不可進 course query。

### 13.2 Child expansion

- **[Proposed for v1]** 對每個 Parent 依 `childChunkIds` 原順序批次載入 Leaf，再重排回 Parent order；不得依 MongoDB natural order。
- **[Proposed for v1]** 每個 Leaf 必須驗證存在、course/video scope 一致；跨 scope、missing 或 duplicate ID 要記錄 telemetry 並排除。
- **[Proposed for v1]** 同一 Leaf 被多個 Parent 命中時只放一次 context，保留全部 `sourceParentIds`，`parentScore=max(scores)` 作為排序分數。
- **[Proposed for v1]** global ordering 先依最佳 Parent score 降冪，再以 Parent order、Leaf startSec、Leaf chunkId deterministic tie-break；同 Parent 內維持 child order。

### 13.3 Context assembly 與 fallback

- **[Proposed for v1]** Parent score只用於候選排序，不宣稱是 Leaf semantic score；debug 欄位應命名 `parentScore`。
- **[Proposed for v1]** context 上限同時限制 Parent candidates、dedup 後 Leaf count、characters/tokens；達上限後 deterministic truncate。
- **[Proposed for v1]** Parent 無候選、index unavailable、expansion 後無合法 Leaf 或 feature flag 關閉時，回退既有 Leaf-only retrieval。
- **[Backend review required]** fallback 必須出現在 runtime diagnostics，例如 `retrievalPath=leaf_fallback` 與 reason，不改既有 answer status 語意。

## 14. Citation Contract

- **[Proposed for v1]** 最終 citation 一律指向 Leaf document；`segmentId/chunkId`、`videoId`、snippet、`startSec/endSec` 均來自 Leaf。
- **[Proposed for v1]** Parent timestamp 只供 search/debug，不取代 Leaf timestamp，也不直接呈現在使用者 citation。
- **[Proposed for v1]** Parent provenance 可選擇放在 `runtime.hierarchicalRetrieval` 或 internal match debug：`sourceParentIds`、`parentScore`、`hierarchyFingerprint`；不要求前端顯示。
- **[Confirmed by current code]** 現有 QA response 已有 `answer`、`matches`、`citations`、`answerStatus`、`clip`、`runtime`，citation 已含 source video、timestamp、score/confidence、snippet。
- **[Proposed for v1]** 因最終仍回 Leaf citation，Sprint 3 預設不修改 public `citations[]` contract；若新增 provenance，須為 backward-compatible optional field。
- **[Backend review required]** Frontend 不需為 Parent 新增跳轉行為；既有 Leaf timestamp jump contract 應保持。

## 15. Retrieval Evaluation Contract

- **[Proposed for v1]** Baseline A：現行 Leaf-only retrieval；Candidate B：Parent search → child expansion → Leaf context。
- **[Proposed for v1]** 使用固定、版本化 QA dataset；同一 query、scope、answer model與成本設定比較，避免同時改多個變因。
- **[Proposed for v1]** MVP 必量：Relevant Leaf Recall、Citation Accuracy、Timestamp Accuracy、Answer Correctness、Fallback Rate。
- **[Proposed for v1]** 工程量測：Retrieval Hit Rate、Context Precision、Duplicate Context Ratio、latency p50/p95、Query Embedding Calls、token usage、API cost。
- **[Proposed for v1]** acceptance gate：Citation/Timestamp 不得低於 baseline；Relevant Leaf Recall 或 Answer Correctness 至少一項有可重現提升；p95 latency 與 cost 不得超過團隊核准 budget。
- **[Joint decision required]** 數值門檻、QA dataset owner、人工評分 rubric 與最低 sample size 在 Sprint 4 開始前定版。
- **[Deferred]** Topic/Chapter/Summary 多層 hierarchy 與自動 QA dataset generation。

## 16. Version 與 Fingerprint Contract

| 層次 | Version / fingerprint | Dependency |
|---|---|---|
| Leaf chunk | chunk strategy + Leaf fingerprint | normalization/chunk config |
| Hierarchy | strategy `fixed_leaf_grouping_v1`、schema `1`、joiner `newline_v1`、Hierarchy fingerprint | Leaf fingerprint |
| Parent embedding | `parent_embedding_v2` + Parent embedding fingerprint | Hierarchy fingerprint + provider/model/dim/task/instruction/instruction version/generation/preprocess/normalize/contract/role |
| Parent document | `parent_document_v1` | artifact contract + storage mapping |
| Retrieval | `parent_child_v1` | collection/index/filter/expansion/context rules |
| Generation | `generationVersion`（若採用） | 一次可發布 Parent dataset |

- **[Proposed for v1]** manifest、artifact、MongoDB document 使用相同 fingerprint 值與欄位命名語意，snake_case artifact 對 camelCase DB 做明確 mapping。
- **[Proposed for v1]** run ID 與 timestamp 是 provenance，不屬 deterministic fingerprint。
- **[Proposed for v1]** 每筆 Parent document重複保存必要 metadata 是刻意的：便於 vector result 自我驗證、cleanup 與 audit。
- **[Proposed for v1]** 任何 dependency 改變，只 invalidate 自該層及 downstream；Leaf artifact 不因 Parent-only 設定改變而重建。

## 17. Resume 與 Invalidation Contract

| 情境 | v1 行為 |
|---|---|
| fingerprint 相同、artifact valid | **[Proposed for v1]** reuse Parent embedding |
| Hierarchy fingerprint 改變 | **[Proposed for v1]** 從 `parent_embedding` 重跑；Hierarchy 本身依既有規則決定是否重跑 |
| model/dimension/task/preprocess 改變 | **[Proposed for v1]** 從 `parent_embedding` 重跑 |
| Parent source artifact missing/invalid | **[Proposed for v1]** 由 `hierarchy` 起恢復，再跑 Parent embedding |
| Parent embedding artifact missing/invalid | **[Proposed for v1]** 只從 `parent_embedding` 重跑 |
| `PARENT_EMBEDDING_ENABLED=false` | **[Proposed for v1]** Parent embedding skipped；不要求 embedding artifact/fingerprint；Leaf downstream 照常 resume |
| `HIERARCHY_ENABLED=false` 且 Parent embedding disabled | **[Proposed for v1]** hierarchy 與 Parent embedding 都 skipped；不要求兩個 Parent artifacts |
| legacy manifest 無 Parent embedding metadata | **[Proposed for v1]** disabled 時相容；enabled 時不可假裝 reuse，從 Parent embedding 起補建 |
| gate `true → false` | **[Proposed for v1]** 不刪舊 artifact；stage skipped，Leaf downstream 不因 Parent-only config 改變而 invalidated |
| gate `false → true` | **[Proposed for v1]** 執行 Parent embedding；不得因 manifest 缺 metadata 而誤判 reuse |

- **[Proposed for v1]** Parent artifact validator 與 Parent embedding artifact validator分離；後者另驗證 record count/ID set、text、metadata、vector dimension、status 與 fingerprints。
- **[Proposed for v1]** partial artifact 可作 per-record checkpoint，但 Sprint 2A 只有 100% required Parent success/reuse 才 completed；任一最終 failure 即 stage/run failed，且不可發布。

## 17.1 Parent Publication Adapter（2026-08-03 offline implementation）

- **[Confirmed by current code]** 正式模組為 `STT_Whisper/src/parent_mongodb_uploader.py`；它不建立 MongoDB client，collection 由呼叫端注入，且尚未接入 Pipeline `main.py` 或 Leaf `upload_all()`。
- **[Implemented 2026-08-09]** Uploader 只接受 `gemini-embedding-2`／`taskType=null`／stable instruction metadata／3072 維 contract；preview artifact 會整批阻擋且 write count 為 0。
- **[Confirmed by current code]** `courseId` 必須由呼叫端顯式提供，或由呼叫端注入的權威 resolver 對每筆解析；格式為 MongoDB ObjectId，缺失、無效或同批衝突皆拒絕。不得從 `videoId`、課名或第一門課推測。
- **[Confirmed by current code]** artifact 到 storage 使用集中式白名單 snake_case → camelCase mapping。artifact-only 的 `embedding_status`、`embedding_timestamp`、`embedding_error`、`embedding_request_id` 不寫入 Backend schema。
- **[Confirmed by current code]** upsert filter 唯一為 `{ parentId }`，operation 使用 `$set`、`upsert=True`，bulk write 使用 `ordered=False`。不把 `courseId` 或 `generationVersion` 放入 filter，不執行 delete 或 stale cleanup。
- **[Confirmed by current code]** `documentSchemaVersion=parent_document_v1`、`generationVersion=null`（可由呼叫端保留 audit 值）、`isActive=true`；generation switching 尚未啟用。
- **[Offline only]** mock tests 已覆蓋 mapping、整批 preflight、course scope、向量 contract、idempotent upsert、partial failure 與敏感錯誤安全化。尚未產生真實 Parent artifacts，亦未連線或寫入 shared Atlas。

## 18. Ownership Matrix

| 工作項目 | AI Pipeline | Backend | Database | 共同決策 | DB 權限需求 |
|---|---:|---:|---:|---:|---|
| Parent Embedding Stage/Artifact/Fingerprint | R/A | C | C |  | 無 |
| Resume / Artifact Validation | R/A |  | C |  | 無 |
| Parent uploader adapter + mock tests | R/A | C | C |  | mock 無；live 有 |
| Parent document mapping | R | C | A | C | 有 |
| Parent Collection / schema validation | C | C | R/A | C | 有 |
| Unique / General / Atlas Index | C | C | R/A | C | 有 |
| Stale cleanup / generation / rollback | C | C | R/A | C | 有 |
| Mongoose Parent Model | C | R/A | C |  | 無（code）；live 有 |
| Parent Vector Search | C | R/A | C |  | Atlas read |
| Child Expansion / Context Assembly | C | R/A | C | C | DB read |
| Citation Mapping / API compatibility | C | R/A |  | C | 無 |
| Retrieval Evaluation | R | R | C | A | 視 dataset 而定 |
| Migration / Live Verification | C | C | R/A | C | 有 |

`R=執行、A=最終負責、C=協作/審核`。**[Proposed for v1]** 若現有 repo ownership 文件沒有更細規則，本矩陣作 Sprint 分工基線；實際 live DB 操作仍由 Database owner 批准。

## 19. Parent Chunk MongoDB Handoff Checklist

以下每項都需附 repo evidence 或 Database owner 的 live evidence，不得只口頭宣稱：

- [ ] 1. 確認本文件版本與 sign-off owners。
- [ ] 2. 確認既有 Leaf collection 是 `video_segments_text`，Parent 不寫入其中。
- [ ] 3. 確認 Leaf unique key 與 child lookup 使用的 canonical ID。
- [ ] 4. 記錄既有 Leaf Atlas index contract 與 live readiness evidence。
- [ ] 5. 鎖定 Parent Artifact Schema v1。
- [ ] 6. 核准 storage strategy：獨立 collection。
- [ ] 7. 核准 collection 名 `video_segments_parent`。
- [ ] 8. 核准 Parent document schema 與 required/nullability。
- [ ] 9. 核准 `parentId` namespace 與 unique strategy。
- [ ] 10. 核准 regular indexes。
- [ ] 11. 核准 Atlas Vector Index 名 `parent_embedding_index`。
- [ ] 12. 核准 vector path `embedding`。
- [ ] 13. 核准 embedding model/dimension；確認 index 維度一致。
- [ ] 14. 核准 similarity `cosine` 與 vector normalization contract。
- [ ] 15. 核准 metadata filters：course/video/level/type/generation/active。
- [ ] 16. 核准 Sprint 2B MVP stale policy。
- [ ] 17. 核准正式 generation switch 與 cleanup policy。
- [ ] 18. 判定是否需要 migration；獨立空 collection 預期不需搬 Leaf。
- [ ] 19. 審核 rollback script/步驟，禁止未受控 delete。
- [ ] 20. 核准最小 DB roles；不得在文件保存 URI、帳密或 API key。
- [ ] 21. 完成 mock uploader idempotency/partial failure/guard tests。
- [ ] 22. 由 Database owner 執行 live collection/index smoke 與 `listIndexes` evidence。
- [ ] 23. 驗證 Parent count、ID set、dimension、fingerprint、course/video scope。
- [ ] 24. 將 live 結果回填 current-state/handoff 文件並記錄 rollback point。

## 20. 後續 Sprint Roadmap

### Sprint 2A — Parent Embedding Implementation

- **[Proposed for v1]** 新增 `PARENT_EMBEDDING_ENABLED`（預設 false）、`parent_embedding` stage、config validation、artifact、fingerprint、resume、validation、run summary 與 offline mock tests。
- **[Proposed for v1]** Sprint 2A 是 explicit opt-in 實驗；disabled 時 Leaf Pipeline 行為不變，enabled 時 Parent stage 為 blocking 且要求 100% 成功／reuse。
- **[Proposed for v1]** 可立即開始，不需要 MongoDB 權限。
- **[Proposed for v1]** 明確不含 MongoDB、collection/index、Backend 或 retrieval。

### Sprint 2B — Parent Storage Implementation

- **[Proposed for v1]** Pipeline 先實作獨立 uploader adapter、idempotent upsert、upload summary、retry/resume、mock tests、cleanup guard。
- **[Database review required]** collection/index/schema/live smoke/migration/cleanup/rollback 必須先 review；沒有核准前只能 mock。
- **[Proposed for v1]** 第一階段可做 isolated storage smoke，但不可啟用 production Parent retrieval；正式上線前採 generation switch 或核准的 guarded cleanup。
- **[Database review required]** 只有 completed、100% 有效的 Parent Embedding generation 可進 DB publication；是否讓 storage 使用同一 gate 或新增 publication gate，於 Sprint 2B 定版。

### Sprint 3 — Hierarchical Retrieval

- **[Proposed for v1]** 前置條件：Parent artifact/storage contract 定版、Parent vector index queryable、course/video scope verified、current generation 可辨識。
- **[Proposed for v1]** Backend 新增 `HIERARCHICAL_RETRIEVAL_ENABLED=false`，實作 Parent candidate retrieval、child expansion、dedupe、Leaf context、Leaf citation 與 Leaf-only fallback；Parent data 存在不會自動啟用 retrieval。

### Sprint 4 — Retrieval Evaluation

- **[Proposed for v1]** 前置條件：Sprint 3 可用 feature flag 切換 baseline/candidate，且 telemetry 能分辨 retrieval path。
- **[Proposed for v1]** 固定 QA dataset，比較 retrieval/citation/answer/latency/cost，通過 gate 才擴大 rollout。

## 21. Open Questions

1. **[Joint decision required]** canonical `videoId` 是 Backend `Video._id` 字串，還是 pipeline `video_id`？若兩者共存，mapping 的唯一 Source of Truth 在哪裡？
2. **[Backend review required]** uploader 取得 `courseId` 的正式方式是 processing job payload、Video lookup，或兩者交叉驗證？
3. **[Database review required]** Sprint 2B 直接採 generation/isActive，或先 isolated smoke 再升級？
4. **[Database review required]** unique key 採 `parentId` 還是 `{parentId, generationVersion}`？
5. **[Backend review required]** Parent vector search 的 match limit、numCandidates、context token budget 預設值。
6. **[Joint decision required]** Sprint 4 acceptance 數值、QA dataset 與人工評分 owner。
7. **[Database review required]** Atlas index deployment、retention 與 previous generation 保留時間。
8. **[Deferred]** 是否將 Parent Embedding 拆成獨立 job、支援 branch-aware publication，或由 production 自動產生 Parent generation。
9. **[Deferred]** 是否擴充 Level 2 Topic、Chapter 或 Summary；不阻塞 v1。

## 22. Decision Summary 與本 Sprint 範圍

### 已收斂的 v1 決策

- **[Proposed for v1]** Parent Embedding 使用獨立 `parent_embedding` stage，置於 `hierarchy` 後、`text_embedding` 前。
- **[Proposed for v1]** `HIERARCHY_ENABLED`、`PARENT_EMBEDDING_ENABLED`、`HIERARCHICAL_RETRIEVAL_ENABLED` 分別控制 Parent generation、Parent embedding、Backend retrieval；三者預設 false，不互相隱式啟用。
- **[Proposed for v1]** Sprint 2A 的 Parent Embedding 是 explicit opt-in blocking stage；disabled 時不影響 Leaf Pipeline，enabled 時要求 100% success/reuse，失敗 run 不可發布但不影響既有 Leaf-only QA。
- **[Proposed for v1]** Parent Embedding 使用獨立 `embeddings_parent_gemini.jsonl`，不混入 Leaf artifact。
- **[Proposed for v1]** Sprint 2A 只做 offline artifact/fingerprint/resume/validation/mock，不需 MongoDB 權限。
- **[Proposed for v1]** Parent storage 採獨立 `video_segments_parent`，不修改 `video_segments_text`。
- **[Proposed for v1]** Parent identity 使用 `parentId`，不冒充 `segmentId` 或 `chunkId`。
- **[Proposed for v1]** Hierarchical retrieval 是 Parent search → child expansion → Leaf context → Leaf citation，並保留 Leaf-only fallback。
- **[Proposed for v1]** Citation timestamp 與 snippet 一律來自 Leaf；Parent provenance 預設只進 runtime/debug。
- **[Database review required]** collection、schema、regular/Atlas indexes、generation、cleanup、migration、rollback 與 live verification 都需 Database owner 審核／執行。

### 本文件未執行

- **[Confirmed by current code]** 本 Sprint 只新增本 Markdown 設計文件。
- **[Deferred]** 未修改 Python、Backend、Frontend、uploader、Mongoose model、config、`.env.example`、README 或 tests。
- **[Deferred]** 未呼叫 Gemini、MongoDB 或其他外部服務；未建立 collection/index、未 migration、未刪資料、未跑 Docker、未 commit/push/pull/fetch/merge/rebase/reset/restore/stash。
## Step 10 Citation 與隔離 E2E 契約（2026-08-06）

### Citation identity

- 正式 `citations[]` 保留所有既有欄位並新增 `chunkId: string | null`。
- `chunkId` 只能來自實際 Leaf match；legacy match 只有 `segmentId` 時輸出 `null`，不得複製或推測 ID。
- `timestamp.startSec/endSec` 永遠來自 Leaf，不得以 Parent 聚合時間取代。
- Citation transcript 仍只輸出既有長度限制的 snippet，不輸出完整 Leaf transcript。
- Parent lineage 不納入正式 Citation API。多 Parent 命中同一 Leaf 時仍去重並採最高 Parent score；lineage 僅供隔離 runner evidence 使用。

### Hierarchical diagnostics

成功的 `runtime.hierarchicalRetrieval.diagnostics` 以 additive contract 提供：

```json
{
  "requestedChildCount": 0,
  "foundChildCount": 0,
  "missingChildCount": 0,
  "duplicateChildCount": 0,
  "scopeMismatchCount": 0,
  "truncatedChildCount": 0,
  "contextTruncated": false
}
```

Gate=false 時維持既有 Leaf-only response。若在取得完整 counts 前 fallback，`diagnostics` 為 `null`，不得捏造零值。

### Zero-write isolated runner

- 入口：`backend/src/scripts/phase2_2_hierarchical_e2e_runner.js`。
- Runner 直接串接 query embedding、Parent Search、Child Expansion、Leaf Context、可選 Answer Generation與 Citation builder；禁止呼叫具副作用的完整 `askQuestion()`。
- 預設 `--with-answer=false`；live Answer Generation 必須明確開啟。
- Runner 不修改 shared Gate；啟動時要求 shared Gate=false、fallback=true、FAQ cache=false。
- 啟動前要求 `chunkId_1` 存在，並要求等價 Child lookup explain 的 winning plan實際包含 `chunkId_1`。
- MongoDB command monitor 對 write command標記 `WRITE_OPERATION_DETECTED`；live run仍應搭配read-only MongoDB credential。
- Live E2E 尚未執行；此 runner不代表Step 9或Step 10已完成。
