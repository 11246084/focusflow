# Atlas 小樣本準備與操作

本文件說明如何用第三階段保存的向量，準備三筆 Chunk 的 Atlas 驗證。工具預設只讀取資料及產生寫入計畫，完整備份、逐字稿與向量只保存在忽略的 `.local-tools/`。整體功能狀態見[目前狀態](../../current-status.md)，提交紀錄見[進度](evidence/進度.md)。

**最新邊界（2026-11-11）：原晚間窗口已取消。本輪僅獨立工具與離線驗證，正式 Atlas 操作仍 No-Go。** 使用者接受小樣本範圍與 M0 剩餘風險；無衝突、接手管理者及執行當下證據仍須確認。以下歷史窗口不再是執行時程，最終依本頁末的清單與 [decisions.md](decisions.md#2026-11-11-最新操作邊界) 接續，不自動開始。

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
# 第七階段 Atlas 操作授權單（待單獨核准，2026-11-11）

目標 host 為 `focusflow.gw8l4ke.mongodb.net`，Database `focusflow`、Collection `video_segments_text`、既有 Index `text_embedding_index`。原定義包含 embedding（3072／cosine）及 courseId、videoId filter；提案只新增 stableTextEmbedding、audioEmbedding、visualEmbedding（各 3072／cosine），保留全部原欄位與舊 694 筆 embedding。這比原 HANDOFF 多一條 stable 文字 path，B 方案決策及實際操作均需使用者核准。

- 三筆 allowlist 為 `6a6da68e56dd124511ec51b4_chunk_0117`、`6a6da68e56dd124511ec51b4_chunk_0001`、`6a6da69256dd124511ec51d5_chunk_0070`，課程 `6a6da68456dd124511ec5196`。只寫三個向量欄位與 mediaEmbeddingMeta.text/audio/visual，共九個已保存 stable gemini-embedding-2 向量；向量 JSON 約 594785 bytes，另加 metadata。沿用保存的三個 query，模型呼叫費用為 0。
- 本次備份 `.local-tools/atlas-preparation/backup-1794363217578.json` 包含 694 筆與原索引，校驗碼由工具驗證；提案為 phase7-plan.json，純 JSON 索引前後像為 phase7-index-before.json／phase7-index-after.json。執行前重跑 index-plan 建立當次備份，核對三筆身分、原 embedding digest、索引 beforeHash 與計畫雜湊。不得沿用過期雜湊套用到不同前像。
- 本次僅能確認本資料庫有 3 個 READY/queryable 索引，tier、全叢集名額、Search 用量及費用未知。擴充同名索引不增加索引數，仍可能重建、增加資源負擔或影響舊文字查詢。變更窗口由使用者指定，開關保持 false；先取得管理端 tier／限制證據，遇到配額拒絕立即停止，不升級、不刪索引。
- 命令前綴均為支援版本的 `node backend/scripts/atlas-multimodal/run.js`。依序跑 `--mode baseline --output .local-tools/atlas-preparation/phase7-before-smoke.json`、`--mode index-plan --output .local-tools/atlas-preparation/phase7-approved-plan.json`。核准當次計畫後才跑 `--mode dry-run --strategy B --backup <當次備份> --execute-write --approve-plan <當次planHash> --output .local-tools/atlas-preparation/phase7-write-receipt.json`，逐筆 CAS 寫入並留 receipt。
- Index 更新另在已驗證目標的 mongosh 執行 `db.getSiblingDB('focusflow').getCollection('video_segments_text').updateSearchIndex('text_embedding_index', JSON.parse(require('fs').readFileSync('<當次 after 定義純 JSON 路徑>', 'utf8')))`。此步只在核准後操作，現有 CLI 的 index-plan 不會修改索引。接著跑 `--mode index-wait --backup <當次備份>`，最多 61 次、間隔 30 秒；FAILED、逾時或定義 hash 不符即停止。重跑 baseline，三筆須各為自身第一名，再跑 `--mode search --strategy B --backup <當次備份> --output .local-tools/atlas-preparation/phase7-real-search.json`，核對三路成功、兩版 RRF 與跨課／未授權影片負例。
- 回復時保持 flag=false，依 receipt 與原前像以 `--mode rollback --strategy B --backup <當次備份> --execute-write --approve-plan <同一當次planHash>` 回復三筆欄位，再以 updateSearchIndex 套用當次 before 純 JSON，等待 READY 並重驗舊文字 baseline。CAS 發現他人異動即停止，不強制覆寫。建議驗證後回復三筆與索引；如需保留，請在本授權中明確選定。真實 QA 的新 embedding 呼叫可能付費，本授權單只含保存向量查詢，正式 API 線上提問另訂費用範圍。

請核准的項目為 B 方案契約差異、上述三筆／九向量寫入、同名索引更新與必要回復、變更窗口，以及驗證後回復或保留。尚未取得核准，以上寫入／索引命令均未執行。

## Free M0 官方限制與操作調整（2026-11-11）

來源分開記錄：使用者提供 Atlas UI 實查，cluster focusflow、FREE M0、MongoDB 8.0.37、AWS Hong Kong；全叢集三個 Search 索引已滿，text_embedding_index 三節點皆 READY／QUERYABLE，估算文件數 815/815、每節點約 10.87 MB，原定義只有 embedding（3072／cosine）及 courseId、videoId filter。使用者未修改資料或索引；本輪只更新計畫，沒有重新連線 Atlas。

官方允許同一 vectorSearch 定義內有多個 vector 欄位；Free 限三個 Search／Vector 索引，定義 JSON 不超過 3 KB。B 方案保留同名索引、原 embedding 與 filters，再加三個不同 path，合計四個 vector 欄位、兩個 filter。既存 phase8-index-after.json 的壓縮 JSON 為 424 UTF-8 bytes，符合定義大小限制；3 KB 是定義限制，不能拿來解讀每節點 10.87 MB 的實體索引大小。這是支援範圍核對，尚未完成 M0 真實重建驗收。[官方多向量定義](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/?deployment-type=self&embedding=byo&interface=driver&language=go)、[Free Search 限制](https://www.mongodb.com/docs/search/deployment/feature-compatibility/)

Free 監測只有 Connections、Logical Size、Network、Opcounters 等有限指標，Search CPU／Memory 不可取得屬已確認方案限制。以使用者可見的 Operation Throttling、索引三節點狀態、查詢錯誤／延遲及舊文字基準共同觀察；保留資源盲區，待使用者接受，不再要求提供該方案不存在的進階圖表。[官方 Free 限制](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)

更新索引會背景重建，官方說明重建期間舊定義仍能服務，完成後才替換。M0 的共享資源仍可能影響延遲，官方沒有承諾本次耗時或資源峰值。815 是全 collection 的 UI 估算口徑，694 是先前六支課程的備份範圍，不能視為相同集合範圍；同名重建涵蓋整個 collection 的當次文件。窗口前核對全 collection 計數／索引範圍，保護其他課程與使用者，三筆以外不寫資料。[官方重建行為](https://www.mongodb.com/docs/manual/reference/method/db.collection.updatesearchindex/)

調整執行順序與回復方式如下。

1. 使用者指定無教學尖峰、影片處理或批次評測的兩小時維護窗口，安排 Atlas 管理者可觀察及接手。兩小時是預留建議，不是完成保證；範圍包括正向與回復兩次重建及驗收。正式多模態開關維持關閉。
2. 以當次資料重建備份／CAS／planHash，核對三筆身份、694 舊向量、全 collection 範圍及完整索引 before 定義。三節點都要 READY／QUERYABLE。先跑舊文字三筆 baseline 並保存延遲、可用監測圖表與節點狀態。
3. 核准後只做三筆／九個保存向量寫入、驗 receipt，再更新同名索引一次。保留 embedding 及 filters，不變更 quantization、模型生成或其他 path；三條新 path 使用保存向量，不啟用 autoEmbed。
4. 既有 index-wait 的 61 次／30 秒約為 30 分鐘觀察界線，只核對整體狀態及定義 hash，不能取代 Atlas UI 三節點確認。到期仍建置時停止新變更並保留 receipt／狀態，由管理者判斷等待或可安全回復的時機；不把逾時直接當成可立即送反向更新的條件，也不重複送 updateSearchIndex。
5. READY 且三節點完成後仍須輪詢三筆實際可查詢性，因資料與 Search 索引為最終一致；之後才比對三路排名、等權／文字 2:1:1 RRF、原始秒數及權限負例。前後舊文字 baseline 都須三筆自身排名 1；錯誤／超時、基準退化、配額拒絕或 FAILED 時停止後續寫入，保存證據。
6. 驗證後預設回復：先以 receipt、當次前像及 CAS 核對並還原三筆新增欄位，再在沒有衝突更新且平台允許時套用 before 索引定義。這會觸發第二次重建，需再次等三節點 READY／QUERYABLE、核對原定義 hash、確認九向量欄位回到前像及 694 舊向量不變，最後重跑文字 baseline。他人異動或平台拒絕時停止並交管理者，不刪除再重建索引。

剩餘核准為操作窗口、接受 M0 監測盲區及雙次重建風險、三筆 CAS 寫入、同名索引更新與必要回復。單一小樣本技術驗證沿用三個保存 query；完整 43 題品質驗收仍另外受 X01、全量資料與評測條件限制。

## 原 2026-11-11 20:00–22:00 窗口與授權關卡（已取消，歷史紀錄）

使用者已指定台灣時間 2026-11-11 20:00–22:00。當前只核准文件提交／push、唯讀查證、備份校驗與 Dry Run，狀態為 PREP-ONLY／NO-GO FOR WRITE。即使準備檢查通過，也不建立排程或自動開始；必須使用者於窗口內在線再次明確核准三筆 CAS 寫入、同名索引更新、真實三路驗證與必要回復。

窗口內還要確認 Atlas 管理者可聯絡且有處置權限、VM 管理者知悉且無重疊修復／部署。正式網站狀態未知時，須使用者明示接受只做 Atlas 小樣本且不含正式網站 E2E，否則 No-Go。當次備份、全部索引相關欄位的 before 快照與 checksum、三節點狀態、九向量來源、三筆新增欄位不存在、fresh planHash、baseline 與隔離健康均要即時重驗；下午的結果不代替窗口證據。

驗證後預設回復。超出 22:00 仍在建置／回復時停止新的非必要變更，持續可行的唯讀監測並交接管理者；不得宣稱已恢復，也不盲送反向更新。窗口過期或人員失聯時未開始寫入即保持原狀。

## 更新後 Go／No-Go 執行前表

本表列出下次操作的證據與責任分工；歷次結果須在實際窗口重驗。第八階段的 B 技術決策已獲使用者同意，資料／索引執行授權仍分開取得。

| 條件 | 現有證據 | 負責人 | 執行前狀態 |
|---|---|---|---|
| Tier／全叢集 Search 配額與容量 | 使用者 UI 實查 M0、三索引已滿；同名多 path 符合官方定義，現有索引約 10.87 MB／節點 | Atlas 管理者在窗口重驗全 collection 與 Logical Size；不能只據索引大小保證重建餘裕 | 支援範圍確認，資源峰值未知 |
| Search CPU／記憶體／重建資源 | M0 不提供進階監測；採可用基礎指標、Throttling、查詢與三節點狀態 | 使用者接受盲區，Atlas 管理者監看 | 已確認限制，待風險接受 |
| 帳務及費用限制 | Free M0，計畫維持方案且沿用保存向量；不新增付費服務 | 使用者核定本次範圍 | 本計畫無新增模型費用，待核定 |
| 低風險窗口與復原聯絡人 | 已指定 2026-11-11 20:00–22:00 台灣時間；人員在線、管理者可接手及 VM 無重疊仍待確認 | 使用者與 Atlas／VM 管理者 | 窗口確定，值守／二次授權 BLOCKED |
| 寫入與索引更新權限 | 11/11 connectionStatus 布林確認，未試寫 | Codex 在窗口唯讀重驗 | 曾確認，待重驗 |
| 694 舊向量、三筆身份與 baseline | 第八階段 694 筆相同，三筆自查第 1 | Codex 用既有 baseline／Dry Run 工具 | 曾通過，待重驗 |
| 當次備份／CAS／planHash | 既有 phase8-dry-run 與備份；不固定沿用過期 hash | Codex／使用者核對實際計畫 | 窗口前重建並核准 |
| 索引 before／after 與監測 | 同名增加三路；READY/queryable、定義 hash、文字 baseline | Codex／Atlas 管理者 | 待正式核准 |
| rollback | CAS 比對 receipt，預設回復三筆欄位及原索引；他人異動即停 | 使用者核准必要回復，Codex 執行 | 待正式核准 |
| 三路與權限驗收 | 保存九向量／三 query、本機預期排名；尚無真實三路結果 | Codex | BLOCKED 至索引與資料就緒 |

全部條件達成後，仍須使用者明確核准三筆寫入、同名索引更新與必要回復。真實完整 43 題另缺 X01 的 V5 時間標註確認、完整一致版本的語料／Parent／媒體向量與排名，不以三筆小樣本取代。

## 索引前像的預設欄位核對

完整保存 latestDefinition 與各節點 mainIndex.definition，不覆蓋原始快照。2026-11-11 下午查證三節點定義完全相同，與 latestDefinition 的 fields 相同，唯一差異為節點定義多出 numPartitions: 1。[官方 Vector Search API 定義](https://www.mongodb.com/docs/api/doc/atlas-admin-api-v2/operation/operation-creategroupclustersearchindex) 明列此欄位預設為 1；因此可辨識這個已知預設值差異，但不能宣稱兩種原始 JSON checksum 相等。

當次 latestDefinition beforeHash 為 `1cb8b24998df4c6ec0a629b4490044d1cdd868c6d711cc1c2680596cce785935`；三節點完整定義 hash 均為 `4a3f8d5c8bbf57d82bec890bdca8574d00fabbea4310263af75727b4db126eb4`。窗口核對須同時保留兩者，確認 fields 完全一致、差異只限已確認的預設 numPartitions: 1；其他差異即停止。更新／回復使用當次保存的使用者定義，不把節點狀態或額外預設欄位直接抄入提案。每次重建後仍要檢查三節點 READY／queryable、使用者定義 hash 及逐節點欄位，不能僅依現有 index-wait 的整體結果放行。

目前本機未安裝 mongosh。若窗口核准後仍沿用文件中的 mongosh 操作，須先備妥該操作環境；也可先明確選定既有 Node MongoDB driver 的 collection.updateSearchIndex 等價操作，唯讀已確認方法與帳號權限存在。此次沒有安裝工具、試更新或新增開發。下午實查證據與剩餘門檻以 [目前狀態](../../current-status.md) 為準。

## Node Driver 離線驗證與操作介面

使用獨立 [index-control.js](../../../backend/scripts/atlas-multimodal/index-control.js)，不載入 app／models 或 env，也不建立連線；呼叫端提供已核對命名空間、關閉 retryReads／retryWrites 並設好連線逾時的 collection。沒有新增 CLI 寫入模式、自動排程或自動回復。原 `run.js --mode index-wait` 仍是整體狀態檢查，不可取代此介面的逐節點驗證。

`transitionIndex(collection, proposal, options)` 的 proposal 是既有 `control.indexPlan(當次索引前像, 'B')`；會重新驗算 beforeHash／afterHash、保留舊向量與 filters、只增三個 path、定義不超過 3 KB。direction 為 forward 或 restore，預設 execute=false：讀取／檢查 → 回傳 dry_run 與目標 JSON → 更新次數 0。restore 使用同一份前像提案的 before，而不是從變更後索引重新產生提案。

正式核准後才可指定 execute=true、approveHash=approvalHash(proposal)，並傳入 `createIndexJournal('.local-tools/atlas-preparation/<當次操作>/index-receipts')` 回傳的 receipt／readReceipt。這個索引 operationHash 綁定 namespace、索引名及 before／after；它與既有綁定 bundle／三筆資料的 planHash 分工不同，正式檢查必須同時記錄，不能互相替代。紀錄檔依 operationHash 與 direction 分開，包含完整檢查快照、階段與 checksum，寫後 flush 並回讀；不得刪除紀錄來規避重送保護。範例只讀呼叫：

```js
const { transitionIndex } = require('./backend/scripts/atlas-multimodal/index-control');
// collection 與 proposal 由已完成目標／備份核對的呼叫端提供；這裡不建立連線。
const forward = await transitionIndex(collection, proposal); // dry_run，after JSON
// restore Dry Run 僅在正向已完成且三節點就緒時適用；原索引已在前像則回報 already_at_target。
const restore = await transitionIndex(collection, proposal, { direction: 'restore' });
```

流程為前像／三節點就緒 → prepared 落盤 → 重新讀取前像／版本／index id → submission_started 落盤 → 單次 `collection.updateSearchIndex('text_embedding_index', target)` → submitted 落盤 → 輪詢三節點及定義 → verified 落盤。所有節點需 READY／queryable，無 stagedIndex，定義只允許已確認的 numPartitions: 1 預設差異。Node Driver 的真實方法及命令建構器以 Fake 執行端離線驗證；這不等於 Atlas 已接受或完成更新。

輪詢最多 61 次、間隔 30 秒；逾時只停止，不重送、不反向重建。FAILED、額外定義、節點缺漏、權限／配額拒絕、網路未知結果或 receipt 故障均向呼叫端拋錯，不捕捉後自動重試。submitted／submission_started 紀錄存在時，後續執行若未確認三節點已達目標則禁止再送；已達目標只回報 already_at_target。索引更新無伺服器 CAS，最後一次讀取後仍存在競爭時間差，因此不得同時跑多個工具／管理者；不能以 Mock 測試取代排他操作確認。

三筆資料仍沿用 `planWrites/applyPlan/rollbackPlan`。rollback 現在也逐筆保存 receipt；失敗後已回復項目不重寫，其他人的欄位或 CAS 衝突均停止。索引 journal 與資料 write／rollback receipt 使用不同檔案；錯誤、逾時時一併保留，不能用完整 collection 備份強制覆蓋。正式驗證後，只有在平台狀態允許時才按既定計畫回復欄位及索引，回復完成同樣必須有三節點與舊文字基準證據。

## 最終 Go／No-Go 與管理者確認

管理者須當次確認並留下時間／姓名／聯絡方式：目前無 Atlas 資料／索引變更、VM 修復或正式部署衝突；操作期間不啟動其他變更；有具處置權限者在線接手；可讀取索引三節點、Throttling／告警與基礎資源圖表；若超時或失聯，由誰持續唯讀監測與交接。無法確認任一項即 No-Go。不能只從 GitHub 沒有執行中的部署推定所有人都沒操作。

| 放行條件 | 必要證據／停止條件 |
|---|---|
| 最新授權與人員 | 本輪只授權離線工作；正式操作前確認最新授權有效、排他協調與接手人員，不自動開始 |
| M0／索引與資源 | 管理端當次 M0、全叢集三索引、可用監測與告警；不建立第四個，不升級；嚴重節流／告警即停 |
| 前像及資料 | fresh 備份回讀 checksum、限定 694 範圍標示、三筆身份／原始時間／逐字稿／舊 embedding、九個保存向量及新增欄位狀態；與舊備份不一致先查明 |
| 計畫與索引 | 當次資料 planHash 及索引 operationHash、完整 before／after、三節點 READY／queryable；出現未核准欄位或版本衝突即停 |
| 基準與 receipt | 舊文字三筆 rank 1、課程／影片負例正常、延遲觀察；磁碟資料 receipt、正反向索引 journal 與監測可用 |
| Driver／CAS 離線門檻 | 執行驗證紀錄中的定向測試確認工具行為；Mock 通過不等於以上即時條件已通過，測試結果見目前狀態 |
| 驗證與回復 | 真實三路、兩種 RRF、原始時間及授權負例，再按 receipt／CAS 回復三筆與原索引；等待回復重建完成、694 向量不變、重跑舊文字基準 |

任何前置未通過即不寫入。送出後結果不明先查平台，保留全部證據交接管理者；不得因為尚未完成驗收就宣稱成功或盲目回復。
