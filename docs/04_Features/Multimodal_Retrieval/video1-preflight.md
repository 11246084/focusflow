# 影片一真實建置前最終檢查

本頁保留工具修正前的檢查快照。三個入口後續已補齊，使用方式見[影片一批次工具](video1-tools.md)，最新測試與剩餘限制以[狀態正本](../../current-status.md)為準。

本文件記錄 2026-11-12 對 dev `e3774d4` 的唯讀與離線檢查，供下一輪建置授權使用。執行狀態見 [目前狀態](../../current-status.md)，驗收規則仍依 [decisions.md](decisions.md) 第 11 項。本輪沒有付費呼叫、Atlas 寫入、索引更新、服務啟動或正式評測。

## 實查與數量

- `git pull --ff-only origin dev`：已是最新，開始時工作目錄乾淨。
- V1 `6a6da68e56dd124511ec51b4` 有 117 個原始 Chunk，117 筆舊 embedding；新版文字、聲音、畫面欄位各 0 筆。
- 原片 `backend/uploads/1785570957608-aiA10_1140119_1.mp4` 可讀，長 1756.5 秒；SHA-256 `2931462f4db6dc9779b18cc408663e7d15ad9861e928fcff5b7e817338672ccd`。
- 117 筆字稿與起訖時間已逐筆比對當次 Atlas 備份一致。全部 117 段符合影音規則，0 段超過 60 秒，1 段不足 8 秒依原規則延伸。使用既有 `sample_window`、`cut_media` 實際切出 234 個檔案並完整解碼通過，保留原始引用時間，採樣時間另存。
- 原生 checkpoint 匯出驗證 12 筆成功；V1 的 chunk_0001、chunk_0117 可重用各三路，共 6 筆。V1 目標 351 筆向量，尚需 115 文字＋115 聲音＋115 畫面＝345 個模型輸入。
- 保存的 V1 兩個探索 query 可做技術接線驗收，新增 query 輸入可為 0；它們不是既有 42 題的成效證據。Hierarchical 尚需另外建置 39 筆 Parent 文字向量，不包含於 351 筆 Leaf。

## 成本與停止機制

官方標準價格核對：[Gemini 價格](https://ai.google.dev/gemini-api/docs/pricing#gemini-embedding-2)。既有 `estimate_cost` 每次文字預留 8192 tokens（US$0.0016384），聲音以整秒向上取整，畫面最多 32 幀。原前檢僅按編碼時長估算 US$1.780076；後續已依 Adapter 採「編碼與採樣時長取大者」修正，345 個缺少輸入首次保守預留 US$1.824316。建議首輪預留 US$1.83，最多三次嘗試預留 US$5.49。39 Parent 另預留 US$0.0638976／一次。這是程式估算，不是帳單；實際重用必須通過原生簽章與來源 digest，不以重新編碼檔案取代舊 checkpoint 輸入。

另外使用獨立 Fake ledger 實測 US$20 邊界：19.999 時新文字呼叫被擋、SDK 0 次；19.996 且連續 429 時只允許 2 次，累計 19.9992768，第三次在 SDK 前被擋；20 時 SDK 0 次。重試先預留、不退還，SDK 自身重試停用。

**尚缺批次入口的固定約束**：Adapter 可傳入 20，但通用上限仍容許 30，現有 `run_gemini_validation.py` 只處理 12 個輸入／US$0.25。下一輪須最小擴充既有入口，以凍結的 V1 manifest 綁定共用 ledger、強制累計 20、每輸入最多 3 次、非 429 最終失敗率超過 5% 停止；不得換輸出目錄重置 ledger。345 個新輸入最多 1035 次嘗試，不能據此繞過金額上限。

## 備份、寫入與索引

本輪 `run.js::backup/readBackup` 已實際匯出六片 694 筆完整文件、BSON 型別及索引定義，重讀 checksum 通過。整個 collection 有 815 筆；694 備份是六片操作範圍的完整前像，不等於整個 collection 的災難備份。

原三筆 `planWrites/applyPlan` Dry Run 全通過，`rollbackPlan` Dry Run 均為 already_restored。CAS 代表資料與備份相同才寫入；現有工具具備完整前像比對、保護原欄位、逐筆讀回、receipt、衝突即停及只還原自有欄位。這些有既有測試支持，本輪沒有在正式 Atlas 實寫或實回復。

**阻塞**：`control.js::validateBundle/planWrites` 仍限定原三個 ID／12 筆輸入，實際以 V1 清單呼叫已被拒絕。只需擴充既有契約接受明確核准的 V1 117 個 ID／351 向量及來源簽章，並讓批次入口在任何寫入前自動呼叫備份、重讀校驗；不能略過檢查或直接呼叫 updateMany。

Atlas 唯讀時點：`video_segments_text/text_embedding_index`、`video_segments_parent/parent_embedding_index`、`video_segments_video/video_embedding_index` 全部 READY、queryable，三節點皆相同。集合資料約 56.58 MB、storage 129.97 MB、一般 index 4.36 MB；這些不是 Search Index 總用量，無法證明 M0 重建容量及延遲。部署實際方案／Search 資源成本仍需管理介面證據，不能由三個索引反推方案。

一次性方案 B：只更新同名 `text_embedding_index`，保留 3072 維 cosine `embedding` 與 courseId/videoId filters，新增同規格 `stableTextEmbedding`、`audioEmbedding`、`visualEmbedding`。既有索引不刪、不建立第四個，Parent／Video 索引不改。`index-control.js::transitionIndex` Dry Run 成功，新增路徑正確；當次正式執行須重新讀取定義與產生 approvalHash，不能直接沿用本次 hash。

下一輪授權後精確順序：

1. 完成上述最小入口擴充及回歸，凍結 117 筆來源／向量 manifest、共用成本 ledger，確認操作窗口及 Weihao 可聯絡。
2. 產生缺少的 345 筆向量，只存本機；驗證 117 組三路、3072 維、模型版本、原時間與來源 digest。
3. 寫前重新自動備份 694 筆前像、三索引與校驗；逐筆 CAS 寫新增三路向量／metadata，保留 embedding，其後讀回並落 durable receipt。第一次錯誤或不確定結果即停，先查證再續跑。
4. 同名 Leaf 索引只送一次更新，持久化 journal；等待三節點 READY/queryable 及新資料可見。逾時／未知結果不可盲目重送，FAILED、容量或舊文字回歸失敗即停。
5. 真實三路自查及下述安全 QA E2E，核對舊 embedding hash、694 筆數量、固定 query 的舊文字 top20 與延遲。成功資料保留、正式旗標仍關閉。
6. 失敗時依 receipt 回復自有欄位，遇外部修改拒絕覆蓋；索引回復須核對 journal／當前狀態，BUILDING、FAILED 或未知狀態不保證能自動還原，需停下協調。不得整份文件覆蓋或刪 collection。

## 真實 QA E2E 與通過條件

只寫 V1 時，原課程六片範圍最多 117/694，不可視為完整。現行 `readStableTextCoverage` 本輪實查為 0/694、V1 0/117，皆不放行；既有部分覆蓋回歸已通過。三路搜尋回滿 top20 不能替代完整覆蓋檢查。

最小補充方案為擴充既有 `multimodal-qa.integration.test.js` harness 的唯讀 Atlas 模式：真實 V1 原 video/Chunk ID，測試課程及 enrollment 僅在記憶體合法掛載 V1；沿用真實 HTTP 身分與 scope 流程，向量搜尋轉送唯讀 Atlas，Conversation／FAQ／用量等全部留記憶體。精確重播已保存 query，其他模型呼叫一律拒絕；答案用 template，故只能驗證 QA 接線與引用，不能宣稱真實 LLM 回答品質。**這個安全真實 Atlas 入口目前不存在，正常後端啟動或正常 askQuestion 可能寫入，不可直接使用。**

通過需同時滿足：

- V1 合法範圍覆蓋 117/117；原六片課程部分覆蓋負控制仍不放行。
- 攔截實際 Atlas aggregate，證明文字、聲音、畫面三條 `$vectorSearch` 都執行，索引、path、video allowlist 與 query 身分正確，各有候選。
- 核對 RRF k=60、權重、channel rank／contribution／retrievedBy 與融合順序；`usedFallback=false` 且 `textSource` 不能是 scoped_text_search 或 hierarchy 替代。只看最終回答不能算通過。
- 引用的 chunkId／videoId／原始時間、字稿 trim 與播放器 seek 一致；範圍外影片不能出現。
- Flat、旗標 OFF 舊流程、FAQ 命中／未命中、課程授權負例分開驗證。Hierarchical 真實驗收待 39 Parent 合約／向量完成，不能用 Mock 通過替代。

不改 `qa.service.js`、原 embedding、FAQ 資料或正式旗標。第 11 項品質門檻仍須全量同語料、固定 per-question.json、42 題計分＋X01 另列、六組模態×兩權重與 Flat／Hierarchical 比較；V1 探索 E2E 不替代這些成效評測。

## 本機證據與結論依據

忽略目錄 `.local-tools/v1-final-preflight-20261112/` 保存 `atlas-preflight.json`、694 筆備份、`verified-bundle.json`、234 個切片與 `media-manifest.json`、`offline-preflight.json`、Backend 與 Python 測試輸出。完整向量、備份及字稿不提交 Git。

本輪相關 Backend 六檔 62/62、Gemini Adapter 10/10、三種 US$20 邊界均通過。舊文字三個實際 self-query 均 rank1／top20；這只證明現有舊路徑可查，不是題庫成效。未重跑無關的 1935 項完整回歸，未做真實 Atlas QA E2E、正式評測、付費或寫入。

資料準備可繼續，實際批次建置／寫入 **NO-GO**：尚缺 V1 manifest 批次入口、117 筆受控寫入契約及安全真實 Atlas QA harness，另需當次付費／寫入／索引授權。這三項是工具缺口，不是要重做核心檢索；先補最小擴充再授權，才有可直接執行的命令。
