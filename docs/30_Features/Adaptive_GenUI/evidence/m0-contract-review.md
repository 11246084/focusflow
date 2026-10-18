# M0-E01 契約決策與技術 review

日期：2026-10-13；契約版本：`m0-contract-v1`；reviewer：Codex。
基準 HEAD：`966f34b7cbaf446a7b6975b7e7dffc56d3af3e84`。
依據：[PLAN §3–7](../Adaptive_GenUI_PLAN.md)。以下是後續工程的固定契約與合成正反例，不是已實作的 Schema、provider 探針或教師品質簽核。

## 1. 現況接點與信任邊界

| 目前程式／函式 | 查證結果與後續接點 |
|---|---|
| [qa.service.js](../../../../backend/src/services/qa.service.js) `buildQaResponse`、`buildUserFacingCitations`、`resolveSupportingMatches` | 最終 citation 經答案採用及可播放過濾；Evidence Bundle 必須在此邊界依實際採用集合建立，不能直接將 matches 升格。既有缺 supportingEvidenceIds 會回全部 matches；GenUI 遇缺明確 provenance 時拒絕使用，保留舊 QA 語意。 |
| 同檔 `faqMatchesCurrentScope`、`faqHasCurrentAnswerEvidence`、exact/semantic hit | 兩種 hit 都有 scope 與 answer evidence marker 檢查；新 Bundle 還須重取目前原文並比對版本，不把 FAQ 舊快照視為永久有效。無法建立 Bundle 時僅停用 UI，不重新扣次或強迫生成 QA。 |
| [conversation.service.js](../../../../backend/src/services/conversation.service.js) `loadOwnedConversation`、`runQuestion` | 先驗擁有者及修課；取得 QA 成功文字後才可進 GenUI。需分離 UI error 與既有 QA catch，避免 completed answer 變 failed。 |
| 同檔 `publicMessage`、`listMessages`、`retryMessage` | public mapper 為新增欄位接點；history 現僅驗 conversation，尚無逐來源撤銷檢查。UI 失敗不可使成功訊息變成可 retry。 |
| [message.model.js](../../../../backend/src/models/message.model.js)、[conversation.model.js](../../../../backend/src/models/conversation.model.js) | 現無 learningUi 或呈現偏好。後續正式欄位保存 immutable artifact／conversation 偏好，不藏 Mixed runtime。 |

Bundle 僅在 server 內傳遞，含受權限約束的 courseId、當輪 S-id、原文、videoId、segmentId/chunkId、時間範圍及 contentVersion。只有具明確文字證據的來源可支持教材 claim；僅有影像 embedding 無 transcript 的來源不支持文字 UI。public API 不輸出 Bundle 或 planner 診斷。直接 QA、LINE 保留文字／引用契約。clientCapabilities 只能減少能力，不能授權讀取。

## 2. 模式、交付與偏好

- 既有 answer/message.content 必須可獨立閱讀，learningUi 缺省或 null 表示無 UI。新增欄位在首次、history、retry 使用同一公開形狀，沿用既有 response envelope。
- planner 決策：plannerVersion=`1`；mode=text/clarify/ui；componentTypes 在 text/clarify 為空、ui 僅一個 comparison/steps/quiz；附 learningObjective、reasonCode、evidenceRefs、interactionIntent。clarify 另有 clarificationQuestion，只問意圖／指涉，不新增教材事實；保留原回答再附澄清問句。
- internal outcome 記 plannerInvoked、plannedMode、deliveredMode、fallbackStage、fallbackReason。正常 text/clarify 不計 fallback；預檢未呼叫模型時 plannedMode=null。veto 保留原 plannedMode。
- 一輪最多 planner/generator 各一次，無自動修復重試；answerReady 起共用 5,000ms deadline，單次完整 JSON。取消或逾時忽略遲到結果且不保存；文字成功不重算提問額度。
- conversation preference 為 auto/text/brief/stopped；當輪明確覆寫只影響該輪，持久偏好更新須明確表示後續適用。text/brief/stopped 均禁止自動 UI；重新啟用需明確偏好更新。

## 3. Draft、Artifact 與版本

Draft 僅含 schemaVersion=`1`、blocks 及 claims；block 有 blockId/type/componentVersion=`1`/data，claim 有 claimId/text/evidenceRefs/contentOrigin。模型提供的 blockId/claimId 只是 artifact 內識別符，必須唯一且只能被本 artifact 參照，絕非資料庫 ID。evidenceRefs 只接受本次 S1…Sn。未知 key 一律拒絕，包括 URL、style、script、工具及自訂 action。

Artifact 由 server 產生 schemaVersion=`1`、catalogVersion=`1`、artifactVersion（從 1 起的整數）、blocks、claims、sourceRefs；將 claim.evidenceRefs 轉成 sourceRefIds。sourceRefs 包含 refId、videoId、segmentId 或 chunkId（至少其一）、startSec、endSec、contentVersion；refId 以內容身分決定而非 S 序號，不能由 client 指定。原文留在受控內部證據，public artifact 不附完整逐字稿。

| 元件 data 契約 | 必須成立的不變量 |
|---|---|
| comparison：concepts[{conceptId,label}]、aspects[{aspectId,label,cells[{conceptId,claimId}]}] | 2–3 概念、1–6 面向；每面向每概念恰一 cell，無重複／缺格；每教材敘述引用 claim。 |
| steps：items[{stepId,title,claimId}] | 1–8 步，陣列順序即呈現順序；不增加無證據因果箭頭。 |
| quiz：question、options[{optionId,text}]、correctOptionId、explanationClaimId、contentOrigin | 1 題、2–4 唯一選項，正解存在且恰一；解析 claim 支持規則及正解。選項是候選答案而非教材事實；生成例題明標 generatedExercise，不宣稱老師原題。 |

所有 claim 都有非空合法來源，包括 generatedExercise 的解答規則／解析。courseDerived 不可混入未標記的虛構數字或人物。元件標題、標籤不承載額外無引用教材主張。初版最多一 block，完整 Draft 及 Artifact JSON 各不超過 32,768 UTF-8 bytes，文字欄位上限 1,000 Unicode code points；ID 限 64 個 ASCII 英數字／底線／連字號，禁止原型污染名稱。所有 references 都須解析；無效必需 claim 使整 block 退化，不局部刪題。

schemaVersion 管資料形狀、catalogVersion 管元件集合、componentVersion 管元件 data、artifactVersion 管該訊息快照。artifact 不原地改內容；替換需版本增加。選項／block ID 只在 messageId+artifactVersion 內有效。事件另用 stateRevision CAS；作答不改 artifactVersion。未知任一必要版本時退文字、不發送互動，不靜默套用最新 renderer。

## 4. 內容 hash 與撤銷

contentVersion=`sha256:` 加小寫十六進位 digest。hash 輸入固定為 UTF-8 JSON 陣列 `["evidence-v1",courseId,videoId,segmentIdOrNull,chunkIdOrNull,startMs,endMs,normalizedText]`；識別碼保留大小寫；文字先 Unicode NFC，再 CRLF/CR 轉 LF、去除首尾空白，保留內部空白。時間必須有限非負、end>=start，秒乘 1,000 後四捨五入為整數。空文字或無法確定範圍拒絕。後續 sourceRefs 的秒值使用此毫秒精度；改時間或內容必須改 hash。refId=`ref-` 加同 digest；不同課程或片段不碰撞到同一身分。

hash 是版本比對，不能取代授權。生成、保存前、history 回傳、來源跳轉與互動都重驗課程／影片／片段存取及 hash。來源移除、內容更新或無法查驗時整 artifact 不回傳且拒絕互動；不自動套新原文重播舊解答。撤銷課程直接拒絕整個 message 存取；只有某來源失效時隱藏其快照及依賴內容，回中性「內容不可用」文字，不再回傳可能含該原文的舊 answer/transcript。此為待 M3/M4 實作的撤銷行為，不能以現有 listMessages 宣稱已具備。

## 5. 操作、費用與保留

事件 endpoint 預定 POST /api/v1/learning-interactions：clientEventId、messageId、artifactVersion、blockId、action、payload、expectedStateRevision。MVP 持久化 action 僅 submitAnswer，payload 僅 optionId。expand/select/seekSource 是本地動作，不逐 tick 保存、不叫模型；submitAnswer 也不叫模型。追問另為受既有限額約束的新 turn，interactionContext 僅 messageId/artifactVersion/blockId/eventId，由 server 重建 context，不採信 client 自報正解、分數或自由摘要。

去重 key=userId+clientEventId（server userId）；同 key 同完整正規化 request 回原 event，不再次 CAS；同 key 不同 request 回 409。新事件 expectedStateRevision 必須等於目前 revision，再原子加一。無登入 401、他人 conversation 依目前政策 403、不存在 404、無效欄位／action 400、版本或 CAS 衝突 409、限額 429。事件過期／不存在不可臆測學生選項；有歧義時 clarify。M4 隔離 DB 必須驗證競爭、唯一索引與交易語意，不能以本次 review 替代。

費用設定採 fail closed：本輪 paid budget=0、僅 mocks；未批准模型價目與預算時不得外呼。後續 server 設定包含每 turn 與每日 GenUI 預算（USD 整數 micro-units）、planner/generator 各自 input/output token 上限、版本化價目、併發上限（初始 1）與 deadline。正式 budget 預設 0；未知價目、缺上限或超限回 BUDGET_EXCEEDED。呼叫前以最大 token 費用原子保留額度，完成後結算；timeout 未知用量不先釋放已可能消耗的保留額度，避免超支。GenUI 帳務獨立於 QA 提問計數；shadow 同樣受費用／deadline／權限限制。數值批准與真實成本量測留給 quality gate。

事件保留決策：createdAt 起 30 天（UTC），expiresAt=createdAt+30×24h；讀取即檢查 expiresAt，不能倚賴 TTL 即時刪除。只存必要 optionId、action、版本、revision、server 所屬關係與去重 ID；不存自由提問或逐字稿。conversation/message/account 刪除須連動刪除事件及 artifact；來源撤銷立即失效，不等 TTL，實體清理由同一清除流程處理。immutable artifact 隨 message 生命週期，受相同存取／刪除限制。匿名聚合 metrics 不含 userId、問題、教材、token 憑證；不留可逆學生追蹤 ID。30 天是本地工程預設，正式收集仍需人工政策審查，未授權不啟用外部收集。

## 6. 固定合成契約正反例

以下全部為合成資料：course-demo 的 video-demo/segment-demo，10–12 秒原文「先讀題，再選一個答案。」；S1 指向此來源；Q1 的 A=讀題、B=跳過讀題。正反例描述用於 M0 review，M0-E02/E03 再轉成可執行 schema fixtures／case format。

| ID | 輸入／變化 | 預期結果與禁止結果 |
|---|---|---|
| T+ | 使用者要求一句話；文字「先讀題。」引用 S1 | text、learningUi=null；無 planner/generator；不可硬出 steps。 |
| T- | 舊 client 卻提供 ui 決策 | CLIENT_UNSUPPORTED；零 GenUI calls，不能信任 client 自授權。 |
| C+ | 已有 Q1，但「為何這個錯」未有可唯一定位的事件 | clarify「你指哪個選項？」、無 UI、非 fallback。 |
| C- | 澄清問句加入「跳過讀題會提高正確率」 | 無證據教材主張拒絕，保留原 QA，記驗證 fallback。 |
| U+ | 要求流程，S1 支持兩步；steps claim1=先讀題、claim2=再選答案 | 驗證後兩 claims 映射穩定 refId；deliveredMode=ui。 |
| U- | 同一 Draft 改 claim2 evidenceRefs=[S9] 或加入 fetchUrl | 整 block 拒絕，文字仍成功，不重跑 QA。 |
| F+ | plannedMode=ui，generator 在 answerReady+5,001ms 才回 | deliveredMode=text，fallbackStage=generator/reason=TIMEOUT；遲到 artifact 不存。 |
| F- | planner 正常選 text 卻記 fallback 或重新扣提問額度 | 契約違反；正常文字選擇不算生成失敗。 |
| V+ | artifactVersion=1 的事件 Q1/B，stateRevision=0 | 權限與來源有效才原子存 event，revision=1；同 request 重送回原結果。 |
| V- | 同 eventId 改 A，或 artifactVersion=0／未知 schemaVersion | 事件 409；未知 renderer 版本只顯示文字，不猜測 mapping。 |
| R+ | S1 排序改為 S2，但來源內容／範圍不變 | digest/refId 不變，既有 artifact 引用不被重排污染。 |
| R- | 撤銷修課，或來源刪除／文字變更 | 課程拒絕存取；來源失效則內容不可用，不回舊原文快照，不接受 Q1 作答。 |
| H+ | 原文 CRLF 改 LF 或等價 NFC | contentVersion 相同；正規化重跑穩定。 |
| H- | end 12 秒改 13 秒或文字「一個」改「兩個」 | contentVersion 不同，舊 artifact 不可繼續互動。 |
| E- | 事件 createdAt 已滿 30 天但 DB 尚未 TTL 刪除 | 讀取即視為過期；追問不採舊選項，改澄清。 |
| B- | paid budget=0、未批准模型或缺價目 | 零外部呼叫；BUDGET_EXCEEDED，不能以 shadow 繞過。 |

## 7. Review 程序與結果

Codex 於 2026-10-13 逐項將 §1 對照目前 source 函式、§2–5 對照 PLAN §3–7，並人工式技術追蹤 §6 的 16 個合成案例：文字、澄清、UI、fallback、版本、撤銷各含正反例；hash、費用、過期另有邊界案例。16/16 在本文件規則中有明確預期結果，未發現需放寬 PLAN 的衝突。此分母僅表示文件 review 覆蓋，不是執行中的 validator 通過率。

M0-E01 驗收一對應 §2–4、§6；驗收二對應 §4–5。沒有呼叫模型或 DB、沒有啟服。Schema 精確解析、CJS/ESM 匯入與 provider payload mocks 由 M0-E02 驗證；合成 baseline 由 M0-E03 驗證；教學語意、120 例、付費成本及正式保留政策仍待人工／provider quality gate。

## 8. 後续整合必查

M2 檢查 FAQ exact/semantic／無答案／template／不具文字的來源；M3 檢查 formal message 欄位、public mapping、history/retry、撤銷與未知版本；M4 檢查持久化事件、CAS、刪除連動與來源重驗；M5 檢查 LINE/direct QA、OpenAPI、旗標零呼叫及舊行為相容。本輪未改 response 或資料模型，未宣稱上述 runtime gate 完成。
