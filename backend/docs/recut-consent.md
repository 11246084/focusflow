# recut 同意紀錄、撤回與 PoC 條款

本文件說明授課內容、原音偏好、肖像與聲音複製的版本化同意，以及失敗後可恢復的撤回流程。介面供上傳、教師審閱與產片工作使用；功能進度見[目前狀態](../../docs/current-status.md)。

## PoC 條款草稿

版本：`recut-poc-2026-11-01-v1`。實際 API 文字以 [recutConsent.js](../src/constants/recutConsent.js) 的 `TERMS` 為準；改文字時須更換版本，不能把舊紀錄改成接受新版。

**FocusFlow 教師授課內容與短片使用同意（PoC）**

這是校內概念驗證版條款，不代表已完成法律審查或保證足以涵蓋所有使用情境。試跑教授影片另以書面同意為依據，由團隊明確補登。

1. **授課內容**：上傳前，請確認您有權提供這份授課內容，並同意系統處理影片、產生逐字稿與向量資料供教學問答，也可剪輯或改寫授課內容製作短片。短片須經教師審閱，可上傳系統共用 YouTube 帳號，設為不公開連結，並提供學生短片牆觀看；持有連結者仍可能轉傳。不同意時不能上傳。此項不包含使用您的原音、肖像或聲音複製。
2. **原音與合成語音**：生成 recut 時，您可選擇使用自己的授課原音，或選擇不使用原音的合成語音版。系統第一次詢問後記住您的選擇，之後會顯示並允許改選。合成語音版可能改寫授課內容為旁白，片中標示「AI 合成語音」；未就緒時會明確告知，不會改用您的原音。
3. **肖像**：數位分身另外需要您的肖像使用同意，影像由地端模型處理。這與授課內容同意、原音選擇及聲音複製同意分開記錄；不同意時不能選擇需要您肖像的產片方式。
4. **聲音複製**：數位分身的聲音複製另行取得同意，聲音複製由地端模型處理。提供授課影片或同意使用原音，不代表同意複製聲音。
5. **處理服務**：recut 的選段、文字與圖卡檢查會把必要授課內容交給外部 Gemini 服務處理。合成語音採本機 Kokoro 模型與 sherpa-onnx 執行，不把合成語音文字送到外部語音服務，不需您的參考音。
6. **撤回與下架**：您可改選或撤回同意，系統保留誰在何時同意或撤回哪版條款的紀錄。撤回後禁止需要該同意的新工作，並停止處理中的工作。已完成短片列出供您逐支勾選或全選，預設不勾選；選中的短片從學生短片牆移除、未上架工作取消，系統盡力將 YouTube 影片轉私人。失敗時每位管理員會收到通知，並保留待手動下架項目。已被他人下載或轉傳的影片無法收回。

草稿參考[中山大學課程授權範本（勤益科大公開附件）](https://oaa.ncut.edu.tw/var/file/9/1009/attach/24/pta_51174_2991748_73187.pdf)附件二第 9 頁的授權內容、改作及權利來源項目，以及[清大研究倫理教學說明](https://rec.site.nthu.edu.tw/p/405-1233-205365%2Cc11249.php?Lang=zh-tw)中分別取得資料與肖像使用授權、說明撤回條件的寫法；沒有套用範本的不限時間、地域及 CC 授權。YouTube 不公開連結可被取得連結者觀看及分享，依[官方隱私設定說明](https://support.google.com/youtube/answer/157177)。本輪於 2026-11-02 實際開啟並閱讀上述 PDF 附件與兩個官方網頁；它們僅支持草稿寫法及平台分享行為，並非本系統法律適足性的判定。非作者條款審查由整合工作安排，與本地程式測試分開回報。

## 同意範圍與 API

所有端點需現有登入驗證。課程端點只允許該課程教師及管理員；學生、其他教師不能查詢或修改。服務從目前 Course 取得教師，不採信呼叫者指定的其他教師身分。聲音及分身偏好可由該教師自己的任一課程管理，內容同意只在指定課程／來源生效。

| kind | choice | 有效範圍 |
|---|---|---|
| `content` | `granted` / `declined` | 課程；可再限 `videoId` 或 `sourceId` |
| `voice` | `original` / `synthetic` | 教師全域，首次選擇後保存、可改選 |
| `avatarLikeness` | `granted` / `declined` | 教師全域，單獨肖像同意 |
| `voiceClone` | `granted` / `declined` | 教師全域，單獨聲音複製同意 |

撤回以獨立端點新增 `withdrawn` 紀錄。`videoId` 為影片文件 ObjectId，`sourceId` 為原影片的 `videoId` 來源識別；兩者解析到同一影片，必須存在且屬於該課程。未指定影片的內容同意涵蓋該課程；只指定影片的同意不授權整門課或其他課程。

以下路徑相對於 `/api/v1`，掛載與 OpenAPI 由整合分支接入。

| 方法與路徑 | 用途 |
|---|---|
| `GET /recut-consent/terms` | 取得版本及完整 PoC 條款 |
| `GET /courses/:courseId/recut-consent` | 讀目前有效同意、`voiceMode`、`syntheticReady` |
| `POST /courses/:courseId/recut-consent` | 新增同意／改選；必填 `kind`、`choice`、`requestId`、`termsVersion` |
| `GET /courses/:courseId/recut-consent/withdrawal-assets?kind=voice` | 列相關成品，每支 `selected:false`、`selectAll:false` |
| `POST /courses/:courseId/recut-consent/withdrawals` | 新增撤回；明確提供 `selectedAssetIds` 或 `selectAll:true`，兩者不能並用 |
| `POST /courses/:courseId/recut-consent/withdrawals/:withdrawalId/retry` | 重試已持久化工作，不新增撤回紀錄 |
| `GET /admin/recut-consent/manual-actions` | 僅管理員可列轉私人失敗的待辦 |

內容／來源查詢可帶 `videoId` 或 `sourceId`。管理員代登可帶文字 `evidenceRef` 指向書面同意的登記編號，禁止放入書面文件本體或秘密。教師不能代登這個欄位。相同 `requestId`、相同輸入重送不重複新增；同鍵不同輸入回 `409 RECUT_CONSENT_IDEMPOTENCY_CONFLICT`。過期條款版本回 `409 RECUT_CONSENT_TERMS_OUTDATED`。

例：教師在 A 課程選原音 → `voiceMode:original`，到自己 B 課程仍讀到原音偏好；A 的內容同意不因此授權 B。改選合成語音 → 保存 `synthetic`，目前內部產片 gate 回 `503 RECUT_SYNTHETIC_VOICE_NOT_READY`，不使用教師原音；傳入 `syntheticReady:true` 也不能繞過。

`assertConsentForWork({courseId, videoId?, sourceId?, contentOnly?, voiceMode?, avatar?})` 為內部 gate：上傳檢查 `contentOnly:true`；原音 recut 要內容及 `voice:original`；數位分身另要肖像與聲音複製。舊 `ShortAsset.consentConfirmed` 只是歷史上架揭露欄位，不能推定任何新同意。生成、佇列、worker、發布前都須由各入口再次使用 gate，避免只在選模式時檢查。

## 演算法與恢復界線

對應 [service](../src/services/recutConsent.service.js)、[repository](../src/services/recutConsent.repository.js) 與 [model](../src/models/recutConsent.model.js)。採用「教師文件的 revision 比對更新（CAS）＋持久化動作清單」，解決同時改選、重送請求、程序重啟遺失下架通知等問題。CAS 是更新時要求資料版本仍和讀取時一致，競爭失敗就重新讀取再試；不是只用記憶體鎖。

1. 驗證操作者、目前課程教師與來源；按 `kind` 決定課程或教師範圍。
2. 每位教師一份 `recutconsents` 文件，保存 `revision`、只新增的 `records` 與 `withdrawals`。同意紀錄包含操作者、教師、範圍、選擇、條款版本、伺服器時間與選填書面依據。
3. 同意／改選用 `$push` 追加，CAS 失敗最多重試 30 次，仍衝突回 409。`teacherId` 的唯一 index 是首次併發建立文件的必要條件；**沒有授權不得在共用 Atlas 建 index 或用啟動 server 的 autoIndex 代替**。
4. 撤回先取得適用成品並凍結教師選單；撤回紀錄與動作清單在同一次 CAS 寫入，然後執行副作用。新的 gate 立即看見 `withdrawn`。預設沒有成品選取，仍停止處理中的相關工作。
5. 每個撤回取得具 token、期限的持久租約，執行 `stopWork`、所選成品的 `archiveAsset` 與 `makeYouTubePrivate`。完成狀態逐步保存，已完成動作不重跑。未完成且租約逾期的工作可由新程序恢復。
6. 轉私人失敗先留下 `manualActionRequired`，列舉所有管理員並先持久保存收件人及通知 outbox（尚待送出的動作），再逐位通知。列舉／通知失敗保留待重試，不把失敗當成成功。轉私人重試成功才清除該待辦；已完成通知不重送。

輸入為明確同意或撤回選擇；輸出為有效決策或可恢復的撤回工作。替代方案是每次覆寫單一布林值或在記憶體排下架，但會丟失改選歷史，且程序重啟可能遺失後續動作；目前以單一教師文件避免跨集合交易需求。

### 生命週期轉接契約

`configureLifecycle(adapter)` 須提供下列全部方法，缺少時拒絕配置；未配置的撤回回 503。這些方法由整合分支串現有 ShortScript、RecutTask、ShortAsset、YouTube 與通知服務。

| 方法 | 必要行為 |
|---|---|
| `listAssets(scope)` | 只列相應教師及同意範圍的成品 |
| `stopWork(scope, context)` | 取消尚未發布工作，讓進行中的工作停止；處理中 gate 仍需複查 |
| `archiveAsset(assetId, scope, context)` | CAS／冪等更新為 `archived`，從學生牆移除 |
| `makeYouTubePrivate(assetId, scope, context)` | 有 YouTube ID 才轉私人，失敗必須拋錯；不得只記 log |
| `listAdmins()` | 列出所有有效管理員，不只第一位 |
| `notifyAdmin(adminId, payload, context)` | 每位一則，按 `context.operationId` 持久化去重 |

`scope` 的內容同意含教師／課程／影片來源；其他同意為教師全域，`courseId/videoId/sourceId:null`，不可誤當成只處理某一課程。`context.operationId` 在重試或重啟後保持相同；轉接層須自行持久去重。外部動作成功後、儲存完成前可能中斷，重試可再次呼叫相同動作，因此不能宣稱外部副作用「恰好一次」。租約也不能阻止已超時的網路請求繼續執行，需搭配轉接層的 CAS／冪等。

限制：歷史與動作放同一教師文件會持續增加，受 MongoDB 16 MiB 文件限制，未實作長期分區或封存；API 不提供刪除或改寫同意歷史。待辦未完成時拒絕同種類別的新改選，避免尚未停止的舊工作被重新允許；這個保守規則也會擋住其他課程同種類別的改選。合成語音偏好可保存，但 RC12 未就緒時產片固定拒絕。UI、正式服務掛載、上傳與發片 gate、管理員頁及真實外部行為須另以整合證據判定，不能由本文件或測試通過推定。

## 書面同意補登

[補登腳本](../src/scripts/recutConsentBackfill.js) 不匯入 dotenv、不連 Mongo，CLI 永遠 dry-run。輸入為明確 JSON 陣列，每筆需 `teacherId`、`courseId`、`kind`、`choice`、穩定 `requestId` 與不含秘密的 `evidenceRef`；`videoId`／`sourceId` 選填。

```json
[{"teacherId":"000000000000000000000001","courseId":"000000000000000000000003","kind":"voice","choice":"original","requestId":"paper-A-voice","evidenceRef":"教授書面同意 登記A"}]
```

在 `backend/` 執行：

```powershell
node src/scripts/recutConsentBackfill.js D:/AI-workspace/consent-evidence-plan.json
```

輸出 `dryRun:true`、`writes:0` 與會寫入的計畫，不由歷史 `consentConfirmed` 推定原音、肖像或聲音複製。內容、原音、肖像、聲音複製各需獨立明確條目。

實際補登只開放程式介面 `runBackfill({entries, service, user, dryRun:false, authorized:true, target:'isolated-local'})`，須另行授權、管理員及注入的隔離服務；其標籤不是資料庫連線檢查，呼叫端仍須保證注入服務只連已授權隔離資料庫。**不提供共用 Atlas 執行指令，也未對 Atlas 執行補登。**

## 可重跑的本地驗證

先依根 README 檢查 Node 版本。使用現有依賴；測試前載入 [noDotenv preload](../tests/fixtures/recutConsentNoDotenv.cjs)，阻止應用程式開啟 dotenv 檔案。若此 worktree 未安裝依賴，可明確將 `NODE_PATH` 指到主 repo `backend/node_modules`，不改其內容。

```powershell
node --require ./tests/fixtures/recutConsentNoDotenv.cjs --test --experimental-test-isolation=none --test-concurrency=1 tests/recutConsent.service.test.js tests/recutConsentBackfill.test.js tests/recutConsent.routes.test.js
```

service 14 例涵蓋同意／撤回／租約與通知恢復；補登 2 例驗證零寫入與 fake repository 冪等；HTTP 5 例使用真實 Express 路由、假的身分及資料庫，並非正式登入 E2E。

[Mongo 測試](../tests/recutConsent.mongo.test.js) 固定只連 `127.0.0.1:27031`，以隨機 `recut_consent_test_*` 資料庫建立必要 index，不啟用 autoIndex；需先備妥專用本機 Mongo，再明確開啟測試。它以兩個獨立 Node 程序競爭同一教師，驗證 16 筆紀錄沒有遺失，並驗證完成／待辦混合資料的恢復、通知與手動待辦。

```powershell
$env:RECUT_CONSENT_LOCAL_MONGO_TEST = '1'
node --require ./tests/fixtures/recutConsentNoDotenv.cjs --test --experimental-test-isolation=none --test-concurrency=1 tests/recutConsent.mongo.test.js
```

沒有 opt-in 時該測試明確 skip；不會退回其他資料庫。測試資料留在專用本機容器，不會自動刪除任何共用資料。測試使用假的 YouTube／通知動作，沒有驗證 Atlas、VM、YouTube、Gemini、LINE、實際合成語音、正式部署或教師人工驗收。
