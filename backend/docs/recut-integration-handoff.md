# recut 前端串接交接草稿

這份草稿讓前端工程師把教師從上傳、同意、產稿、修改、審核到學生觀看串成可理解的流程。請先依目前 API 與狀態接線，再用實際瀏覽器與教師操作驗證；後端仍在整合及獨立審查，本文不代表正式驗收。進度只看[目前狀態](../../docs/current-status.md)，完整欄位與回應以 [OpenAPI](openapi.yaml) 和目前程式為準。

## 2026-11-04 試產查核快照

授權教授原片已在本機完成 bootstrap；24 句中首尾截斷句不可選。使用者自行遮蔽輸入金鑰後，單題流程實際呼叫 Gemini 三次，第三次選段成功；cards 第四次工作嘗試被本機 100,000 bytes 請求上限阻擋，沒有第四次 HTTP 呼叫，也沒有 MP4。`callsUsed=4` 不等於四次真呼叫；`5102638` 已縮小 cards 請求並保留選句原始 word／timing 與完整檢查；安全續跑已凍結並通過隔離複核，但教授資料的實際續跑結果尚未確認，已知尚無 MP4。這次試產不代表正式同意、部署或教師驗收。凍結來源 backend 全套 1,682 項、1,680 通過、2 跳過、0 失敗；跳過及隔離 Mongo 證據；進度與明細看[目前狀態](../../docs/current-status.md)。

## 接手前先知道

- 本輪沒有修改正式前端。RC10 決策 #78 規定開關關閉時上傳仍先檢查內容同意；現有上傳頁未串接，缺少有效內容同意時會收到 409，因此不能直接部署 main。現有教師網頁仍是舊八拍流程，尚未接上 recut；接線時沿用既有版面，不自行新增上線故事；完整稿放在閱讀主畫面，逐句編修工具按需展開。使用者應看得懂「目前在做什麼、完成後做什麼」。
- 路徑均包含 `/api/v1`。登入及課程管理權限仍適用；短片自動化功能開關關閉時路由回 404，不能顯示成使用者沒有影片。成品與講稿是兩次不同的審核。
- `courseId` 是課程、`scriptId` 是短片腳本、`taskId` 是背景工作、`versionId` 是凍結講稿版本、`assetId` 是成品、`generationVersion` 是成品產生版次；`expectedRevision` 是當前腳本修訂號。都由後端回應取得，不在瀏覽器自行推算。
- 範例：教師在完整稿看到一句被略過的原話 → 加回草稿 → 套用後等待背景工作 → 新版完整稿重新審閱 → 核准講稿 → 等待成品 → 實際觀看 MP4 後核准；不是按一次按鈕就發布。
- 正式課程先取得內容同意再上傳。本機教授原片試產有獨立入口：[bootstrap 與單題試跑操作](../README.md) 分別使用 `src/scripts/recutBootstrapTrial.js` 和 `src/scripts/recutSingleTopic.js`；其輸入與限制以該操作說明為準。試跑資料不代表正式同意、課程建立、教師上傳或人工驗收。

## 共通畫面與回應規則

| 情況 | 前端處理 |
|---|---|
| 請求進行中 | 顯示目前動作、停用同一操作的重複按鈕；保留未送文字、勾選與仍在頁面記憶體中的 `File`。重新整理後瀏覽器可能要求重新選檔，不承諾可還原。 |
| `200`／`201` | 以回傳資料及後續 GET 更新畫面，不自行猜測狀態；上傳成功不等於影片處理或發布完成。 |
| `202` | 顯示排隊／處理中，保留 `data.id` 當 `taskId` 並查詢；離頁或重新整理可依腳本狀態恢復。 |
| `400`／`422` | 顯示可讀原因與修正位置，保留輸入；例如沒有可用候選、證據不足或選段長度不合。 |
| `401`／`403`／`404` | 提示重新登入、無課程權限或功能不可用；避免把 404 一律解讀成被刪除。 |
| `409` | 可能是舊版、忙碌、同意不足或來源已更新：顯示具體 `error.code` 對應訊息並重新讀取；保留未送內容供人工比對，不能把舊修改自動覆蓋新版。 |
| `503`／網路中斷 | 顯示服務或功能尚未就緒；先查目前狀態再決定重試，避免把已成功但回應遺失的寫入當作未送出。 |

成功與失敗外層格式、各狀態碼及參數詳見 OpenAPI；不要只靠 HTTP 連線成功就顯示完成。停止等待或關閉畫面不等於取消背景工作。取消 API 回應後仍要查工作是否進入終態。

## 1. 原片上傳與授課內容同意

起點是教師準備替一門課上傳原片，取得目前 `courseId`。先 `GET /api/v1/recut-consent/terms`（`getRecutConsentTerms`），顯示回傳條款，再 `GET /api/v1/courses/:courseId/recut-consent`（`getRecutConsent`）讀目前同意。教師明確同意後，`POST /api/v1/courses/:courseId/recut-consent`（`recordRecutConsent`）帶 `kind: content`、`choice: granted`、目前 `termsVersion`、此決定穩定的 `requestId`。同一決定與相同資料重送沿用同一 ID；改變內容要新的 ID。同鍵不同輸入回 `409 RECUT_CONSENT_IDEMPOTENCY_CONFLICT`，條款過期回 `409 RECUT_CONSENT_TERMS_OUTDATED`，重新讀取並請教師確認新版。

同意成功後，`POST /api/v1/courses/:courseId/videos`（`createVideo`）以 multipart `video` 上傳，`title` 選填；`201` 建立影片後，以 `GET /api/v1/videos/:videoId/processing` 查看處理。課程批次上傳為 `POST /api/v1/courses/:courseId/video-batches`，YouTube 來源是 `POST /api/v1/courses/:courseId/videos/youtube`，各自欄位依 OpenAPI。後端在建立資料前檢查內容同意；拒絕同意不能上傳。舊 TeacherUpload 尚未接新同意流程，直接上傳在缺少有效同意時會 409；不要只加假同意或沿用舊 `consentConfirmed`。同意記錄採獨立 API，不是憑上傳請求自行宣稱同意。

載入條款或上傳時顯示進度；409 顯示需確認內容並保留尚未送出的表單與檔案，處理失敗以實際錯誤和影片狀態引導重試。離開前提醒未送資料；一旦已送上傳，關閉畫面不表示後端已撤銷。

## 2. 選題、原音偏好與背景生成

從已有可用課程與來源開始，`GET /api/v1/courses/:courseId/short-scripts/candidates`（`listShortScriptCandidates`）唯讀列候選；`POST /api/v1/courses/:courseId/short-scripts/auto`（`createShortScript`）可依 schema 選 `topicKey`，201 建立腳本與凍結證據，保存 `scriptId`。無候選或證據不足時顯示原因及回到選題，不要宣稱已產稿；重複主題 409 時先查 `GET /api/v1/courses/:courseId/short-scripts`。

首次產生 recut 先讀該課程同意並顯示目前教師的 `voiceMode`；缺少時明確詢問 `original` 或 `synthetic`，再用同意 POST 的 `kind: voice`、選擇、`termsVersion`、穩定 `requestId` 記錄。這是教師全域偏好，其他課程也會顯示；每次生成前都要可見並可改選或撤回，內容同意仍按課程／來源區分。`syntheticReady` 為假時仍可保存選擇，但產片會 503；RC12 未開放時不可暗中改用原音。等待儲存時停用重送；成功後更新偏好，失敗保留選擇。

`PATCH /api/v1/short-scripts/:scriptId/production-mode`（`setShortScriptProductionMode`）帶 `productionMode: recut`；成功後 `POST /api/v1/short-scripts/:scriptId/recut/generate`（`startRecutGeneration`）不帶欄位或傳空物件。202 回 `data.id`，以 `GET /api/v1/short-scripts/:scriptId/recut/tasks/:taskId`（`getRecutTask`）查進度，並以 `GET /api/v1/short-scripts/:scriptId/recut`（`getRecutState`）讀目前狀態。不可在前端指定模型、額度、路徑或工作類型。

提供 `POST /api/v1/short-scripts/:scriptId/recut/tasks/:taskId/cancel`（`cancelRecutTask`，空 body）作取消要求，顯示「正在取消」直到查到終態；取消或失敗恢復原快照、已用額度不退。成功後進完整稿；失敗顯示原因與依狀態重試，503 缺少步驟／轉接或合成語音未就緒時不要自動連續重試。`RECUT_SOURCE_UPDATED` 需重新取得來源，不可把舊逐字稿當新來源。

## 3. 完整講稿、修改與建議

從 `script_review` 開始，`GET /api/v1/short-scripts/:scriptId/recut/review`（`getRecutReview`）回目前版 `fullScript/current`、逐句來源、草稿、建議與最近改動摘要。閱讀頁顯示完整講稿與來源；`draft.fullScript` 是未套用預覽，不能誤標已完成。依回傳版本、revision、句子及 warning 顯示，來源已更新時提示但不默默換原話；無法回答時顯示原因，不能核准。

- 加回／移除：`PATCH /api/v1/short-scripts/:scriptId/recut/selection`（`editRecutSelection`），帶 `versionId`、`expectedRevision`、`changes`，每項含 `sentenceId`、`action: add|remove`，`reasonLabel` 選填。200 更新草稿及長度；片頭移除要顯示 warning，不替教師換片頭。未套用草稿時停用核准；草稿可暫時超長，但套用須 30～65 秒。
- 放棄草稿：`POST /api/v1/short-scripts/:scriptId/recut/selection/restore`（`restoreRecutSelection`），帶當前 `versionId/expectedRevision`；200 全部復原，不刪歷史、不重跑。送出前清楚說明會放棄哪些草稿；失敗留在原畫面。
- 套用草稿：`POST /api/v1/short-scripts/:scriptId/recut/selection/apply`（`applyRecutSelection`）帶同一對版本及 revision；202 保存 taskId 並查任務。成功讀新版完整稿與摘要；取消／失敗保留原版及未套用修改。正在處理時不可再修改，取消依上節執行。
- 採納建議：`POST /api/v1/short-scripts/:scriptId/recut/suggestions/apply`（`applyRecutSuggestions`）帶同一對版本及 revision、`suggestionIds`；需要推翻鎖定選段時另明確確認 `confirmedSelectionChangeIds`，`reasonLabel` 選填。202 後查任務並讀新版；採納紀錄不代表背景任務成功。未選建議會記為未採納，不要讓教師誤以為只隱藏了它們。

修改原話或順序必須重新核准講稿；純呈現新版可沿用講稿核准，但新 MP4 一律重審。409 時保留本機未送改動，重新讀 review 並讓教師比對後重新操作；不可拿舊 revision 強送。

## 4. 講稿核准、渲染、成品審核

起點是目前版本可回答、沒有待套用草稿或執行中工作。教師看完整稿後，`POST /api/v1/short-scripts/:scriptId/recut/approve-script`（`approveRecutScript`）帶 `versionId/expectedRevision`；200 後以新 revision 更新畫面，進 `script_approved`。核准只確認講稿，不代表產片或發布。若 409 重新讀取並重審變動；關閉確認視窗可取消尚未送出的操作。

`POST /api/v1/short-scripts/:scriptId/recut/render`（`queueRecutRender`）帶目前版本及 revision，成功排入 `render_queued`，再由 worker 處理。輪詢 recut state；`render_failed` 顯示失敗與可重新送 render 的動作，避免不停自動重試。沒有契約說明此階段有教師取消端點，不要把離頁說成取消。完成進 `asset_review`，用 `GET /api/v1/shorts/:shortAssetId`（`getReviewShortAsset`）讀成品；老師應觀看當前 MP4，再決定。

- 核准：`POST /api/v1/short-scripts/:scriptId/recut/approve-asset`（`approveRecutAsset`）帶 `versionId/expectedRevision/assetId/generationVersion`。200 表示精確成品已核准；先取得的 YouTube ready 與此核准都成立，後端才發布。相同目前成品的核准重送可補齊部分提交；仍先查當前狀態。
- 退回：`POST /api/v1/short-scripts/:scriptId/recut/reject-asset`（`rejectRecutAsset`）帶同樣識別資訊、`scope: presentation|content` 與非空 `reasons`。呈現問題回 `script_approved`，內容問題回 `script_review` 並撤銷講稿核准；成品核准撤銷、舊資產移出目前引用。此操作不是取消對話框能復原；新 MP4 要重新觀看核准。
- 審閱計時：`POST /api/v1/short-scripts/:scriptId/recut/review-time`（`recordRecutReviewTime`）；start 帶 `versionId/expectedRevision/action/phase`，stop 帶原 `versionId/timingId/action/phase`。phase 是 `script_review`、`asset_review`、`production_wait`。關閉頁面可能留未結束紀錄，不虛構時間。

## 5. 發布、學生觀看與失敗處理

YouTube ready 是外部處理完成，與精確 `(scriptId, versionId, assetId, generationVersion)` 的當前核准是雙閘門。後端再次檢查目前參照與有效核准才進 `published`；先後順序均可。前端應區分「已核准，等待發布」、「發布失敗／待處理」與「已發布」，不要把 200 審核回應直接顯示為學生已看見。

`GET /api/v1/courses/:courseId/short-assets`（`listCourseShortAssets`）查教師成品；上傳失敗時 `POST /api/v1/short-assets/:assetId/upload/retry`（`retryShortAssetYouTubeUpload`）依 OpenAPI 必要條件與回應執行，先讀目前資產避免重複。錯誤顯示可否重試與後端原因；處理中禁連點。學生以 `GET /api/v1/youtube/shorts`（`listStudentShorts`）讀 feed；後端重查目前資產與核准，歷史 published 並不保證可見。實際學生帳號權限及 YouTube 播放仍需各自驗證。

## 6. 改選、撤回與管理員待辦

從目前同意開始，先 `GET /api/v1/courses/:courseId/recut-consent/withdrawal-assets?kind=voice`（`listRecutConsentWithdrawalAssets`；內容撤回改對應 kind，來源可依 schema 限定）。顯示所有適用成品、逐支勾選及全選；預設每支不選，切換時清楚顯示數量。聲音偏好影響教師所有課程，不要暗示只有目前課程。

`POST /api/v1/courses/:courseId/recut-consent/withdrawals`（`withdrawRecutConsent`）帶 `kind/requestId/termsVersion` 及 `selectedAssetIds` 或 `selectAll:true`；不可同時使用非空清單與全選。同一撤回重送保留相同 requestId 與輸入。後端先持久記錄撤回並阻止新工作、停止相關工作與租約；只封存選中資產、取消待上傳並盡力將 YouTube 轉私人。未選且已發布的歷史成品保留；不能承諾收回已下載或轉傳內容。送出前的對話框可取消；撤回送出後不是復原按鈕。

回 `status: pending` 或 `actions[].manualActionRequired: true` 要顯示「尚有下架工作」與具體待辦，不顯示全部完成。`POST /api/v1/courses/:courseId/recut-consent/withdrawals/:withdrawalId/retry`（`retryRecutConsentWithdrawal`）重試同一持久動作而非新撤回；先更新狀態，顯示進行中與結果。轉私人失敗會保留 manual-private outbox 並通知各管理員；`GET /api/v1/admin/recut-consent/manual-actions`（`listRecutConsentManualActions`）僅管理員查看。外部成功後紀錄提交前中斷可能重試，因此不得宣稱外部動作恰好一次。待辦未完成時同類改選可能 409，顯示先處理待辦。

## 正式前端待做的入口

1. 既有課程上傳頁：條款、明確內容同意、上傳進度及錯誤；保留原表單、檔案與課程上下文。
2. 教師短片流程：候選、原音偏好、背景任務、完整稿、按需展開逐句修改、建議採納、講稿核准、等待產片、成品觀看／退回／核准、發布狀態。沿用現有八拍佈局，不以開發術語取代教師可理解的按鈕。
3. 教師同意管理：跨課程聲音偏好、改選、撤回、逐支／全選和未完成下架狀態。
4. 學生短片牆：依 feed 顯示可觀看資產與空狀態，不以教師頁狀態自行判斷可見。
5. 管理員待辦與 worker 管理需要入口及權限設計；本交接不實作 RC9 或 RC7 管理畫面。管理 worker 使用 `GET/POST /api/v1/admin/recut-workers`、`PATCH /api/v1/admin/recut-workers/:workerId`，建立時金鑰只回一次；worker 不可使用教師 JWT 充當身分。

worker 以專用 Bearer 呼叫 `POST /api/v1/recut-worker/jobs/claim`，其後 `POST /api/v1/recut-worker/jobs/:jobId/heartbeat`、`GET /api/v1/recut-worker/jobs/:jobId/source`、`POST /api/v1/recut-worker/jobs/:jobId/failure`、`POST /api/v1/recut-worker/jobs/:jobId/result` 需 `X-Recut-Lease`；result 是 `video` 與 `metadata` 的 multipart。租約、版本、失敗分類和通知詳見 [worker 契約](recut-review.md#rc7-專用-worker-與持久租約)，不應把金鑰放教師前端。

## 開發與驗收檢查

依序接上同意及上傳 → 選題與偏好 → 工作查詢與取消 → 完整稿／草稿／建議 → 講稿核准／渲染／成品審核 → 發布與學生 feed → 撤回及管理待辦。每步使用後端回傳 ID 與 revision，逐項確認：

- [ ] 同意過期、拒絕與改選時，保留表單；不同課程內容授權及教師全域語音偏好不混淆。
- [ ] 關閉頁面後可重新讀工作；取消、失敗、來源變動及過期 revision 不遺失未送文字，也不假顯示成功。
- [ ] 完整稿與草稿區別明確；採納後重跑、內容／呈現退回、新 MP4 審核各走正確分支。
- [ ] 先 ready 後核准、先核准後 ready、上傳失敗與重試皆不提前顯示學生可見。
- [ ] 撤回預設不選，逐支與全選互斥；未選已發布保留，pending／manual 必須顯示且可重試。
- [ ] 用教師、其他教師、學生及管理員帳號驗權限；實際瀏覽器、真實媒體、外部服務、正式部署和教師人工驗收各自留證據。

資料與工程接點：[資料集合、狀態轉移及 queue 註冊](recut-foundation.md)；[來源與切句](recut-source.md)；[選段及 RC4 介面](recut-selection.md)；[審閱與 worker](recut-review.md)；[同意與撤回](recut-consent.md)。來源句子樣本在 [recut-sentences.json](../tests/fixtures/recut-sentences.json)，僅格式樣本；狀態及階段唯一常數在 [recut.js](../src/constants/recut.js)，轉移入口在 [recutState.service.js](../src/services/recutState.service.js)。`registerRecutSteps` 的 generate 依序 sourceCheck、selection、cards、wholeCheck；修改任務由 `registerRecutReviewSteps` 註冊 prepare、cards、wholeCheck，使用共用 queue；介面與實際 adapter 以各技術文件和程式為準。不要從前端直接修改資料集合。

本文件是程式契約導覽與待驗收清單，不是 live、外部服務或正式人工驗收紀錄；實際結果及限制請看[狀態正本](../../docs/current-status.md)。

## 受控試產續跑與重新渲染

`executeRecutTrialResume` 接收 `loadArtifacts`、`runtimeFactory`、`output`、`targetUri`、`allowModel` 與 `render: false`；保留原先已用的三次實際呼叫，最多再呼叫 cards 與 wholeCheck 各一次，不能重置原額度。請求前由資料庫 reservation ledger 永久 claim；保存 source、plan、full script、generation checkpoint 與資料庫 hash root。`executeRecutTrialRerender` 不呼叫模型、不讀模型金鑰，仍檢查資料庫 generation／source／script 綁定並重新驗證原始 MP4 hash；自簽 checkpoint 不能繞過資料庫綁定。render-only CLI 使用 `--rerender-from`，不使用 `--allow-model`。新單題流程也在渲染前保存 progress 與 generation checkpoint。上述為凍結程式與隔離測試結果，不表示教授試產已續跑。
