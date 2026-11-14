# Gemini 與 Atlas adapters

這份文件說明獨立 adapter 的使用方式與下一輪三個真實 chunk 驗證。模型呼叫與正式索引操作需依 HANDOFF 取得當次授權。MVD 的操作入口沿用 [Demo README](../../../backend/scripts/multimodal-demo/README.md)。

## 不付費的準備指令

從 repo 根目錄使用已建立的 Python 虛擬環境。

```powershell
# 產生計畫，會讀取本機歷史 chunk 與原片時長
STT_Whisper\.venv\Scripts\python.exe -X utf8 STT_Whisper/src/plan_multimodal_validation.py
# 另外實際切出 6 份影音並建立 Mock 向量，仍不連模型或資料庫
STT_Whisper\.venv\Scripts\python.exe -X utf8 STT_Whisper/src/plan_multimodal_validation.py --prepare
```

預設輸出 `.local-tools/phase2-validation/plan.json`，每支影片子目錄的 `manifest.json` 指向切片。原片與 8/1 的兩份文字產物需已在本機，檔案位置見程式的 `SOURCES`。產物不足時停止，沿用既有匯出檔補齊資料來源。

## Gemini adapter

`STT_Whisper/src/gemini_multimodal_adapter.py` 提供 `GeminiMultimodalAdapter`。

- `embed_text(text, role="query")` 使用既有搜尋前綴；`role="text"` 使用既有文件前綴。
- `embed_media(record)` 接收切片 manifest 的成功紀錄，單次只送一個 WAV 或 MP4，保留 chunk 原始與取樣時間。
- 預設 `allow_paid=False`，禁止呼叫。未來取得授權後才以 `allow_paid=True`、`max_cost_usd` 與 `max_calls` 建立實例。預設 SDK 只從執行環境讀取 Gemini 憑證，程式不印出機密。環境設定應透過受信任 loader 在執行期載入，不手動輸出 `.env`。
- SDK timeout 預設 30 秒，關閉 SDK 內部重試，由 adapter 對 429、指定暫時性 HTTP 錯誤與 transport timeout 最多嘗試三次。永久錯誤立即停止，原始 provider 錯誤內容省略。
- 每次嘗試前印出估計費用並原子寫入預留帳。跨輸出目錄共用 `.local-tools/multimodal-gemini/cost-ledger.json`，累計預估上限不超過 US$30，呼叫次數同時計入每次重試。失敗與逾時的預留不退還，實際帳單仍需核對。
- 檢查點綁定模型、模態、契約、輸入雜湊與 chunk／時間，成功結果續跑會沿用。Mock 與 Gemini 使用不同 provider 與契約。記錄 requested model ID、SDK 版本、處理時間、狀態與費用，服務端不可變模型修訂版尚無證據可填。
- 帳本以 `.lock` 保護並行操作。強制終止後，先確認沒有執行中的模型請求，再處理殘留鎖，保留費用帳與已預留金額。所有真實向量與帳本留在本機忽略目錄。

文字每次保守預留完整 8192 token 的費用；媒體先核對實際時長，聲音按秒向上取整，影片按最多 32 幀估算。1 fps MP4 會有一格內的時長量化，允許最多 1 秒差異，另記 `mediaDurationSec`，原始與取樣時間均保留；費用使用實際與取樣時長的較大值。音訊容差維持 0.15 秒。媒體限制採 chunk 契約的最多 60 秒，inline 上限保守設為 15 MB。官網支援的較長媒體上限不改動本次 chunk 規則。

## Atlas adapter

`backend/src/services/atlasMultimodalAdapter.service.js` 提供 `readAtlasIndex(collection)` 與 `retrieveAtlasMultimodal(options)`，由呼叫端注入 MongoDB collection，不啟動完整後端。

options 包含成功的 Gemini query embedding、已授權的 `{ courseId, allowedVideoIds }`、當次 `indexSnapshot`、經實際資料驗證的 `textDataContract` 與融合模式。使用同一 `text_embedding_index`，各路 path 為 `embedding`、`audioEmbedding`、`visualEmbedding`，top20、numCandidates=100，保持既有查詢候選倍率 5。

既有 Leaf 可缺 courseId，搜尋沿用canonical影片allowlist；呼叫端須先驗課程存取及合法掛載關係。2026-11-12 Q5定案：Leaf／media metadata的courseId僅為來源，結果依已授權影片保留，再以當次scope課程正規化候選；不因來源課程不同拒絕合法共享。此adapter不負責登入或自行授予權限。

正式QA開關ON時另以`readStableTextCoverage`核對授權範圍的每個Chunk ID／video／原秒數，及3072維、數值／unit norm與完整stable文字契約；不依top20筆數推定全量完成。部分覆蓋或查證失敗改用原文字檢索當文字一路，媒體皆不可用則整體回退。coverage不快取成功值，避免刪除／更新後沿用舊的「完整」狀態；查詢只回身份與時間，不把向量傳回Node。

正式QA的索引定義以collection物件隔離，成功快取30秒、失敗或不存在5秒，同時請求合併一次讀取；到期不使用過期READY，刷新失敗即回退。工具的`readAtlasIndex`仍為即時讀取，操作窗口不受QA快取影響。測試切換情境使用`clearMultimodalIndexCache`，不以清正式快取作驗收資料修補。開關OFF不新增索引／coverage查詢。

索引需 READY、queryable、3072 維 cosine 並具 videoId filter。缺欄位會回傳 missing 與原因。文字契約未知時停用文字路徑，結果 metadata 也再次核對；媒體結果需成功狀態、穩定版模型與對應契約。各路具 maxTimeMS、AbortSignal、耗時、來源及錯誤診斷，單路錯誤可降級。融合使用既有 RRF，原始引用時間維持不變。

目前真實 Atlas 沒有媒體索引欄位，文字 metadata 不足，這個 adapter 尚不會對現有資料產生可用的三路結果。Mock repository 測試只驗證查詢組裝與 RRF 整合。

## 下一輪真實驗證

可執行的 Dry Run／Fake SDK／付費入口及最後授權明細已整理於 [執行前檢查](evidence/2026-11-10-preflight.md)。預設省略真實 API，只有 Gemini 模式加付費旗標與明確預算／次數才會進入模型呼叫。

三筆候選是影片一 `_chunk_0117`、`_chunk_0001` 與影片四 `_chunk_0070`，保留原始 chunk ID。短段 1752.15–1754.55 秒取樣為 1748.5–1756.5 秒；其他取樣為 6.42–35.62、888.2–900.2 秒。

1. 重核原片與 chunk 對應，觀看三段確認內容，建立三個探索性問題。它們不取代正式題庫與標準答案。
2. 申請最多 12 個輸入的真實驗證，最多三次嘗試為 36 次呼叫，建議預估額度 US$0.25，所有 checkpoint 共用階段費用帳。
3. 保留 preview 文字向量，在本機另產 3 個 stable document、3 個 query、3 個 audio、3 個 visual 向量。首輪估計 US$0.0573304，全部嘗試估計 US$0.1719912，真實帳單另核。
4. 在本機對相同三個 chunk 做完整 cosine 排序及 RRF。stable query 對舊 preview 文字的排名只能用於跨版本診斷。可追溯的舊 query 向量若不存在，舊版基線仍無法完整重現。
5. Atlas 仍維持唯讀。三路正式查詢另需資料與索引授權，更新前重新匯出完整現行索引定義與目標資料備份，確認容量、權限、回復方式及 READY 驗證。先前的去敏摘要不作為索引回復備份。
6. 真實三路完成後再協調 `qa.service.js`、FAQ 與引用，整合通過後才做正式 43 題評測。

費率與輸入規格於 2026-11-10 重新查閱，依據見 [官方文件 D1、D2](references.md#業界與官方文件)；SDK timeout／retry 行為參考 [Google Python SDK](https://googleapis.github.io/python-genai/genai.html)。估算採 Standard 付費費率，未使用 Batch 折扣或免費額度假設。
# 第六階段 QA Retrieval Bridge 契約

`backend/src/services/multimodalQaBridge.service.js` 提供 `retrieveForQa`，讓 QA 可注入既有文字檢索與教師逐字稿讀取。輸入 `scope` 必須由授權層產生，包含 courseId、allowedVideoIds，可選 allowedChunkIds；模組不自行判斷使用者身分。`settings` 接受 enabled、mode（equal／text_weighted）、hierarchy，enabled 預設 false。未提供分層文字檢索函式時不得開啟 hierarchy。

使用 Atlas 時傳入 `atlas`（collection、indexSnapshot、textPath、textDataContract）與 queryEmbedding，queryEmbedding 沿用 adapter 的完整 Gemini query 紀錄契約。離線時可傳 searchers.audio／visual。textSearch 與 hierarchicalTextSearch 回傳 chunk 陣列；loadEvidence 接收候選與 scope，回傳同識別碼、原始起訖及 text 的授權教師逐字稿。教師逐字稿的載入失敗會往上拋錯，避免把不完整證據交給回答模型。

輸出 matches 內 transcript 與 text 都取自 loader，citations 保留 chunkId、videoId、startSec、endSec、retrievedBy、channelRanks。例如音訊找回原始 10–12 秒的 chunk，即使媒體取樣延伸，也只引用 10–12 秒。候選與逐字稿秒數不合時丟棄候選。空結果或檢索錯誤重試文字路徑，文字仍無證據則回傳空清單，呼叫端沿用既有無答案處理；文字路徑本身失敗則往上拋錯。

`faqEvidenceVersion(baseVersion, settings)` 將正規化設定加入版本雜湊。正式接入時應傳入現有 FAQ 基礎版本；所有快取讀取與寫入須共用同一個結果。橋接回傳的 evidenceVersion 是獨立介面的預設基礎版本。`supplementalVisualEnabled` 在 enabled=true 時固定 false。

## 正式 QA 的協作接點

- `qa.service.js` 的 askQuestion 檢索段，提供已授權 segmentScope、現有 Leaf 與 hierarchicalSearch，並把 numeric query vector 包成已核對契約的 query record。
- `buildCitation`、respondFromFaqCache 與 FAQ 證據版本，串接 retrievedBy、channelRanks 與 faqEvidenceVersion；快取需保存及重建相同來源。
- `parallelVisualSearchPromise` 與 selectSupplementalVisualMatches，依新開關停用舊補充引用。
- `backend/src/config/env.js` 準備 `QA_MULTIMODAL_FUSION_ENABLED`，只在明確 true 時開啟；本階段僅交付獨立設定介面。
- OpenAPI citation 與 StudentCourses 引用卡片，增加檢索來源傳遞及標籤。LINE 引用沿用現有路徑，不顯示標籤。

## 離線驗證與評測輸出

從根目錄使用支援的 Node 執行 `node backend/scripts/validateMultimodalQaOffline.js .local-tools/atlas-preparation/bundle.json`。輸出 JSON 含 citations 及 comparison，沒有完整向量或逐字稿；輸入保留在忽略目錄。這個工具只讀本機已保存向量，以內積模擬 Atlas cosine 排名；SDK 與 Atlas 網路呼叫均為零。

`buildComparisonRecords` 接收 questionId、scope、flat 的 text/audio/visual 及 hierarchical.text，固定共享 media 候選，輸出兩種 mode × 六組 group × 兩種 weighting。每筆含 questionId、group、mode、weighting、ranked，ranked 最多 20 筆且只含 rank/chunkId/videoId/startSec/endSec。呼叫端可直接存成 per-question.json，交給獨立評分器與既有題庫重算。此模組不產生 Parent、不呼叫模型、不改評分器；正式 43 題需完整資料、固定設定與外部驗算。

## Atlas 就緒後驗收

先確認資料與 query 模型契約、三路索引 READY 及授權影片範圍，再以既有三筆向量核對各路前 20、兩版 RRF 與本機排名。執行跨課、未授權影片、缺索引與單路失敗探測。正式 QA 接線後再驗證快取切換、逐字稿證據、引用原始秒數與網頁標籤，最後才進入全量與 43 題比較。
# 第七階段正式接線

askQuestion 已在既有授權、Leaf／Parent rollout 後呼叫 Bridge，三路使用 stable path。原檢索結果保留作 fallback，分層 serve 只替換文字候選。loader 從同次已複核 scope 的逐字稿取證；舊資料缺 chunkId 時只在內部以 segmentId 識別，對外仍保留 chunkId=null。啟用時不執行舊影像補充路徑。retrievedBy 與 channelRanks 傳到 citations、對話 sources 及網頁「比對方式」。新向量欄位在 Mongoose 預設 select=false，避免正常逐字稿載入讀出三組向量。

設定 false 保留原 FAQ 證據版本。true 的版本包含模型契約、stable path 版本及分層 rollout 設定；scope 每次重新驗證，降級結果沿用原規則不入快取。正式部署與 Atlas 就緒後才可規劃開啟。

離線命令可加第三個參數 `node backend/scripts/validateMultimodalQaOffline.js .local-tools/atlas-preparation/bundle.json .local-tools/phase2-validation/phase7-comparison`，產出 per-question.json 與 config.json。config 標記 formalEvaluation=false；小樣本的 hierarchical text 是相同 fixture，只驗證輸出結構，不代表完整 43 題或 Parent 效果。固定排名與原始時間可供獨立重算。
