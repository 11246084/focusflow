# recut 教師審閱與修改 API

這份文件讓 RC4 接上重新配圖，讓 RC9 接上講稿與成品審閱。端點契約以 [OpenAPI](openapi.yaml) 為準，來源格式與狀態入口見 [RC1](recut-foundation.md)，選段驗證見 [RC3](recut-selection.md)；功能狀態與測試結果只看[目前狀態](../../docs/current-status.md)。

## RC9 端點

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
| `POST /approve-asset` | 另帶 `assetId/generationVersion`，精確核准目前 MP4；不直接發布 |
| `POST /review-time` | `start` 帶目前 `versionId/expectedRevision/phase`；`stop` 帶原 `versionId/timingId/phase`，時間由伺服器計算 |

除計時停止外，寫入都要目前 `versionId` 與 `expectedRevision`，過時回 409。`/review` 的 `fullScript/current` 永遠是目前版，`draft.fullScript` 才是未套用預覽；逐句 `selected/label/opening/teacherChanged` 以草稿優先，`originalLabel` 保留目前版理由。閱讀講稿不顯示 JSON、圖卡規格或原始編號；修改時才用逐句來源。成品識別來自 `recut.currentAssetId/currentAssetGenerationVersion`，MP4 資料沿用既有 `GET /api/v1/shorts/:shortAssetId`。

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
