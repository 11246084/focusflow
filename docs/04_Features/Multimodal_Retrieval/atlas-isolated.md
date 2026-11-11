# 三筆 Atlas 隔離驗證：前置檢查與授權清單

本輪只準備專用 Collection、索引與三筆資料，沒有執行任何 Atlas 寫入或索引建立。已保存的 12 筆真實向量可重用，無須 Gemini 呼叫。功能狀態見[目前狀態](../../current-status.md)，提交見[進度](evidence/進度.md)。

## 現有資料庫整合方向（2026-11-11）

使用者已明示本次不採隔離環境。正式目標固定為現有 `focusflow.video_segments_text` 與同名 `text_embedding_index` 的 [B 方案](atlas-preparation.md)，不新增資料庫、集合、專案或叢集；本頁其餘保留歷史工具說明，不是目前執行授權。現有 M0 三個 Search 索引已滿，換集合或資料庫仍共用同一配額，不能新增第四個測試索引。整體查證狀態只看 [目前狀態](../../current-status.md)。

## 2026-11-10 實查與阻礙（歷史）

| 項目 | 實際結果 |
|---|---|
| 連線環境 | 沿用既有受信任 env loader 的 Atlas 連線，資料庫 `focusflow`；不揭露主機、帳號或連線字串 |
| 建議目標 | `focusflow.multimodal_sample_3_validation`，當次不存在 |
| 建議測試索引 | `multimodal_sample_3_vector_index`，只建於上列 Collection |
| 既有索引 | `video_segments_text.text_embedding_index`、`video_segments_parent.parent_embedding_index`、`video_segments_video.video_embedding_index`，全為 READY／queryable |
| 查證範圍 | `focusflow` 29 個 Collection 的 Search 索引清單，失敗 0；總計 3 個。不是叢集全部資料庫盤點 |
| 權限 | `connectionStatus(showPrivileges)` 在記憶體轉成布林結果，目標 namespace 的 find／insert／remove／createCollection／createSearchIndexes／listSearchIndexes／dropSearchIndex／dropCollection 均為 true。未以試寫驗權，也未保存身份或原始權限回應 |
| 資料容量 | dbStats：dataSize 56,563,686、storageSize 129,941,504、一般 indexSize 4,288,512 bytes。這不含可據以計算剩餘 Search 記憶體或整個叢集空間的證據 |
| 新資料大小 | 三筆文件合計約 387,720 BSON bytes（含包裝陣列）；9 個向量的原始 float64 數值 221,184 bytes。索引、重建記憶體與複本額外計算 |
| 仍未確認 | 當次部署 tier、叢集級剩餘索引配額、可用 Search 資源及可能帳單增量 |

**不能宣稱所有檢查都通過。** 官方[索引限制](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/)為 Free 最多 3 個、Flex 最多 10 個 Search／Vector 索引合計。若目前是 Free，這個資料庫已用滿 3 個，新增第四個測試索引不可行，換 Collection 或換資料庫也不會增加叢集配額。權限足夠不等於配額足夠。

請 Weihao 只補當次 Atlas tier、叢集索引總數／剩餘名額與容量證據，無須新增環境或提供密碼。若確實已滿，最小替代是指定既有且有空位的非正式 Atlas 部署，重新確認連線目標與三筆資料即可；若只有目前 Free，改採第四階段沿用正式索引方案會涉及正式 path 變更，須另行決策／授權，不能自行當作替代操作。本輪沒有建立新叢集、升級或刪索引。

## 欄位契約

固定課程 `6a6da68456dd124511ec5196`，三筆完整 ID 及時間如下。查詢向量不寫入 Collection。

| Chunk ID | 原始引用時間 | 內容類型 |
|---|---|---|
| `6a6da68e56dd124511ec51b4_chunk_0117` | 1752.15–1754.55 | A：文字生圖 |
| `6a6da68e56dd124511ec51b4_chunk_0001` | 6.42–35.62 | B：課程介紹 |
| `6a6da69256dd124511ec51d5_chunk_0070` | 888.2–900.2 | C：論文蒐集 |

每筆只含 `_id=chunkId`、`chunkId`、`courseId`（字串）、`videoId`（字串）、`startSec`、`endSec`、該段 `text`、`validationOwner=focusflow_multimodal_phase5_v1`，加上：

- `stableTextEmbedding`、`audioEmbedding`、`visualEmbedding`：各 3072 維、有限值、unit norm，沿用既有真實 checkpoint。
- `mediaEmbeddingMeta.text/audio/visual`：provider、模型、完整契約、dimension、原始與取樣時間、處理時間、signature、vectorDigest 等既有 metadata。模型 requested ID 為 `gemini-embedding-2`，不可變服務端 revision 未提供。

沒有舊 `embedding` 或其他 691 筆資料，也沒有複製不必要的正式欄位。三路身份與正式三筆原文／時間及影片課程關係已唯讀逐項核對。索引定義只有上述三個 vector path（3072 cosine）以及 `courseId`、`videoId` filter。這是專用測試契約，沒有修改正式 schema 或原 #13 的同名索引決議。

## 可重複的前置與搜尋指令

根目錄 PowerShell：

```powershell
. ./.local-tools/activate.ps1
STT_Whisper/.venv/Scripts/python.exe STT_Whisper/src/export_atlas_sample_bundle.py
node backend/scripts/atlas-multimodal/isolated.js
```

預設 `preflight` 只讀 Atlas，寫入本機 `.local-tools/atlas-isolated/`：`preflight.json`、`payload.json`、不可覆寫的 `backup-<時間>.json`。payload 是可審核的三筆精確資料及索引定義，報告含其 SHA-256。所有檔案均不進 Git。

授權後完成指定寫入與索引建立、確認新資料已被索引，再用以下唯讀入口驗證：

```powershell
node backend/scripts/atlas-multimodal/isolated.js --mode search --output .local-tools/atlas-isolated/search.json
node backend/scripts/atlas-multimodal/run.js --mode baseline --output .local-tools/atlas-isolated/production-baseline.json
```

隔離 CLI 故意只提供唯讀 modes，沒有會意外建集合或索引的旗標。實際寫入不在本輪執行；下一輪授權後依精確 payload 使用原生 driver 的 `createCollection`、逐筆 `insertOne`（不 upsert）、`createSearchIndex({name, type:'vectorSearch', definition})`，不經完整後端或 Mongoose autoIndex。不得對既有同名測試 Collection 盲目覆寫。

三個問題各查三路，共 9 次正向 Vector Search。每路 `numCandidates=100`、`limit=20`，三筆測試資料應回傳 3 個候選；同一組真實候選分別送入等權及文字 2:1:1 的既有 RRF，k 固定 60，不重複查詢兩版。另執行錯誤 Course／Video 各三路，共 6 次負向查詢，必須回傳 0。正式舊文字基準前後各 3 次，合計 6 次。最小固定查詢總數 21，READY／資料可見性輪詢另外記錄，不無限重試。

搜尋會檢查完整索引定義 hash、READY／queryable、精確三筆文件及身份，保存每路 ID／時間／排名／分數、RRF 通道貢獻與本機 cosine 差異。Atlas cosine 分數依 `(1+cosine)/2` 對照；微小浮點差異與近似排序分開記錄，不調參數迎合結果。課程／影片在 Atlas 查詢前就過濾，另有回傳後核對。Mock 測試標示 Mock，不能拿測試函式的 `source` 常數當真實執行證據。

## 備份、回復與停止

當次前置已保存「目標不存在、無測試索引、文件空集合」的備份，以及正式三筆來源；EJSON 磁碟寫回讀及兩份 checksum 核對通過。第四階段的 694 筆完整備份仍在本機，沒有覆寫。

本機回復演練：精確 payload 建立模擬測試狀態 → 檢查 owner、三筆 allowlist、每份文件 hash → 移除模擬索引 → 按 hash 移除三筆 → 確認零文件／無索引／目標不存在。測試另驗證已有目標、額外文件、owner 不符或並行改動時拒絕清除。這已驗證本機回復邏輯與備份 round-trip，**尚未實測 Atlas 建立／刪除，因本輪禁止寫入**。

實際執行需另存 collection UUID、建立回應、每筆成功 receipt、實際文件與索引定義，部分失敗即停止；續跑只接受相同 UUID／owner／payload，不換目標掩蓋失敗。清理時依當次成功 receipt，逐筆核對已寫入子集合與完整文件值後刪除，不能要求一定三筆才處理部分失敗。先備份測試結果與新資料，僅刪本輪建立的索引／文件；確認沒有額外文件或非本輪索引後才刪空 Collection。若有不明資料或 UUID 改變，立即停下，不 drop。

FAILED 或最多 30 分鐘索引未 READY 即停止；READY 後資料仍不可查，最多再等待 5 分鐘，明記輪詢次數後停止。三路單路失敗、scope 洩漏、模型／時間契約不符、payload 改動、資料超過三筆、正式文字基準改變都停止，不自動修改正式資料補救。清理僅在下一輪包含明確授權時執行。

## 成本與測試證據

模型新增費用 US$0，因直接沿用 12 筆 checkpoint；三筆資料增加約 0.39 MB BSON，Search 索引負載、帳單增量與外傳費用尚無法精算。Free 的新增資源費用不收費，但若已滿索引配額便不能執行。若需升級，官方 [Flex 成本](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/)為 US$0.011/hour 起，依 ops/sec 可能較高；這是整體方案報價，不是本次測試費用，也未授權升級。查詢和建索引仍與正式系統共用運算資源，因此 namespace 隔離不等於資源隔離。

Node 34/34 通過（新隔離測試 7 項、既有相關測試 27 項）：精確三筆／9 向量、拒絕額外資料、回復演練、0／1／2／3 筆部分寫入清理計畫、權限資源範圍、測試 index 與雙 filter、三題 9 路 Mock 搜尋到真實 RRF、兩版融合、本機差異、6 次負向 scope、單路失敗及洩漏停止。此為無外部寫入的單元／Mock 整合測試，不等同真實三路 Atlas 搜尋成功。

```powershell
node --test backend/tests/atlas-isolated.script.test.js backend/tests/atlas-preparation.script.test.js backend/tests/atlas-multimodal-adapter.service.test.js backend/tests/rank-fusion.service.test.js backend/tests/multimodal-retrieval.service.test.js backend/tests/multimodal-diagnostics.script.test.js
```

未執行整套前後端／Python 測試，因本輪只新增 Node 隔離工具及擴充 adapter 的固定索引 allowlist，原正式預設不變；未啟動完整後端、未做正式評測。沒有新增 Gemini 呼叫、Atlas 資料寫入或索引變更。

## 三筆 Atlas 隔離驗證執行清單（仍有前提）

目前不可無條件開工。Weihao 先確認 tier、**叢集級至少 1 個空索引名額**、資源與可接受成本；若是目前已用滿的 Free，須先指定可用隔離目標，不能授權後硬建第四個。

確認可用後，庭語可直接授權下列具體範圍：

1. 既有連線目標 `focusflow`，新建 `multimodal_sample_3_validation` 與該 Collection 的 `multimodal_sample_3_vector_index`，只允許本文件三筆 Chunk、9 個已存在 stable 向量，不新增 Gemini 呼叫。
2. 寫入前重查目標不存在、核對本機 payload hash、重新保存備份與正式舊文字三筆基準；只建立索引定義中的三個 vector path 及兩個 filter，禁止動正式三個索引與 694 筆向量。
3. 執行 9 次正向＋6 次負向 Vector Search、兩版 k=60 RRF、本機排名比較及前後正式文字基準；輪詢設上述時限，失敗立即停止。
4. 授權完成／失敗後，保存證據、按 UUID／owner／receipt 核對後刪除本輪測試索引及已寫入的三筆或部分文件，只在空且沒有非本輪資源時刪除測試 Collection，回到原先不存在狀態。
5. 不升級叢集、不改正式 schema／索引／qa.service.js、不執行 43 題評測；若需付費變更方案，另行報價與授權。

給 Weihao：

> 第五階段前置完成。focusflow 已有 text／parent／video 三個 READY Vector 索引，帳號可建立測試集合與索引；但 tier／叢集剩餘配額還未知。若是 Free，三個名額已滿，不能新增第四個。請只確認當次方案、至少一個空名額及可接受資源成本；若已滿，指定既有可用的非正式 Atlas 目標即可。三筆 stable payload、雙 filter、RRF、備份／回復本機演練已備妥，不需 Gemini 費用，尚未有任何 Atlas 寫入。請不要為此刪除正式索引。11/13 完整交付仍需協助後續 RAG 與驗收。
