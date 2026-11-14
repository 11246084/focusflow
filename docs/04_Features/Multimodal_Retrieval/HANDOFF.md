# 多模態檢索、章節與影片升級：開發接手說明

> 最新邊界：教授確認額度前全面停止新Gemini請求；恢復額度不自動授權重試。先讀[暫停API後的驗收結果](../../current-status.md)與[本輪決策](decisions.md#2026-11-14-暫停api期間的驗收範圍)。保存探索Query可做唯讀驗證，不能冒充正式Gold題庫；全題排名收集與Parent共用ledger接線仍需完成。

> 2026-11-14 接手提醒：本輪已同步dev並依明確授權完成影片六的一次受控重試。結果與停止條件請先讀[目前狀態](../../current-status.md)最上方；本次許可已使用，不可再次重送。Atlas成功資料保留，Query／Parent與後續寫入仍需另行授權。

### 新上傳影片

重新處理令原計畫失效時，保留原 before-image 與 receipt，使用 `--plan atlas-before-<識別碼>.json` 建立新的備份及核准碼。準備、寫入與回復要指定同一計畫檔。

續跑單一世代使用 `python STT_Whisper/src/upload_multimodal.py --resume <世代目錄>`，沿用 Worker 的環境設定。入口重新核對影片、課程、來源 SHA、manifest 及資料庫片段，只執行多模態階段。先前有未知計費時，既有 ledger 會阻止重送。

上傳儲存服務依主機／磁碟保留容量；它沒有跨 Worker 的 Checkpoint 讀寫介面。驗收的共享磁碟需由維運提供存取控制，正式模式仍需實測斷線、換機與備份恢復。刪除影片後寫入器會因查無擁有者停止，私有 Checkpoint 與稽核證據的保留、清除週期需另行配置。

開發驗收若要由 Python 接續建立 Atlas 計畫，另設 `UPLOAD_MULTIMODAL_ATLAS_ACCEPTANCE=true`。操作員可在該世代的私有目錄放置 `atlas-approval.json`（只含當次 approvalHash）；下次接續時會在啟動寫入前消耗該核准，相同核准不會自動重送。操作員也可直接使用下方 CLI。遇未知結果查核後才可人工接續。

教師單片與批次 API 透過 Queue 或批次管理器啟動單片 Python 程序。文字上傳與完成通知後，`UPLOAD_MULTIMODAL_MODE=fake-sdk` 可在隔離測試環境執行新增階段。整條上傳路徑仍包含原本 STT 的外部依賴；只測新增階段可跑 `python -m unittest discover -s STT_Whisper/tests -p test_upload_multimodal.py`。

真實模式需另行核准付費，再配置 `UPLOAD_MULTIMODAL_MODE=gemini`、`UPLOAD_MULTIMODAL_ALLOW_PAID=true`、`UPLOAD_MULTIMODAL_STORAGE` 與 `UPLOAD_MULTIMODAL_LEDGER`。儲存根目錄與原有 ledger 應掛載於所有 Worker 共用、服務身分專用且支援排他建立與原子換檔的持久磁碟。禁止以空白 ledger 取代累計帳本。世代目錄依 mode／courseId／videoId／manifestHash 區隔。pause、cancel 檔案在批次邊界生效；故障後先檢查 worker.lock、ledger 與最近 intent，再續跑。同片重處理須核對當前來源與版本。

開發驗收的 Atlas CLI 是 `node backend/scripts/atlas-multimodal/upload.js --directory <世代目錄>`。它要求真實 bundle、目前影片版本與既有三路索引，保存 before-image 後回傳 approvalHash。只有具該次授權的操作員可用相同指令附加 `--approve <approvalHash>`。回復使用 `--restore` 取得獨立核准碼。未知結果或衝突應先檢查該次 intent、receipt 與資料庫，不得自動重送。正式自動寫入政策尚未啟用。

> 2026-11-13 接手入口：先讀[目前狀態](../../current-status.md)最新多模態段落。Gemini 付費請求目前 NO-GO；不要重複分析相同 429、嘗試重送或自動恢復。先依[後五片工具](remaining-videos-tools.md)進行唯讀及無付費驗證。本機 Checkpoint 完成與 Atlas 寫入完成分開判讀；V2～V5當次限定寫入已完成，後續不重送成功資料，題庫E2E的Query依賴見狀態正本；下文歷史執行稿不構成新的外部操作授權。

> 組員請先用瀏覽器打開 [docs/07_HTML說明頁/多模態檢索.html](../../07_HTML說明頁/多模態檢索.html)；這份 Markdown 是寫給 AI 讀的。

這份文件給組員庭語的 AI（Codex 或 Claude Code），讓它不必讀過先前的對話，就能從現在一路做到 11/13 交付。設計依據只看 [decisions.md](decisions.md)，功能狀態只看[目前狀態](../../current-status.md)；這裡只寫結果目標、優先順序、規則、求援方式與需要授權的執行稿。功能完成時，在同一批 commit 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-11-13（增補付費暫停期間的接手入口；下文原始執行稿保留歷史規則）

## 開場時 AI 要做的事

1. 讀完本文件，以及 decisions.md 的這幾段：「結果目標 M1」「範圍調整」「Weihao 保留的邊界」「交接方式」表格，與已定案第 7～13 項。其他段落（參考方案、業界做法、現況查證）需要時再查，不要一次全讀。
2. 用一個具體例子（例：學生問全聯先生廣告，逐字稿聽成「全連」）向庭語說明要解決什麼問題，再請她用自己的話說出「要改什麼、怎樣算成功」，釐清誤解。
3. 先問她的想法，再拿參考方案（decisions.md「參考方案」Q19）比較，說明取捨；她選定方案、說「開始」之後，在同一個對話一路做到完成。
4. 如果 `evidence/進度.md` 已存在，代表之前做過，先讀它接續，不要重來。

## 結果目標

完整原文在 decisions.md M1、M2。一句話：**即使逐字稿聽錯、漏掉或講不出畫面上的東西，學生問了仍找得到老師講那件事的位置，而且引用跳得到正確時間；同時學生不必問 AI，也能從章節找到主題。** 最晚 **11/13** 交付。

## 優先順序

依序做，時間或額度不夠時，前面的一定要先完成（decisions.md E）。

| # | 結果 | 完成判準 |
|---|---|---|
| 1 | 多模態檢索：用現有 chunk 產生逐段聲音、畫面向量；與文字檢索在 chunk 層用 RRF 合併；開關預設關閉；引用回傳 `retrievedBy`，網頁引用卡片顯示「比對方式」標籤 | 43 題的比較依 MA 跑完：平面／分層 × 只用文字／多模態，以及第 8 項的 6 組；`per-question.json` 交給協調 session 獨立重算，數字一致；第 11 項門檻的判斷寫進報告；後端、前端測試通過 |
| 2 | 章節：每支影片產生章節，播放頁顯示章節清單、點擊跳轉、標示目前章節；先用現有 chunk 產生 | 6 支影片都有章節並寫入 Atlas；章節產生失敗時影片仍能播放與提問；前端測試、lint、build 通過 |
| 3 | 影片升級（RU）：後端判斷每支影片缺什麼、什麼過期，只補那一部分；需要時整支換新逐字稿 | AI入門 6 支升級完成，依 RC 契約整支替換；升級後重新產生章節、補產向量、再跑一次 43 題 |

## 已鎖定，不能自己改

組員的 AI 決定「怎麼寫」，不決定「量什麼」（G1）。以下照 decisions.md，要改就先求援：

- **評分規則**：第 7 項（chunk 一半以上落在標註範圍才算命中、Recall@5 為主、每路取前 20 名、一般 RRF k=60 與文字加權版兩版）、第 8 項（6 組）、第 11 項（預設開啟的門檻）、MA（2×2 只比檢索、Parent 用固定 3 筆合併、分層只改變文字檢索那一路）。跑之前固定，不調參數。
- **向量與證據**：第 9 項（一個 chunk 各一個聲音、一個畫面向量，短於 8 秒延伸到 8 秒、長於 60 秒不產生）；第 12 項（回答證據一律用同一筆 chunk 的逐字稿、`QA_MULTIMODAL_FUSION_ENABLED` 開啟時停用舊的影像補充引用、FAQ 快取的證據版本納入檢索設定）。
- **資料與索引**：第 13 項（`audioEmbedding`、`visualEmbedding` 存在 `video_segments_text`，加進 `text_embedding_index`，不新增索引）；RU 四條不變條件；[chunk 版本契約](../Short_Video/chunk-version-contract.md) C1～C6。
- **模型**：`gemini-embedding-2`（已定案第 4 項）。

## 外部裁判

不由實作的 AI 自己判斷通過（G3b）：

- 比較腳本必須輸出 `evidence/<日期>_retrieval-comparison/per-question.json`，每題每組一筆：`{ questionId, group, mode, ranked: [{ rank, chunkId, videoId, startSec, endSec }] }`，`ranked` 取前 20 名。協調 session 用另寫的程式，只讀這份檔與[題庫](../QA_Evaluation/datasets/question-bank.json)重算 Recall@5、MRR、新增找回與退步題數；和庭語的報告一致才算數。
- 第 11 項的「新命中題逐題確認」由協調 session 做。
- 完成後由另一個 AI 依 decisions.md 獨立審查程式，在 `dev` 上補修。

## 在 dev 上工作的規則

- 先讀 repo 根目錄的 `AGENTS.md`；第一次執行 Node.js 指令前先跑 `node -v`，對照[根 README 環境需求](../../../README.md#環境需求)。
- 直接在 `dev` 開發：開工前 `git pull`；一個可以獨立說明的修改一筆 commit，訊息用中文，例如 `feat(backend): 新增 RRF 排名融合服務`；push 前跑該修改相關的測試，全部通過才 push 到 `dev`。**不要推 `main`**，推 `main` 會自動部署。
- 用本機 Git 設定的身分，commit 不加 `Co-Authored-By`、`Generated with` 等 AI 署名。
- 只改這次結果需要的檔案，範圍大致是：`STT_Whisper/src/`（逐段向量、章節、升級）、`backend/src/services/` 的檢索與融合、`backend/src/models/videoSegment.model.js`、`video.model.js`、新的評測腳本、`frontend/focus-flow/src/pages/StudentCourses.jsx` 與章節元件、對應測試與文件。**改 `qa.service.js`、`line.service.js`、recut 相關檔案前先求援**：系統設定 S2、S3 也會改 `qa.service.js`，LINE 屬於百陶，recut 屬於 Weihao。
- 測試指令見根目錄 `CLAUDE.md`「常用指令」；新增或刪除 route 要同步 `backend/docs/openapi.yaml` 並跑 `npm run docs:lint`。

## 進度檔

每次 commit 後更新 `docs/04_Features/Multimodal_Retrieval/evidence/進度.md`（新增前先在 [docs/README.md](../../README.md) 登記），內容固定三段：做完什麼（附 commit）、下一步、卡在哪裡。額度用完或換工具時，新的對話讀這份檔接續。

依 G6，AI 每次更新進度檔時，用剩下的優先項目估算能不能在 11/13 前完成；**預估趕不上時，最晚 11/9 提醒庭語向 Weihao 求援**，不自行刪減範圍。

## 什麼時候停下來找 Weihao

只在三種情況停下（G3b）；停下的那一部分暫停，其他部分照做，請庭語傳一段話給 Weihao：

1. 需要授權、但不在下方執行稿範圍內的外部操作。
2. 方案必須越過 G1 邊界：改目標或範圍、改已鎖定的規則、動到其他功能的契約（API 回應欄位、FAQ 快取、recut 資料）、超過費用上限。
3. 做不到成功標準，例：模型無法做文字對聲音的語意比對。說清楚限制，不用表面完成代替。

## 執行稿

Weihao 已預先授權以下範圍（decisions.md MB）；範圍外仍須另外同意。每次執行把實際指令、時間與結果記在進度檔。

**目標**：資料庫 `focusflow`；課程「AI入門基礎課」`courseId = 6a6da68456dd124511ec5196`；影片 `aiA10_1140119_1`～`_6`（`videos._id` 依序為 `6a6da68e56dd124511ec51b4`、`…51bf`、`…51ca`、`…51d5`、`…51e0`、`…51eb`）。

### R1 付費呼叫 Gemini

- 用教授的金鑰，只放在本機 `.env`。程式執行前印出預估費用（聲音秒數 × US$0.00016＋畫面格數 × US$0.00079＋文字筆數估算），必須帶費用上限參數，超過就不執行。
- 累計花費記在進度檔；**這一階段累計超過 US$30 先停下找 Weihao**。估計：聲音約 US$1.7、畫面約 US$8.6、升級後補產約 US$10。
- 成功：每個 chunk 的聲音、畫面向量狀態都是成功或有記錄的略過原因。失敗：429 以外的錯誤重試後仍失敗超過 5%，停下檢查，不要反覆重跑。

### R2 寫入向量與修改 `text_embedding_index`

- 先把目前的索引定義存成 `evidence/` 下的 JSON。2026-10-31 查到的定義：`embedding`（3072 維、cosine）＋過濾欄位 `courseId`、`videoId`，狀態 READY。
- 寫入前程式自動匯出 6 支影片現有的 `video_segments_text` 文件當備份，存在本機 `STT_Whisper/data/`（不進 repo）。
- 只對上述 6 支影片的既有 chunk 更新欄位，不新增、不刪除文件；寫入後核對更新筆數等於有向量的 chunk 數。
- 索引改成 `embedding`、`audioEmbedding`、`visualEmbedding` 三個 3072 維 cosine 向量欄位，保留 `courseId`、`videoId` 過濾。套用後每 30 秒查一次，最多 30 分鐘。
- 成功：狀態 READY、`queryable: true`、定義正確，三個欄位各做一次查詢都有結果，正式站文字問答正常。失敗：FAILED 或 30 分鐘未完成 → 改回存下的舊定義，停下找 Weihao。

### R3 升級影片（RU、RC）

- 每支影片：①依[契約](../Short_Video/chunk-version-contract.md) C4 列出仍引用它的 `shortScripts`、`recutSources`、`clips`，有就停下；②自動匯出該影片的 `video_segments_text`、`video_segments_parent` 與 `videos` 文件當備份；③新 chunk、Parent、向量在本機產生並驗證；④在一個交易內刪舊換新、更新 `activeTranscriptVersion`；⑤清除該課程的 FAQ 快取（`faqs`）。
- 一次只升級一支，第一支（`_1`）完成並驗證後才做其他五支。
- 成功：該影片 chunk 數大於 0、每筆都有 `transcriptVersion` 與文字向量、向量搜尋查得到新 chunk、正式站對這支影片提問有引用。失敗：任一步驟出錯 → 交易不提交；已提交但驗證失敗 → 用備份在一個交易內換回，停下找 Weihao。

## Weihao 這邊開工前要準備

- 把教授的 Gemini 金鑰私下交給庭語；把 6 支原片（Weihao 本機 `D:\AI-workspace\01_Projects\短影音測試製作\source\`，約 630 MB）放到團隊雲端硬碟只分享給她。
- 確認庭語本機 `backend/.env` 連得到 Atlas。
- 協調 session 唯讀匯出 AI入門 694 筆 chunk（含文字向量）給她，並寫好獨立重算分數的程式。

## 交付與部署

- 11/13：在 `dev` 完成，交付比較報告（`evidence/<日期>_retrieval-comparison/report.md`）、`per-question.json`、`config.json`（輸入檔雜湊、參數、程式版本）。
- 11/14：Weihao 依報告做判斷①（是否預設開啟），並部署 `main`。需要的環境變數與索引狀態列在報告最後。
- 完成時同步：[功能開關](../../../backend/docs/feature-flags.md)、`backend/.env.example`、`backend/docs/openapi.yaml`、[說明頁](../../07_HTML說明頁/多模態檢索.html)；狀態由 Weihao 更新到[目前狀態](../../current-status.md)。
- 定案、選用的方案或結果改變時，同一批 commit 先更新 decisions.md，再更新說明頁與頁尾的更新日期（`AGENTS.md`）。
