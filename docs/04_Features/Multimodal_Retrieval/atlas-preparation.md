# Atlas 小樣本準備與操作

本文件說明如何用第三階段保存的向量，準備三筆 Chunk 的 Atlas 驗證。工具預設只讀取資料及產生寫入計畫，完整備份、逐字稿與向量只保存在忽略的 `.local-tools/`。整體功能狀態見[目前狀態](../../current-status.md)，提交紀錄見[進度](evidence/進度.md)。

## 2026-11-10 實際查證

- `focusflow.video_segments_text` 六支指定影片共 694 筆，已完整匯出為 BSON Extended JSON，保留型別及 SHA-256 校驗。每份約 88.7 MB，只存本機，不進 Git。
- `text_embedding_index` 為 READY、queryable，定義仍只有 `embedding` 3072 cosine、`courseId` filter、`videoId` filter。A／B 都只提出同一索引的欄位差異，沒有套用。
- 當次集合資訊未設定 validator；現有 Mongoose schema 未宣告新欄位，這兩種限制已分開檢查。
- 三筆小樣本身份、逐字稿與原始時間符合資料庫，B Dry Run 各提出三個向量及對應 metadata；資料更新 0 筆、索引更新 0 次、模型呼叫 0 次。
- 以三筆舊向量各做一次 Atlas 自查詢，均回傳 20 筆，自己的 Chunk 都排名 1。這只證明現行文字索引可查詢，不代表問答品質、正式站驗收或 preview／stable 相容。
- 用三個已保存的 stable 查詢向量執行 B 檢索預檢，三路均回報 `index_field_missing`，各路候選 0，未執行不存在 path 的搜尋。沒有真實 Atlas 三路融合成功的證據。
- 既有 694 筆文字向量與 preview 產物完全匹配的依據見[第二階段紀錄](evidence/2026-11-10-phase2.md)，三筆真實模型比較見[小樣本結果](evidence/2026-11-10-live-sample.md)。維度相同不足以認定相容。

## 選項與建議

| 方案 | 可行性與成本 | 風險、影響與時程 |
|---|---|---|
| A 保留 preview 文字，新增 stable 影音 | 現有向量可重用，0 次新增模型呼叫；同一索引新增兩路 | 舊文字契約未確認，stable 查詢不能安全當作 preview 查詢。CLI 會停用該文字路，只能先驗兩路，準備最快 |
| B 另加 stable 文字欄位 | 三筆 stable 逐字稿向量已存在，0 次新增模型呼叫；新增三個 path | 建議最小驗證方案。保留舊 `embedding`，新欄位暫名 `stableTextEmbedding`，三路版本一致；新增欄位超出原鎖定 #13，正式採用前需 Weihao 確認 |
| C 全量重新產生文字向量 | 需要 694 筆模型輸入、另做 token 成本估算與授權 | 目前無全面相容性或品質證據支持重算。成本、驗證與遷移時間最高，本工具不支援此範圍 |

B 的三筆新增向量共 9 個，float64 原始數值約 216 KiB，不含 BSON 陣列鍵、metadata、索引與重建期間資源。不能把這個數字當成 Atlas 記憶體預估。A 為 6 個向量約 144 KiB。

MongoDB 的 [Vector Search 欄位定義](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/)支援同一 `fields` 陣列配置多個 vector 與 filter，現行[維度上限](https://www.mongodb.com/docs/vector-search/)為 8192，3072 符合。更新索引會重建，期間舊定義仍可提供查詢。這是官方功能規格，尚未在本部署套用新欄位。

本輪沒有 Atlas 管理 API 憑證，無法由 MongoDB 連線可靠確認方案、剩餘 Search 容量或部署資源；歷史的 M0 標示不等於現況。正式變更前由 Weihao 提供當次 Atlas 方案、Search 限額與容量畫面，對照[部署選項](https://www.mongodb.com/docs/vector-search/deployment/deployment-options/)與 [Free 限制](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)。沿用索引名稱不增加索引數，但重建仍耗資源；未查證的上限不硬編成成功條件。

## 操作

在 repo 根目錄 PowerShell 執行。既有 env loader 在工具內使用連線，請勿輸出 `.env`。所有本機路徑都必須位於 `.local-tools`。

```powershell
. ./.local-tools/activate.ps1
STT_Whisper/.venv/Scripts/python.exe STT_Whisper/src/export_atlas_sample_bundle.py
node backend/scripts/atlas-multimodal/run.js
node backend/scripts/atlas-multimodal/run.js --strategy A --output .local-tools/atlas-preparation/dry-run-A.json
node backend/scripts/atlas-multimodal/run.js --mode index-plan --output .local-tools/atlas-preparation/index-plan.json
node backend/scripts/atlas-multimodal/run.js --mode search --output .local-tools/atlas-preparation/search.json
node backend/scripts/atlas-multimodal/run.js --mode baseline --output .local-tools/atlas-preparation/baseline.json
```

未提供 `--backup` 時，每次建立一份不覆寫的 694 筆備份。重複分析可帶 `--backup .local-tools/atlas-preparation/backup-<時間>.json`，工具會核對校驗碼，並重新查證影片與課程關係。備份是範圍匯出，非整個叢集的交易快照；正式執行前重新備份，CAS 會拒絕匯出期間或之後被修改的目標文件。

例如三筆 A/B/C 原有文件加上 9 筆本機向量 → 三筆 Dry Run 計畫，沒有 `embedding` 更新。程式使用原生 MongoClient，不載入 Mongoose model、完整後端、排程或 Migration。

## 資料契約與檢索

固定允許清單是 `...51b4_chunk_0117`、`...51b4_chunk_0001`、`...51d5_chunk_0070`，完整 ID 定義於 `control.js`。A 原始 1752.15–1754.55 秒、B 6.42–35.62 秒、C 888.2–900.2 秒。A 延伸取樣 1748.5–1756.5，但引用仍保留原始時間。

- B 寫入 `stableTextEmbedding`、`audioEmbedding`、`visualEmbedding` 與 `mediaEmbeddingMeta.text/audio/visual`，保留模型、provider、契約、dimension、處理時間、來源 signature、sample 時間與向量摘要。requested model 是 stable，服務端不可變 revision 未提供，不宣稱已取得。
- Python 匯出器先核對現有 source／切片輸入 signature 與 checkpoint 的 Python JSON digest，再輸出跨語言 float64 digest。Node 驗證 3072、有限數值、unit norm、模型、完整文字契約、身份及逐字稿。不把 preview 當作 stable metadata 補寫。
- 現有 Mongoose schema 尚未宣告這些新欄位，不能直接經其 strict update 寫入。獨立工具使用原生 driver；正式 RAG 接入前仍須擴充 model 與協調共用契約，本輪沒有改 schema。若集合有 validator，實際寫入模式會先停止，要求單獨審查。
- 三個保存的文字查詢各搜尋三路，每路 `numCandidates=100`、`limit=20`，最小驗證只保留三筆允許 Chunk。先以課程已確認的 video allowlist 做 Atlas filter，再核對 course／chunk／metadata；現有 Chunk 缺少 courseId，不能直接要求該欄位等於課程，僅在權限關係確認後於記憶體補上。
- 同一筆逐字稿及原始時間交給既有 RRF，固定 k=60，等權版與文字 2:1:1 由既有模組處理。CLI 預設等權，`--fusion-mode text_weighted` 使用文字加權；分路 Atlas 分數與 RRF 貢獻分開保存，不混加分數。報告只列 ID、時間、排名、分數、通道狀態，不含逐字稿、metadata 原文或向量。

## 未授權的實際執行與回復

以下只是參數說明，本輪沒有執行：取得書面授權後，使用同一份備份重跑 Dry Run，確認報告 `planHash`，再以 `--execute-write --backup <原備份> --approve-plan <hash>` 進入寫入。這個 hash 同時綁定資料快照、輸入 bundle、策略與索引提案。工具沒有自動套用索引功能。

逐筆 `updateOne` 不 upsert，只 `$set` 計畫欄位，完整文件 CAS 防止並行修改，重新讀取確認原資料與新向量。每成功一筆保存 receipt，失敗即停止；相同備份及計畫續跑會辨認已成功項目，不重寫。若在寫後、receipt 前中斷，同樣可從實際資料辨認成功。遇到異動衝突請檢查，不用新備份掩蓋失敗狀態。

資料回復先使用 `--mode rollback --backup <原備份>` 做 Dry Run；另獲准後加上述 execute／hash 參數。只移除這次新增的欄位或還原原值，依 CAS 與校驗阻擋衝突；原本不存在的 metadata root 在沒有其他內容時才移除。預期整份目標文件與備份相同，非目標 691 筆不更新。這不是整份 collection 覆蓋工具。

索引正式更新需另外授權：用 driver `updateSearchIndex('text_embedding_index', proposal.after)`，保留所有原設定；每 30 秒檢查一次，最多 30 分鐘（`--mode index-wait --backup <原備份>`）。READY、queryable 且完整定義 hash 一致後，再跑三路 search、baseline。FAILED、逾時或舊查詢回歸失敗立刻停止，不繼續寫其他資料；依已授權回復範圍將 `proposal.before` 套回同名索引，確認舊定義 READY 後回復三筆新增資料。沒有預先授權就先回報，工具不擅自自動回復索引。

最小成功標準：三路都有真實候選，3 筆 identity／時間無衝突，RRF 與分路排名可重算，舊文字自查詢仍可用，原 `embedding` 未改，課程隔離無洩漏。候選可能不足 20，尤其目前僅 3 筆有新向量。三筆驗證不代表 694 筆檢索品質。

## 測試與審查

Node 27 項、Python 29 項通過；包含格式與契約、改動輸入／向量拒絕匯出、Dry Run 零寫入、CAS 衝突、部分停止與續跑、重複執行、資料回復、索引差異與輪詢、三路 Mock adapter 到真實 RRF、通道失敗降級。MVD rescue 實際執行成功，重用六個真實切片，候選及向量清楚標示 Mock。

```powershell
node --test backend/tests/atlas-preparation.script.test.js backend/tests/atlas-multimodal-adapter.service.test.js backend/tests/rank-fusion.service.test.js backend/tests/multimodal-retrieval.service.test.js backend/tests/multimodal-diagnostics.script.test.js
STT_Whisper/.venv/Scripts/python.exe -m unittest discover -s STT_Whisper/tests -p test_export_atlas_sample_bundle.py -v
```

另已重跑 Python `test_gemini_multimodal_adapter.py`、`test_segment_media_embedding.py`、`test_plan_multimodal_validation.py`、`test_run_gemini_validation.py`。測試皆使用假 SDK／transport，沒有新增付費請求。未執行完整 backend／frontend／pipeline 套件，因變更集中在獨立工具與 adapter；未啟動後端、未驗正式網站、未做正式寫入、索引重建與 43 題評測。程式單元測試不代表真實 Atlas 寫入驗收。

審查入口：`STT_Whisper/src/export_atlas_sample_bundle.py` 的 `export_bundle`、`backend/scripts/atlas-multimodal/control.js` 的 `planWrites/applyPlan/rollbackPlan/indexPlan/waitReady`、同目錄 `run.js`、`backend/src/services/atlasMultimodalAdapter.service.js` 的 `retrieveAtlasMultimodal`，以及對應新增測試。

給 Weihao 的訊息：

> 四階段準備已完成唯讀備份、Dry Run 與檢索工具。舊索引可用，三筆舊文字自查詢都排第一；新三路尚未建立，沒有執行正式寫入。建議只在原三筆新增 stableTextEmbedding、audioEmbedding、visualEmbedding 與 metadata，保留全部 694 筆 embedding，沿用 text_embedding_index 加三個 path。stableTextEmbedding 超出原 #13，請確認欄位／索引契約，並提供當次 Atlas 方案與可用容量；再由庭語授權三筆寫入、同名索引更新及必要回復。qa.service.js 仍未改。11/13 完整目標還有 RAG、全量影音、章節／RU 與正式評測，時程有風險，需要你協調支援，不能把本輪小樣本當完整交付。
