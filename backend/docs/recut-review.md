# recut 教師審閱與修改 API

這份文件讓 RC4 接上重新配圖，讓 RC9 接上講稿與成品審閱。端點契約以 [OpenAPI](openapi.yaml) 為準，來源格式與狀態入口見 [RC1](recut-foundation.md)，選段驗證見 [RC3](recut-selection.md)；功能狀態與測試結果只看[目前狀態](../../docs/current-status.md)。

## RC9 端點

狀態 mutation 先以 `ShortScript.recutMutationLock` 的 token／expiresAt 做資料庫 CAS 取得 2 分鐘租約，每 30 秒延長；只包住短暫資料庫更新，不包住模型或媒體工作。同程序 mutex 減少本機競爭，跨程序由 Mongo 租約拒絕另一個 owner；寫入 recut 快照仍同時核對 token、有效期限及 revision，失去租約的程序不能提交，釋放時也不能清除新 owner 的 token。程序中斷後只允許過期 lease 被接手。相較只用記憶體鎖，這能保護多程序部署；忙碌或租約改變時回 409，呼叫端重新讀取後再操作。對應 `recutState.service.js` 與 opt-in 的 `recut-mongo-isolated.test.js`，僅後者證明真 Mongo 的跨程序競爭行為。

逐字稿依[版本契約](../../docs/04_Features/Short_Video/chunk-version-contract.md)處理：`shortScripts.evidence` 與 `RecutSource` 保存 `transcriptVersion`，缺欄位視為 `legacy`；RecutSource 另存視窗內 chunk 的 ID、原文與起訖快照。生成來源視窗前先比較影片 `activeTranscriptVersion`，不同即回 `RECUT_SOURCE_UPDATED`，不回查重用的 chunk ID。已凍結後的選段、施工單、審閱與 worker 都使用來源句子／逐字時間快照；審閱回 `sourceUpdated` 與提示，不因新 chunk 默默改寫原版。舊來源不自動重新凍結，也不寫入逐字稿集合。

所有端點前綴為 `/api/v1/short-scripts/:scriptId/recut`，沿用短影片功能開關、登入與課程教師／admin 權限。學生、其他課程教師回 403，關閉功能回 404。寫入不接受客戶端自訂額度、任務類型、原片路徑或施工單。

| method＋尾段 | 用途與結果 |
|---|---|
| `GET /review` | 目前版本、完整講稿、逐句來源、草稿、建議與最近完成修改摘要 |
| `PATCH /selection` | `{versionId,expectedRevision,changes:[{sentenceId,action:'add'或'remove',reasonLabel?}]}`；立即回傳草稿長度與是否合法 |
| `POST /selection/restore` | 全部復原；不重跑、不刪歷史 |
| `POST /selection/apply` | 一次套用；202 回 RC1 任務，重跑第二／三步 |
| `POST /suggestions/apply` | 整批 `suggestionIds`、選填 `reasonLabel`；需推翻鎖定時明列 `confirmedSelectionChangeIds`；202 回同一任務 |
| `POST /approve-script` | 核准眼前版本，記錄教師／時間；不直接製作 |
| `POST /render` | 將已核准版本設為 `render_queued`；RC7 worker 或 RC11a 本機試產接手，不在此呼叫工具 |
| `POST /approve-asset` | 另帶 `assetId/generationVersion`，精確核准目前 MP4；同步 ShortAsset 審核，YouTube ready 時發布 |
| `POST /review-time` | `start` 帶目前 `versionId/expectedRevision/phase`；`stop` 帶原 `versionId/timingId/phase`，時間由伺服器計算 |

除計時停止外，寫入都要目前 `versionId` 與 `expectedRevision`，過時回 409。`/review` 的 `fullScript/current` 永遠是目前版，`draft.fullScript` 才是未套用預覽；逐句 `selectionAllowed/exclusionReason` 說明是否能加回；`selected/label/opening/teacherChanged` 以草稿優先，`originalLabel` 保留目前版理由。閱讀講稿不顯示 JSON、圖卡規格或原始編號；修改時才用逐句來源。成品識別來自 `recut.currentAssetId/currentAssetGenerationVersion`，MP4 資料沿用既有 `GET /api/v1/shorts/:shortAssetId`。

例如 s7 原本跳過 → 加回 → 回傳 `current.durationSec:37`、`draft.durationSec:42`，核准停用；套用成功後切新版、清草稿，重新審講稿。取消或失敗回原版，s7 仍留在未套用修改。移除片頭回 `warnings`，不自動選新片頭。

## 草稿與取捨

[recutReviewSelection.service.js](../src/services/recutReviewSelection.service.js) 把修改投影到同一份凍結句子：保留未動過的句內微調與原範圍分組、刪除整句時切開範圍、新加句獨立成段。原片頭仍保留時才搬前，不另換一句。依實際逐字剪點重算總長；0 秒或超長都可暫存，套用必須 30～65 秒。全部改回原選句集合時直接還原原選段與施工單，不耗模型額度。

替代方案是每次修改直接覆寫版本或立刻重跑，會失去原版、增加呼叫，因此採持久草稿與一次套用。新增句保守獨立成段，不自動把原本未選的停頓合併；剪接自然度待試跑確認。標籤仍須符合保留／跳過格式，教師加回的跳過句在新版轉成保留類，移除句轉跳過類；UI 以 `teacherChanged/originalLabel` 區分，不把轉換後標籤說成原 AI 理由。

`withRecutTransition(scriptId, async scopedTransition => ...)` 在同一腳本鎖內做草稿與狀態更新；仍只經 RC1 的狀態函式。呼叫 `queue.enqueue({...,transition:scopedTransition})` 避免重複取鎖，排隊標記寫入失敗時也沿用它還原；不要在已持鎖時再呼叫 `transitionRecut`。revision 的 CAS 防過時覆寫。只支援單程序 queue，跨程序 worker 由 RC7 接手。

## RC4 的重跑與建議介面

```js
const { registerRecutReviewSteps } = require('./recutReviewSteps.service');
registerRecutReviewSteps({
  cards: { id: 'cards-v1', stage: 'cards', run: cardsStep },
  wholeCheck: { id: 'whole-check-v1', stage: 'wholeCheck', run: wholeCheckStep },
});
```

這會為 `apply_selection/apply_suggestions` 註冊 prepare → cards → wholeCheck；沒有預設假步驟。prepare 回 `sourceId/baseVersionId/selection/selectionResult/fullScript/selectionLocked/adoptedSuggestions`。RC4 使用 [共用呼叫函式](recut-selection.md#rc4-串接)，最後回 `{version:{sourceId,selection,fullScript,plan,modelId,shortRenderVersion,assetVersions,theme}}`，不得帶舊 `_id`。

所有原音選段、片頭、鎖定 ID 與完整講稿都須符合 `lockedSelection`；第三步需退回第一步的問題改列品質建議，不能再呼叫選段。RC1 queue 在提交前做最後比對，違反時失敗並還原。完整 plan 仍由 RC4／RC5 的 renderer 驗證器檢查，RC8 的測試 plan 不能拿去渲染。

AI 建議一項存一筆 `RecutReviewEvent`，`kind:'suggestion'`、`scriptId/versionId` 與 `content`，並帶下例 `proposal`。只把採納項送給背景步驟；同批建議的原音修改若互相矛盾則拒絕。

```js
{
  kind: 'selection', // 或 presentation
  problem: '例子缺少必要條件', proposedChange: '加回這一句', impact: '會增加五秒',
  changes: [{sentenceId:'s7', action:'add'}]
}
// presentation 的 proposal 改帶 allowedPaths，例如 ['/plan/cards/0/subtitle']。
// 這是依 RC5 最終 schema 指定的 JSON Pointer，不由教師輸入；範例欄位不代表 RC5 已定稿。
```

呈現建議必須有明確 `allowedPaths`，只容許 `/theme` 或 plan 下的呈現欄位，不能涵蓋 source、clips、schemaVersion。queue 以遞迴差異比對限制在採納項的範圍，越界即失敗；呈現建議另比較 RC1 `narrationKey`，確保聲音與順序未變。若有選段變更，RC4 可依採納項重配相依圖卡，須在 `impact` 揭露影響。路徑比對避免模型藉採納一項重寫整份 plan；代價是 RC4／RC5 改 schema 時須同步提案路徑。

`adopted:null` 表示未決定，`true` 表示教師按過套用，不代表任務成功；任務結果另查 RC1。整批套用將未選項記 false；直接核准講稿或成品也將未決定項結算 false。選段改動另存 edit 事件，保留原標籤、原因、taskId 與 suggestionId。純品質建議不擋核准。

## 儲存、核准與時間

新增欄位都在既有 RC1 集合，沒有修改共用 Atlas：

- `recutreviewevents.draftSelection` 保存整份草稿，`draftId` 分組、`revertedAt` 留復原紀錄；`ShortScript.recut.pendingEditId` 只指向最後一筆。`proposal/suggestionId` 分別存提案與來源建議。
- `recuttasks.input` 固定 `baseVersionId/sourceId/lockedSelection/fullScript/selectionLocked/adoptedSuggestions/confirmedSelectionChangeIds/presentationScope`，重跑讀同一快照。`changeSummary` 在提交前由實際新舊版差異計算並保存；`latestChangeSummary` 可在重新整理後重讀，失敗不冒稱已改版。
- 核准仍走 `transitionRecut`，不得直接改 state。純呈現新版由 RC1 沿用講稿核准，清舊成品並重審新 MP4；原話內容／順序變動回 `script_review`。未套用、處理中、錯版本或錯 MP4 都不能核准。API 再比對顯示的原話與儲存講稿，避免核准另一份文字。
- `recutreviewevents` 的 timing 分 `script_review/asset_review/production_wait`，個別記伺服器 `startedAt/endedAt/durationMs`；同人同階段重送 start 沿用開啟紀錄，stop 可跨新版、不可接管別人的計時，重送不改結果。RC9 需在進出畫面及等待時送 start/stop；意外關閉未送 stop 的區段保留未結束，不虛構耗時。

## 驗證界線

`recut-review.service.test.js` 驗草稿、即時長度、復原、鎖定、範圍限制、取消／失敗、共用額度、回審、摘要與三段時間；`recut-review.routes.test.js` 驗九端點的功能開關、401／403、成功、錯版本與輸入。全部使用記憶體 harness 和假步驟，不啟動正式 server、renderer 或任何外部 API。

2026-10-29 的子 agent 已確認九端點需求契約，並複核計時必填、目前版／草稿語意、無法回答原因、改動摘要與採納統計五項修正。這是 API 契約確認，不代表 RC4 接線、RC9 畫面或實際成品驗收；完整獨立審查仍依 HANDOFF 排定。

## 成品核准、發布與退回

`approve-asset` 在同一腳本鎖與 revision CAS 中建立精確 `(scriptId,versionId,assetId,generationVersion)` 核准，再 CAS 寫 `ShortAsset.reviewStatus/reviewedGenerationVersion`。先保存核准紀錄，資產寫入失敗時可重送補寫；發布仍檢查目前版與兩份紀錄。相同目前成品已核准的重送可接受舊 revision，不建立第二筆核准。

YouTube ready 與教師核准兩個入口共用 `markShortAssetPublished`。它重新讀資產、檢查 current version/asset/generation 與有效核准，保留 YouTube 的 ready/attempt/file/generation CAS，再在同一腳本鎖內同步 recut `published`。若資產已公開但腳本提交失敗，後續 ready 查詢或核准重送補同步。學生 feed 也重查 recut 當前引用與核准，舊成品不能靠歷史 `published` 留在學生牆。一般 ShortAsset 審核與發布入口同樣轉入此流程。

`POST /recut/reject-asset` 帶核准相同的識別／revision，另加 `scope:presentation|content` 與非空 `reasons`。先把舊成品改 `draft/rejected`、撤銷成品核准並留事件，清目前成品引用；呈現回 `script_approved`，內容回 `script_review` 並撤銷該版講稿核准。純呈現保留原音與順序，任何新 MP4 都重新審核。一般成品退回依 contentIncorrect/incomplete/other 保守回內容審閱，其他理由回呈現。

## RC7 專用 worker 與持久租約

啟動組裝使用 `recutApplication.service.js` 的 `configureRecutApplication({ runtimeAdapters })`，把 RC2～RC4 的 generate、選段修改、建議重跑註冊到 API 與 RC8 共用的 `recutQueue`。獨立本機工具可用 `createRecutApplication({ runtimeAdapters, queue })` 注入自己的 queue；建構不啟動資料庫或外部工作。`startServer({ recutRuntimeAdapters })` 接受同一組明確轉接，缺少 provider、renderer 或原片處理方法時，在建立任務前回 503 與缺項清單，不使用假的預設 provider。品質建議同時保存在 task 的 `suggestions` 及對應版本的 review events。

管理員 `GET/POST /api/v1/admin/recut-workers`、`PATCH /:workerId` 建立、列出、暫停或永久停用。資料庫只存 SHA-256 雜湊；一次性金鑰只在建立回傳，所有管理動作留 adminAuditLogs。一般 JWT 與 worker 金鑰驗證分離；worker 不能使用教師、學生或管理員 API。

worker 用專用 Bearer 金鑰呼叫 `/api/v1/recut-worker/jobs` 下的 `POST /claim`（shortRenderVersion/assetVersions）、`POST /:jobId/heartbeat`、`GET /:jobId/source`、`POST /:jobId/failure`、`POST /:jobId/result`。領取回工作、planHash、施工單、凍結逐字來源及一次性 leaseToken。其餘四個操作須 `X-Recut-Lease`；上傳使用 `video` 與 `metadata` JSON multipart，收檔前後均核對租約。原片下載僅能讀 uploads 內的安全檔案，不回絕對路徑。

演算法採 DB FIFO＋雙重 CAS：先保留每台 worker 唯一 activeJob，再 claim 最早未租用且版本相符工作；租約 10 分鐘，每 60 秒 heartbeat 延長。逾時或偶發黑畫面／字型失敗才換另一台，最多三次；固定規格、長度、靜音、音量失敗第一次即終止，通知教師與所有管理員且去重。重啟及每分鐘恢復過期工作與未完成通知。`completing` 先持久保存成品引用，再建立／連結待審資產；中斷恢復同一 assetId，避免一支接受的成品被重派或重建。

撤回讀取 render job 時明確選取 schema 預設隱藏的 `leaseHash`，再以 status／hash 做取消 CAS。逾期恢復另比對讀到的 `leaseExpiresAt` 並要求仍已逾期；heartbeat 若已延長同一 token，舊的恢復快照不能重排或清除該 worker。學生 feed 以同一排序游標持續掃描，直到收滿一頁加一筆有效成品或資料耗盡；不合目前精確核准的 recut 不會造成空頁 token 錯誤或截斷後續有效短片。

檢查依原始數值判斷，不信任 worker 宣稱 passed：720×1280、30fps、一影一音、來源選段加片尾總長 ±0.5 秒；黑畫面少於0.5秒（pix_th .05）、靜音少於2秒（-50dB）、-16 LUFS ±2、真峰值≤-1.5dBTP、字型已載入。門檻集中 `recutRenderChecks.service.js`，總長由凍結 source/selection 與 plan 計算。worker 回數據為受信任專用 worker 的檢查證據，後端不在此重跑 FFmpeg；遭控制的 worker 仍可能偽造測值，需在正式開放前驗證執行環境。

替代方案為記憶體租約或直接讓 worker 使用教師 upload API，前者重啟失去排他、後者授權過寬，因此使用兩個專用集合及受限路由。跨文件的完成程序採可恢復提交而非要求 Mongo replica set transaction；目前版變更、撤回或過期結果一律不公開。真實 FFmpeg、媒體品質與外部 YouTube 不由 fake 測試證明，驗證紀錄見狀態正本。

## 同意閘門與撤回整合

內容同意在原片／YouTube 來源／批次上傳建立資料前檢查；recut 排隊、每次嘗試、渲染派工／心跳／下載／回傳、短片上傳及新發布均重查目前課程與教師同意。舊 `ShortAsset.disclosure.consentConfirmed` 不代表教師原音偏好。缺內容或語音同意回 409；選合成語音但 RC12 未就緒回 503，不偷偷改用原音。錯誤公開回傳 `error.details.consentTerms` 與 `consentUrl`，正式環境也可讀。

既有教師上傳 UI 仍須補接：先 `GET /api/v1/recut-consent/terms`，向教師顯示條款並取得明確選擇，再 `POST /api/v1/courses/:courseId/recut-consent` 傳 `kind:content`、`choice:granted`、目前 `termsVersion` 與穩定 `requestId`，成功後才送原片。首次 recut 另以 `kind:voice` 保存 `original|synthetic`；偏好跨該教師所有課程共用。未補接時原有上傳會明確拒絕，這份後端契約不表示前端流程已可實機使用。

撤回先持久記錄選擇，再取消仍處理中的 task／render job、失效 worker lease；只把教師選中的成品改為 `archived`，取消待上傳並盡力轉私人。未勾選的歷史已發布成品保留，feed 仍核對精確 version／asset／generation 核准，已封存的成品不會被 ready 回呼或重試恢復。回應 `status:pending` 與 `actions[].manualActionRequired:true` 表示仍需重試或管理員下架，不能顯示成全部完成。

`consentWithdrawal.privateRequired` 是成品端的持久轉私人待辦。若撤回發生在已送出 YouTube bytes 或發布 CAS 等待中，晚到結果會封存並保存遠端 ID／孤兒紀錄；轉私人失敗會去重通知各管理員，啟動及每分鐘恢復待辦。渲染建立交錯則取消 completing job，封存其尚未完成的成品，不建立第二份。外部轉私人屬冪等操作；程序若在外部成功、紀錄尚未提交時中斷，恢復會再次確認轉私人。

YouTube 回傳後的上傳 CAS 排除 `archived`；即使同意預檢已通過、教師之後才封存沒有遠端 ID 的成品，晚到 ID 仍會持久保存並排轉私人。CAS 成功後再讀目前資產與同意，補上提交後的撤回窗口。管理員待辦 API 合併同意文件 actions 與 Asset 晚到補償待辦，並在合併前驗證管理員角色。

worker 原片下載固定 `application/octet-stream`，內容可以是 MP4 或其他允許的原始影音格式。成品 metadata 可加 `planVersion`（須等於 `plan.schemaVersion`）及非負整數 `renderDurationMs`；後端持久保存，舊 worker 省略時保留相容。

視窗邊界截斷句沿用來源的 `excludedSentenceIds`。教師加回、採納選段建議與背景 `lockedSelection` 都經 `resolveSelection`；即使草稿容許暫時超長，也不能加回這些句子。公開修改端點回 `422 RECUT_SENTENCE_EXCLUDED` 且不保存事件或草稿；前端保留輸入並顯示逐句的 `exclusionReason`。

撤回同意的 `withdrawal-assets` 回明確的 `scope/assets/selectAll`；每支 `selected` 與整體 `selectAll` 預設 false。管理員 `manual-actions` 回待手動下架的動作陣列，含 `id/withdrawalId/assetId/type/status/manualActionRequired`；晚到成品待辦可缺 `teacherId`，教師登入呼叫此端點仍為 403。完整欄位依 [OpenAPI](openapi.yaml)。
