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

文字每次保守預留完整 8192 token 的費用；媒體先核對實際時長，聲音按秒向上取整，影片按最多 32 幀估算。媒體限制採 chunk 契約的最多 60 秒，inline 上限保守設為 15 MB。官網支援的較長媒體上限不改動本次 chunk 規則。

## Atlas adapter

`backend/src/services/atlasMultimodalAdapter.service.js` 提供 `readAtlasIndex(collection)` 與 `retrieveAtlasMultimodal(options)`，由呼叫端注入 MongoDB collection，不啟動完整後端。

options 包含成功的 Gemini query embedding、已授權的 `{ courseId, allowedVideoIds }`、當次 `indexSnapshot`、經實際資料驗證的 `textDataContract` 與融合模式。使用同一 `text_embedding_index`，各路 path 為 `embedding`、`audioEmbedding`、`visualEmbedding`，top20、numCandidates=100，保持既有查詢候選倍率 5。

既有 Leaf 缺 courseId，搜尋沿用影片 allowlist；呼叫端須先用現有課程存取流程建立允許影片清單。結果會再檢查影片與存在時的 courseId，才以已確認的課程關係補入候選。此 adapter 不負責登入或自行授予課程權限。

索引需 READY、queryable、3072 維 cosine 並具 videoId filter。缺欄位會回傳 missing 與原因。文字契約未知時停用文字路徑，結果 metadata 也再次核對；媒體結果需成功狀態、穩定版模型與對應契約。各路具 maxTimeMS、AbortSignal、耗時、來源及錯誤診斷，單路錯誤可降級。融合使用既有 RRF，原始引用時間維持不變。

目前真實 Atlas 沒有媒體索引欄位，文字 metadata 不足，這個 adapter 尚不會對現有資料產生可用的三路結果。Mock repository 測試只驗證查詢組裝與 RRF 整合。

## 下一輪真實驗證

三筆候選是影片一 `_chunk_0117`、`_chunk_0001` 與影片四 `_chunk_0070`，保留原始 chunk ID。短段 1752.15–1754.55 秒取樣為 1748.5–1756.5 秒；其他取樣為 6.42–35.62、888.2–900.2 秒。

1. 重核原片與 chunk 對應，觀看三段確認內容，建立三個探索性問題。它們不取代正式題庫與標準答案。
2. 申請最多 12 個輸入的真實驗證，最多三次嘗試為 36 次呼叫，建議預估額度 US$0.25，所有 checkpoint 共用階段費用帳。
3. 保留 preview 文字向量，在本機另產 3 個 stable document、3 個 query、3 個 audio、3 個 visual 向量。首輪估計 US$0.0573304，全部嘗試估計 US$0.1719912，真實帳單另核。
4. 在本機對相同三個 chunk 做完整 cosine 排序及 RRF。stable query 對舊 preview 文字的排名只能用於跨版本診斷。可追溯的舊 query 向量若不存在，舊版基線仍無法完整重現。
5. Atlas 仍維持唯讀。三路正式查詢另需資料與索引授權，更新前重新匯出完整現行索引定義與目標資料備份，確認容量、權限、回復方式及 READY 驗證。先前的去敏摘要不作為索引回復備份。
6. 真實三路完成後再協調 `qa.service.js`、FAQ 與引用，整合通過後才做正式 43 題評測。

費率與輸入規格於 2026-11-10 重新查閱，依據見 [官方文件 D1、D2](references.md#業界與官方文件)；SDK timeout／retry 行為參考 [Google Python SDK](https://googleapis.github.io/python-genai/genai.html)。估算採 Standard 付費費率，未使用 Batch 折扣或免費額度假設。
