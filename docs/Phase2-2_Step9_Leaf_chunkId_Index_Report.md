# Phase 2-2 Step 9：Leaf chunkId 索引修正與 Child Expansion 驗證報告

> 狀態：**READY_FOR_PARENT_CHILD_CITATION_E2E**
> 執行日期：2026-08-06
> 對應交接文件：《FocusFlow Phase 2-2｜Leaf chunkId 索引修正與 Child Expansion 驗證交接文件》（Database Owner）
> 前置狀態：`BLOCKED_MISSING_CAMELCASE_INDEX` → 已解除

本報告記錄 Step 9 的實際執行內容與 live 驗證結果，作為進入 [Step 10 E2E 計畫](Phase2-2_Step10_E2E_Test_Plan.md) 的前置條件證據。

---

## 1. 摘要

| 項目 | 結果 |
|------|------|
| Live Atlas 新增 index | `video_segments_text.chunkId_1`（non-unique） |
| Bootstrap 修正 | `database/tools/setup/init_indexes.js` snake_case → camelCase |
| chunkId-only 查詢 | COLLSCAN 1,651 筆 → IXSCAN 3 筆 |
| 正式 Child Expansion 查詢 | 已使用 `chunkId_1` + `segmentId_1` OR 索引，docs examined = nReturned = 9 |
| Child Expansion live 驗證 | 3 Parent / 9 Child 全部命中，missing = scope mismatch = duplicate = 0 |
| Backend 回歸測試 | 341 pass / 0 fail |
| 結論 | READY_FOR_PARENT_CHILD_CITATION_E2E |

未執行項目（依交接文件安全限制）：未開啟 `HIERARCHICAL_RETRIEVAL_ENABLED`、未執行 Parent → Child → Citation E2E、未執行 Answer Generation、未上傳其餘 Parent、未 commit / push。

---

## 2. 問題背景

Parent Vector Search 找出主題範圍後，系統會依 `Parent.childChunkIds` 回到 Leaf collection `video_segments_text` 取得精確逐字稿與時間戳。

該回查缺少對應索引：

- Live Atlas 上沒有 `{ chunkId: 1 }`。
- `database/tools/setup/init_indexes.js` 仍以 snake_case 定義 `{ video_id: 1 }`、`{ chunk_id: 1 }`，與 Backend 實際查詢的 camelCase 欄位不一致。

結果是每次 Child Expansion 都退化成全 collection 掃描，或退化成掃描目標影片的所有 Leaf；同時也無法用 `explain("executionStats")` 證明正式查詢走了有效索引，因此 Step 10 無法開始。

---

## 3. 建立前 Preflight（live 實查）

### 3.1 資料完整性

| 檢查項目 | 結果 |
|----------|------|
| Collection 文件數 | 1,651 |
| chunkId missing | 0 |
| chunkId null | 0 |
| chunkId 空字串 | 0 |
| chunkId 非 String | 0 |
| distinct chunkId | 1,651 |
| duplicate groups | 0 |
| legacy `chunk_id` | 0 |
| legacy `video_id` | 0 |

資料條件符合建立索引（含 unique）的門檻，無需 partial index。

### 3.2 建立前 listIndexes

`focusflow.video_segments_text`：

| Index | Key |
|-------|-----|
| `_id_` | `{ _id: 1 }` |
| `courseId_1` | `{ courseId: 1 }` |
| `segmentId_1` | `{ segmentId: 1 }` |
| `videoId_1` | `{ videoId: 1 }` |
| `courseId_1_videoId_1` | `{ courseId: 1, videoId: 1 }` |

Vector Search index：`text_embedding_index`，`status=READY`、`queryable=true`、3072 維、filter 欄位 `courseId` / `videoId`。

確認缺少 `chunkId_1`，與交接文件描述一致。

### 3.3 附帶查證：Leaf 文件實際形狀

抽查目標影片的 Leaf 文件後確認：

- **沒有 `courseId` 欄位**
- **`segmentId` 為 `null`**
- `videoId` 為 `String(videos._id)`

因此正式 Child Expansion 查詢的 scope branch 實際只有 `videoId` 那一條會命中，`courseId` 條件對這批資料不成立。這與 `CLAUDE.md` 記載的 bridge contract 一致（app-owned 影片沒有 `videoId` 欄位，pipeline 直接把 `String(videos._id)` 寫進片段的 `videoId`）。

---

## 4. 建立的 Live Index

```js
db.video_segments_text.createIndex({ chunkId: 1 }, { name: "chunkId_1" })
```

| 屬性 | 值 |
|------|-----|
| Index name | `chunkId_1` |
| Key pattern | `{ chunkId: 1 }` |
| unique | false |
| sparse | false |
| partial | false |

### Unique 決策

採交接文件的保守方案，先建立 **non-unique**。

判斷依據：

- 支持 unique 的一面：`STT_Whisper/src/mongodb_uploader.py:482` 以 `{ chunkId }` 為 filter 做 `UpdateOne(..., upsert=True)`，chunkId 由 `f"{video_id}_chunk_{index:04d}"` 生成（`STT_Whisper/src/chunking.py:50`），天然具備全域唯一性，且重跑 pipeline 是原地更新而非新增。live 1,651 筆亦全部唯一。
- 不採 unique 的理由：unique 對本次要解決的查詢效能問題**沒有任何幫助**，卻替 ingest 增加一個失敗面。

結論：先 non-unique，若日後確定要以 DB 層強制 importer contract，再單獨評估轉 unique。目前資料面已完全乾淨，隨時可轉。

### 建立後 listIndexes

原有 5 個 classic index 全部保留，新增 `chunkId_1`，共 6 個。Vector index `text_embedding_index` 未受影響，仍為 READY。

### 未執行的變更

- 未 drop 任何 index
- 未修改任何 Leaf / Parent document
- 未修改 collection validator
- 未修改 Parent vector index
- 未開啟任何 feature gate

---

## 5. Explain 驗證（executionStats）

### 5.1 查詢 A：只使用 chunkId

```js
db.video_segments_text.find({
  chunkId: { $in: [
    "6a6da69556dd124511ec51eb_chunk_0001",
    "6a6da69556dd124511ec51eb_chunk_0002",
    "6a6da69556dd124511ec51eb_chunk_0003"
  ] }
}).explain("executionStats")
```

| 指標 | 建立前 | 建立後 |
|------|--------|--------|
| Winning plan | **COLLSCAN** | **IXSCAN → FETCH** |
| Index | — | `chunkId_1`（`{ chunkId: 1 }`） |
| totalKeysExamined | 0 | 4 |
| totalDocsExamined | 1,651 | 3 |
| nReturned | 3 | 3 |
| executionTimeMillis | 2 | 1 |
| rejectedPlans | 0 | 0 |

### 5.2 查詢 B：videoId + chunkId

```js
db.video_segments_text.find({
  videoId: "6a6da69556dd124511ec51eb",
  chunkId: { $in: [ /* 同上 3 筆 */ ] }
}).explain("executionStats")
```

| 指標 | 建立前 | 建立後 |
|------|--------|--------|
| Winning plan | IXSCAN `videoId_1` → FETCH | **IXSCAN `chunkId_1` → FETCH（filter: videoId）** |
| totalKeysExamined | 139 | 4 |
| totalDocsExamined | 139 | 3 |
| nReturned | 3 | 3 |
| executionTimeMillis | — | 0 |
| rejectedPlans | — | 1（舊的 `videoId_1` 計畫） |

Planner 主動改選 `chunkId_1`，舊的「掃整支影片 139 筆」策略降為 rejected plan。

### 5.3 查詢 C：正式 Child Expansion 等價查詢

查詢形狀取自 `backend/src/services/childExpansion.service.js` 的 `findLeavesByChunkIds` 與 `bridgeScope.service.js` 的 `buildSegmentLookupQuery`：

```text
(chunkId IN [9 ids] OR segmentId IN [9 ids])
AND
(courseId = "6a6da68456dd124511ec5196" OR videoId IN [課程 7 支影片])
```

| 指標 | 結果 |
|------|------|
| Winning plan | `OR( IXSCAN segmentId_1, IXSCAN chunkId_1 )` → FETCH（filter: scope） |
| chunkId branch index | `chunkId_1`，keysExamined 10、nReturned 9 |
| segmentId branch index | `segmentId_1`，keysExamined 0、nReturned 0（該批 Leaf 的 `segmentId` 為 null） |
| totalKeysExamined | 10 |
| totalDocsExamined | 9 |
| nReturned | 9 |
| executionTimeMillis | 1 |
| rejectedPlans | 2（`videoId_1` / `courseId_1_videoId_1` 組合） |
| COLLSCAN | 無 |

### 5.4 驗收對照

| 驗收條件 | 結果 |
|----------|------|
| winning plan 出現 IXSCAN | ✅ A / B / C 皆是 |
| chunkId branch 使用 `chunkId_1` | ✅ |
| segmentId branch 使用 `segmentId_1` | ✅ |
| 不再出現明顯 COLLSCAN | ✅ |
| totalDocsExamined 接近 nReturned | ✅ A: 3/3、B: 3/3、C: 9/9 |
| 不再以掃描整支影片 139 筆為唯一策略 | ✅ 已降為 rejected plan |

---

## 6. Bootstrap 修正

檔案：`database/tools/setup/init_indexes.js`（`video_segments_text` 區塊）

### 修改前

```js
db.video_segments_text.createIndex({ video_id: 1 });
db.video_segments_text.createIndex({ chunk_id: 1 }, { unique: true });
db.video_segments_text.createIndex({ video_id: 1, courseId: 1 });
```

### 修改後

```js
db.video_segments_text.createIndex({ videoId: 1 });
db.video_segments_text.createIndex({ chunkId: 1 });
db.video_segments_text.createIndex({ segmentId: 1 });
db.video_segments_text.createIndex({ courseId: 1 });
db.video_segments_text.createIndex({ courseId: 1, videoId: 1 });
```

### 變更理由

| 變更 | 理由 |
|------|------|
| `video_id` → `videoId` | pipeline uploader 與 Backend 都只寫 / 只查 camelCase |
| `chunk_id` (unique) → `chunkId` (non-unique) | 對齊實際欄位；unique 決策見 §4 |
| 新增 `segmentId` | Child Expansion 的 id branch 是 `(chunkId OR segmentId)`，兩邊都需要索引；live 已有但 bootstrap 缺 |
| `{ video_id, courseId }` → `{ courseId }` + `{ courseId, videoId }` | 對齊 live 既有的 `courseId_1` 與 `courseId_1_videoId_1` |

diff 統計：1 file changed, 23 insertions(+), 10 deletions(-)。

### 未變更範圍

- 未修改 Parent vector index 定義
- 未修改 Backend schema
- 未修改 Child Expansion contract
- 未大幅重構
- 其他 collection（`raw_transcripts`、`stt_cache`、`transcripts_normalized`、`video_segments_audio`、`video_segments_video`、legacy `video_segments`）的 snake_case 定義維持不動 —— 那些是 pipeline 實際使用的欄位名，不在本次範圍

---

## 7. Child Expansion Live 驗證

### 7.1 測試對象

| Parent ID | childCount | childChunkIds 長度 | 一致 |
|-----------|-----------|-------------------|------|
| `6a6da69556dd124511ec51eb_parent_0001` | 3 | 3 | ✅ |
| `6a6da69556dd124511ec51eb_parent_0002` | 3 | 3 | ✅ |
| `6a6da69556dd124511ec51eb_parent_0003` | 3 | 3 | ✅ |

三筆 Parent 皆屬 `videoId=6a6da69556dd124511ec51eb`、`courseId=6a6da68456dd124511ec5196`，時間區間連續（2.58–65.28 / 65.38–118.4 / 118.6–159.54）。

### 7.2 正向結果

以正式查詢形狀對 live Atlas 撈回 9 筆 Leaf，再交給 `childExpansion.service.expandParentHits` 處理：

| 指標 | 結果 |
|------|------|
| requestedChildCount | 9 |
| foundCount | **9** |
| missingChildCount | 0 |
| scopeMismatchCount | 0 |
| duplicateChildCount | 0 |
| truncatedChildCount | 0 |
| 輸出順序等於 `childChunkIds` 串接 | ✅ |
| 時間欄位存在且 `endSec > startSec` | ✅ 9/9 |
| 取得其他影片的 Leaf | 0 |

**不依賴 `$in` 回傳順序**：測試時 repository 刻意以反轉順序回傳文件，並另外以反轉的 Parent 順序再跑一次，輸出仍嚴格依 `childChunkIds` 排列。

### 7.3 負向測試

| 情境 | 預期 | 實際 |
|------|------|------|
| missing child ID（多帶一個不存在的 `chunk_9999`） | 計入 missing，其餘正常 | requested 4 / missing 1 / found 3 ✅ |
| duplicate child ID（兩個 Parent 指向同一組 child） | 去重並計數 | requested 6 / duplicate 3 / found 3、輸出無重複 ✅ |
| wrong video scope（Parent 宣稱屬於別支影片） | 全部判為 scope mismatch | scopeMismatch 3 / found 0、無跨影片外洩 ✅ |
| empty `childChunkIds` | 回空、不 throw | requested 0 / found 0 ✅ |
| malformed Parent（完全沒有 `childChunkIds` 欄位） | 回空、不 throw | requested 0 / found 0 ✅ |
| childCount mismatch（`childCount=99`） | 以 `childChunkIds` 為準 | found 3、順序正確 ✅ |

### 7.4 執行方式與限制

本次驗證的資料面全部來自 live Atlas，邏輯面走的是 repo 內真實的 `childExpansion.service`。

**限制須據實說明**：執行環境對 Atlas 的 SRV DNS 查詢被阻擋（`querySrv ECONNREFUSED`），無法從該環境直連跑完整的「service → mongoose → Atlas」單一進程。因此採取的作法是：

1. 以正式查詢形狀對 live Atlas 實際執行查詢與 explain（DB 端完全 live）。
2. 將 Atlas 實際回傳的那 9 筆文件，餵給真實的 `expandParentHits` 重放（邏輯端使用 production code，非 mock 實作）。

差異僅在傳輸層。要跑真正單一進程端到端的版本，需在可解析 SRV 的環境執行對應腳本。

---

## 8. 回歸測試

| 項目 | 指令 | 結果 |
|------|------|------|
| Backend 全套測試 | `npm test`（backend） | **341 pass / 0 fail / 0 skipped**，duration 162s |
| Bootstrap 語法檢查 | `node --check database/tools/setup/init_indexes.js` | ✅ |
| Bootstrap 語法檢查 | `node --check database/tools/setup/init_collections.js` | ✅ |

---

## 9. 安全限制遵循檢核

| 限制 | 遵循 |
|------|------|
| 不得修改 Leaf 或 Parent documents | ✅ 未修改 |
| 不得刪除既有 index | ✅ 未刪除 |
| 不得修改 Parent vector index | ✅ 未修改 |
| 不得開啟 `HIERARCHICAL_RETRIEVAL_ENABLED` | ✅ 未開啟 |
| 不得執行 Parent → Child → Citation E2E | ✅ 未執行 |
| 不得執行 Answer Generation | ✅ 未執行 |
| 不得上傳其餘 Parent | ✅ 未上傳 |
| 不得輸出 MongoDB URI / credentials / 完整逐字稿 / embedding | ✅ 本報告未含任何上述內容 |
| 不 Commit、不 Push | ✅ 變更留在 working tree |

---

## 10. Git 狀態

```text
 M database/tools/setup/init_indexes.js
?? docs/Contest/            （本次工作前即存在的 untracked 目錄）
```

執行前 working tree 除 `docs/Contest/` 外乾淨，HEAD 為 `07c8898`。未執行任何 reset / clean / restore / rebase / merge。

---

## 11. 結論與下一步

**結論：`READY_FOR_PARENT_CHILD_CITATION_E2E`**

Step 10 的前置條件對照（見 [Step 10 E2E 計畫](Phase2-2_Step10_E2E_Test_Plan.md) §2）：

| 前置條件 | 狀態 |
|----------|------|
| `video_segments_text.chunkId_1` 存在且可用 | ✅ |
| 正式 Child lookup explain 包含 `chunkId_1` IXSCAN | ✅ |
| Step 9 三筆隔離 Parent 完整展開且無 missing / scope mismatch | ✅ |
| `parent_embedding_index` 為 READY / queryable | ✅ 實查確認：`video_segments_parent.parent_embedding_index`，`status=READY`、`queryable=true`、3072 維、filter 欄位 `courseId` / `videoId` |
| Shared `HIERARCHICAL_RETRIEVAL_ENABLED=false` | ✅ 未變更，維持關閉 |
| Local HEAD 等於 `origin/main` 且 working tree 乾淨 | ⏳ `init_indexes.js` 尚未 commit |

### 待辦

1. Review 並 commit `database/tools/setup/init_indexes.js`。
2. 若日後確定要以 DB 層強制 chunkId 唯一性，再單獨評估 `chunkId_1` 轉 unique。
4. Step 10 通過後，同步更新 [docs/current-status.md](current-status.md) 與 [backend/docs/current-state.md](../backend/docs/current-state.md)。目前尚未更新，因為 Gate 仍關閉、對外 API contract 未變動，提早寫入會造成狀態文件失真。
