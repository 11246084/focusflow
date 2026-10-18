# Phase 2-2 Step 10：Parent → Child → Citation 隔離 E2E 計畫

> 狀態：準備完成、尚未 live 執行。Step 9 的歷史證據仍需 Database owner 以目前資料重新驗證 shared Atlas `chunkId_1`。2026-08-13 檢查發現現有 Backend Atlas credential 是 `atlasAdmin`，不可用於本驗收；Shared Gate 必須保持 `false`。

## 1. 目的與邊界

隔離 runner 驗證以下 read-only 資料流：

```text
Question → Query Embedding → Parent Vector Search → Parent Validation
→ Child Expansion → Leaf Context → Optional Answer Generation
→ Citation → Safe Evidence Report
```

它不是正式 QA endpoint，也不驗證 UsageLog、Question recording、FAQ cache 或 Clip hit-count，不得承接正式流量。

## 2. Live 前置條件

1. Local HEAD等於`origin/main`且Working Tree乾淨。
2. Shared `HIERARCHICAL_RETRIEVAL_ENABLED=false`。
3. `HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF=true`。
4. Runner process設定`FAQ_CACHE_ENABLED=false`。
5. Parent與Leaf collections可唯讀。
6. `parent_embedding_index`為READY/queryable。
7. `video_segments_text.chunkId_1`存在且可用。
8. 正式Child lookup explain包含`chunkId_1` IXSCAN。
9. Step 9三筆隔離Parent完整展開且無missing/scope mismatch。
10. 使用專用 MongoDB credential，且登入角色必須**只有** target database 的 built-in `read`；`atlasAdmin`、`readWrite`、跨 DB 或多角色帳號一律拒絕。

缺少`chunkId_1`或explain未使用時，Runner必須在Answer call與Child Expansion前以`E2E_CHUNK_ID_INDEX_NOT_READY`結束。

## 3. CLI

先執行零 Gemini／零 Answer 的 DB-only preflight。這一步只檢查專用唯讀角色、scope、collections、active Parent／Leaf contract、`chunkId_1` 與 Parent vector index definition：

```powershell
cd backend
$env:FAQ_CACHE_ENABLED='false'
npm.cmd run preflight:phase2-2:readonly -- `
  --course-id 6a6da68456dd124511ec5196 `
  --video-id 6a6da69556dd124511ec51eb `
  --allowed-video-id 6a6da69556dd124511ec51eb `
  --json
```

`preflight:phase2-2:readonly` 不需要 `--question` 或 `GEMINI_API_KEY`，輸出必須顯示所有 external execution 為 `false`、`externalCalls=0`。它不執行 Parent Search 或 Child explain；通過後才能另行核准下面的一次 Gemini query embedding E2E。

```powershell
cd backend
$env:FAQ_CACHE_ENABLED='false'
# 在 backend/.env 或目前 process 設定專用 URI；不要把真正 URI 貼進 shell history。
# PHASE2_2_READONLY_MONGODB_URI=mongodb+srv://<dedicated-reader>:<password>@.../focusflow
npm.cmd run e2e:phase2-2:readonly -- `
  --question "知識圖譜如何提升人工智慧回答的準確性？" `
  --course-id 6a6da68456dd124511ec5196 `
  --video-id 6a6da69556dd124511ec51eb `
  --allowed-video-id 6a6da69556dd124511ec51eb `
  --max-parents 3 `
  --max-children 9 `
  --json
```

預設不執行Answer Generation。只有經明確核准才加入`--with-answer`。Runner不會把shared Gate改成true或修改`.env`；若未提供專用 URI，或登入角色不是單一 `read@focusflow`，會在查詢業務資料前安全結束。

## 4. 必要環境

- `PHASE2_2_READONLY_MONGODB_URI`：專供本 runner；不得 fallback 到一般 `MONGODB_URI`。
- `VIDEO_SEGMENT_COLLECTION=video_segments_text`
- `VIDEO_SEGMENT_PARENT_COLLECTION=video_segments_parent`
- `VIDEO_SEGMENTS_PARENT_VECTOR_INDEX_NAME=parent_embedding_index`
- `QA_QUERY_EMBEDDING_PROVIDER=gemini`
- `GEMINI_API_KEY`：只供完整 E2E 的 query embedding；DB-only preflight 不需要。
- `QA_ANSWER_PROVIDER=gemini`與`GEMINI_CHAT_MODEL`：僅`--with-answer`使用。
- `FAQ_CACHE_ENABLED=false`
- `HIERARCHICAL_RETRIEVAL_ENABLED=false`
- `HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF=true`
- Hierarchical parent/child/context limits與timeout。

不得把secret寫入command line、文件或runner output。

## 5. 驗收問題

- 知識圖譜：預期`..._parent_0001`，Child `..._chunk_0001`～`0003`。
- Amazon推薦：預期`..._parent_0003`，Child `..._chunk_0007`～`0009`。
- 語意改寫：預期`..._parent_0003`，不依賴逐字匹配。
- 無關問題：不得生成context未支持的確定答案；記錄分數與no-answer行為。
- Failure：Parent no hits、部分/全部Child missing、Answer provider failure與write detection。

每個Citation必須保留實際Leaf `chunkId`與Leaf timestamp，不得引用其他影片或不存在的Child。

## 6. 安全 evidence

Runner只輸出：

- Question字數，不輸出prompt。
- Query provider/model/dimension/API call count，不輸出vector。
- Parent IDs、scores與Child ID lineage，不輸出Parent text。
- Child requested/found/missing/duplicate/scope/truncated counts。
- Context Leaf count、chunk IDs、video IDs與truncation flag，不輸出Leaf全文。
- Answer executed/provider/status/length，不預設輸出answer全文。
- Citation chunk/segment/video IDs與timestamps。
- Mongo read/write command counts與external call count。
- 經角色檢查的 database access evidence（只輸出 `read` 與 database name，不輸出帳密或 URI）。

Live evidence另需保存執行前後collection counts、`mongoWrites=0`、read-only credential證據、Gate前後均為false、Gemini call數與完整回歸結果。

## 7. 安全結束

1. 關閉MongoDB connection。
2. 確認process-local設定消失。
3. 重新載入shared runtime並確認Gate=false。
4. 確認Git沒有artifact或secret。
5. 確認MongoDB writes與Atlas index operations均為0。

完成本文件不代表Live E2E通過。只有Step 9與所有E2E案例、安全證據通過後，Step 10才能標示完成。
