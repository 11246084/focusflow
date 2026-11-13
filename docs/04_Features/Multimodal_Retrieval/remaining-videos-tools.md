# 影片二至六建置工具

本輪把影片一的既有入口擴充成依核准清單逐片執行，沒有重寫 Embedding、Atlas Adapter、RRF 或 QA Bridge。下列實際付費／寫入指令均須取得下一輪授權；本輪只完成素材準備、Fake 預演、唯讀查證與測試。最新結果看[狀態正本](../../current-status.md)。

> 2026-11-13 寫入後提醒：V2～V5已依限定授權完成，結果以[狀態正本](../../current-status.md)為準。不要照下方歷史範例重送成功資料或重新產生向量；V6及任何新付費／寫入仍需另行授權。既定題庫E2E要使用相符問題的保存Query，self-query不能代替。

## 執行前先確認目前授權

先讀[狀態正本](../../current-status.md)最新多模態段落。本頁下方數量／預算表是 11/12 準備快照，不是目前尚缺輸入或 Atlas 覆蓋；已成功 Checkpoint 不重建。Gemini 付費請求目前 NO-GO，不能直接執行下方付費範例。完整影片可沿用既有 `dry-run` 與不帶 `--execute-write` 的檢查；影片六未完整時不匯出完整 bundle、不產生可執行寫入計畫。

收到新的 Atlas 授權後，仍須重新建立當次備份／計畫並核對 approvalHash，不能把歷史或本輪 Dry Run 的通過當成已獲准寫入。後五片禁止索引操作；遇衝突、未知結果或告警即停，不自動回復。

## 凍結來源與數量（11/12 準備快照）

共用清單是 `backend/scripts/atlas-multimodal/corpus.json`：六片原始 videoId、Chunk 數、檔名、原片與原始文字產物 SHA-256、時長、固定影音略過 ID。Python 與 Node 使用同一份；不接受任意新影片、混片或缺少 ID 的 manifest。準備時逐筆沿用原字稿及起訖時間，短段延伸採樣時間另存，不改引用時間。

| 影片 | Chunk | 可做影音 | 目標向量 | 本機可重用 | 新輸入 | 首次保守預留 US$ |
|---|---:|---:|---:|---:|---:|---:|
| V2 | 123 | 123 | 369 | 0 | 369 | 1.9067732 |
| V3 | 83 | 82 | 247 | 0 | 247 | 1.2588872 |
| V4 | 144 | 144 | 432 | 3 | 429 | 1.9732912 |
| V5 | 88 | 87 | 262 | 0 | 262 | 1.2746792 |
| V6 | 139 | 139 | 417 | 0 | 417 | 2.2483876 |
| 合計 | 577 | 575 | 1727 | 3 | 1724 | 8.6620184 |

V3 chunk_0034（603.74 秒）、V5 chunk_0016（647.03 秒）只建 stable 文字。它們仍在文字 allowlist，沒有假影音向量；manifest 記錄 `duration_over_60s`，bundle 只含 text，CAS 只寫文字向量與文字 metadata，保留舊 embedding。V4 chunk_0070 的原生三路 Checkpoint 沿用原 bytes／採樣時間。

## 無付費操作

根目錄 PowerShell；沿用 Node 22、Python 3.11、FFmpeg：

```powershell
. ./.local-tools/activate.ps1
$py = 'STT_Whisper/.venv/Scripts/python.exe'
# 已建立的 manifest 不覆寫；本輪 V2～V6 均已準備完成。
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --video 2 --mode prepare
$manifest = '.local-tools/multimodal-build/V2/manifest.json'
$approved = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLower()
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --video 2 --mode dry-run --approve-manifest $approved
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --video 2 --mode fake-sdk --approve-manifest $approved --start 0 --batch-size 10
```

V3～V6 改 `--video` 與資料夾。`start` 是 Chunk 在清單中的零起算位置，不是向量筆數；可依 0、10、20…逐批，最後不足十筆自動裁切。略過影音的 Chunk 不會吃掉下一個 Chunk 的輸入。每片狀態／Fake ledger／Fake Checkpoint 分開，真實向量仍共用原生 Checkpoint 目錄；Fake bundle 不能用真實匯出模式提交。

## 下一輪取得模型授權後

```powershell
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --video 2 --mode gemini --allow-paid --approve-manifest $approved --start 0 --batch-size 10
# 逐批確認後續跑；成功 Checkpoint 直接重用。
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --video 2 --mode export --approve-manifest $approved
```

模型固定 gemini-embedding-2／3072 維；真實入口固定使用原 `.local-tools/multimodal-gemini/cost-ledger.json` 及 `.local-tools/gemini-small-sample/gemini/checkpoints`。本輪實查 ledger US$1.88568520，後五片首次保守預留合計後約 US$10.54770360，不是帳單；全部三次最壞約 US$27.87174040，不能保證所有重試都能完成。每次呼叫前仍受累計 US$20 停止上限；輸入次數上限按固定全六片 Leaf 最多三次設為6247，並不增加金額上限，也不授權付費。

任何請求錯誤先停，不自動重送。失敗／未知輸入重啟或換 output 也不能直接再呼叫；必須檢查 ledger／Checkpoint，另有受控重試授權後才加 `--retry-signature <原簽章> --retry-attempt <明確下一次序號>`。只允許該次序號的一次新增嘗試，前像與原預留先存共用 `controlled-retry-permits`，不能抹掉原未知費用。成功快取損壞／遺失時拒絕重建，先回復原快取。

## 下一輪取得 Atlas 寫入授權後

沿用 `video1.js` 檔名及既有 B／CAS 流程，讓每片 manifest 決定固定範圍：

```powershell
$bundle = '.local-tools/multimodal-build/V2/bundle.json'
$plan = '.local-tools/multimodal-build/V2/write-plan.json'
node backend/scripts/atlas-multimodal/video1.js --mode dry-run --manifest $manifest --approve-manifest $approved --bundle $bundle --output $plan
# 查看當次 plan 的 approvalHash，再填入 $writeApproval。
node backend/scripts/atlas-multimodal/video1.js --mode apply --execute-write --manifest $manifest --approve-manifest $approved --bundle $bundle --plan $plan --approve-plan $writeApproval --output .local-tools/multimodal-build/V2/apply-01.json
```

準備時自動完整備份指定六片694筆、六片版本與索引，重讀 checksum；執行前再次自動備份並核對前像、版本、權限、索引 ID／雜湊。逐筆 CAS、intent、receipt、讀回、失敗即停均沿用。新清單必須發現現有三路索引已 READY，且新增定義差異為0；後五片入口直接拒絕 index-plan/update/restore，沒有第二次重建命令。影片一117筆完整文件指紋綁入 plan，寫前／寫後核對，不能把它列為目標。

原 embedding、字稿、時間、courseId/videoId 都受保護；兩個過長項目的影音欄位也視為非自有欄位，並行異動會停止。資料回復先用同一 plan 的 `rollback` Dry Run，真正回復仍須另獲授權，不自動刪除成功資料或回復索引。

## 每片真實 QA 與舊文字回歸

使用現有題庫挑選有該片人工時間的單片題：V2 F06、V3 F08、V4 F15、V5 F12、V6 F11。`query-plan` 只讀原題與 Gold 時間，找重疊的真實 Chunk 作來源錨點，不改 Gold、不新增題：

```powershell
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --video 2 --mode query-plan --approve-manifest $approved
# 只有另外授權該題 query 模型輸入後才執行；五片最多新增5個query，另預留US$0.008192。
& $py -X utf8 STT_Whisper/src/run_video1_batch.py --video 2 --mode query --question-id F06 --allow-paid --approve-manifest $approved
$query = '.local-tools/multimodal-build/V2/query-bundle.json'
$queryHash = (Get-FileHash -LiteralPath $query -Algorithm SHA256).Hash.ToLower()
node backend/scripts/atlas-multimodal/video1-qa.js --manifest $manifest --approve-manifest $approved --query-bundle $query --approve-query-bundle $queryHash --query-id 6a6da69056dd124511ec51bf_chunk_0037 --output .local-tools/multimodal-build/V2/qa-real.json
```

V3／V4／V5／V6 的錨點分別為 chunk_0012／0067／0078／0101，完整 videoId 依 catalog。query 向量產生使用同一成本 ledger、簽章、停止與重用機制；沒有付費時只能列 query-plan，不能拿 Synthetic Vector 冒充真實題庫 query。

QA Harness 以本機記憶體合法掛載該片、沿用正式 HTTP／QA／Bridge／RRF；只讀 Atlas，其他狀態只寫記憶體。確認三條真實 vectorSearch、各路候選、k60與貢獻、原字稿／來源／時間、無 fallback／文字替換，以及撤銷 enrollment 後403且不搜尋。答案仍是既有 template，不能代表LLM正確性。每片寫入前後另用同一舊 embedding／video allowlist 比對舊文字 Top20、延遲與舊向量 hash；逐片檢查已完成影片與非目標資料不變。

## 容量及評測邊界

當次 dbStats：dataSize 71,655,161 bytes、storageSize 129,970,176 bytes、一般 indexSize 4,358,144 bytes。依影片一 BSON 增量估算再加約74,158,871 bytes；五片切片實占約322MB，本機剩餘約469GB。這些不是 Search Index 儲存量／全叢集容量保證。控制台存取等待逾時，本輪沒有重新核實部署 tier 及 Search 用量；正式寫入時須當次核對容量、告警、三節點與無並行操作。官方 Free 限0.5GB、合計3個Search／Vector索引，維持既有三個，不建第四個。[Free限制](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)、[Search限制](https://www.mongodb.com/docs/search/deployment/feature-compatibility/)。

評測沿用現有 `auditMultimodalOffline.js`／`verifyMultimodalAudit.js`，`--pending-x01 --inspect-bank` 已驗證42題計分、X01另列、7拒答另列。`per-question.json` 保持既有 records 陣列：questionId／mode(flat或hierarchical)／group(六組)／weighting(equal或text_weighted)／ranked(前20及原Chunk時間)；每題24組，text/all×flat/hierarchical就是主2×2。config須綁定相同 bank／manifest／protocol／ranking hash，獨立工具重算Recall@5／Recall@10／MRR。舊／stable文字基準仍分列；不可跨語料規模宣稱改善。

本輪未執行正式42／43題成效評測。題庫query向量、真實Parent與Hierarchical資料仍待建立／核實；V1的兩題及五片Fake E2E不能代替正式結果。全課程覆蓋與第11項門檻未通過前，正式旗標維持關閉。


本輪可分享的測試／數量／成本摘要見[準備證據](evidence/2026-11-12-remaining-preparation-summary.json)。它標示Fake與唯讀來源，不能當真實五片模型／Atlas／評測結果。
