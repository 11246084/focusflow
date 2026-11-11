# 多模態授權契約審查與測試矩陣

本文件以 `dev 13e8a8ce894678c3501eb7bb9f99d90c000ebe5a` 的契約、程式與既有測試，重新審查 2026-11-11 真實 Atlas 小樣本的跨課探測。先確定每層接收什麼可信資料，再設計測試；不是授權改程式或 Atlas。當次進度、已執行與未執行範圍只看 [目前狀態](../../current-status.md)。

## 結論及前輪判定更正

1. **Leaf 缺少頂層 courseId 是既有、明確支援的資料情況，不能直接判為髒資料或漏洞。** Schema 非 required、預設 null；現有匯入工具可省略此欄位；Adapter 契約與 QA 測試都明寫依可信影片 allowlist 保留合法 Leaf。這不表示任意 videoId 或未知課程都可通行。
2. **正式 QA 的授權在上游。** Course 存取檢查與服務端影片關係建立 scope；Adapter 不登入、不查 Enrollment、不自行證明任意呼叫端提供的 scope 是真的。Bridge 也要求已授權 scope 與可信逐字稿 loader。
3. 前輪把 `{ courseId: 錯誤課程, allowedVideoIds: 原課程影片 }` 直接傳給獨立 Adapter，還期待零筆，**違反已授權 scope 的前置條件，屬測試假設錯誤**。當時三路確實各回三筆、正常三題排名及完整回復都是有效觀察；但「因此證實 Adapter／正式 QA 跨課漏洞」的結論撤回。原始私有證據不覆寫，另加本次契約解讀。
4. 原有實作路徑有 Course → Video → Chunk 與逐字稿再核對，**程式審查不等於完成所有攻擊回歸或正式網站驗收**。客戶端 scope 注入、多課程與缺欄位組合仍需依下表補測，不能現在就改稱安全驗收全部通過。

## 已閱讀來源與權威順序

[HANDOFF](HANDOFF.md) 全文、[decisions](decisions.md) 全文及 [QA／Adapter 契約](phase2-adapters.md) 已讀；舊 HANDOFF 的付費／寫入／部署執行稿不構成本輪授權。判斷依程式／schema／測試，接著是契約文件與歷史紀錄；以下代號在每個案例中指定依據，不能只憑測試名稱推定覆蓋。

| 代號 | 依據與明確責任 |
|---|---|
| C1 | [qa.routes.js](../../../backend/src/routes/qa.routes.js)、[qa.controller.js](../../../backend/src/controllers/qa.controller.js)：authenticate 後只把 req.user、body.courseId、question 與固定 source 傳給 QA；未傳 body.scope／allowedVideoIds／user |
| C2 | [courseAccess.service.js](../../../backend/src/services/courseAccess.service.js)：學生需 published＋active Enrollment；舊 Enrollment 無 status 視 active，revoked 拒絕；教師限課程擁有人，admin 可存取。這不是所有角色都須修課的契約 |
| C3 | [bridgeScope.service.js](../../../backend/src/services/bridgeScope.service.js)：collectScopedVideos 合併 videos.courseId 與 Course.videoIds 解析出的影片；buildCourseSegmentScope 只加入影片 `_id`；buildSegmentLookupQuery／segmentMatchesScope 依 canonical videoId，空 allowlist fail-closed |
| C4 | [qa.service.js](../../../backend/src/services/qa.service.js)：askQuestion 在 1275 附近 await 課程授權；438 載入並再次過濾 Leaf；1581–1606 以已驗證課程組裝 scope、asEvidence 與 loader。revalidateFaqMatches 另驗目前 scope 下的 segmentId／videoId 成對關係 |
| C5 | [VideoSegment schema](../../../backend/src/models/videoSegment.model.js)、[Video schema](../../../backend/src/models/video.model.js)、[Course schema](../../../backend/src/models/course.model.js)、[Enrollment schema](../../../backend/src/models/enrollment.model.js)：原始 Leaf.courseId 可空，videoId 以 String(videos._id) 綁定；不可把正規化候選的必填課程反推成所有原始 Leaf 都必填 |
| C6 | [phase2-adapters.md](phase2-adapters.md) 的 Atlas adapter／QA Bridge／第七階段，及 [API 影片片段契約](../../../backend/docs/phase2-api-contract.md#2x-影片資料來源與片段綁定)：輸入必須是已授權 scope，缺 Leaf.courseId 沿用影片 allowlist |
| C7 | [atlasMultimodalAdapter.service.js](../../../backend/src/services/atlasMultimodalAdapter.service.js)：正式索引 pipeline 依 videoId 預濾；結果再驗影片、可選 chunk allowlist 與存在時的 courseId，缺課程時補上可信 scope.courseId；沒有 Course／Enrollment repository |
| C8 | [multimodalQaBridge.service.js](../../../backend/src/services/multimodalQaBridge.service.js)、[rankFusion.service.js](../../../backend/src/services/rankFusion.service.js)：正規化候選需非空 courseId／videoId／chunkId；Bridge 以三個 ID、原始時間及可信 loader 交叉驗證，不使用媒體描述當證據；合法文字 fallback 可以非空 |
| C9 | [video.service.js](../../../backend/src/services/video.service.js) 的 attachVideoToCourse／resolveAccessibleVideoContext 及 [course.service.js](../../../backend/src/services/course.service.js) 的 resolveStudentCourseVideo：同時有來源與目的課程管理權才可掛載；主課程或合法掛載課程的學生可有影片存取權，不等於只能查 video.courseId |
| C10 | [既有匯入工具](../../../database/tools/mongodb_uploader.py) 的選填 FOCUSFLOW_COURSE_ID 與條件式寫入，以及 [scope monitoring](../../../backend/src/services/qaScopeMonitoring.service.js)：缺課程可沿用 canonical 影片範圍，註解不能代替實際行為 |

### 可信資料流

HTTP authenticate → 服務端 req.user → Course.findById → assertCanAccessCourse → collectScopedVideos → canonical `_id` allowlist → 葉片查詢／再次過濾 → QA 建立 Adapter／Bridge scope → 候選重新取同 scope 的逐字稿 → 回答及引用。

課程授權、影片列表與 FAQ 查詢在 Promise.all 中並行；未授權時會中斷後續，不能期待「連任何內部資料讀取都為零」。正確斷言是拒絕回答、不可回傳 FAQ／片段，且不進入後續 embedding／Atlas 檢索／回答生成。scope 不是客戶端證明文件；內部程式若偽造 scope 或 loader，不能由下層函式自動推得原使用者權限。

**原始資料與正規化資料要分開。** DB Leaf 可以沒有 courseId；QA asEvidence／Adapter 在可信影片關係下補入當次課程，之後 Bridge／RRF 的候選才要求 courseId。把原始 Leaf 直接當成正規化候選送入 Bridge，和正常 QA 資料流並不相同。

## 測試前置、來源與執行邊界

以下全為**待審測試設計，本輪沒有新增或執行測試程式**。既有測試已靜態閱讀，不把之前 66/66 當成此矩陣已通過。未連 Atlas、不啟動正式服務、不更改 env／旗標；本輪只有文件。

- F1：本機記憶體合成資料。已發布課程 A／B，各有主影片 VA／VB；使用者 SA 只修 A、SAB 修 A/B、S0 無修課，另設 owner teacher／非 owner／admin。Enrollment active／revoked／無 status 分開，不改正式人員或課程。
- F2：每支影片一筆固定原始時間、非空教師逐字稿及可預期排序的 Chunk。分別建立「無 courseId」「null」「一致 ObjectId／字串表示」「明示其他課程」版本，其他欄位完全相同；只在記憶體，真實備份僅作唯讀欄位形狀參考，不複製向量／私人文字進 Git。
- F3：沿用既有 Fake Atlas／Fake embedding HTTP 與 template answer；Fake 需記錄實際 query filter，刻意混入越界候選，不能讓 stub 不論輸入都回空以製造假通過。三路模型／metadata 合法、同時備妥合法逐字稿，避免把契約不相容／無證據誤認成授權成功。
- F4：用既有 backendTestHarness 的記憶體 store、必要時本機 Express；拒絕外網與 mongoose.connect，所有實際 Atlas／Gemini 存取為零。測試檔預設程序隔離，env 與 monkey patch 每例還原。對登入、QA、FAQ 的正常本機 store 寫入不等於正式寫入。
- F5：另設 SB 僅修 B；VA 主課程為 A，但由合法管理者掛載至 B。用受控 fixture 表達已完成掛載，讀取來源為 C9 與既有掛載測試；不是直接讓客戶端篡改 Course.videoIds。Leaf.courseId 缺少／A，以及 media metadata 記錄 A，分別測試。

## 正式 QA 測試矩陣

每列的「影響」都是未來更動必須守住的合法功能，不表示已決定修改。API 錯誤碼與空檢索是不同結果；跨課情境先區分有沒有修課／合法掛載。

| ID／責任 | 契約依據 | 前置及來源 | 輸入 | 預期結果與理由 | 原有合法檢索影響 |
|---|---|---|---|---|---|
| Q01 正式 QA | C1 | F1/F4，未登入 | POST /qa/ask A＋問題 | 401 UNAUTHORIZED；在 HTTP 邊界拒絕，非空候選斷言 | 合法登入不受影響 |
| Q02 正式 QA | C1/C2/C4 | F1/F4，SA 僅修 A；分測 S0、revoked、draft | 請求 B；另帶 scope=A、VA 等偽造欄位 | 403 COURSE_ACCESS_DENIED；不返回課程答案或 FAQ、不進後續向量／模型；允許授權前的內部並行 metadata 讀取 | 不得把所有學生或所有 draft 存取者一概拒絕，teacher/admin 另測 |
| Q03 正式 QA | C2/C3/C4 | F1/F2/F3，SA 已修 A，VA 的 Leaf 無／null courseId | 正常請求 A | 回傳 VA 合法片段與引用，保留時間；**預期非零** | 加強制 courseId AND filter 會讓此例退化，禁止藉此通過 |
| Q04 正式 QA | C1/C3/C4 | F1/F3，SAB 已修 A/B，兩課沒有掛載關係 | 請求 B，body 同時注入 scope=A、allowedVideoIds=[VA]、user=admin | 仍依 req.user 與 B 的服務端範圍查 VB；可有 B 答案，不含 VA；額外欄位目前忽略而非必須 400 | 跨課但有 B 權限者須可合法查 B，不可一律零筆 |
| Q05 正式 QA | C3/C4/C7/C8 | F3，可信 A scope，但 Fake Atlas 混入 VB／無 videoId／外部 alias | 正常請求 A | 越界候選不能進 matches/citations；若另有合法 VA 或合法 fallback，整體仍可非零 | 只排除不在 canonical allowlist 者，保留真正 VA |
| Q06 正式 QA／scope 建構 | C3/C5/C6 | F2/F4，Course.videoIds 指向 metadata-only VA，Video.courseId 缺少；Leaf 也缺課程 | 合法請求該 bridge 課程 | 由實際 Video._id 建立 scope 並取合法 Leaf；不能靠裸 courseId 或 raw alias 放行 | 保留既有 pipeline／QA-only 課程 |
| Q07 正式 QA | C3/C4/C8 | F1/F3，課程可存取但無可解析影片，視覺集合亦空 | 請求該課程 | 200＋no_searchable_segments／空引用，不轉查全庫；不斷言 embedding 一定未呼叫 | 只對空 allowlist fail-closed，不誤傷有影片但缺冗餘課程欄位者 |
| Q08 正式 QA／FAQ | C2/C4 | F1/F3，A 的 FAQ 引用已不屬 A 的 VB；再測 revoked 學生與語意 FAQ | 問相同或相似問題 | 無權課程仍 403；可存取 A 者丟棄失效整筆 FAQ，改正常檢索，可回合法 VA，不能回舊越界答案 | 不應為了清空而禁止所有 FAQ 或合法重檢索 |
| Q09 正式 QA／影片授權 | C3/C9 | F5，VA 合法掛載 B、原始 Leaf 無課程 | 僅修 B 的學生查 B | B scope 包含 canonical VA，允許合法共享內容，預期可非零 | 不得把 Video 主課程不是 B 就當成越權 |
| Q10 正式 QA／角色 | C2 | F1/F4，同一課程分 owner teacher、other teacher、admin、legacy Enrollment 無 status | 各自請求課程 | owner/admin 依現契約可存取；other teacher 403；舊無 status 學生在 published 可讀，revoked 不可 | 防止測試把所有角色強制改成修課制或擅改舊 Enrollment |
| Q11 正式 QA／問題內容 | C1/C3/C4 | F1/F3，SA 僅修 A，scope 固定 A；兩課內容可有相同詞 | 問題文字提及 B，未更換 courseId=A | 問題文字不能擴大到 VB；可有 A 的合法相關片段，或因無相關證據回 no_answer。不能只因提及別課就強制所有檢索零筆 | 保留合法課內同主題問答，分開權限與語意相關性 |

## Adapter 與 Bridge 測試矩陣

| ID／責任 | 契約依據 | 前置及來源 | 輸入 | 預期結果與理由 | 原有合法檢索影響 |
|---|---|---|---|---|---|
| A01 獨立 Adapter | C5/C6/C7 | F2/F3，呼叫端已驗 A→VA；正常 query/index/meta | scope=A/VA，原始 Leaf.courseId 缺少或 null | 合法候選非零，候選正規化為 A，三路與時間保留；缺原始欄位不是拒絕理由 | 是 legacy 正常路徑的保護案例 |
| A02 獨立 Adapter | C6/C7 | F2/F3，可信 A/VA，混合有明示 courseId=B 的列及正常 VA | 同 A01 | 依目前 Adapter 契約丟棄明示衝突列、保留正常列；不是所有列都零 | 此斷言只針對未涉及合法跨課掛載的矛盾資料，U01 另處理 |
| A03 獨立 Adapter | C3/C7 | F3，可信 A/VA，偽造候選 courseId=A 但 videoId=VB；另有正常列 | 正常 scope | 即使課程欄位相同也排除 VB；保留 VA | 課程 ID 不得取代影片 allowlist |
| A04 獨立 Adapter | C7 | F3 記錄呼叫次數，其他契約有效 | scope 缺 courseId、allowedVideoIds 非陣列或為空 | TypeError 且不進 repository；格式錯誤不是「查完回零」 | 不能把只有格式驗證說成已完成登入／關係驗證 |
| A05 呼叫端測試設計，非 Adapter 授權測試 | C6/C7 | F1/F3，A、B 無共享，卻人工組 B/VA，原始 Leaf 缺課程 | 直接呼叫 Adapter 的偽造 scope | **標為前置條件不成立，不設零筆通過門檻**。可保存觀察；可信 scope 測試應改由 B 的 scope builder 產生 VB，或由 QA 拒絕未修課者 | 不為修這個非法測試輸入而排除缺課程的合法 VA |
| A06 原生查詢的測試設計 | C5/C7 | F2/F3，Leaf 沒 courseId；有同資料的 video-only 正控制 | raw vector filter 強制 courseId=錯誤值＋videoId，再用正確課程重查 | 正錯 course filter 都可能零筆；需記為篩選資料不存在、不能證明授權有效。正式驗收仍走可信影片 scope | 不把這個 raw probe 當成必須加入的正式過濾 |
| B01 Bridge | C4/C6/C8 | F2/F3，Adapter／QA 已補 A 的候選；loader 給相同三個 ID、秒數、逐字稿 | 可信 A/VA scope | matches/citations 可非零，text 取 loader，非取媒體描述 | 保留缺原始課程欄位經正常轉換後的引用 |
| B02 Bridge | C8 | F3，錯 course／video／chunk 候選或 loader，另備合法文字 fallback | 可信 A/VA scope | 越界 evidence 不成為引用；合法 fallback 可回 VA。只有 fallback 也空時才要求總結果零 | 不以「丟棄壞候選」誤要求「所有合法答案也清空」 |
| B03 Bridge | C8 | F3，同 ID 候選與 loader 起訖不符或逐字稿空；fallback 分別設合法與空 | 正常 scope | 不用不一致 evidence；合法 fallback 非零、空 fallback 為零，兩個獨立子例 | 維持原始時間與正常文字降級，不改時間湊成通過 |
| B04 Bridge／呼叫端 | C4/C5/C8 | F2 原始 Leaf 缺課程，分「直接傳 raw」及「QA asEvidence 正規化後」 | 同一合法影片與 loader | raw 缺候選必填欄位可被排除／回退；正式轉換後應可接受。不可由 raw 被拒推論資料庫必須補寫 | 防止混淆 DB schema 與候選契約而破壞 legacy |
| B05 呼叫端信任界線 | C6/C8 | F3，scope、候選及 loader 全部被內部呼叫端一致偽造成 B/VA | 直接呼叫 Bridge | 本函式無原使用者／Course repository，不能期待它證明偽造；列為不受信任呼叫端超出前置條件。必須以 Q02/Q04 驗外部邊界 | 若要新增獨立授權職責屬契約變更，不能偷偷放進測試 |

## 契約不明與實作缺陷的判定

| ID／責任 | 依據與前置來源 | 輸入與現況 | 預期／判定理由 | 合法功能影響及待決事項 |
|---|---|---|---|---|
| U01 QA／Adapter 的跨模組契約 | C3/C6/C7/C9、F5；合法掛載確有程式與 route tests | B 合法掛 VA，但 Leaf 明示 courseId=A；Video-only QA 可取，Adapter 明示衝突規則會丟棄，可能降級成合法文字答案 | **契約不明／衝突，尚未執行本例。** 跨課掛載的讀取權已成立，但冗餘 Leaf.courseId 代表來源課程還是額外 ACL 未定；不能僅把 Adapter 拒絕或接受任一方當全系統通過 | 先定義合法掛載下多模態應否沿用影片關係；目前不能任選改 filter、補 courseId 或忽略所有衝突 |
| U02 媒體 metadata 與原始課程欄位 | C6/C7/C9、F5；media meta 記原製作時課程 A，B 合法掛載 | 原始 Leaf.courseId 缺少而 metadata.courseId=A；目前相容性檢查不把 metadata 課程當權限憑證 | **語意需確認，不是已證實漏洞。** 製作來源身份不必然等於當次授權課程；要先決定能否跨課重用同 Chunk 向量 | 強制 metadata.courseId=B 可能讓所有合法共享影音失效；不以安全名義默改 |
| U03 文件／註解漂移 | C3/C5/C10、既有 bridge-scope tests | bridgeContractPath 呈現字串提到 videos.videoId、model 註解稱 QA 同時 courseId＋videoId；實際文字 scope 只加 videos._id、只按 canonical videoId | **已確認說明與實作不一致**，以目前程式／測試／API 契約為準；不是把 alias 或 mandatory course filter 加回去的理由 | 最小修正先改說明；若涉及 runtime 的 bridgeContractPath 字串也須另核准，不在本輪改程式 |

針對前輪已觀察的 B/VA 偽造 scope，**沒有證明違反既有 Adapter 契約的實作缺陷**。新的缺陷必須有「合法前置＋違反既有明確預期」的可重現案例；例如 QA 若真的採用 body.allowedVideoIds，或可信 A scope 下仍引用 VB，才可依 Q04/Q05 定為缺陷。未做這些新測試前，不宣稱已通過或已失敗。

## 現有測試與矩陣對照

| 已讀測試 | 已有內容與尚缺內容 |
|---|---|
| [bridge-scope](../../../backend/tests/bridge-scope.service.test.js)、[qa-scope-monitoring](../../../backend/tests/qa-scope-monitoring.service.test.js) | 明確允許 canonical videoId＋無 courseId；拒絕空 allowlist、alias／外來影片；支援 Q03/Q05/Q07/A03，未測 HTTP 注入 |
| [qa.service](../../../backend/tests/qa.service.test.js) | `falls back to course video whitelist...`、`uses canonical video._id...`、`scopes QA to pipeline metadata...`；已存在 legacy 與 scope 建構保護，不能因新測試改成零筆 |
| [qa.routes](../../../backend/tests/qa.routes.test.js)、[enrollment.routes](../../../backend/tests/enrollment.routes.test.js) | 登入、非擁有者教師 403、缺 courseId 的合法片段、修課撤銷等；qa.routes 的舊註解稱學生可讀每課，與目前 C2 不符，不把註解當授權規則。Q02 學生拒絕與 Q04 注入仍應專門補測 |
| [course-video.routes](../../../backend/tests/course-video.routes.test.js) | 教師合法掛載另一自有課程、重複掛載拒絕、學生／非管理者不能掛載；已有合法跨課共享的明確證據，U01 尚缺多模態 QA 組合 |
| [Atlas Adapter](../../../backend/tests/atlas-multimodal-adapter.service.test.js) | 正常 candidate fixture 本身就沒有 courseId，成功後補為可信 scope 課程；混入外來 video／明示其他課程會丟棄。A01 不是新例外 |
| [QA Bridge](../../../backend/tests/multimodal-qa-bridge.service.test.js) | 合法逐字稿、錯誤 ID／時間、空 evidence、文字 fallback、設定分版；壞候選案例以空文字回退才期待零，不能推廣成所有情境零筆 |
| [多模態 QA 整合](../../../backend/tests/multimodal-qa.integration.test.js)、[FAQ routes](../../../backend/tests/faq.routes.test.js) | 正式 askQuestion 經 Fake embedding／Atlas 的接線、降級、引用與 FAQ scope 重驗；現有多模態正向 fixture 帶 courseId，仍需補缺欄位的 flag ON 與 Q04/U01 組合 |

## 供審查的最小修正方案及順序

1. **先修正驗收解讀與測試設計，正式程式零修改。** A05 改為前置條件違反觀察；以 Q02/Q04/Q05 做真正外部授權測試，以 A01/Q03 保護合法缺欄位資料。保留前輪原始失敗紀錄及安全回復證據，不偽造通過報告。
2. 核准測試階段後，只在既有測試檔補上述 fixture 與斷言；先驗 flag OFF，再驗 ON、降級及 FAQ。優先 Q02/Q03/Q04/Q05/Q08、A01、B01/B02。測試只寫記憶體 store，provider／Atlas 均 Fake；先不重新寫真實 Atlas。
3. U01/U02 先由使用者確認「合法掛載的影片是否共用同一 Leaf／向量，Leaf／media metadata 的 courseId 是否僅表來源」。建議沿用既有影片授權關係，但這只是建議；不得以本文件直接核准更改 Adapter 明示衝突規則。U03 可先做文件更正，runtime 字串另列小修正候選。
4. 只有新測試在合法前置下證實明確違約，才提出該層最小程式修補並取得授權。禁止為 A05 加 mandatory courseId filter、補寫 Atlas.courseId、移除合法 Chunk、修改 RRF 或擴大 Bridge 職責。未取得一致契約前不重啟 Atlas 寫入／索引變更。

契約審查當輪只交付分析與待審矩陣，沒有執行新矩陣、修改正式模組／資料、重新連線 Atlas、付費模型或部署。之後已依文件保存授權獨立提交於 `0891715`；這不改變實作與驗收標籤仍待後續授權及證據的限制。
