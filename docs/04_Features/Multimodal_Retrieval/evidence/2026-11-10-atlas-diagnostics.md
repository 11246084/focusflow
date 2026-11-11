# Atlas 與 Chunk 唯讀查證

2026-11-10 使用現有後端 `.env` 實查資料庫 `focusflow`。查詢對象為 HANDOFF 的 AI入門基礎課六支影片，Leaf 為 `video_segments_text`，Parent 為 `video_segments_parent`。本機完整統計保存在 `.local-tools/multimodal-diagnostics/atlas.json`，此文件只收錄無逐字稿、完整向量與憑證的摘要。

## 已透過 Atlas 驗證

課程 `6a6da68456dd124511ec5196` 的 `videoIds` 正好包含指定六支，影片的 `courseId` 均對應此課程。

| 影片 | videos._id／chunk.videoId | Chunk | 短於 8 秒 | 長於 60 秒 | 影片秒數 |
|---|---|---|---|---|---|
| `_1` | `6a6da68e56dd124511ec51b4` | 117 | 1 | 0 | 1756.50 |
| `_2` | `6a6da69056dd124511ec51bf` | 123 | 1 | 0 | 1796.74 |
| `_3` | `6a6da69156dd124511ec51ca` | 83 | 1 | 1 | 1785.87 |
| `_4` | `6a6da69256dd124511ec51d5` | 144 | 6 | 0 | 1825.18 |
| `_5` | `6a6da69356dd124511ec51e0` | 88 | 5 | 1 | 1827.32 |
| `_6` | `6a6da69556dd124511ec51eb` | 139 | 1 | 0 | 2184.81 |
| 合計 | | 694 | 15 | 2 | |

- 檢查範圍未截斷，查詢與讀取索引均成功，沒有權限錯誤。
- Chunk 實存欄位只有 `_id`、`chunkId`、`segmentId`、`videoId`、`startSec`、`endSec`、`text`、`embedding`。沒有 `courseId`、時間／版本 metadata、聲音或畫面向量欄位。
- 全部 ID 符合 `<videoId>_chunk_<至少四位數字>`。本次範圍內重複 ID、無效時間、超出影片長度、無法對應六支影片、空文字均為 0。按起始時間排序後，六支影片皆無相鄰重疊與 chunk 序號倒退。
- 例如影片一 `_chunk_0001` 為 6.42–35.62 秒，`_0002` 為 35.82–55.92 秒。引用應保留這些原始時間。
- 兩筆超長 chunk 分別為影片三的 603.74 秒與影片五的 647.03 秒。依鎖定規則記錄略過媒體 Embedding，保留原 chunk。
- 694 筆文字向量均為 3072 維數字陣列，格式異常 0，平方範數與 1 的差小於 0.001。這只證明向量結構與近似 L2 正規化。
- 694 筆皆缺少 camelCase 與已檢查 legacy 的模型、provider、維度宣告、instruction、generation、normalization、契約版本與產生時間。`transcriptVersion` 及影片的 `activeTranscriptVersion` 亦未實存。缺少 metadata 的 694 筆屬版本未知，無法確認穩定版、preview 或版本混用。
- Parent 有 3 筆，均為影片六、`isActive=true`，每筆 3 個 child，共涵蓋 9 個 Leaf；引用失聯 0。它們尚未涵蓋全部 694 筆 Leaf。

實查 `text_embedding_index` 為 `vectorSearch`、`READY`、`queryable=true`，定義如下。

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 3072, "similarity": "cosine" },
    { "type": "filter", "path": "courseId" },
    { "type": "filter", "path": "videoId" }
  ]
}
```

目前沒有 `audioEmbedding`、`visualEmbedding` 索引欄位。此次沒有執行向量搜尋，queryable 狀態尚不能證明實際命中品質。

## 僅程式碼與本機設定確認

- 本機設定是 Atlas 搜尋、Gemini query provider、`gemini-embedding-2`，索引名與實查一致。正式站 runtime 尚未確認。
- `qa.service.js` 的 `loadScopedSearchableSegments`、`searchSegmentsWithAtlas` 使用現有 Leaf collection；`bridgeScope.service.js` 的 `buildSegmentLookupQuery` 依允許的 `videoId` 清單篩選。這解釋了舊資料沒有 `courseId` 仍可經影片權限路徑讀取。
- 現行 `embeddingContract.service.js` 要求穩定版 Gemini 的完整 metadata，現存資料不足以證明相容。
- `chunking.py` 以 transcript segments 合併成 chunk；目前預設最多 220 字、6 段、45 秒，ID 依影片與流水號產生。資料沒有儲存當時參數，不能用目前預設回推歷史切段策略。
- Mongoose `activeTranscriptVersion` 預設為 legacy，但 raw Atlas 缺少此欄位；Schema 預設值不能當成資料已寫入版本的證據。

## 下一階段判斷

| 工作 | 判斷與所需確認 |
|---|---|
| 使用既有 chunk 切聲音／畫面 | 可沿用 ID 與時間。先核對各原片時長，15 筆補長、2 筆略過。由課程與影片關係在記憶體補入工具所需 `courseId`，原始 chunk 不需改寫。 |
| 保留現有文字向量 | 可以保留資料。與穩定版 query／媒體向量的契約相容性尚未證實，需要 Weihao 提供可追溯的產生紀錄或匯出檔，不自行重算或回填推測 metadata。 |
| 同一索引新增媒體欄位 | 官方介面支援，現有索引定義也符合預期結構。實際新增需另行授權、保存完整舊定義、備份與驗證 READY，尚未驗證本帳號的更新權限或剩餘容量。 |
| Gemini adapter 開發 | 可獨立開發與 mock 測試。真實呼叫需另確認價格、費用估算、金鑰與授權。 |
| 三路 Atlas／RAG 整合 | 媒體欄位與索引尚缺，需先補資料、索引並協調 `qa.service.js`。 |

本次無版本欄位可供確認正式站正在使用哪個 transcript 版本，也無法排除歷史原地替換。孤兒與重複檢查只限本課程／影片查詢範圍，未全庫掃描。

## 驗證

Node 22.23.4 執行 `node --test backend/tests/multimodal-diagnostics.script.test.js backend/tests/rank-fusion.service.test.js backend/tests/multimodal-retrieval.service.test.js`，12/12 通過。新增診斷測試涵蓋 metadata 未知與衝突分離、資料異常、查詢投影／上限、索引權限失敗與錯誤遮蔽。

唯讀實查命令為 `node backend/scripts/multimodal-diagnostics/run.js`。未啟動後端、未執行 Gemini、正式 43 題評測、migration、資料或索引寫入。完整系統測試未執行，因本輪只新增獨立診斷工具與文件，未改既有執行路徑。
