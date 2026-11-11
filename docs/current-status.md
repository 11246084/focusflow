# FocusFlow 目前狀態

這份文件集中記錄各模組的進度，避免不同文件各寫一份。請先看狀態與依據，再由團隊填寫負責人及待決項目；後端技術說明見[技術索引](../backend/docs/current-state.md)。

**狀態定義：**「規劃中」指方案研究；「實作中」指仍在補功能；「已實作」只代表本段範圍的程式接線完成，不代表驗收通過，尚未查證的部分另列「○○未驗證」；「已驗收」需指定環境與驗收證據。各模組的執行與驗證範圍以該段記錄為準；日期為最後查閱或驗證日期，正式驗收日期另列。

## 多模態團隊溝通快照（2026-11-11）

組員先讀 [團隊總覽](04_Features/Multimodal_Retrieval/team-overview.md)，再依需要看 [契約矩陣](04_Features/Multimodal_Retrieval/authorization-contract-review.md) 與 [Atlas 去敏實測摘要](04_Features/Multimodal_Retrieval/evidence/2026-11-11-atlas-sample-summary.json)。總覽是當日溝通快照，本文件仍為唯一持續維護的狀態正本；不要把下方歷次快照直接當現在的放行條件。

| 完成層級 | 已有成果與證據 | 明確未完成 |
|---|---|---|
| 程式已實作 | 逐 Chunk 影音／Gemini Adapter、Atlas Adapter、固定 RRF、QA Bridge、QA 開關／回退、FAQ 分版與引用；CAS 與索引安全工具 | 不代表正式 runtime 已啟用；本輪未查正式旗標 |
| 離線驗證 | 66/66 安全工具與相關回歸；歷次本機 QA／引用及 Parent 合成驗證 | 新增 25 項 Contract-first 矩陣只完成設計，尚未實作／執行 |
| 真實小樣本 | 12 個保存 Gemini 輸入結果；三筆九向量實際 Atlas 寫入、三題三路、兩版 RRF、舊文字與安全回復均有來源 | 原偽造 scope probe 不構成正式 QA 漏洞證據，也不代表完整授權測試通過 |
| 全量／正式驗收 | 尚未完成；維持明確限制 | 694 筆全量影音、完整一致 Parent／語料、X01 核定、正式 43 題比較、正式網站多模態 E2E、開啟／部署決策 |

Atlas 第一輪實測已結束並完整回復，最後 694 筆指定範圍完整文件與備份相同、全 collection 815 筆、原索引三節點 READY／QUERYABLE、舊文字三筆 rank 1。新三路資料及 path 沒有留作持續啟用；原查詢／回復觀察詳見下節與去敏 JSON。該 JSON 只含 allowlist 的識別碼、時間、排名／分數及雜湊，不含向量、逐字稿、憑證、完整 metadata 或私人帳號。

契約審查已於 `0891715` 獨立保存；本輪另外授權團隊文件整理與 dev 提交，不授權功能實作、重新寫 Atlas 或部署。接下來先核定 U01/U02 與測試矩陣，再只補本機測試；合法前置下若有明確違約才提最小修補。之後全量、正式評測與部署各依條件另行授權。11/13 完整目標仍有時程風險，不以三題結果替代完整交付。

## 多模態 Contract-first 契約審查（2026-11-11）

以 dev `13e8a8c` 完成 HANDOFF／decisions／QA-Adapter 契約、Course／Video 授權、資料模型與相關測試的靜態審查。既有契約明確支援 Leaf 缺頂層 courseId：正式 QA 先驗課程存取，再由服務端 Course／Video 關係產生 canonical 影片 allowlist，並在候選與逐字稿階段複核。控制器不接受客戶端傳入的任意 scope；Adapter／Bridge 的 scope 則要求由呼叫端先授權。

更正前輪判定：把錯誤課程與原影片 allowlist 人工配成 scope，直接呼叫 Adapter 後期待零筆，屬超出契約前置條件的測試假設錯誤，不能定為已證實的 Adapter／正式 QA 漏洞。正常缺 courseId 的合法 Chunk 不應被補寫或排除。合法跨課掛載確為既有功能；明示 Leaf.courseId 與當次掛載課程不同、media metadata 課程語意則列 U01/U02 跨模組契約待決，不擅選拒絕或接受當成修正。

前輪真實 Atlas 觀察仍保留：三筆九向量 CAS 寫入、同名索引正向重建與三題三路／兩版 RRF 已完成；最後三筆與指定 694 筆完整文件皆回到前像、舊向量摘要不變、集合仍 815 筆、原索引三節點 READY／QUERYABLE、舊文字三筆 rank 1。原始來源在忽略目錄 `.local-tools/atlas-preparation/live-round1/` 的 report.json、scope-diagnostic.json、final.json 與正反向 receipt，不提交向量、備份或完整 metadata。當時因負例假設而安全停止並完整回復是有效事實；不能因此把正式 QA 跨課隔離或完整多模態品質驗收標成已通過。

已整理 [契約分析、25 列測試／待決矩陣與最小修正方案](04_Features/Multimodal_Retrieval/authorization-contract-review.md)：每列含依據、fixture、輸入、預期理由、責任層與合法檢索影響。本輪只做文件與測試設計，沒有新增／執行矩陣測試、沒有連 Atlas／模型、沒有改程式或 commit／push；之前 66/66 不能當成本矩陣已通過。正式修改與後續實測仍待審查及另行授權。下方是先前各階段紀錄，不代表本輪有寫入授權。

## Atlas B 異常處理演練與即時唯讀核對（2026-11-11 17:14–17:17，台灣時間）

**唯讀與離線演練 GO；正式 Atlas 寫入／索引更新 NO-GO，等待單獨授權。** 目標固定為現有 `focusflow.video_segments_text` 與 `text_embedding_index`；不另建資料庫、集合、專案、叢集或第四個索引。原晚間窗口已取消，不排程或自動開始。

使用者已確認無操作衝突，具有 Project Data Access Admin，並願意負責持續監看、停止、依前像回復及必要時聯繫 Project Owner／MongoDB 支援；不再把一般操作必須另有一位管理者當成缺口。角色與處置原則由使用者確認；本次是工具／程序演練，不是人工操作正式 Atlas 回復的實作測驗，也不保證外部支援能即時介入。

Node 22.23.4 重跑既有 8 檔定向測試，66/66、無失敗／略過；涵蓋 BUILDING 等待、FAILED／逾時／未知結果停止、跨執行禁止重送、receipt 損毀、CAS 衝突與安全回復。磁碟 Fake journal 寫入回讀、索引 before／after 純 JSON 雜湊核對均通過。程式／QA／RRF／Bridge 沒有修改。

當次 Atlas 唯讀結果：694 筆指定範圍備份回讀 checksum 通過，舊 embedding 與第七階段備份全部相同；三筆完整前像未變且新增欄位不存在。全 collection 計數 815；694 備份不是全 collection 災難備份。三節點 READY／QUERYABLE，mainIndex 定義在保留原始快照、辨識預設 numPartitions: 1 後一致；Driver 的 find／update／listSearchIndexes／updateSearchIndex 均可用，未試寫。三筆文字 self-query 都 rank 1、各 20 筆，耗時 133.77／73.37／73.61 ms；課程與未授權影片負例均 0 筆，這不是正式問題品質評測。

控制台確認 Free M0、8.0.37、AWS Hong Kong、全叢集三個 Search 索引已滿，目標索引 815/815、約 10.87 MB；資料 58.12 MB／512 MB、連線 20／500、無未結案告警。Operation Throttling 有入口但圖為空白，不能宣稱節流為 0；M0 監測盲區、重建時間及索引無伺服器 CAS 的風險保留。三路真實搜尋、兩版 RRF 的 Atlas 結果及正式回復尚未執行。

原始證據只存忽略的 `.local-tools/atlas-preparation/`，不提交備份、完整向量、checkpoint、逐字稿、憑證或私人帳號資訊。精確檔名與當次雜湊見 [操作計畫](04_Features/Multimodal_Retrieval/atlas-preparation.md#最終-gono-go-與管理者確認)，演練命令與來源見 [驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。本次實際 Atlas 寫入／索引更新／回復、付費 Gemini、部署與 VM 操作均為 0。後續必須另有正式授權；延後或狀態改變時刷新唯讀證據，不沿用本快照自動放行。

## Atlas B Driver 離線安全驗證（2026-11-11，先前工具階段紀錄）

當時原 20:00–22:00 窗口已取消，該工具階段授權只含獨立工具、Mock 測試、文件與 commit／push。當時待確認的人員與即時核對已由上節更新，不能把本段歷史限制當成目前缺口；正式寫入仍待單獨授權。

新增獨立 `index-control.js`：限定 B 方案與同名索引，預設 Dry Run；前像、版本、三節點與定義核對，正向／回復各只送出一次。含 checksum 的磁碟 receipt 記錄 prepared／submission_started／submitted／verified；結果不明時跨執行阻擋重送。資料 rollback 補逐筆 receipt，保留既有 CAS、原 embedding 與他人異動保護。未改 QA、RRF、Bridge 或部署。

Node 22.23.4 的 8 個相關檔案共 66/66 通過，無失敗／略過。包含實際安裝 Driver 的 Collection.updateSearchIndex 與命令建構器，執行端以 Fake 取代，沒有 connect／socket；驗證正反向 JSON、三節點輪詢、逾時／權限／配額／網路未知結果、receipt 損毀與程序重啟保護，並回歸三筆 CAS、資料回復及既有融合／Bridge。全部是離線 Fake／Synthetic 驗證；本輪未連 Atlas、未寫入／更新索引、未付費或部署，也未宣稱真實三路驗收完成。命令與日誌見 [驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

工具路徑已離線驗證，餘下正式門檻為管理者協調／監測、執行當下 M0／配額／三節點、備份／舊 694 向量／planHash／baseline 重驗，以及符合最新正式操作授權。完整 [Go／No-Go 與管理者清單](04_Features/Multimodal_Retrieval/atlas-preparation.md#最終-gono-go-與管理者確認)。未跑 Backend 全套、前端或 pipeline，因本輪只修改獨立工具與對應測試。

## Atlas M0 管理端資訊與操作計畫（2026-11-11，先前準備紀錄）

使用者提供 Atlas UI 查證：focusflow 為 Free M0、MongoDB 8.0.37、AWS Hong Kong，全叢集三個 Search 索引達上限；text_embedding_index 三節點 READY／QUERYABLE、估算文件數 815/815、每節點約 10.87 MB，只有 embedding（3072／cosine）及 courseId、videoId filters，未做 UI 修改。本輪依官方文件核對，同名索引加入三條 vector path 符合定義／數量限制；既有 after 定義壓縮 JSON 424 bytes，低於 3 KB。

M0 Search CPU／Memory 不可取得已確認，改用基礎指標、Throttling、節點狀態與查詢基準。資源峰值與耗時仍未知；建議兩小時低峰窗口，含正向及回復兩次重建。815 為 UI 全 collection 口徑，694 為指定課程備份，重建影響範圍需當次核對。現有 index-wait 未逐節點驗證，計畫補上 Atlas UI 人工確認，沒有修改工具或正式設定。

目前技術支援限制核對完成，實際執行仍 NO-GO，等待窗口、風險接受及三筆寫入／索引更新／回復明確授權。詳見[更新後 Go／No-Go](04_Features/Multimodal_Retrieval/atlas-preparation.md)。本輪僅分析與更新文件，未連 Atlas、寫資料、改索引、升級或付費；純文件只做 diff／連結與計畫核對，未跑程式測試。

使用者另指定 2026-11-11 20:00–22:00 台灣時間，只核准準備檢查與文件 commit／push。當前 PREP-ONLY／NO-GO FOR WRITE；需在窗口內確認使用者在線、Atlas 管理者可接手、VM 無重疊，以及 fresh 備份／planHash／三節點／baseline，再取得獨立二次授權。不得自動開始或排程。

## 第十階段題庫一致性與完整本機問答（2026-11-11）

已核對 decisions 基線表／第 6、7、8 項及 MA，固定 50 題中 43 可回答為 Recall@5／Recall@10／MRR 分母，7 拒答只另列診斷。新增 annotation-issues.json、retrieval-protocol.json 與 protocolHash／goldVersion 綁定。X01 在主評分表「評分表」F25／G25、ad84f6d 最初題庫及 8/24、9/3 結果都是同一缺漏，無 V5 人工時間來源，原題庫與主評分表未改，正式品質評測仍 BLOCKED。

已用本機 Vite 的完整學生頁及隔離 Express 跑過實際登入、進課、六種問答情境、引用卡片、對話重載與 HTML video 跳轉。六情境為 off／flat／hierarchical／missing-index／all-failed／invalid-time，對話 POST 皆 201、越權課程皆 403，原始 1752.15–1754.55 秒與身份／排名保留，播放器實測落在原始起點附近。保存 Gemini query 為真實向量，Atlas／embedding HTTP 為 Fake、Parent 為 synthetic、回答為 template、影片為 1800 秒合成黑畫面。完整頁 headless Edge 自動驗收通過，未做正式站人工驗收、真實教學影片播放或真實生成品質驗收。

Atlas 管理端資源、低風險窗口與另外的資料／索引執行授權仍未取得。小樣本真實驗證沿用既有 B 工具，實際窗口才重驗前像，不重跑無意義的 Dry Run。本輪未連 Atlas、未呼叫付費模型、未部署或操作 VM。詳見[驗收操作](04_Features/Multimodal_Retrieval/offline-acceptance.md)及 [Go／No-Go](04_Features/Multimodal_Retrieval/atlas-preparation.md)。

Node 22.23.4：後端受影響回歸 210/210、無失敗／略過；含完整頁瀏覽器的 QA 檔 4/4 通過，主案例內跑六情境及對話重載。前端 184/184、lint／build 通過，保留大 bundle 警告。X01 inspect 預期 BLOCKED，沒有正式 Recall／MRR；未跑全套 Backend／pipeline、真實 Atlas 或正式站人工驗收。命令與來源快照見[驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

推送前取得 Weihao 新增五筆至 `3e521ed`，以一般 merge `705ad76` 安全整合，保留 LINE 去重／逾時、教師統計及前端連結修正。合併後重跑受影響後端並納入 teacherStats，218/218；前端 192/192、lint／build、OpenAPI lint 通過；完整學生頁 QA 檔 4/4、六情境與對話重載再次通過。無失敗或略過，仍未跑全套 Backend／pipeline。

接續中斷工作時本機與 origin/dev 已同為 `b5bd95b`，包含本輪提交及後續短影片修補。本輪多模態程式與前端相對 `705ad76` 無差異；在 b5bd95b 再跑同一後端子集，218/218、無失敗／略過。前端與瀏覽器沿用上述相同程式版本的已通過結果。

## 第九階段多模態離線驗收（2026-11-11）

新增真正經既有 Parent search／Child expansion／Leaf context 的合成 fixture，Flat 與 Hierarchical 的文字候選不同，media 候選固定。覆蓋父子不同時間、合成向量排序、缺 Parent／Child、部分 Child、重複命中與跨課影片回退；正式 QA 測試另走 Fake Parent serve rollout。既有 Adapter、RRF、Bridge 與正式 QA 接線沿用。

新增本機排名 auditor 與獨立區間掃描 checker，校驗固定 43 題可回答／7 題拒答、gold 時間、manifest、身份、rank、完整 24 組與輸入 hash。發現 X01 宣告 V2+V3+V5，時間只標 V2／V3；真實題庫輸出 BLOCKED，未修改 gold 或產出正式品質分數。合成 43 題驗算僅驗證算式。完整 43 題實測還缺題庫維護者確認 X01、完整一致模型版本的語料／Parent／媒體向量與真實排名。

引用標籤抽成實際 React 元件並補 aria-label。保存真實 Gemini query、Fake Atlas／embedding HTTP、template answer 的本機 API 產出引用 fixture，headless Edge 驗證實際元件標籤、原始 1752.15–1754.55 秒、身份／排名、鍵盤跳轉與舊資料無標籤通過。這是最小元件 smoke，未驗整個 StudentCourses、正式播放器或正式站。

操作與資料來源見[離線驗收](04_Features/Multimodal_Retrieval/offline-acceptance.md)，Atlas 管理端資訊、低風險窗口與實際操作授權仍 BLOCKED，見 [Go／No-Go](04_Features/Multimodal_Retrieval/atlas-preparation.md)。本輪沒有 Atlas 連線／寫入／索引操作、付費呼叫、部署或 VM 操作。

Node 22.23.4 執行受影響後端回歸 209/209 通過；新增評分第六名邊界等案例後，auditor 定向重跑 6/6。第一次用共用程序跑相同子集為 205 通過／4 失敗，確認為 env 提問字數／每日次數的載入順序污染，改用 Node 預設檔案隔離後同子集全過，未改 production 配額邏輯。前端 184/184、lint／build 通過，保留既有大 bundle 警告；headless Edge 元件 smoke 通過並檢視截圖。未跑全套 Backend、pipeline、正式站或真實 Atlas；當次明細見[測試紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

## 多模態正式 QA 接線（2026-11-11）

第七階段已接 askQuestion、預設關閉的 QA_MULTIMODAL_FUSION_ENABLED、FAQ 分版、三路失敗回退、API 引用與網頁比對方式，對話 sources 保存來源與排名。使用保存 query 向量、Fake Atlas／embedding HTTP 及 template answer 的 4 項整合測試通過，涵蓋 API 到前端標籤、FAQ 開關切換、三路成功、單路失敗、缺索引、preflight 失敗、空結果與非法時間。既有授權、Leaf／Parent rollout 與 LINE 邏輯保留。測試均為本機 fixture，真實 Atlas 三路標記 BLOCKED，仍缺 stable paths；正式 runtime 開啟與部署未執行。

本次 Atlas 唯讀診斷仍為 694 筆、無截斷與診斷錯誤；29 個集合內共 3 個 READY/queryable Search 索引，隔離目標不存在。tier／全叢集剩餘配額仍未知。已建立當次 694 筆前像備份與索引 before/after 提案，實際寫入與索引變更皆 0。B 方案授權範圍見 [Atlas 授權單](04_Features/Multimodal_Retrieval/atlas-preparation.md)。

前端 183/183、lint、build 與 OpenAPI lint 通過，build 有大於 500 kB 的 bundle 警告。正式 43 題未執行；本機輸出 3 題、72 筆 comparison 及 config.json，分層僅使用相同文字 fixture。

Backend 全套首次 1849 項，1847 通過、1 失敗、1 略過；失敗為即時磁碟統計影響的預約測試，固定測試快照後 1/1 重跑通過，未改服務邏輯。最新定向回歸 28/28，後續修改未再重跑整套。命令與邊界見[驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

## 多模態 QA 獨立橋接（2026-11-11）

第六階段新增 `multimodalQaBridge.service.js` 與離線評測輸出介面。已保存三筆真實 query 與九筆 document／audio／visual 向量經模擬 Atlas 排名、既有 adapter、RRF、教師逐字稿載入與引用輸出驗證，保留原始時間、retrievedBy、channelRanks。離線輸出涵蓋兩種文字檢索模式、六組模態及兩種權重，每題 24 筆逐題排名；小樣本分層文字沿用平面 fixture，沒有宣稱驗證完整 Parent 檢索。

預設關閉、全路失敗後文字回退、跨課／未授權影片、chunk allowlist、時間錯位及 FAQ 版本介面有回歸案例。正式 `qa.service.js`、LINE、S2／S3 未接線。Atlas 三路、全量媒體向量與正式 43 題尚待授權與整合。操作與精確接點見[橋接契約](04_Features/Multimodal_Retrieval/phase2-adapters.md)。

本輪使用 Node 22.23.4。新增橋接 8 項、連同既有 Atlas／RRF／三路模組 24 項通過。已保存向量驗證 3 題及 72 筆比較輸出，API／Atlas 呼叫均為 0。後端依既有全套命令執行，共 1776 項，首次 1765 通過、10 失敗、1 略過；10 項均為 short_render 缺少已鎖定的 iconify 套件，依現有 lockfile 執行 npm ci --ignore-scripts 後，相關 Recut 87 項與 runtime adapter 7 項重跑全過。未重新執行整套，保留首次結果與重跑紀錄。QA／LINE 回歸在本次全套中通過。原始本機證據位於忽略目錄 `.local-tools/phase2-validation/` 的 phase6-backend.tap、phase6-recut-retry.tap 與 qa-bridge.json。git diff --check 通過；本輪沒有前端行為修改，未跑前端 build。真實 Atlas／付費生成／正式 43 題與部署未執行。

## 多模態 Atlas 小樣本準備（2026-11-10）

2026-11-10 整合審查：已提交的檢索元件與工具審查通過，問答尚未接上多模態（沒有 `QA_MULTIMODAL_FUSION_ENABLED`、`retrievedBy`，43 題比較腳本也還沒有）；修正切片準備遇到超出影片長度的 chunk 會整支中斷的問題。接續點見[多模態進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。

第五階段前置：新增專用 Collection／Index 的唯讀工具，準備原三筆／9 個真實 stable 向量，加入 Course／Video 雙 filter、兩版 RRF、本機排名比較與負向隔離探測。實查 `focusflow` 的 29 個 Collection 共 3 個 READY Search 索引，目標集合不存在，必要帳號權限可用；部署 tier／叢集剩餘配額與資源成本未核實，若為 Free 即已滿 3 個上限。Node 34 項通過、備份磁碟回讀與本機回復演練通過，尚未建立 Atlas 測試資源或執行真實三路查詢。等待 Weihao 確認配額及庭語另授權三筆寫入／索引建立／清理，不刪除正式索引、不自行升級。見[第五階段隔離驗證](04_Features/Multimodal_Retrieval/atlas-isolated.md)。

已實作獨立的本機 checkpoint 匯出、694 筆資料與索引備份、三筆受控寫入 Dry Run、索引差異／READY 輪詢、資料回復與 Atlas 三路 CLI。真實 Atlas 唯讀確認舊索引 READY、queryable，三筆舊向量自查詢各回傳 20 筆且自身排名 1；新三路 path 尚未建立，因此沒有真實三路搜尋成功的證據。Node 27、Python 29 項通過，真實切片＋Mock 候選的 MVD rescue 回歸成功。未做正式寫入、索引調整、額外付費呼叫、qa.service.js 整合或 43 題評測。建議三筆另存 stable 文字欄位的 B 方案，仍待 Weihao 確認契約與部署容量、庭語另授權寫入與索引操作。完整操作、取捨與回復方案見 [Atlas 準備說明](04_Features/Multimodal_Retrieval/atlas-preparation.md)。11/13 完整多模態／章節／RU／評測交付有時程風險，已提醒需 Weihao 支援。

## Recut 修正（2026-11-06，2026-11-10 核對合併狀態）

**已於 2026-11-09 透過 PR #11 合入團隊 `dev`，合併提交為 `8a4c181a`。** 2026-11-10 核對本機 Git 紀錄，合併提交已包含於本次拉取的 `dev`（`80791830`）。本輪僅確認 Git 合併；正式部署、發布與教師驗收未查證。

**2026-11-08 最終候選 `f708fa6`（程式），候選分支之後只有文件提交。** 第三次唯讀獨立審查（最終 diff，重點為 `e8d3c16` 之後）找到 1 項會阻擋交付的問題：版本不符時領取回錯誤，會讓已升級的 worker 在佇列只剩舊工作時自己停止；另有 2 項應修正（runtime 建立失敗時資料庫連線未關、輸出鎖殘留）。已在 `f708fa6` 修正並補回歸測試，同一位審查者複審結論為「接受，附註」。當日執行：backend `npm test` 1789 項 1788 通過、1 跳過、0 失敗；short_render `npm test` 165 項 164 通過、1 跳過，另設瀏覽器執行選用測試 4／4 通過。OpenAPI 未變更、未跑 `docs:lint`；`/recut-worker/jobs/claim` 在「只有版本不符的工作」時改回閒置，已記在 `backend/docs/recut-review.md` 與前端交接。提交身分稽核：本交付 15 筆提交的 author／committer 都是 `Weihao <11246062@ntub.edu.tw>`，沒有 AI trailer 或署名；提交都帶 SSH 簽章（金鑰 `SHA256:32dP45eSMmVSt/G/CGvcxl/P+MO3Nwj9xeTh/GSA2wc`，由執行環境提供），是否已登記到個人 GitHub 帳號尚未確認。Gemini schema 確認呼叫與教師審片仍待進行。

來源分支為 fork `Hao-weii/focusflow` 的 `wip/recut-cards-schema-fix`，從團隊 `dev` 的 `18aed4c` 切出，以候選 `955c7cb0` 合入。以下保留 2026-11-05 至 11-08 的試產、測試與審查紀錄，不作為 2026-11-10 重新執行的驗證證據。

2026-11-05 OpenCV 本機試產（教授影片 `aiA10_1140216_1.mp4` 18:04–20:26，本機 `recut_trial_opencv-20261105`，`gemini-3.8-flash`）：run-6 產出第一支可播放 MP4（46.5 秒），當天共 69 次 Gemini 外呼（含除錯），以回傳 token × 價目估算約 US$0.83，不是帳單。run-6 響度 −18.1 LUFS，不符決策 #62 的 ±2 LU；另有字幕跨剪接點 2.2 秒、scene-5 空白圖卡 3.18 秒、引言泡泡超出卡片 23 px、圖卡出現原話沒有的「大型模型」。

本分支修正：配圖 cues 改為清單（Gemini 400 的原因）；params 改為各元件獨立 schema（修正 compare 被 not-merge 覆蓋與跨元件欄位）；修正訊息附允許欄位與實際秒數；重複的修正失敗先改用定向修正、再停止並回 `RECUT_REPAIR_STALLED`；沒有 `trialPolicy` 的單題試產也在渲染前凍結 generation（`recuttrialgenerations`），可零呼叫重渲染；short_render 0.3.0 增益只套一次、字幕不跨剪接點、擋下空白圖卡、卡片文字超框時縮放或拒絕渲染。額度預設仍為 5。

修正版影片由 run-6 施工單離線重渲染，本階段 0 次模型呼叫：`revision-1`（43.3 秒，去掉 c3 尾端「當然啦」與 c4 開頭重說）與 `revision-1b`（45.5 秒，保留 c4 開頭重說）。兩支自動檢查都通過決策 #62 七項（−17.2／−17.1 LUFS、真峰值 −1.6 dBTP），沒有字幕跨剪接點、空白圖卡或文字超框。剪接改動會改變播放的老師原音，需重新核准講稿；c4 剪接點位於連續語音中，需人工聽音確認。run-6 沒有 generation checkpoint，也沒有資料庫綁定，無法用零呼叫重渲染流程回復，修正版不宣稱 checkpoint 來源。

驗證分三類。**本次新執行（2026-11-06，Node 22.23.4，程式候選 `6581ad0`）**：backend `npm test` 1787 項 1786 通過、1 跳過、0 失敗；short_render `npm test` 165 項 164 通過、1 跳過（需瀏覽器的選用測試），另設 `SHORT_RENDER_TEST_BROWSER` 單獨執行該檔 4／4 通過。之後只有文件提交。 OpenAPI 未變更，未跑 `docs:lint`。**真實本機堆疊驗證**（專用本機資料庫 `recut_trial_ckpt-verify-20261106`、假 provider、真實 CLI 與 short_render／HyperFrames／FFmpeg 渲染）：生成 3 次假呼叫後寫入 checkpoint 與資料庫綁定、刻意讓渲染失敗、另起程序重渲染 0 次 provider 嘗試並產出可播放 MP4（決策 #62 自動檢查通過）；被改、重算 hash、缺欄位、input／config 不同、腳本或來源已變的 checkpoint 都拒絕且未渲染；原 run 檔案與資料庫紀錄不變。**獨立審查**：兩輪唯讀審查（第二輪針對 `936430d` 之後的 7 筆）提出的問題已修正，包含 checkpoint 前提改在任何模型呼叫前檢查、worker 不再被版本不符的工作擋住。**未執行**：以真實 Gemini 確認新 schema 會被接受（新 schema 約 4.9 KB、124 節點；舊版 4.5 KB 已確認可用、20 KB 被拒；確認呼叫待授權）、前端、人工 code review、教師審片。2026-11-05 與先前的雲端測試結果是歷史紀錄。

## Recut 交付候選檢查點（2026-11-05）

前端串接準備度為 **CONDITIONAL**：可依 [OpenAPI](../backend/docs/openapi.yaml) 與[前端交接](../backend/docs/recut-integration-handoff.md)開發，但正式使用仍需設定、正式 UI、外部服務與人工驗收。[工程報告](07_HTML說明頁/Recut工程交付報告.html)是本日快照，後續狀態以本節更新為準。

本機 `feat/recut` 已快轉整合最新 `origin/dev` `8c0a5e0`（合併提交 `574daf2`），程式驗證點 `2232036`，recut 來源 `9ad9407`；交付範圍為 dev 協作分支，本輪未執行 main 或部署。獨立審查發現共用 provider 重試在 503 headers 已到、body 卡住時未釋放舊傳輸的 P2，`2232036` 在重試前中止被丟棄的傳輸，保留成功回應期限與取消行為。作者定向 57 項及獨立 60 項、native probe／cleanup matrix 通過，P2 已關閉；這不是教授 cards 失敗原因的修復。原 `8c0a5e0` 合併後全套主動中斷，不作通過證據；最新來源 `2232036` 完整 backend 全套 1,750 項、1,748 通過、0 失敗、2 跳過、0 取消，174 suites、exit 0，耗時 1,541,837 ms；481 個執行時 tracked 檔起訖 SHA-256 無差異。兩項跳過為 Windows symlink 與 consent Mongo opt-in；fencing suite 註記不另算第三項，專用 Mongo 已另驗 6＋1。前一候選 `028f8f8` 全套 1,712 項、1,710 通過、0 失敗、2 跳過、0 取消、exit 0，不能代替最新來源結果。較早 fresh 隔離 Mongo 租約 6／6、同意 1／1，renderer 148／148、0 跳過；Windows symlink 未驗證。本機 ignored 日誌不隨 Git 交付。

`ce4a76f` 自動組裝 backend runtime，fake HTTP 202 → queue → script_review 測試 7／7；`1da5097` 加入可持久保存的 render-ready 通知，fake 測試 22／22。這些是本機替身測試，不代表真服務或教師驗收。正式前端尚未串接 recut，現有網頁仍是八拍流程；管理員正常配置一次並維持 RC7 worker 常駐後，目標流程才是教師審完整講稿、再審實際 MP4，並待遠端 ready 與當前成品核准雙閘門成立。

獨立複核 core／consent 80／80、worker render／process 8／8；受限 sandbox 的 loopback 出現 EACCES，限定升權後 fake HTTP 15／15 通過。fresh 隔離 Mongo 租約 6／6、同意 1／1；後者使用的隨機資料庫保留，未刪除教授資料。對應測試及本機紀錄可由[工程報告](07_HTML說明頁/Recut工程交付報告.html)追溯。

**交接限制：**RC10 決策 #78 要求即使功能開關關閉，上傳仍先檢查內容同意；現有前端尚未接上，舊上傳流程在缺少有效內容同意時會收到 409。可供前端開發與 dev 整合，不能直接部署 main。使用者已授權本次合併並 push dev；部署流程僅 main push 觸發。

工程報告本身的離線瀏覽器複核通過 1440／390／360 寬度、六情境、12 個節點、8 種發布條件與鍵盤操作；這不是正式前端或教師驗收。

R2 獨立畫面複核：三種新卡 30 圖與 code 15 圖（短合成範例）通過；catalog 的 aiOnly 為 12，code 仍為 RC6 專用。這不代表真實課程影片或真人審片驗收。

教授授權原片經 CPU small ASR，45.03 秒、441 words、24 句；首尾截斷句 s1／s24 禁選。前三次 provider 呼叫取得用量，第三次選段成功；原 cards 工作嘗試被本機大小 guard 阻擋，未出站。`5102638` 將 cards payload 從 104,529 降至 36,144 bytes，保留選句原始 words／timing 與完整驗證。

實際受控續跑的第四次 provider 嘗試為 cards，36,144 bytes、4,603 ms，回 `RECUT_MODEL_FAILED`、usage null；HTTP 類型與遠端是否收件或計費尚不明。保守計額 provider 4 次、workflow 5 次，reservation 累計 US$0.1659405；原上限 5 次與 US$0.50 不變，僅餘一次，不足 cards 與必要 wholeCheck 兩步。永久 claim 不重置，也不自動付費重試；目前無 generation checkpoint 與 MP4，教授試片 **BLOCKED**，需額外決策。紀錄為本機 ignored 的 `short_render/out/professor-resume-cards-check-20261104/run.json` 與 `progress-checkpoint.json`。目前 adapter 將 HTTP 400／429／500／503 與網路錯誤折疊為同一代碼，未保存 HTTP 或 provider 狀態，因此無法回溯本次原因。cards schema 為 19,917 bytes、330 nodes、317 properties、210 optional、深度 8；複雜度只是候選風險，不能推定為 400 或服務故障。後續建議以白名單保存狀態碼、provider 狀態列舉、失敗階段及 schema hash／大小，不保存原始錯誤、本文、header 或 prompt；schema 瘦身另列改善，均尚未實作。正式十題、RC12 原音正式驗收與模型下載未授權；正式部署、真 YouTube／LINE、正式前端與真人審片未驗證。

## 各模組

**httpOnly cookie 認證｜已部署；2026-10-25 正式環境驗收通過。** 2026-10-25 13:13 部署到正式站（`main` = `d3de1ef`），部署探測與瀏覽器驗收通過，過程、Atlas 寫入與 VM 設定見[上線紀錄](10_Operations/deployment/2026-10-25_httpOnly_cookie認證上線紀錄.md)；正式站未測 step-up 與信任裝置，nginx 未轉送 `/uploads` 為既有問題。2026-10-24～25 已接上後端、前端及 deploy.yml，依[決策第 1～25 項](04_Features/HttpOnly_Cookie/decisions.md)完成獨立逐條審查及修正後複核。已修正 pending／忘記密碼重寄與猜碼次數的競態、admin 驗證失敗稽核、OpenAPI 描述及登入恢復重試按鈕遮擋。2026-10-25 依使用者補充定案完成升權撤銷：學生／教師實際升為 admin 時，同次更新角色與版本、撤銷全部憑證；重新登入並通過信箱兩段式驗證，才取得 12 小時新 session。原 admin 僅編輯姓名不撤銷，session 刪除故障也不放行舊憑證。原審查 findings 已全部處理，本輪完整後端測試通過。

| 驗證範圍 | 結果（本機 2026-10-24～25；正式環境另註日期） |
|---|---|
| Backend | 全套 1,154／1,154 通過；OpenAPI lint 通過，docs route 11 項通過。含 CSRF、Node fetch 分流、資料庫故障拒絕、撤銷、升權重登／MFA／12 小時效期與 GET 例外盤點 |
| 隔離 Mongo | 11／11 通過：索引重跑與衝突、真實 TTL、80 次並行簽發、單次驗證消耗、重寄計數與競態、原子版本遞增、最後一位 admin 保護，以及學生／教師升 admin 的舊憑證撤銷與新 12 小時 session；未連 Atlas |
| Frontend／workflow | 116／116、lint、相對 API 設定的 build 通過；deploy.yml 的 YAML、3 段 Node、21 段 Bash 語法通過；相同 dist 掃描通過（29 檔），在服務重啟前執行。原有非相對 API 環境設定會被 build guard 拒絕；未改本機 .env |
| 本機 Chromium＋Vite proxy | cookie 屬性、同來源 Network、重新整理、登入登出、全裝置登出、多分頁換帳號、admin 兩段式驗證與信任裝置、首次登入、註冊信箱驗證、step-up、影片上傳與 /uploads 讀取、頭像、回饋附件、跨來源表單 403、網路故障後重試通過；2026-10-25 另驗證升權後目標舊登入遭拒、畫面清除、操作人維持登入，目標重新 MFA 後取得 12 小時 cookie。使用記憶體資料與假寄信，影片只驗證上傳／讀取，未做 STT |
| 原有腳本 | runQaEval 用 mock／template 跑 1 題、0 錯誤；verifyShortsDeployment 經 fetch 登入通過，允許空 feed 且不查 YouTube；未呼叫付費服務 |
| 正式環境（2026-10-25） | 第 15 項第 6 層通過：真實寄信、admin 首次登入與兩段式驗證、教師與學生首次登入、cookie 屬性、同來源 Network、多分頁與全裝置登出、頭像與回饋附件、LINE 內建瀏覽器與 Email 連結進站恢復登入、部署探測（舊 JWT 拒收、登出即失效）。step-up 與信任裝置未在正式站測 |

**帳號、課程與管理功能｜已實作。** 範圍含登入、修課、通知、頭貼、統計及問題回報；依據：[路由入口](../backend/src/routes/index.js)、[帳號介面](../backend/src/routes/auth.routes.js)、[課程權限](../backend/src/services/courseAccess.service.js)。最後驗證：2026-10-14；負責人：＿＿（待填）。

**網頁操作｜已實作。** 範圍含角色頁面、課程影片、問答與上傳操作的後端呼叫；依據：[應用程式入口](../frontend/focus-flow/src/App.jsx)、[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)、[上傳頁](../frontend/focus-flow/src/pages/TeacherUpload.jsx)。瀏覽器操作結果 ⚠️ 未驗證。**已知問題（待修）**：2026-10-25 正式站發現首頁（未登入的介紹頁，`App.jsx`）在視窗較窄時跑版，例如桌機開著 DevTools、可視寬度約 900px：介紹卡片的「立即開始」按鈕被卡片底部切到，左側圖塊與統計卡片互相重疊；需另排時間修正並檢查手機寬度。最後驗證：2026-10-14；負責人：＿＿（待填）。

**文字問答與多輪對話｜已實作。** 含課程範圍檢查、來源引用、常見問題快取及對話紀錄；快取是保留可重用回答以減少重複計算。依據：[問答服務](../backend/src/services/qa.service.js)、[對話服務](../backend/src/services/conversation.service.js)；回答品質與外部模型 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**LINE 綁定與問答｜已實作。** 含訊息驗簽、帳號綁定與問答接線；依據：[LINE 介面](../backend/src/routes/line.routes.js)、[訊息處理](../backend/src/services/line.service.js)。2026-11-04 正式站以一個帳號在手機實測收送訊息正常，見下段。最後驗證：2026-11-04；負責人：＿＿（待填）。2026-11-10 整合審查修正了停用帳號仍可在 LINE 提問、回答卡第一筆引用可能連到別段等問題，2026-11-11 再補上 webhook 重送去重、LINE API 逾時、教師首頁網頁與 LINE 提問數分開顯示，以及回呼頁兩個操作卡點。以上都只有替身測試、尚未部署與實機驗證，見 [LINE 進度](04_Features/LINE_Binding/evidence/進度.md)。

**LINE Login 綁定與圖文選單｜已部署，正式站手機實測通過（僅一個帳號）。** 依 [LINE 決策](04_Features/LINE_Binding/decisions.md) LL、LM～LM4：學生按「連結帳號」到 LINE 授權後就完成綁定，不需綁定碼；未綁定看到「連結帳號」選單，綁定後換成 2×2 四格「切換課程、今日額度、使用說明、網頁版」，解除時換回；另有「今日額度」「使用說明」指令、課程卡片直接選課與回答分段。依據：[LINE Login 服務](../backend/src/services/lineLogin.service.js)、[選單服務](../backend/src/services/lineRichMenu.service.js)、[建立腳本](../backend/src/scripts/setupLineRichMenus.js)。2026-11-04 部署 `07c8c30`、`2d5e4d2`；LINE Login channel「FocusFlow 綁定」改為 Published，VM `backend/.env` 設定 `LINE_LOGIN_*` 三項與 `LINE_RICH_MENU_BOUND_ID`。同日以一個帳號在手機實測：解除綁定後選單換成「連結帳號」→ LINE 授權 → 綁定成功 → 選單換成 2×2。未測：從未加好友的帳號與歡迎訊息、電腦版 LINE、LINE 已綁定其他帳號的衝突、多位學生同時使用。後端完整測試有三支既有逾時測試會卡住整輪，本次排除未驗證（見決策 LM4）。最後驗證：2026-11-04；負責人：＿＿（待填）。

**單支影片與語音轉文字｜已實作。** 後端啟動處理程序，產生逐字稿、切段與搜尋向量，再接收完成或失敗通知；向量是用來比較內容相似度的一串數字。依據：[影片服務](../backend/src/services/video.service.js)、[處理入口](../STT_Whisper/src/main.py)、[回報處理](../backend/src/services/videoProcessing.service.js)；真實影片完整流程 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**YouTube Lifecycle F3／F4、Q-A～Q-F｜本機開發及隔離驗收完成；未部署。** 2026-10-29：F3／F4 經獨立複驗後，以 `b2feceb` 提交、`6cd381b` 合併至 dev；Q 共用契約 `3dc8c92`、後端 `ae8d22b`、前端 `5a0ee05`。範圍含額度暫停與單支試傳、租約與傳送階段、就緒／隱私政策、受保護 Range 播放、容量預約及半成品清理、教師與管理頁、來源切換續播與錯誤提示。隔離 Mongo **94／94**、Frontend **158／158**、lint／build／OpenAPI lint 通過，Chrome／Edge 三角色與原片起播／拖曳通過、延遲回應競態各 **7／7**；Backend 完整回歸共 1280 項（1278 通過、1 個舊開關數斷言失敗、1 項 OS 權限跳過）；修正斷言後該檔 13／13 複驗通過，沒有未解失敗。獨立審查確認三項 P2 已修復，沒有已知 P1／P2 合併阻礙；證據及驗收邊界見[本機整合驗證](04_Features/YouTube_Lifecycle/evidence/2026-10-29_q-integration.md)。沒有 push、部署、正式 Atlas／VM／YouTube 操作或正式清理。原片播放與 privacy_guard 預設仍關閉；Firefox／iOS Safari、正式 nginx／500 MB／中斷／507／20 個 Range、第一次實際 YouTube 隱私讀回與學生嵌入需另行授權或設備驗證。清理必須先通過 Q-B 正式就緒驗收，原 #33 的日期不能直接當啟用條件。

以下 YouTube 段落保留歷史時點，不能用來推定本輪正式環境現況。

**YouTube 上傳｜已實作。** [上傳服務](../backend/src/services/youtubeUpload.service.js)由[影片完成通知](../backend/src/services/videoProcessing.service.js)排程，受功能開關與憑證條件控制。2026-10-22 部署後正式站憑證檢查為 `ok`、權限含 `youtube.force-ssl`（見[上線紀錄](10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)）；經新版程式實際上傳的結果未驗證，延後到團隊下次上傳課程影片時確認。最後驗證：2026-10-22；負責人：＿＿（待填）。

**YouTube 恢復／清理｜已部署；恢復已開啟，清理未開啟。** 依[設計決策](04_Features/YouTube_Lifecycle/decisions.md)實作兩層開關、定期[恢復排程](../backend/src/services/youtubeUpload.service.js)、依空間與保留期的[原片清理](../backend/src/services/youtubeLifecycle.service.js)與刪除預告、管理員[隔離收尾](../backend/src/services/youtubeQuarantine.service.js)（含已達重試上限的項目）、補回原片，短片成品一併納入；管理員操作在「YouTube 上傳管理」頁。2026-10-22 合併 `main` 部署到正式站（本機 Backend 1123、Frontend 107 項測試通過），恢復排程每 5 分鐘執行、管理員頁開關與待處理清單正常；清理的環境變數維持不允許，依決策 #33 於 2026-11-09～11-13 開啟。實際失敗後的自動恢復、清理刪檔與短片流程在正式站未驗證，過程見[上線紀錄](10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)。最後驗證：2026-10-22；負責人：＿＿（待填）。

2026-10-27 收尾複驗（分支 `fix/youtube-lifecycle-review`，本機提交／未合併／未部署）：**F0～F2 可結案，FR01～FR06 PASS；沒有未解決的已知 P1／P2 程式合併阻礙，建議進入 Commit／Merge 整合。** 已確認 NR01 P1 的 intent 接管／刪檔收尾，以及 NR02 P2 的課程刪除交易／持久外部待辦；本輪另重現並修正外部請求無回應會卡住排程的 P2，加入含回應本文的 30 秒期限。最終 Backend 全套 **1199／1199**、隔離 Mongo **62／62**、`docs:lint` 與 `git diff --check` 通過；真實 120 秒租約 **58／58**、standalone 拒絕 **1／1** 沿用未受本輪修改影響的證據，沒有重跑同樣的長測試。判定是本輪程式審查與隔離驗證，不宣稱另一位未參與修復的獨立審查者或正式環境驗收；詳見[最終報告](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f0-f2-final-review.md)。前輪 [FR 修復](04_Features/YouTube_Lifecycle/evidence/2026-10-27_fr01-fr06-fixes.md)與 [NR 交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_nr01-nr02-fixes.md)保留歷史結果。部署前仍需確認交易能力、所有 writer 升級與原有啟用門檻。沒有實作 Q-A～Q-F、F3／F4，未連 Atlas、VM 或真實 YouTube，未 Push、Merge 或部署。

2026-10-27 本機整合：使用者授權提交 F0～F2 修復與證據。合併前發現本機 `dev` 與修復分支已分歧（`dev` 獨有 8 個 commit，修復分支提交前獨有 3 個），無法 fast-forward；依使用者停止條件保留本機提交並暫停合併，不自行 rebase 或建立非 fast-forward merge。主工作目錄的第三輪 7 份規格與其他未提交檔案均不切換、不提交、不覆蓋。

2026-10-27 後續整合：F0～F2 已以 `5f60c12` 本機合併至 dev，前段「未合併／快轉受阻」保留當時記錄。本次將第三輪 YouTube 決策 #35～#64、Q-0 共用契約及 Q-A～Q-F 工單依主題提交並整合；#51～#64 定案原文完整保留，契約已對齊現行 claim update、attempt heartbeat、cleanup intent、持久備份與交易式刪課。這是純文件整合，沒有開始 F3／F4 或 Q-A～Q-F；F3／F4 仍為後續 Q 開始前的既定門檻，實作與正式環境操作均須另行授權。多模態、開放資料及競賽文件另作本機提交，沒有混入此次 dev 文件整合。

以下保留 2026-10-26 初次實作的歷史測試記錄，不作 FR01～FR06 已結案的依據：

| 問題 | 修改入口 | 測試證據與限制 |
|---|---|---|
| F0 快照／憑證 | [harness](../backend/tests/helpers/backendTestHarness.js)、[quarantine fixture](../backend/tests/youtube-quarantine.service.test.js) | backend 全套 1158／1158；fixture 補強後直接回歸 28／28。Date／ObjectId／Buffer、雙向隔離、主別名與 fetch 失敗還原均有案例 |
| R01、R02 | [實體檔辨識](../backend/src/utils/localVideoSource.js)、[共同清理判斷](../backend/src/services/localSourceCleanup.service.js) | [清理安全測試](../backend/tests/youtube-cleanup-safety.service.test.js)：跨集合／草稿／處理中引用、相對與絕對路徑、hard link、根外、Windows junction 與 Linux 容器 symlink；未讀 VM |
| R08、R09 | [清理排程](../backend/src/services/youtubeLifecycle.service.js)、[短片清理](../backend/src/services/shortAssetCleanup.service.js) | 同上測試與既有 lifecycle：逐檔讀空間、失敗後補選、刪檔前停用／設定失敗、保留期／補回重算、影片與短片 DB 收尾恢復；F1 全套 1171／1171，最後細修另跑相關 67／67 |
| R03 | [來源所有權](../backend/src/services/youtubeWorkOwnership.service.js)、[補回／既有重處理](../backend/src/services/video.service.js) | [F2 競態測試](../backend/tests/youtube-work-ownership.service.test.js)與[補回路由](../backend/tests/video-source-restore.routes.test.js)：同步取得輪次鎖、候選後路徑／時間／狀態／代數改變、真正補回後拒絕舊候選、最後設定等待中阻止審核／封存回復改草稿，另以真實 Mongo 驗證 |
| R04、R05 | [影片上傳](../backend/src/services/youtubeUpload.service.js)、[短片上傳](../backend/src/services/shortAssetPublish.service.js)、[短片恢復](../backend/src/services/shortAssetRecovery.service.js) | F2 競態：A／B 候選與教師重試交錯、unsafe／退避／上限、所有開始入口共用排他權、舊 attempt 拒絕回寫、DB 失敗不送 bytes、上傳後回寫失敗不再重傳、上傳中仍可審核且封存後不重新上架；YouTube 全為 mock |
| R06 | [隔離套用](../backend/src/services/youtubeQuarantine.service.js)、[共同備份檢查](../backend/src/services/youtubeWorkOwnership.service.js) | Video／Video 與 Video／ShortAsset 同 ID 競爭、驗證與回寫失敗釋放、歷史重複備份拒刪；採工單允許的單一 writer 限制，不是跨行程 DB 唯一性，詳見[實作約束](04_Features/YouTube_Lifecycle/decisions.md#f-工單的實作約束2026-10-26) |

2026-10-26 F2 整合：backend 全套 1199／1199、Windows 與 Linux 容器清理／所有權各 41／41、隔離 Mongo 14／14 通過（未載入記憶體 harness；明確 loopback URI、隨機 DB、成功與失敗移除 DB；另驗證 null／缺欄位初次上傳、略過上傳及重啟遺留 token 隔離）。測試只處理自建暫存檔，沒有連 Atlas、VM 或真實 YouTube；未執行 STT／FFmpeg、前端／瀏覽器及決策 #33 的正式驗收。

2026-10-27 F3／F4 修復（`fix/youtube-lifecycle-f3-f4`，基於 dev `b35c121`；未提交、未合併、未部署）：R07 已加入 completed 影片補回後的明確重新處理，沿用 F0～F2 原子來源所有權，保留 Video／YouTube ID、播放與保留期；R10～R12 已修正總覽有效開關、雙來源 7 天預告清單與並行 history。Backend **1208／1208**、隔離 Mongo **68／68**、Frontend **118／118**、真實元件瀏覽器（假 API）**8／8**，lint、build、OpenAPI lint、文件連結與 `git diff --check` 通過。未發現已知 P1／P2；程式與本機驗證達可提交候選標準，依既有 F 工單仍須獨立 diff 複驗後整合。本輪沒有驗證真實 STT／FFmpeg、YouTube、Atlas、VM 或正式清理，沒有實作 Q-A～Q-F；第三輪 #51～#64 與 Q-0／Q 工單完整保留。詳見[修復與驗證交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f3-f4-fixes.md)。

**多影片批次｜已實作。** [批次服務](../backend/src/services/videoBatchProcessing.service.js)與[批次入口](../STT_Whisper/src/batch_main.py)串接排程、重試及恢復；真實語音模型、向量產生與部署的完整流程未驗證。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生短影片瀏覽｜已實作。** [短影片頁](../frontend/focus-flow/src/pages/StudentShortsWall.jsx)串接[學生介面](../backend/src/routes/youtube.routes.js)。較新紀錄：[2026-09-29 後端整體回歸](../backend/docs/implementation-log.md)（原文為工作分支紀錄，非正式環境驗收）；直接相關的[縮圖測試](../backend/tests/shorts.routes.test.js)於 2026-09-27 加入（Git `d8360fc`，未記載單項執行結果）。最近播放驗收仍為 2026-08-13（限當時環境），未找到更新的播放驗收。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片腳本｜已實作；上架未驗證。** [腳本介面](../backend/src/routes/short-script.routes.js)串接選題、生成、成品上傳與審核；[發布服務](../backend/src/services/shortAssetPublish.service.js)處理 YouTube 上傳與審核後提供學生瀏覽。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片自動產片｜開發中。** RC1 資料／狀態機／背景工作、RC2 視窗／原片檢查／辨識包裝／切句、RC3 設定轉接／選段判斷／逐字驗證、RC8 教師審閱／草稿／採納建議／核准／計時已完成本機實作；介面見 [RC1](../backend/docs/recut-foundation.md)、[RC2](../backend/docs/recut-source.md)、[RC3](../backend/docs/recut-selection.md)、[RC8](../backend/docs/recut-review.md)。2026-10-29 Node 22.23.4 的 backend 全套 1322／1322、隔離 loopback Mongo 6／6、OpenAPI lint 與文件路由測試 11／11 通過。RC2 專屬19項、RC3專屬21項、RC8專屬39項，8拍程式與既有測試未改。子 agent 已複核選段草稿與審閱API契約；外部工具及模型皆注入假實作。未執行真實辨識、Gemini、渲染、VM／Atlas／YouTube、前端或人工驗收；完整管線待 RC4、RC5，S1 尚用轉接。後續依 [HANDOFF](04_Features/Short_Video/HANDOFF.md) 接續，完整獨立審查排定 11/6 起。

**分層檢索與向量發布｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。分層檢索是先找較大段落，再找可引用的小片段；[檢索服務](../backend/src/services/hierarchicalRetrieval.service.js)、[資料檢查](../backend/src/services/hierarchicalDataReadiness.service.js)與[發布入口](../STT_Whisper/src/publish_parent_embeddings.py)有對應程式，不據此判定可啟用。最後驗證：2026-10-15；負責人：＿＿（待填）。

**影像補充引用｜已實作；實際資料覆蓋未驗證。** [問答服務](../backend/src/services/qa.service.js)串接影像查詢與來源引用，但仍需另查課程影片是否有可用影像資料。最後驗證：2026-10-15；負責人：＿＿（待填）。

**教育開放資料推薦｜已實作。** [推薦服務](../backend/src/services/openDataExtension.service.js)與[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)以關鍵字推薦延伸影片。程式已隨 2026-10-22 部署上線，但正式站 `OPEN_DATA_EXTENSION_ENABLED` 未開、未匯入清單；真實清單匯入與推薦品質 ⚠️ 未驗證。最後驗證：2026-10-22；負責人：＿＿（待填）。

**資料庫交付工具｜已實作；真實資料還原未驗證。** [匯出與還原服務](../backend/src/services/databaseDeliverable.service.js)有對應程式；舊文的記憶體模擬測試不代表實際資料庫還原成功。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生試用與部署｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。[部署設定](../.github/workflows/deploy.yml)只能證明部署步驟存在；歷史開放試用不等於本次驗收，需補目前環境與驗收紀錄。2026-10-23 VM 資安更新完成：Rocky Linux 9.8、Node.js 22.23.4、nginx 安全修補與 ngrok 更新，重開機後 `/health`、nginx 代理與 LINE 問答實測正常；語音轉文字流程更新後未實測。2026-10-30 查證 VM 核心受 CVE-2026-98432 影響，Rocky 尚未發布修補，等待中；同日檢查未發現入侵跡象，並將 `focusflow` 的 sudo 縮到部署所需兩個指令、關閉 root 直接 SSH 登入（縮權後的實際部署未驗證）；Node2Shell（CVE-2026-111497）已由 Node.js 22.23.4 與 `libbrotli` 安全更新修正；見[檢查報告](10_Operations/deployment/2026-10-23_VM資安檢查報告.md)。最後驗證：2026-10-30；負責人：＿＿（待填）。

## 歷史查證索引（保留原日期，未重新驗證）

以下是舊文記載的結果，不作為上述模組的本次驗收證據；舊數字不再列為現況。

- 2026-05-23／07-10／07-24／08-02：資料庫數量、向量索引及欄位分布的歷史查詢；完整數字保留於下述 Git 版本。
- 2026-07-26：帳號、通知與頭貼的隔離測試；2026-08-02：YouTube 上傳與刪除後轉私人影片的外部測試，均為舊文紀錄。
- <a id="2026-08-13-多影片批次整合與隔離重啟驗收"></a>2026-08-13：短影片播放驗收；批次隔離測試為「兩支影片 → 一支完成、一支失敗，重啟後保留結果」，另一教師讀取回 403；2026-08-14：單項重試與前端批次契約補強。未涵蓋真實語音模型或部署。
- 2026-08-09／08-13：分層檢索的本機契約與資料檢查紀錄，未能證明目前共用資料庫可用；2026-08-30：[後端第一階段本機測試](04_Features/Student_Pilot_Backend/evidence/2026-08-30_phase1-implementation-results.md)，不等同正式驗收。
- 2026-08-24：[問答品質評測](04_Features/QA_Evaluation/reports/2026-08-24-評測結果.md)；2026-09-10：[憑證申請](10_Operations/deployment/2026-09-10_Lets_Encrypt憑證申請紀錄.md)；2026-09-21／09-23：[開放試用與外部檢查](10_Operations/deployment/2026-09_開放學生試用紀錄.md)。2026-09-24 使用量只代表當時樣本。
- 2026-09-29：舊文記載影像資料尚未綁定課程影片；2026-10-03：推薦功能僅本機實作；2026-10-07：資料庫交付工具僅模擬測試；2026-10-14：本機產片工具紀錄，未宣稱系統串接或部署。

完整舊文（含其餘測試日期、原始數字與會議紀錄）保留在 Git 版本 `9140f9ec58beff5cc21cb97486bc4864f6898eec`，不另建一份狀態文件。查閱例：在 repo 根目錄輸入 `git show 9140f9e:docs/current-status.md` → 顯示整理前原文；把路徑換成 `backend/docs/current-state.md` 可查後端舊文。歷史文字與目前程式有差異時，以程式及新查證為準。

## 2026-10-29 recut 交付候選（進行中）

候選 worktree：`C:/Users/User/Documents/GitHub/_worktrees/focusflow/recut-delivery`；分支 `integration/recut-delivery-20261029`，整合基底 `0be742c`（dev `66caba4`＋recut `130aa4f`）。舊路徑 `D:/AI-workspace/focusflow-recut-delivery` 保留為相容 junction，兩者是同一份 checkout；後續直接接續此候選，不另建或搬移。正式前端與兩份已定案決策保留。

本輪 DoD：先完成 recut 成品核准／退回、ShortAsset review 與 YouTube ready 雙向發布及失敗修復；再接 RC4／RC5／RC6、本機 CLI，完成可隔離驗證的 RC7 後端 worker 身分／租約／成品回傳與 RC10 同意／撤回。每項必須有本輪 fake/記憶體或專用 loopback Mongo 證據，最後獨立審查、修正與全套檢查後才稱候選完成。歷史測試數字不作本輪證據。

當次外部服務、Atlas、VM、真 YouTube／Gemini、正式部署與人工驗收未執行；後續 Gemini 試產見上方 2026-11-04 檢查點。正式前端 UI 不在本輪。RC12 因原音技術試跑尚未通過且模型下載未授權，維持 BLOCKED；合成語音選項須明確回未就緒。

2026-11-01 本輪續接：成品核准同步 RecutApproval 與 ShortAsset 的精確 versionId／assetId／generationVersion；退回依呈現／內容分流，YouTube ready 與核准任一先到均可接續發布，中斷後修復同一成品。RC7 後端已加入雜湊 worker 金鑰、FIFO、10 分鐘租約、3 次派工上限、版本核對、受限原片下載、成品檢查與可恢復回傳。以禁止 dotenv 讀檔的 preload 執行 fake/harness targeted 58／58、路由契約 11／11、OpenAPI lint 通過；尚待跨程序 Mongo 競爭驗證、renderer／pipeline 整合、RC10 gate 與最終獨立驗證，不能據此稱整體完成。

候選已依序合入當次 `origin/dev` 與本機 `dev` 已提交文件，以及 renderer core／hardening、pipeline 與單題工具四筆原始提交。新增 Mongo mutation lease 與 revision／token fencing；專用 `127.0.0.1:27029` 資料庫驗證跨 Node 程序互斥、失效 token 拒絕、同工作僅一次派工與過期 lease 接手，與外部服務隔離。仍須整合最新 chunk 版本契約、RC10 與完整 fake E2E 後交獨立驗證。

2026-11-02 續接：後端整合由 `delivery_backend_resume` 負責 shared models／services／routes／harness／OpenAPI 與啟動組裝；`delivery_consent_resume` 負責 RC10 專屬同意模組；`delivery_pipeline_runtime` 負責 pipeline 與本機 CLI runtime。後端接續 DoD 是完成 RC4 真正註冊入口、API 與審閱共用 queue、持久化建議、RC10 在排程／worker／上傳／發布的實際閘門及撤回處置，再由最終驗證者序列執行全套與獨立審查。

本輪已完成 `45dfd69`：凍結證據與 RecutSource 保存逐字稿版本，異版不回查 chunk，審閱使用快照並提示來源更新；targeted 69／69、補強斷言後增量 4／4、OpenAPI lint 通過，均預載 `noDotenv.cjs` 且外部服務使用替身。`c0bc4ac` 已合入最新 `origin/dev`（`66f45fc`，含本機 dev `2d4ebc9`）；四份 LINE 定案文件與該 dev 一致。尚未完成本輪全套、完整 fake E2E、RC10 整合及最終獨立驗證，不據此稱候選完成。

2026-11-02 接續檢查點：程式整合 HEAD `abb60bb9`。`7c25e15` 抽出不讀設定的來源純演算法（19／19）；`42c3ada` 已實作惰性 application factory、API 與審閱共用 queue、建議持久化（18／18）。RC10 四筆已合入為 `905e21ef`、`866d544b`、`7d4f4b21`、`218ab5f8`；runtime 四筆已合入為 `c97d63e`、`fcf01a00`、`77aa47df`、`2f9b0630`。worker client 原 owner 的程式與文件已合入為 `94c85fe7`、`abb60bb9`；其 145／145 為 owner 本機證據，候選最終全套另驗。

shared backend 已以 `b73ed48` 接上同意閘門、撤回實際取消／封存／轉私人待辦與通知、harness 及跨模組測試。跨模組撤回 6／6 通過，包含未選中已發布成品保留、選中成品封存、管理員去重通知，以及發布 CAS／YouTube 已送 bytes／渲染成品建立三種交錯。factory 4／4 含真 HTTP controller（缺配置 503、配置後生成及建議重跑）與 runtime factory 接 RC2～RC4 三次 fake 判斷。shared／worker／queue／契約 targeted 63／63、OpenAPI lint 通過；上傳／批次／短片回歸 115 項中 114 項通過，唯一舊 fixture 缺少新課程同意已補成真 HTTP「409 → 明確同意 → 201」，其後該項與最新撤回增量 7／7 通過。尚未以完整新一輪全套取代上述分段證據。

最後四筆 pipeline／worker 合入後，factory 與三次選段增量 25／25 通過，包含真 HTTP 與實際 adapter 建構；外部仍全 fake。接續順序：處理已派給 pipeline owner 的獨立審查問題及教授原片本機 bootstrap → shared backend 修後獨立複驗 → 受影響子系統全套與 HTML 檢查。使用者已授權 `D:/User/Weihao/Videos/短影音測試用/原始上課完整片段` 內指定教授影片的本機試產；本輪教授試產 owner 回報重新執行 CPU small ASR 成功（45.03 秒、441 個有效 word、24 句），優先使用這份新辨識結果。較早 CPU／GPU 記憶體錯誤與 `legacy-cached-20261014` 快取仍為歷史紀錄，不把快取說成本次 ASR 成功。使用者另已授權單題 Gemini 費用不超過 US$0.50，後續試產固定 `gemini-3.8-flash`、最多 5 次、每次 output 4096，不傳原始影片且不使用備援模型；此段為當時授權紀錄；後續實際呼叫見上方 2026-11-04 檢查點。Atlas、YouTube、VM 仍未執行。尚無真實 recut MP4、正式部署或人工網頁驗收證據；fake 生成與審閱成功不能代替這些驗收。既有教師 UI 尚須補接同意請求，操作契約見[後端審閱介面](../backend/docs/recut-review.md#同意閘門與撤回整合)。

### shared backend 五項初審問題的修後檢查點

| 初審問題 | 本輪處理與證據 | 尚待 |
|---|---|---|
| feed 過濾後空頁拋錯、後方有效成品遺漏 | `dd57410` 持續掃描到滿頁或耗盡；新回歸 2／2 通過 | 非作者複驗 |
| 真 Mongo 隱藏 leaseHash 使撤回取消失敗 | `fa2995e` 明確 select 隱藏欄位；專用 `127.0.0.1:27029` 真 Mongo leased／completing 取消與原有 fencing 共 6／6 通過 | 非作者複驗 |
| 舊過期快照覆蓋已續期 worker 租約 | `fa2995e` 在逾期恢復 CAS 加原到期時間與過期條件；gated heartbeat 回歸及 worker 16／16 通過 | 非作者複驗 |
| 晚到成品不出現在管理員待辦 API | 當前 route 已合併 core actions 與 Asset 待辦；`a3533ef` 真 HTTP 驗證管理員 200 含該筆、教師 403。直接呼叫 core service 的空結果不能代表 route 缺接線 | 非作者確認初審是否撤回 |
| 同意 gate 之後、上傳 CAS 之前撤回留下 unlisted | `a3533ef` 上傳 CAS 排除 archived，CAS 後重讀，晚到 ID 留持久補償；新增 gated promise、privacy 失敗通知與恢復，撤回整合 8／8 通過 | 非作者複驗 |

上述 fake worker／撤回共 24／24 及真 Mongo 6／6 為修復作者本輪驗證，尚未宣稱獨立審查通過。pipeline 四筆初審修正已合入 `51e7f16f`、`474921fc`、`c7382504`、`304a6c8b`；教授裸影片 bootstrap 與後續 trial guard 由原 owner 接續。工作樹內前端交接文件由另一 owner 維護，不能因 shared 修復完成就稱正式教師 UI 可用。

### 2026-11-03 shared backend 恢復檢查點

候選已依序整合 pipeline 五筆：`a9a89d6a`、`b4ce888f`、`6ac0cca7`、`8d9a2881`、`f8c3a2ac`。正式 source/media 已接 ASR 正規化，持久保存原片 SHA-256、逐字稿版本／片段、辨識證據與截斷句禁止清單；模型、教師加回、片頭、句內微調及 RC8 鎖定重跑共用拒絕檢查。程式碼圖卡遇有／無行號的「會／可能／就…出錯」提示時保守保留原話，不讓 OCR／AI 修正錯誤示範。OpenAPI 補齊禁止加回的 422、逐句可選狀態、撤回成品清單與管理員待辦回應／403。

本輪作者精準測試 **140／140**、OpenAPI lint 與 `git diff --check` 通過；包含真 Express 本機 loopback、記憶體模型與真 Mongoose schema 的 `new/validateSync/toObject`。外部工具、模型與服務皆 fake，未連 Atlas／VM／YouTube／LINE；前端與兩份 Short_Video 決策無修改。精準測試 log：候選根目錄 `backend-shared-tests.log`；lint log：`backend-docs-lint.log`（忽略的本機證據檔，不提交）。完整 backend、隔離 Mongo、renderer 與非作者複驗由整合 owner 接續，不能將本輪作者測試當正式驗收。

恢復命令（PowerShell，在候選 `backend/`）：

```powershell
$env:NODE_PATH='C:/Users/User/Documents/GitHub/focusflow/backend/node_modules;C:/Users/User/Documents/GitHub/_worktrees/focusflow/recut-rc5/short_render/node_modules'
node --require ./tests/helpers/noDotenv.cjs --test --experimental-test-isolation=none --test-concurrency=1 --test-reporter=spec tests/recut-source.service.test.js tests/recut-media.service.test.js tests/recut-selection.service.test.js tests/recut-review.service.test.js tests/recut-review.routes.test.js tests/recut-state.service.test.js tests/recut-code-runtime.service.test.js tests/docs.routes.test.js tests/recut-consent-integration.test.js
npm.cmd run docs:lint
```

只使用指定 preload 禁止載入環境檔，不讀或回報任何金鑰值。整合 owner 當次回報的執行阻塞：Docker Desktop 兩次以隱藏視窗啟動仍未就緒、專用 `127.0.0.1:27029` 拒絕連線；教授試產 runner 只回報缺少 `GEMINI_API_KEY` 變數名，**0 次真模型呼叫**。以上為 2026-11-03 當次診斷，已由上方 2026-11-04 Docker 與真模型試產紀錄取代；不得改連正式資料庫。

## 窗口前唯讀證據（2026-11-11 15:39–15:44 台灣時間）

本次實際連線 Atlas，只讀取與查詢；資料寫入、索引更新／回復及付費模型呼叫皆為 0。全 collection 實際計數 815，指定課程備份 694 筆，與 phase7 備份逐筆比較舊 embedding 全部相同。三筆新欄位皆不存在，Dry Run 三筆通過；既有工具／Adapter 定向測試 20/20 通過。未執行新三路真實搜尋、正式網站 E2E 或完整 43 題評測。

本機證據位於忽略目錄 `.local-tools/atlas-preparation/`：`backup-1794382699301.json`（由既有工具回讀校驗）、`window-prep-20261111-dry-run.json`、`window-prep-20261111-baseline.json`、`window-prep-20261111-status.json`、`window-prep-20261111-latency.json`、`window-prep-20261111-definition-audit.json`。當次 planHash 為 `fcc472a27039656983b3bb4fe4e4db708b4886a9d20c99d3b0d68b7ca22249f2`；這是下午證據，不能直接視為 20:00 窗口的核准計畫。備份含指定範圍 694 筆，不是全 collection 815 筆的完整災難備份，也不授權全量還原。

目標索引與三節點 mainIndex 皆 READY／queryable；帳號 find、update、listSearchIndexes、updateSearchIndex 權限以唯讀方式確認，未試寫。三筆舊文字自查皆 rank 1，各回傳 20 筆，耗時依序 165.50／65.19／78.92 ms（0001／0117／0070）；未授權影片與錯誤課程 filter 均為 0 筆。這只是三次查詢觀察，不能推論 p95 或承諾重建期間效能。

執行狀態仍為 PREP-ONLY／NO-GO FOR WRITE：待窗口內 fresh 核對、Atlas 管理者值守與監測、無重疊 VM／部署確認、必要時接受不含正式站 E2E、M0 資源盲區與兩次重建風險接受，以及使用者再次明確授權。原始定義差異與回復核對方式見 [操作計畫](04_Features/Multimodal_Retrieval/atlas-preparation.md#索引前像的預設欄位核對)。
