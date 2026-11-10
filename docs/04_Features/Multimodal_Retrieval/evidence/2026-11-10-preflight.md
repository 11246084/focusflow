# 真實 Gemini 小樣本執行前檢查

本文件保存三個真實 chunk、12 個模型輸入的授權前快照。2026-11-10 完成 Dry Run、完整 Fake SDK 預演及續跑時，真實 API 呼叫為 0。授權後的實際結果見 [真實小樣本](2026-11-10-live-sample.md)，向量、原片與本機完整輸出保存在忽略目錄。

## 請求明細

課程固定 `6a6da68456dd124511ec5196`。每筆 chunk 各產生 query、document、audio、visual 一個向量，合計 12 個輸入。原始時間為引用依據，取樣範圍另外記錄。

| 影片與 Chunk | 原始秒數 | 取樣秒數 | WAV 實際長度 | MP4 實際長度 | 內容 |
|---|---|---|---|---|---|
| `6a6da68e56dd124511ec51b4_chunk_0117` | 1752.15–1754.55 | 1748.5–1756.5 | 8 秒 | 8 秒 | 文字生圖模型 |
| `6a6da68e56dd124511ec51b4_chunk_0001` | 6.42–35.62 | 6.42–35.62 | 29.2 秒 | 29 秒 | 課程開頭、自然語言處理與 ChatGPT |
| `6a6da69256dd124511ec51d5_chunk_0070` | 888.2–900.2 | 888.2–900.2 | 12 秒 | 12 秒 | 蒐集 ChatGPT 相關論文 |

三個探索性查詢依序為「老師提到哪種模型可以把文字轉成圖片？」「課程開頭預計介紹哪些自然語言處理與 ChatGPT 觀念？」「如何請工具蒐集 2024 年出版、與 ChatGPT 有關的論文？」。Document 使用對應原始逐字稿，完整內容只存本機。

加上契約前綴後，三個 query 分別為 83、98、98 UTF-8 bytes，三個 document 為 44、297、129 bytes。每個文字輸入保守預留完整 8192 token 費用。

聲音為單聲道 16 kHz WAV，畫面為無聲 H.264 MP4、480 高、1 fps。六份檔案均通過來源／切片 SHA256、原始時間對齊及實際解碼檢查。1 fps 的 MP4 時長量化保留於 `mediaDurationSec`，不改引用秒數。

## 最新價格與預算

2026-11-10 重新讀取 Google 官方 Standard 價格頁，文字每百萬 token US$0.20，聲音 US$6.50（約每秒 US$0.00016），影片 US$12.00（約每幀 US$0.00079）。使用付費費率估算，帳戶方案與實際帳單另核。

| 類型 | 輸入數 | 保守計費量 | 首輪預估 USD |
|---|---|---|---|
| 文字 query | 3 | 3 × 8192 token | 0.0049152 |
| 文字 document | 3 | 3 × 8192 token | 0.0049152 |
| 音訊 | 3 | 8＋30＋12＝50 秒 | 0.0080000 |
| 畫面 | 3 | 8＋30＋12＝50 幀 | 0.0395000 |
| 合計 | 12 | | 0.0573304 |

音訊實長共 49.2 秒，畫面實長共 49 秒，估價採實際與取樣範圍的較大值再向上取整。全部用滿三次嘗試，預估 US$0.1719912、最多 36 次。申請的本輪程式預估上限為 US$0.25，與階段累計 US$30 上限同時生效。

官方模型上限為總輸入 8192 token、聲音 180 秒、影片 120 秒。影片最多取 32 幀且忽略音軌，本輪三個 MP4 均小於 32 秒並另送音訊。規格與價格來源見 [D1、D2](../references.md#業界與官方文件)，官方價格頁內容 SHA256 為 `ad2140dd935ccca0a66bb70f7c1b59b5e4c74d6180b599a8c32e0dcf4a422a2e`。

## 執行方式

從 repo 根目錄執行，預設為 Dry Run，會重核原片、切片、歷史對照與 Node RRF 工具，省略憑證載入與 SDK client 建立。

```powershell
STT_Whisper\.venv\Scripts\python.exe -X utf8 STT_Whisper/src/run_gemini_validation.py
STT_Whisper\.venv\Scripts\python.exe -X utf8 STT_Whisper/src/run_gemini_validation.py --mode fake-sdk
```

輸出在 `.local-tools/gemini-small-sample/dry-run/` 與 `fake-sdk/`，其中 request-plan.json 列出 12 個請求，state.json 保存逐筆狀態，comparison.json 保存相似度與兩版 RRF，summary.json 保存此次與累計呼叫數。完整向量只在 checkpoint。Fake SDK 的 provider 為 `fake-sdk`，與真實模式採不同簽章、目錄與帳本。

以下指令在授權前保持未執行，授權後的執行紀錄見真實小樣本報告。

```powershell
STT_Whisper\.venv\Scripts\python.exe -X utf8 STT_Whisper/src/run_gemini_validation.py --mode gemini --execute-paid --max-cost-usd 0.25 --max-calls 36
```

真實模式還需同時提供付費旗標與明確的費用／次數參數。憑證僅由受信任 dotenv 在執行期載入既有後端設定，SDK 固定 Gemini 官方 endpoint 與 v1beta，省略其他環境憑證的自動選擇。輸出目錄為 `gemini/`，階段費用帳為 `.local-tools/multimodal-gemini/cost-ledger.json`。

## 停止與續跑

- 每次嘗試前原子預留費用，超過 US$0.25 或第 36 次後停止。計數跨續跑保留，逾時或錯誤的預留不退還。
- 每次 SDK timeout 為 30 秒，SDK 內部重試設為 1 次總嘗試，由 adapter 對可重試錯誤最多嘗試三次。
- 已檢查本機 google-genai 1.70.0 的 retry_args，attempts=1 對應 tenacity.stop_after_attempt(1)，預留計數不會被 SDK 的隱藏重試放大。
- 任一請求終止失敗後停止剩餘批次，保存失敗位置與安全錯誤類型。原始 API 錯誤省略。
- 成功的輸入以內容、模型、模態、chunk 與時間簽章續跑，向量另做完整性檢查。損壞的 checkpoint 會停止，保留給人查證。
- 未授權 Atlas 寫入、索引變更、全量文字重算或共用 QA 修改。

## 預演與測試證據

第一次完整 Fake SDK 預演成功，四類各 3 次，共 12 次模擬 SDK 呼叫，預留估計 US$0.0573304。第二次全部 12 筆沿用，新增 SDK 呼叫為 0，真實 API 呼叫始終為 0。

Node 21/21、Python 26/26，合計 47/47 通過，另重跑 MVD rescue。Python 分別為 adapter 9、媒體 7、計畫 2、runner 8 項。Runner 測試包含完整 12 個輸入、續跑、Fake／Gemini checkpoint 隔離、完整性檢查、永久錯誤停止、第 36 次邊界及 US$0.25 邊界。

```powershell
node --test backend/tests/multimodal-diagnostics.script.test.js backend/tests/atlas-multimodal-adapter.service.test.js backend/tests/rank-fusion.service.test.js backend/tests/multimodal-retrieval.service.test.js
STT_Whisper\.venv\Scripts\python.exe -m unittest discover -s STT_Whisper/tests -p test_gemini_multimodal_adapter.py -q
STT_Whisper\.venv\Scripts\python.exe -m unittest discover -s STT_Whisper/tests -p test_segment_media_embedding.py -q
STT_Whisper\.venv\Scripts\python.exe -m unittest discover -s STT_Whisper/tests -p test_plan_multimodal_validation.py -q
STT_Whisper\.venv\Scripts\python.exe -m unittest discover -s STT_Whisper/tests -p test_run_gemini_validation.py -q
```

全套系統測試未執行，因本輪只變更獨立 adapter、runner 與 RRF bridge。真實 Gemini、Atlas 寫入與正式 43 題評測未執行，依本輪授權邊界保留。

## 真實結果如何判讀

執行後在本機比較各 chunk 的文字／聲音／畫面 pairwise cosine、三個 query 對三路的排序、等權與文字加權 RRF，以及 stable 文字對歷史 preview 文字的差異。RRF 呼叫既有 Node 模組，未重寫評分演算法。

模型識別記錄為請求的 `gemini-embedding-2`、API 版本與 SDK 版本，服務端不可變修訂版目前無證據可填。3072 維、單位範數及 API 成功只能驗證技術流程，三個片段的語意對齊仍需逐題檢視。stable query 對 preview document 只作跨版本診斷，不能取代舊版 query 基線或推論全部 694 筆相容。Fake SDK 分數只用來驗證程式，`semanticQualityVerified` 保持 false。

待核准範圍為上述 12 個固定輸入、最多 36 次模型嘗試、程式預估 US$0.25 上限，僅本機保存與分析。Atlas 多模態整合待真實模型驗證後另處理。
