# 多模態雲端部署交接

這份文件供Weihao核對既有VM需要補哪些設定，再安排另行授權的發布。依2026-11-14同步後的dev `1361f2e`及本機未提交多模態工具檢查，沒有登入VM、讀取正式設定、呼叫API或修改Atlas。功能與資料完成度只看[目前狀態](../../current-status.md)，本文件不是正式部署或付費授權。

## 1. 先選擇要部署的範圍

| 範圍 | 必須調整 | 不需要的動作 |
|---|---|---|
| A. QA讀取既有Atlas三路向量 | 發布相容前後端，確認Backend查詢憑證、資料契約與原QA設定；正式融合開關須另驗收授權 | 不需在QA程序安裝FFmpeg／Whisper、不必搬Checkpoint或重建索引 |
| B. VM處理新上傳的多模態 | A以外，另佈建Python、影音工具、持久Checkpoint／ledger、私有ACL、單一付費執行者與人工Atlas核准流程 | 設環境變數不等於可自動核准Atlas寫入 |
| C. 在VM接續既有六片建置／評測 | 需另作凍結資料安全遷移、路徑重綁與離線驗證；V6重試政策仍受原三次上限限制 | 不從空ledger或新Checkpoint目錄重新開始 |

**結論：需要主機設定盤點；B／C還需要目前workflow未提供的佈建與驗收。可以先部署相容程式、保持功能關閉，但不能直接以變數啟用當成完成上線。**

## 2. 實際架構與既有證據

```text
瀏覽器／LINE → nginx → Express（PM2）→ Atlas（QA／權限／狀態）
                            └→ 程序內Queue → 本機Python main.py
                                 或 batch_main.py → 子程序main.py
文字處理／原資料寫入／完成通知 → 選配upload_multimodal.py
  → 私有manifest／Checkpoint／bundle／ledger → 等待Atlas人工核准
  → Node CAS寫入器（另授權）→ 逐筆讀回 → processing.multimodal.ready
```

例：新影片先完成文字搜尋 → 三路向量尚未ready時仍走文字RAG → 獲准寫入及讀回後，才具備該影片融合資料條件；正式QA開關另判斷。

| 分類 | 程式／部署證據 | 主機查證邊界 |
|---|---|---|
| 目前已具備 | [workflow](../../../.github/workflows/deploy.yml)：push main觸發self-hosted runner，在`/opt/focusflow`拉程式、安裝Backend／short_render套件、build前端、PM2 restart、nginx reload | 不代表目前VM已部署此dev或使用相同PM2設定 |
| 目前已具備 | [video.service.js](../../../backend/src/services/video.service.js)、[批次程序](../../../backend/src/services/videoBatchProcessing.service.js)：本機spawn Python並繼承環境 | 不是獨立遠端STT Worker協定，也未見此路徑使用Redis／Celery |
| 目前已具備 | [Queue](../../../backend/src/services/videoProcessingQueue.service.js)為程序內陣列；[批次對帳](../../../backend/src/services/videoBatchReconciliation.service.js)讀磁碟manifest與DB狀態 | Queue記憶體不持久、每個PM2程序各一份；對帳不是全域排程器 |
| 目前已具備 | [上傳多模態](../../../STT_Whisper/src/upload_multimodal.py)、[Atlas人工寫入器](../../../backend/scripts/atlas-multimodal/upload.js)、[QA Bridge](../../../backend/src/services/multimodalQaBridge.service.js) | 自動核准與跨主機恢復仍須驗收 |
| 尚待確認 | 追蹤檔案中未見供此服務使用的Dockerfile／docker-compose／PM2 ecosystem；現有發布以PM2＋nginx為依據 | 不能推定VM沒裝Docker，亦不可自行改成容器部署 |

workflow另有依commit message觸發的正式Atlas QA探測，會建立session並實際問答；不可把它當無付費唯讀健康檢查，也不要為本輪文件工作觸發main發布。

前端仍使用[同來源`/api/v1`](../../../frontend/focus-flow/README.md)，無新增多模態金鑰或獨立服務網址；禁止放入VITE變數。LINE共用Backend QA，不另開多模態Webhook。

## 3. 必須補齊的執行環境

| 項目 | 需要的操作／設定位置 | 分類 |
|---|---|---|
| 發布內容 | 本機有未提交工具及診斷程式；先由Weihao審查納入可部署版本，記錄正式main SHA與退回SHA，不只部署dev檔案片段 | 必須調整 |
| Node／npm | 依[根環境需求](../../../README.md#環境需求)：Node 22.23.4以上22版或24.22.1以上24版、npm10以上；核對PM2／runner／Python子程序使用同一路徑 | 必須確認，版本不足才升級 |
| Python | [STT README](../../../STT_Whisper/README.md)要求3.10以上；建議沿用本機驗證的3.11，VM版本未知。於Linux建立`STT_Whisper/.venv/bin/python`，不可搬Windows venv | B／C必須調整 |
| Python依賴 | workflow沒有pip步驟；需另外依[requirements.txt](../../../STT_Whisper/requirements.txt)建置，保留套件版本清單。`google-genai`本機驗證1.70.0，requirements僅下界；PyAV必須`>=11,<19` | B／C必須調整；建議鎖定已驗證版本 |
| FFmpeg | 原Pipeline支援`FFMPEG_BINARY`；但上傳三路程式呼叫無參數`resolve_ffmpeg_binary()`，實際依PATH或imageio-ffmpeg，不可只設變數就宣稱有效。需實測音訊PCM、畫面libx264輸出 | B／C必須調整 |
| STT模型／算力 | 新上傳仍需Whisper模型可讀、記憶體／CPU足夠；沿用WHISPER_MODEL_SIZE／DEVICE／COMPUTE_TYPE，是否有GPU及模型快取須現場確認 | 尚待確認 |
| Python選擇 | Backend先找同repo `.venv/bin/python`，不存在才fallback `python3`；沒有通用`PYTHON_BINARY`設定。`RECUT_PYTHON`只屬短影片，不控制本路徑 | B必須確認 |
| Node子程序 | Python人工Atlas接續使用`NODE_BINARY`或PATH的node；需絕對路徑與服務帳號執行權，不沿用開發者PowerShell activate.ps1 | B必須調整 |

以下是Weihao在獲准後於VM執行的**唯讀範本，本輪未執行**；版本檢查不啟動服務或模型：

```sh
cd /opt/focusflow
node -v
npm -v
STT_Whisper/.venv/bin/python -V
STT_Whisper/.venv/bin/python -m pip check
ffmpeg -version
nproc
free -h
df -h /opt/focusflow
curl --fail --silent http://127.0.0.1:4000/health
```

以PM2實際服務帳號核對exe路徑、cwd、instances／exec_mode、kill_timeout與重啟策略；不要把`pm2 env`、`pm2 jlist`完整輸出或`.env`貼進交接，裡面可能含憑證。帳號與sudo限制沿用[部署排錯](../../10_Operations/deployment/部署與連線排錯.md)。

## 4. 必要環境變數與載入順序

只列名稱與用途。安全配置由維運在VM私有env／secret store完成，依服務身分給最小權限；不覆蓋整份`.env`，不在Git、shell歷史、CI log輸出真值。

| 變數 | 用途／安全配置方式 |
|---|---|
| `GEMINI_API_KEY` | Backend QA與Worker模型憑證；私下確認project ID／number、模型配額及帳務，禁止傳Key。兩個程序來源需一致且可追溯 |
| `GEMINI_EMBEDDING_MODEL_NAME`、`GEMINI_EMBEDDING_OUTPUT_DIM` | 既有文字契約使用gemini-embedding-2／3072；上傳三路Adapter模型與維度另在程式固定，不能靠變數切模型 |
| `QA_VECTOR_SEARCH_MODE`、`QA_QUERY_EMBEDDING_PROVIDER` | A的Atlas／Gemini查詢模式；workflow已傳入，但當次PM2有效值仍需核對。一般真實問答會產生付費Query，旗標關閉也不等於零費用 |
| `QA_ATLAS_VECTOR_INDEX_NAME`、`QA_ATLAS_FILTER_MODE`、`QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_JSON` | 沿用workflow的索引、bridge_course_or_video及完整text_v2契約，不手改部分欄位。契約全文見workflow |
| `QA_MULTIMODAL_FUSION_ENABLED` | 預設false；workflow未顯式設定，PM2舊環境可能保留，須私下確認。開啟需全量覆蓋與正式驗收，部署本身不授權啟用 |
| `QA_VISUAL_RETRIEVAL_ENABLED` | 舊影像補充檢索，與新三路不同；融合開啟時由程式停用舊補充路徑，不藉此開啟新功能 |
| `UPLOAD_MULTIMODAL_MODE` | 未設定時不接新階段；fake-sdk僅隔離測試，gemini僅在付費授權後。這不是QA開關，也不是Atlas自動寫入許可 |
| `UPLOAD_MULTIMODAL_ALLOW_PAID` | 必須明確true才容許新上傳三路真實呼叫；預設保持未設定／false，不能因部署自動開啟 |
| `UPLOAD_MULTIMODAL_STORAGE`、`UPLOAD_MULTIMODAL_LEDGER` | 真實模式要求已存在的絕對私有儲存根目錄與原共用帳本檔。範例規劃根目錄可用`/srv/focusflow-private/multimodal`，不是已佈建路徑 |
| `UPLOAD_MULTIMODAL_ATLAS_ACCEPTANCE`、`NODE_BINARY` | 前者僅開發驗收接續人工Node計畫，正式自動寫入政策未啟用；後者指定Node執行檔。保持前者關閉，直到另授權驗收 |
| `ENABLE_GEMINI_EMBEDDING`、`ENABLE_GEMINI_VIDEO_EMBEDDING` | 既有文字／舊影片Embedding流程；STT範例檔兩者為true，不可直接整份複製啟動。第二個不是新三路模式開關 |
| `GEMINI_EMBEDDING_BATCH_SIZE`、`GEMINI_MAX_RETRIES`、`GEMINI_RETRY_SLEEP_SEC` | 原文字Pipeline參數，不是新三路共用重試政策。新Adapter仍採3次歷史上限、失敗先停，不能用這些變數清除限制 |
| `MONGODB_URI`、`MONGODB_DATABASE_NAME` | 服務端私有連線設定；原上傳Pipeline本來就會寫文字／processing metadata，不能因三路向量未核准就稱整條Pipeline唯讀 |
| `BACKEND_URL`、`PROCESSING_WEBHOOK_SECRET` | Worker回報；Backend spawn目前強制同機localhost及focusflow DB，secret需兩邊一致。遠端Worker不是只改網址即可使用 |
| `VIDEO_PROCESSING_CONCURRENCY`、`VIDEO_BATCH_PIPELINE_ENABLED`、`VIDEO_BATCH_RECONCILE_INTERVAL_MS` | 程序內單片並行、是否批次、manifest對帳。初期單片並行1；批次開關需前後版本一致，不自行翻開 |
| `BATCH_MAX_CONCURRENCY`、`BATCH_ITEM_MAX_RETRIES` | 批次子程序初期1／0，避免原Pipeline重跑增加模型成本；不是全主機或全專案限制 |
| `FFMPEG_BINARY`、`WHISPER_MODEL_SIZE`、`WHISPER_DEVICE`、`WHISPER_COMPUTE_TYPE` | 原處理環境；FFmpeg新階段的PATH限制見上節 |
| `UPLOAD_DIR`、`CLEANUP_AFTER_UPLOAD`、`CLEANUP_KEEP_CHECKPOINTS` | 原片與文字暫存；Backend spawn強制cleanup=true／keep=false，VM env不能覆蓋這兩個child override。保留策略須按程式核對 |
| `HIERARCHICAL_RETRIEVAL_ENABLED`、`HIERARCHICAL_RETRIEVAL_ROLLOUT_MODE`及其allowlists | 分層為另一驗收範圍；Parent建立、寫入與開關都需獨立確認，不因三路部署一併啟用 |

來源：[Backend範例](../../../backend/.env.example)、[STT範例](../../../STT_Whisper/.env.example)、[config](../../../STT_Whisper/src/config.py)、[上傳三路](../../../STT_Whisper/src/upload_multimodal.py)。新增UPLOAD_MULTIMODAL_*尚未完整列入範例檔，不能只比對範例就認定設定齊全。

載入順序：Backend dotenv預設不蓋程序環境；[child環境](../../../backend/src/services/sttProcessLifecycle.service.js)繼承PM2，僅移除空GEMINI_API_KEY，非空值會優先於STT_Whisper/.env。STT dotenv亦不override。六片歷史run_video1_batch反而強制backend/.env優先；新evaluation batch只沿用程序環境。需由Weihao比對來源及project映射，不輸出任何Key。

## 5. 持久儲存、遷移與備份

**B必須：**服務專用持久磁碟，Checkpoint／ledger不能放`/tmp`、容器可丟棄層或前端dist；不置於nginx可讀的uploads，禁止公開下載。POSIX真實模式會檢查root與ledger不得開放group／other權限，目錄0700、檔案0600是建議起點；所有子目錄、備份與服務帳號也須核對。

| 資料 | 現有位置／保留範圍 | 遷移注意 |
|---|---|---|
| 原片與文字恢復資料 | backend UPLOAD_DIR、STT_Whisper/data/outputs/runs、outputs/batches、batch_requests | 確認原片清理／YouTube儲存政策，不因文字完成立即移除多模態所需來源 |
| 新上傳世代 | STORAGE下`mode/courseId/videoId/manifestHash/`：manifest、progress、state、切片、bundle、worker.lock與Atlas journal | Checkpoint另在該video目錄的`checkpoints/`，不能只備份manifestHash子目錄 |
| 成本與重試歷史 | 原`.local-tools/multimodal-gemini/cost-ledger.json`、同目錄controlled-retry-permits | 必須完整原樣接手，不能建立空帳本、退款未知預留或沿用多份可寫副本 |
| 既有六片原生向量 | `.local-tools/gemini-small-sample/gemini/checkpoints`；V1 video1-build、V2～V6 multimodal-build | 含私密教材／向量，只能安全離線傳送，不隨GitHub部署 |
| 寫入證據 | 當次before-image、plan、approvalHash、intent、receipt、讀回與索引快照 | 連同版本與checksum備份，不能只保留成功bundle |

[.gitignore](../../../.gitignore)明確忽略`.local-tools/`與env；目前沒有把這些資料同步VM的workflow。因此**已證明是本機私有成果，尚未證明雲端有副本**。僅A不必搬；若B使用共用US$20預算，必須先遷移原帳本，且停止本機與其他付費writer。

安全遷移順序：停所有writer → 保存SHA／帳本數值／Checkpoint清單及來源hash → 加密傳輸到受限暫存 → 校驗checksum與ACL → 指定唯一付費執行者 → 離線驗證重用／失敗拒絕 → 備份恢復演練後才另請付費授權。活躍.lock不可複製成新owner；也不可直接刪除不明鎖，先查原程序／intent。

C另有阻塞：六片與評測工具預設ledger／Checkpoint仍固定repo `.local-tools`，UPLOAD_MULTIMODAL_LEDGER不會重導所有工具。可規劃持久磁碟bind mount於該既定目錄；不要假設symlink可通過工具的resolve／private-path檢查。舊manifest含Windows絕對切片路徑，直接改JSON會使核准hash／state失效；需保留前像、另審路徑重綁與新計畫，離線證明向量簽章可重用，不能靠重新Embedding解決。原片與凍結STT產物也必須hash相符。

**建議調整：**定期快照與獨立加密備份、設定RPO／RTO與保留期，備份涵蓋所有成功／失敗紀錄、版本與索引；切片／全文可能多份重複，監控磁碟bytes與inode。現有uploadStorage是主機／磁碟預約，不是多模態磁碟容量保證或跨Worker儲存API。

## 6. Worker、Queue與成本保護

- **B初期必須單一付費writer。** PM2多instances各有Queue，設定concurrency=1不等於全域只有一個；批次另有自己的並行度，兩條入口需合併管控。
- ledger以排他建立`.lock`包住單次呼叫及原子寫檔；新上傳另以worker.lock保護同世代。只在同一實體檔案與具排他建立／原子rename語意的持久檔案系統才有效。物件儲存不能直接當可寫檔案系統；未驗證的網路磁碟不能宣稱跨主機安全。
- batch `.execution.lock`用本機PID判斷owner，跨主機無全域PID存活判斷；現有Backend running map亦在記憶體。**多主機／多容器正式並行需另補分散式排程／租約設計與驗收，本輪不新增架構。**
- US$20是Adapter累計保守預留，不是Google帳單或雲端服務商硬上限；既有STT文字Embedding等其他呼叫路徑不全受此ledger保護，不可把整個帳戶都稱為20美元封頂。
- [main.py](../../../STT_Whisper/src/main.py)文字完成與回報後才進多模態；新階段例外會被獨立捕捉，程序可exit0，因此Queue結束／processing.completed不表示multimodal.ready。監控需讀processing.multimodal.status及progress，而不只看exit code。
- Backend spawn沒有此路徑的總任務timeout，batch subprocess.run亦未指定timeout；Adapter單次預設30秒、FFmpeg probe 30秒／切片180秒。PM2 kill_timeout、服務重啟、CPU／記憶體限制與nginx上傳timeout都要現場核對，不把HTTP proxy timeout當背景任務期限。
- 新上傳每10個Chunk保存批次，但成功請求之間目前沒有可配置的節流間隔；GEMINI_RETRY_SLEEP_SEC不控制此迴圈。真實自動處理前必須補上已驗證的限速／暫停策略並對照實際專案RPM／TPM，單writer與成本鎖本身不保證不觸發429。
- 原文字cleanup發生在多模態之前，會刪部分STT暫存；新多模態儲存另有根目錄，不應被通用清理涵蓋。必須實測同片世代、pause／cancel、重啟及來源已清理時的行為。
- resume使用`upload_multimodal.py --resume <世代目錄>`，需相同MODE／STORAGE／LEDGER、目前DB世代與來源hash，且會更新processing metadata；不是唯讀健康檢查。不得用main.py重跑整片作多模態resume。

## 7. Atlas與功能開啟的安全邊界

A使用現有text_embedding_index的stableTextEmbedding／audioEmbedding／visualEmbedding，3072維cosine；保留embedding及courseId／videoId filters。不得建立第四個索引、重建或縮小原集合。當次檢查三個既有索引的所有節點READY／QUERYABLE、無staged；歷史成功快照不能代替正式VM當次觀察。

A的檢索身分需指定資料與索引查詢權限；原Backend另有一般應用寫入用途，不能直接替換整個帳號使其他功能失效。人工CAS工具另需find／update／listSearchIndexes及權限快照查證能力，限既定DB／集合，不因工具可讀回就授予索引變更／刪除權。Atlas IP allowlist、VM出站DNS／TLS、角色與服務身分由Weihao確認，禁止以啟動Mongoose autoIndex驗索引。

[upload.js](../../../backend/scripts/atlas-multimodal/upload.js)會綁定影片owner／fileHash／世代／完整Chunk allowlist，備份重讀、當次approvalHash、CAS、intent／receipt與最終讀回。未給核准只建立本機計畫；給錯hash拒絕；未知結果不自動重送或回復。Python的atlas-approval.json是人工一次性許可，不能由排程服務自行填入；正式自動核准政策尚未啟用。

維持QA_MULTIMODAL_FUSION_ENABLED關閉，直到完整課程覆蓋、正式評測及授權。未Ready新上傳時QA跳過融合走原文字；未完整stable覆蓋時Bridge替換文字路／必要時全文字回退，並維持原課程／影片授權與逐字稿證據。FAQ證據版本包含融合／分層設定，不能靠清全部FAQ代替回歸。來源：[qa.service.js](../../../backend/src/services/qa.service.js)、[readiness](../../../backend/src/services/multimodalReadiness.service.js)、[旗標](../../../backend/docs/feature-flags.md)。

## 8. 部署前與部署後驗收

### 部署前（Weihao確認後逐項留證據）

- [ ] 指定A／B／C範圍、正式commit與退回版本；核對本機未提交工具是否已正式納入，不能假設main已有。
- [ ] 唯讀核對VM帳號、PM2 cwd／exec／instances／kill_timeout、Node／Python／FFmpeg與套件、模型快取；確認不是不同PATH的系統Python。
- [ ] 核對非敏感有效設定與Key所屬project映射；Google配額／帳務阻塞解除前，所有新付費開關保持關閉。
- [ ] B／C完成持久路徑、ACL、單writer、原ledger遷移與hash驗證；保留原Checkpoint與permit，不啟動空帳本。
- [ ] 核對原片保留／清理、剩餘磁碟與備份恢復；確認部署重啟時沒有上傳／付費／CAS任務在途。
- [ ] Atlas查詢／人工寫入身分、IP allowlist、既有索引與實際容量／告警當次查證；任何寫入另取精確計畫授權。
- [ ] workflow缺的Python／儲存佈建另安排；前端同來源build與QA契約檢查通過，功能旗標保持關閉。

### 部署後（依授權分層，不直接跑付費驗收）

1. **無付費檢查：**主機內`/health`與管理員system-status，確認DB、QA契約及venv／Queue；health.runtime.multimodal目前仍描述舊video_segments_video影像路徑，其readyForQa與setupCommand不是新三路驗收；不得照setupCommand重建索引。現有health的readyForAsk不是多模態資料／儲存／帳務保證，亦不能由venv檔案存在推論FFmpeg／SDK可用。[health路由](../../../backend/src/routes/health.routes.js)、[runtime](../../../backend/src/services/runtimeDiagnostics.service.js)、[系統狀態](../../../backend/src/services/systemStatus.service.js)。
2. **隔離Mock驗收：**重用test_upload_multimodal.py、Backend atlas-preparation.script.test.js與multimodal-qa.integration.test.js；新上傳首次三路、重播零新增SDK、無核准零向量寫入、CAS衝突／讀回失敗停止、未Ready回退。Fake不得寫正式DB或當正式品質。
3. **唯讀Atlas驗收：**另用既有保存Query、記憶體應用狀態的video1-qa.js，核對三路Top20／RRF／原字稿／來源時間與撤銷授權；self-query與Template接線、正式Gold成效分開。不要用一般HTTP問答當零費用檢查；它可能呼叫模型及寫FAQ／用量。
4. **受控真實新上傳：**僅另獲模型與資料寫入授權後，以一支可辨識測試來源完成文字→Checkpoint→等待核准→CAS→讀回→QA；另演練restart／resume、斷線／換機、備份恢復、重複排程、磁碟不足。未做過就標未驗收。
5. **正式開啟與退回：**正式Gold、分層與第11項門檻通過並獨立審查後才請開旗標；異常先按授權關閉融合／停止新付費writer，保留成功資料與receipt，不自行rollback Atlas或刪索引。既有文字／FAQ／LINE回歸須保留。

## 9. 成本、監控與Weihao待回覆

**新增成本：**新上傳每Chunk最多三路模型請求、音軌與畫面切片CPU／磁碟、私有Checkpoint／bundle／多份備份、Atlas資料與Search用量，以及QA查詢向量／回答費。API價格與帳務須當次查證；本文件不估VM月費或宣稱Free Atlas容量足夠。已保存向量不因部署重建。

**建議監控：**磁碟可用量／inode、程序RSS／CPU、Queue等待與最久任務、stopped／awaiting_atlas_approval／ready數量及滯留時間、ledger預留與新attempt、429安全diagnostics、鎖齡、CAS衝突／未知結果、備份校驗與Atlas告警。log僅保留安全白名單，私有全文與憑證不進PM2／CI分享輸出。

Weihao需要提供的非敏感確認：①正式main SHA與服務拓樸／程序數；②實際Node／Python／影音工具及服務PATH；③持久磁碟、ACL、備份與單writer方案；④Google project／模型配額／帳務狀態；⑤Atlas角色、IP、索引及容量；⑥原片清理與重啟恢復策略；⑦人工approval責任人及正式驗收窗口。這些本輪均未登入查證；現有未完成資料／API／正式品質門檻只以[狀態正本](../../current-status.md)接續。
