# 影片一批次工具操作

本工具後續已完成限定影片一真實操作；當次狀態、證據與未完成範圍只看[狀態正本](../../current-status.md)。下列 execute 指令均須當次授權與新Preflight，不能因前次成功直接重送。

這份說明沿用現有 Gemini Adapter、B 方案 CAS、索引 journal 與 QA Harness，供影片一建置與驗收使用。預設只做 Dry Run；付費、Atlas 寫入、索引更新均須另外取得當次授權。測試結果與尚未完成的真實驗收見[狀態正本](../../current-status.md)。

## 清單與 Embedding

`STT_Whisper/src/run_video1_batch.py` 只接受影片一 chunk_0001～chunk_0117，模型固定 gemini-embedding-2／3072 維。Manifest 同時保存原字稿／時間、採樣時間、影音路徑與 digest；核准雜湊為整份檔案的 SHA-256，不能修改後沿用舊核准值。不要將清單、字稿、向量或 ledger 提交 Git。

根目錄 PowerShell：

```powershell
. ./.local-tools/activate.ps1
$py = 'STT_Whisper/.venv/Scripts/python.exe'
# 只需建立一次；既有檔案拒絕覆寫。
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --mode prepare --media-manifest .local-tools/v1-final-preflight-20261112/media-manifest.json
$manifest = '.local-tools/video1-build/manifest.json'
$approved = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLower()
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --mode dry-run --approve-manifest $approved
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --mode fake-sdk --approve-manifest $approved --start 0 --batch-size 117
```

`fake-sdk` 使用真實切片及明確標示的合成向量，與真實 ledger／Checkpoint 分開，不能匯出為真實 Atlas bundle。相同命令重跑會使用成功 Checkpoint；沒有語意品質宣稱。

**下一輪取得付費授權後**才可執行：

```powershell
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --mode gemini --allow-paid --approve-manifest $approved --start 0 --batch-size 10
# 其後 start=10,20,...,110；最後一批自動裁到117。中斷時重跑同一批。
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --mode export --approve-manifest $approved
```

真實執行固定共用 `.local-tools/multimodal-gemini/cost-ledger.json`，沿用原小樣本 `.local-tools/gemini-small-sample/gemini/checkpoints`；沒有換 ledger／成本上限的 CLI 參數，既有 ledger 缺失即停。上限固定累計 US$20／1048 次嘗試（含既有 13 次保守記帳及最多 345×3 次），每次 SDK 前持久化成本與該簽章累計嘗試數。跨輸出目錄、重啟、逾時皆不能重置；成功重用不增加費用。三次嘗試耗盡不得自行刪 Checkpoint 重試。

任一輸入失敗先停止該批，比「非429最終失敗超過5%」更保守；先查安全摘要，不自動跳過後繼續。程式硬中斷留下 ledger lock 時也停止，需確認無程序／未知請求後人工處理，不能用新 ledger 續跑。Windows 檔案替換只做最多十次本機短重試，絕不因此重送 API。完整 351 筆成功後才可 export，匯出會以禁止 SDK 的 Adapter 重驗原生簽章／digest，輸出 `.local-tools/video1-build/bundle.json`。

本輪清單核對尚缺345個輸入，首次保守預留 US$1.824316，三次 US$5.472948，另加既有 ledger 累計；不是帳單金額。原生六筆 V1 Checkpoint 已用禁止 SDK 的 factory 重播驗證，可重用且原 ledger 雜湊不變；不是把 Fake 向量當成重用。

## Atlas B 方案與回復

`backend/scripts/atlas-multimodal/video1.js` 只操作 focusflow/video_segments_text 中核准的 117 筆，新增 stableTextEmbedding、audioEmbedding、visualEmbedding 及三路 metadata；原 embedding、字稿、時間、課程、影片與 Gold 不改。

取得真實 bundle 後，可先唯讀建立操作清單（本輪沒有執行此真實命令）：

```powershell
$bundle = '.local-tools/video1-build/bundle.json'
$plan = '.local-tools/video1-build/write-plan.json'
node backend/scripts/atlas-multimodal/video1.js --mode dry-run --manifest $manifest --approve-manifest $approved --bundle $bundle --output $plan
```

這一步自動備份六片 694 筆完整文件、影片版本及索引，重讀 BSON checksum 後產生 approvalHash，綁定 manifest／bundle／前像／權限／影片版本／索引 ID、版本、定義雜湊。694 不是整個 815 筆 collection 的災難備份。權限無法查證、少任何一筆、前像不同、來源或索引變更皆停止。

**下一輪取得明確 Atlas 寫入授權後**，先讀 plan 中的 approvalHash 作為 `$writeApproval`：

```powershell
node backend/scripts/atlas-multimodal/video1.js --mode apply --execute-write --manifest $manifest --approve-manifest $approved --bundle $bundle --plan $plan --approve-plan $writeApproval --output .local-tools/video1-build/apply-01.json
```

執行前再次自動寫入獨立完整備份，重新查權限、版本、索引與全部 117 個前像；每筆仍使用完整文件 CAS、無 upsert、intent 先落磁碟、讀回成功後寫 receipt。逾時或未知結果第一時間停止，禁止盲目重送。檢查 intent／receipt 後，用同一 plan 重新 Dry Run 會讀回核對已套用狀態；新的正式續跑另用不重複的 output 路徑，保留全部證據。

回復使用同一 plan、bundle、manifest 與 `--mode rollback`；預設仍是 Dry Run。另授權後才加 `--execute-write --approve-plan ...`，會自動備份當前狀態、只還原自有欄位、讀回完整前像。外部並行修改即拒絕回復，不整份覆蓋。

## 索引只擴充一次

同名 text_embedding_index 保留舊 embedding／filters，新增三路 3072 cosine 路徑；不建立新索引。Parent／Video 不改。

```powershell
node backend/scripts/atlas-multimodal/video1.js --mode index-plan --manifest $manifest --approve-manifest $approved --bundle $bundle --plan $plan --output .local-tools/video1-build/index-check.json
```

`index-update` 預設亦不執行。**另取得索引授權後**才加 `--execute-index --approve-plan $writeApproval --approve-index <index-control.approvalHash(plan.index)>`，journal 固定在 `.local-tools/video1-build/index-journal`，更換 output 仍使用同一份 journal，不能藉此重送未知結果。更新後三節點 READY／queryable、舊文字回歸、新資料可見才繼續。後五片只寫資料，不再次更新定義。

回復用 `index-restore`、同一 plan 與固定 journal，亦需索引授權及雜湊。BUILDING／FAILED／未知狀態不保證能自動回復；立即停止、找 Weihao 查狀態，不盲目重送。

## 安全真實 Atlas QA

`video1-qa.js` 沿用正式 HTTP、QA service、Bridge、RRF 與引用邏輯。學生／課程／enrollment 只在既有 Harness 記憶體建立合法 V1 掛載，保留真實 videoId、Chunk、字稿、時間及來源。此掛載不代表原六片課程覆蓋完整。正常後端不啟動、Mongoose 連線禁止；只有允許三路搜尋／覆蓋／索引讀取的 aggregate capability 接觸 Atlas，沒有 write 方法。

本輪以 Fake Mongo 與 Synthetic Vector 驗證；**V1 真實向量寫入並完成索引後**才可執行真正唯讀入口：

```powershell
& $py -X utf8 STT_Whisper/src/export_atlas_sample_bundle.py --output .local-tools/video1-build/query-bundle.json
$queryHash = (Get-FileHash .local-tools/video1-build/query-bundle.json -Algorithm SHA256).Hash.ToLower()
node backend/scripts/atlas-multimodal/video1-qa.js --manifest $manifest --approve-manifest $approved --query-bundle .local-tools/video1-build/query-bundle.json --approve-query-bundle $queryHash --query-id 6a6da68e56dd124511ec51b4_chunk_0001 --output .local-tools/video1-build/qa-real.json
```

只重播 bundle 中完全相同的保存 query；其他外部模型請求拒絕。答案使用系統既有 template provider，沒有替換 qa.service.js 或偽造模型回答；報告固定 answerQualityVerified=false。驗收 QA／對話兩條 HTTP 路徑、三路真實查詢、候選、獨立重算 RRF、117/117 覆蓋、無 fallback／文字替換、原時間戳引用，以及取消 enrollment 後 403 且不搜尋。對話、FAQ、用量與其餘狀態僅寫 Harness memory。它不等於真實 LLM 回答品質或正式題庫成效驗收。

本輪沒有真實 Atlas QA 成功證據，也沒有付費、正式資料／索引操作或正式旗標啟用；剩餘當次授權與 M0 資源風險見[影片一前檢](video1-preflight.md)。Hierarchical 真實驗收仍需 39 筆 Parent，不能拿 Mock 回歸當真實完成。
