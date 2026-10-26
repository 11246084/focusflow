# F 工單：YouTube 恢復與原片清理審查修正

本工單將 [2026-10-25 審查報告](../evidence/2026-10-25_codex-review.md)的 R01～R12 拆成可驗收的修正組，實作仍以[決策第 1～34 條](../decisions.md)為準。先修測試替身，再依下列相依順序處理，避免測試通過卻漏掉誤刪與重複上傳。**工單已核可；本輪只補充並提交工單，不開始改程式**。

建立日期：2026-10-25。審查程式基準為 `e22c98731c01aa078a47291ad509657098ae23dd`；審查文件提交為 `edf170aac4228934e17d2fb11cd75a398f7a74c4`。接手時重新核對當前程式，不把報告行號當成永遠不變。

## 工作邊界與相依順序

- 先讀根 [AGENTS.md](../../../../AGENTS.md)，確認本輪授權與 `git status --short`；保留其他對話的異動，不回退、不順手格式化或提交他人檔案。第一個 Node 指令先確認版本符合根 README。
- 本輪只修改並 commit 此工單，使用 `git commit -- <本工單路徑>`，沿用本機 Git 身分、不加 AI 署名、不 push。`decisions.md` 的異動屬於另一個討論，不碰；`docs/README.md` 索引之後再一起登記。
- 未來實作亦不預先授權 Shared Atlas／索引異動、VM 部署、啟用清理、真實 YouTube 上傳／改隱私或刪除使用者原片。測試只能使用自建暫存檔、mock YouTube、明確指定的隔離 Mongo；不得載入正式連線作為測試預設。
- 不改第 1～34 條已定案內容，不併入每日額度待答方案。需要新增 collection／index 或改變既有匯入與共享語意時，先提出具體資料契約與遷移方案，不能直接套到 Shared Atlas。
- 本工單是修正範圍與驗收要求；新增資料結構等建議並非已定案設計。若實作需要新增設計選擇，依 AGENTS.md 記錄於 decisions.md，再取得必要決定。

| 順序 | 組別 | 對應問題 | 前置與交付條件 |
|---|---|---|---|
| F0 | 測試替身與憑證 fixture | 跨組基礎 | 先修快照與環境隔離，確認既有測試不再靠共用物件成立 |
| F1 | 檔案識別與共用檔保護 | R01、R02；清理控制 R08、R09 | 依賴 F0；提供預告、刪除、來源檢查共用的判斷與實體檔案識別 |
| F2 | 原子佔用與並行 | R03～R06 | 依賴 F0；檔案清理／補回互斥接 F1 的檔案識別；取得工作所有權後才能執行副作用 |
| F3 | 補回後重新處理 | R07 | 依賴 F1、F2；先完成後端狀態轉移，再接教師與管理員操作 |
| F4 | P2 狀態顯示與紀錄 | R10～R12 | 依賴 F0；R11 使用 F1 的預告資料，最後與 F2／F3 整合驗收 |

F1、F2 都會改 `youtubeUpload.service.js`、`youtubeLifecycle.service.js`；F2、F3 都會改 `video.service.js`。同一檔案一次由一個實作者負責，後續組接續既有成果，不直接套用互相覆蓋的 patch。

**每日額度的後續相依：**`decisions.md`「額度用完的處理」定案後，另行實作每日額度功能，排在 **F2 之後**，並沿用 F2 的原子佔用。該功能會改到 `youtubeUpload.service.js`、`shortAssetPublish.service.js`、`shortAssetRecovery.service.js`，需接續 F2 成果；F 工單不需要先為額度預留狀態，也不先實作等待額度的分支。

## F0：讓測試能看見真實的快照與設定

**要改的檔案：**[backendTestHarness.js](../../../../backend/tests/helpers/backendTestHarness.js)、[youtube-quarantine.service.test.js](../../../../backend/tests/youtube-quarantine.service.test.js)，以及因更正快照行為而暴露出不合理假設的受影響測試。可新增 harness 專用測試，檔名沿用既有慣例；本工單未建立該測試。

### `.lean()` 快照

- 目前 `.lean()` 直接回傳 store 中同一個物件。改成查詢求值時回傳獨立資料快照，後續資料庫替身更新不得反向改變已讀取的結果；修改結果也不得寫回 store。
- 複製須保留 Date、ObjectId 等測試實際使用的型別與比較語意，包含巢狀 `youtubeUpload`。不要以 JSON 字串化破壞型別，也不要假定 `structuredClone` 會保留 BSON 自訂原型；先盤點 fixture，再實作及驗證複製方式。
- 保持 `find/findOne/findById → select/populate/sort/limit/lean → await` 的使用方式；排序／切片不得改動 store 的原始陣列。必要時一併補足現有 query 替身，不藉這次工作全面重寫 ORM。
- 審查競態測試須固定「讀完候選 → 另一請求更新 → 原請求繼續」順序，使用可控制的 promise 等待點，不靠任意 sleep。修正後驗證狀態應重新查詢或明確讀 store，不依賴早先取得的物件自行變化。

### quarantine 憑證 fixture

- 在每個案例開始時保存並明確設定 `env.youtubeClientId`、`youtubeClientSecret`、`youtubeRefreshToken`、`youtubeOAuthClientId`、`youtubeOAuthClientSecret`、`youtubeOAuthRefreshToken`、`youtubeUploadAccessToken`，並保存／還原開關與測試所需的其他設定。
- 正常案例只放固定假憑證；「無憑證」案例清空主名稱、別名及直接 access token，不能只清空其中一個欄位。對應環境輸入為 `YOUTUBE_CLIENT_*`、`YOUTUBE_REFRESH_TOKEN`、`YOUTUBE_OAUTH_CLIENT_*`、`YOUTUBE_OAUTH_REFRESH_TOKEN`、`YOUTUBE_UPLOAD_ACCESS_TOKEN`。
- 每個案例重設 YouTube credential state；若替換 `global.fetch`，須在可能失敗的非同步操作之前保存原值，並由 `finally`／可靠的 afterEach 還原，不讓前一測試失敗後造成後面的 `fetch is not a function`。
- 測試設定不可從真實 `.env` 補足缺值；不讀取或輸出秘密。禁止意外外連的 mock 應遇到非預期 URL 即失敗，HTTP route 測試只放行本機測試 server。

**驗收：**F0-T1 查詢結果與 store 雙向隔離，巢狀欄位也隔離；F0-T2 Date／ObjectId 與查詢鏈仍正確；F0-T3 假設主／別名初始值各自存在，無憑證案例仍穩定不呼叫 YouTube；F0-T4 模擬測試中途失敗，fetch 與 env 均還原。修改共用 harness 後執行 backend 全套，不只重跑 lifecycle 檔案；再以隔離 Mongo 驗證 F2 的條件更新，不能讓 harness 代替真正的唯一性／交易保證。

### 隔離 Mongo 的執行方式

- 沿用 [backend/integration/auth.mongo.js](../../../../backend/integration/auth.mongo.js) 的做法：只接受帶明確 port 的 bare loopback URI（`mongodb://127.0.0.1:<port>` 或 `mongodb://localhost:<port>`），拒絕 Atlas、其他主機與 URI 內指定既有資料庫；不從正式 `.env` 取得連線預設。
- 本機用 Docker 啟動 Mongo，發布埠必須綁定 `127.0.0.1`（`-p 127.0.0.1:<host-port>:27017`），不發布到所有網路介面。測試直接使用真實 Mongo driver／Mongoose，不載入記憶體 harness；沿用 `autoIndex: false`、`autoCreate: false`，所需 collection／index 只在測試資料庫明確建立。
- 每次執行產生隨機資料庫名稱，例如 `focusflow_youtube_test_` 加 `crypto.randomBytes(8)` 的十六進位字串。測試完成後刪除本次資料庫並關閉連線；失敗路徑也由 teardown／finally 清理。刪除前核對名稱符合本次產生的名稱與測試前綴，不能刪既有資料庫；清理失敗須明確回報。
- 驗收連線守門會拒絕非 loopback URI、並行測試使用不同資料庫，以及成功／失敗案例結束後測試資料庫均移除。F2 與 F4 的隔離 Mongo 驗證共用這些限制；本輪僅記錄規則，不啟動 Docker 或執行資料庫測試。

## F1：檔案識別、共用檔與清理控制

**要改的檔案：**[youtubeUpload.service.js](../../../../backend/src/services/youtubeUpload.service.js)、[youtubeLifecycle.service.js](../../../../backend/src/services/youtubeLifecycle.service.js)、[shortAssetCleanup.service.js](../../../../backend/src/services/shortAssetCleanup.service.js)、[localVideoSource.js](../../../../backend/src/utils/localVideoSource.js)。共同判斷如需抽成 helper，沿用 backend 分工；schema 是否增加正規化欄位須先有資料相容方案。

**測試落點：**[youtube-upload.service.test.js](../../../../backend/tests/youtube-upload.service.test.js)、[youtube-lifecycle.service.test.js](../../../../backend/tests/youtube-lifecycle.service.test.js)、[short-asset-lifecycle.service.test.js](../../../../backend/tests/short-asset-lifecycle.service.test.js)。

**實作要求：**

- 預告與實刪使用共同的檔案識別及安全條件；Video／ShortAsset 的引用要雙向檢查，包含草稿、退回、處理中及不在候選中的紀錄。不能只擋清理短片方向。
- 絕對與相對路徑以同一根目錄解析，核對實際路徑是否位於實際 `UPLOAD_DIR` 內。明確處理 symlink／junction 與不存在的檔案；查詢或路徑辨識失敗時不得猜測為無共用。對連結造成的身份／邊界問題不得僅靠原始字串相等。
- 清理保留期仍由共用政策判斷：低空間遵守最短保留期，超最長保留期獨立處理，0 停用最長保留；補回用較新的 restoredAt 起算。保持一般影片先切播放欄位、短片保留 filePath 的既有規則。
- 每次 `low_space` 刪除前重查可用空間，達門檻即停；以實際成功結果決定是否補選，不預先把失敗／跳過計入釋放量。空間讀取失敗時不得繼續依未知低空間理由刪檔；最長保留期路徑仍依決策處理。
- 在完成非破壞性查詢後、最接近 unlink 的位置重查 cleanup 開關；關閉或讀取失敗即停止。候選需攜帶檔案識別、保留期起點或版本供 F2 再驗證，不能只傳 ID 後刪掉目前最新來源。
- 預告是當下估算；資料、空間或開關改變時可減少／重新判斷實刪清單，不得為了維持舊清單一致而刪除。仍須共用同一套政策，必要的回應欄位同步到 F4 與 API 文件。

| 案例 | 必須證明的結果 |
|---|---|
| F1-T1／R01 | 到期 Video 與短片草稿共用同檔，以及反方向共用：預告不列、實刪拒絕、兩者檔案仍存在 |
| F1-T2／R02 | 絕對／相對與可正規化的不同路徑寫法指向同檔，另一筆仍在 processing 時不能刪；根目錄本身與根外路徑拒絕 |
| F1-T3／R02 | 暫存 UPLOAD_DIR 內連結指向外部暫存目錄，外部檔案不能被刪；Windows junction 與正式站相同 OS 的 symlink 各驗證，權限不支援需列未完成，不能算通過 |
| F1-T4／R08 | 第一支刪完後空間由其他工作恢復，剩餘 low_space 候選不刪；max_age 仍處理；第一支失敗／跳過不虛增已釋放空間 |
| F1-T5／R09 | 單支檔案等 DB 查詢時關閉開關或令設定讀取失敗，放行後不 unlink；影片與短片都驗證 |
| F1-T6／政策 | 最短／最長保留邊界、最長設 0、補回重算、舊影片、statfs 失敗、短片草稿／退回不刪、已上架／封存可刪；固定狀態下 enable 預告與實刪一致 |
| F1-T7／錯誤 | unlink 失敗仍可播放且保留可重試來源；unlink 成功但 DB 回寫失敗有明確可恢復結果，不永久擋住補回或再次誤刪；診斷數量不重複計算 |

本組使用 F0 的快照測試共用引用在查詢後改變的情境；「引用／路徑核對後仍被其他操作改變」的互斥交由 F2 整合驗收。

## F2：原子佔用與並行操作

原子佔用是把「目前仍符合條件」與「取得這次工作所有權」放在同一次受保護的更新，避免兩個請求都先通過檢查。

**要改的檔案：**[youtubeLifecycle.service.js](../../../../backend/src/services/youtubeLifecycle.service.js)、[youtubeUpload.service.js](../../../../backend/src/services/youtubeUpload.service.js)、[shortAssetCleanup.service.js](../../../../backend/src/services/shortAssetCleanup.service.js)、[shortAssetPublish.service.js](../../../../backend/src/services/shortAssetPublish.service.js)、[shortAssetRecovery.service.js](../../../../backend/src/services/shortAssetRecovery.service.js)、[youtubeQuarantine.service.js](../../../../backend/src/services/youtubeQuarantine.service.js)、[video.service.js](../../../../backend/src/services/video.service.js)。若需要持久化所有權／版本，另核對 [video.model.js](../../../../backend/src/models/video.model.js)與 [shortAsset.model.js](../../../../backend/src/models/shortAsset.model.js)及相關讀寫入口。

**測試落點：**既有 youtube lifecycle／upload／quarantine、short asset recovery／lifecycle／routes、video source restore 測試；新增隔離 Mongo 測試可放 `backend/integration/`，不混用 Shared Atlas 或啟動正式 server 觸發 autoIndex。

**實作要求：**

- 清理的行程鎖在第一個 await 前取得，並確保所有 return／throw 都釋放；若採 await 後再檢查，須有明確互斥證明。單筆 cleanup、restore 與重處理共用所有權規則；核對 F1 候選的原檔案／保留期版本，不得以舊候選刪掉新來源。
- 一般影片與短片上傳核心都要重新確認當前狀態。重試佔用包含 `failed + retrySafe=true + attempts 未滿 + 已到期` 及觀察版本；初次上傳另用其允許條件。成功／失敗回寫只接受該次 attempt，過期工作不能覆寫新工作。
- 短片 tracked map 不得只計數：所有開始上傳入口都須取得同一筆工作的排他權。保留「關閉開關不中斷進行中上傳」與「正在傳送不誤隔離」的決策。
- 隔離套用需在 Video／ShortAsset 之間保證一個 YouTube 備份只歸屬一個上傳內容；「先查再寫」不足。提出共用所有權記錄或受部署限制的互斥方案，處理驗證失敗、回寫失敗與重啟恢復；先核對匯入／共享語意，不能直接對所有 Video 加 unique index。
- DB 無法確認工作所有權或引用安全時，不執行外部上傳／刪檔。任何新鎖都須定義失敗恢復方式，不以永遠卡住換取表面互斥。

| 案例 | 必須證明的結果 |
|---|---|
| F2-T1／R03 | 兩輪清理同時開始只接受一輪；第一輪刪除、使用者補回、舊輪恢復時，新檔仍存在且保留期從補回起算 |
| F2-T2／R03 | 候選後 filePath／restoredAt／處理狀態／短片版本改變，舊候選拒絕刪除；補回、重處理與清理交錯不能讀到被刪來源 |
| F2-T3／R04 | 取出 A／B 候選後卡住 A；教師重試 B 並在送出 bytes 後失敗，放行 A 後 B 不再上傳；影片與短片各測一次 |
| F2-T4／R04 | 候選後 nextRetryAt 推遲、attempt 到上限或已上傳，核心不佔用；本次仍為 unsafe 的項目保持隔離 |
| F2-T5／R05 | 教師雙重試、教師與恢復、建立／換代與其他上傳入口交錯，同一 attempt 至多一個 session／PUT；遲到結果不能覆寫較新版本 |
| F2-T6／R06 | 兩個 Video、Video 與 ShortAsset 同時套相同 YouTube ID，至多一筆成功；輸家來源不清理；無此影片／非自家頻道仍拒絕 |
| F2-T7／失敗恢復 | 在外部驗證、狀態回寫、刪檔前後注入失敗，鎖不永久遺留、不重複上傳、不刪新檔；重啟恢復遵守 safe／隔離規則 |

F2-T3 必須用 F0 的獨立 `.lean()` 快照，不能讓候選跟 store 一起變動。F2-T1、T5、T6 另在隔離 Mongo 驗證條件更新／唯一性；不能僅憑 mock 宣稱資料庫保證成立。通知保持同一次失敗只通知一次，retry_limit 仍只允許重設。

## F3：補回後重新處理

**要改的檔案：**[video.service.js](../../../../backend/src/services/video.service.js)、[videoProcessing.service.js](../../../../backend/src/services/videoProcessing.service.js)、[video.controller.js](../../../../backend/src/controllers/video.controller.js)、[video.routes.js](../../../../backend/src/routes/video.routes.js)；前端 [youtubeLifecycle.js](../../../../frontend/focus-flow/src/services/youtubeLifecycle.js)、[TeacherCourses.jsx](../../../../frontend/focus-flow/src/pages/TeacherCourses.jsx)、[AdminVideos.jsx](../../../../frontend/focus-flow/src/pages/AdminVideos.jsx)、[RestoreSourceModal.jsx](../../../../frontend/focus-flow/src/components/RestoreSourceModal.jsx)。控制器／路由僅在選定契約有需要時改動，不預設一定新增端點。

**測試落點：**[video-source-restore.routes.test.js](../../../../backend/tests/video-source-restore.routes.test.js)、[course-video.routes.test.js](../../../../backend/tests/course-video.routes.test.js)、[youtubeLifecycle.test.js](../../../../frontend/focus-flow/tests/youtubeLifecycle.test.js)與相關頁面的實際互動驗證。

**實作要求：**提供 completed 且有可用來源的明確重新處理路徑，不用先偽設 failed 繞過檢查；保留既有 failed 重試。後端使用 F2 的條件佔用，先驗課程權限與 F1 來源安全，再排程；教師／admin 的操作能力與成功訊息要一致。補回仍只存回同一影片，不自動重傳 YouTube，不提供短片補回。

| 案例 | 必須證明的結果 |
|---|---|
| F3-T1／R07 | 真正的 completed 影片經清理 → 補回 → 明確重新處理 → completed，全程同一影片 ID／YouTube ID，來源保留期重算，YouTube 上傳次數不增加 |
| F3-T2／權限 | 課程教師與 admin 可操作；學生、其他課程教師被拒；補回格式／容器不合格、尚未清理、來源不存在均維持正確錯誤與狀態 |
| F3-T3／並行 | 兩次補回、兩次重新處理、重新處理與 cleanup 交錯，只有合法操作取得所有權；輸家新檔安全清理，不誤刪贏家來源、不重複排入 STT |
| F3-T4／畫面 | 教師與 admin 實際完成補回後看到可用的重新處理操作；來源未補回時停用並說明；送出中防重複、失敗留在原視窗，成功後資料更新 |
| F3-T5／播放 | 補回與重新處理期間學生仍用原 YouTube 播放；失敗不改走 YouTube 下載；既有引用與問答仍指向同一影片 |

原本手工建立 failed 的測試保留作失敗重試案例，另補 F3-T1，不能改名後繼續當正常生命週期的證據。前端 API mock／純函式通過不足以驗收 F3-T4；至少以掛載元件或本機瀏覽器搭配假 API 驗證實際按鈕與更新流程，新增測試工具依賴須說明用途。

## F4：P2 的狀態顯示與紀錄

**要改的檔案：**[systemStatus.service.js](../../../../backend/src/services/systemStatus.service.js)、[youtubeAdmin.service.js](../../../../backend/src/services/youtubeAdmin.service.js)、[youtubeLifecycleSettings.service.js](../../../../backend/src/services/youtubeLifecycleSettings.service.js)、[runtimeSetting.model.js](../../../../backend/src/models/runtimeSetting.model.js)（僅新增版本欄位等確有需要時）；前端 [AdminOverview.jsx](../../../../frontend/focus-flow/src/pages/AdminOverview.jsx)、[AdminYouTubeLifecycle.jsx](../../../../frontend/focus-flow/src/pages/AdminYouTubeLifecycle.jsx)與 [youtubeLifecycle.js](../../../../frontend/focus-flow/src/services/youtubeLifecycle.js)。

**測試落點：**[system-status-security.test.js](../../../../backend/tests/system-status-security.test.js)、[youtube-admin.routes.test.js](../../../../backend/tests/youtube-admin.routes.test.js)、[youtube-lifecycle.service.test.js](../../../../backend/tests/youtube-lifecycle.service.test.js)、前端 lifecycle 測試與總覽互動驗證。

**實作要求：**總覽讀當次三個開關的 effective／reason，區分憑證可用與功能啟用；固定呈現 7 天內到期數量與清單，不以另一頁已有清單取代。沿用 F1 的預告資料與政策。history 的 from/to 必須反映每次成功寫入當下的實際值，以版本條件更新及重試或能取當前值的原子更新完成；首次 upsert、同值更新、歷史 50 筆上限都需明確處理，不快取、不寫 UsageLog。

| 案例 | 必須證明的結果 |
|---|---|
| F4-T1／R10 | 環境 true／runtime false、環境 false／runtime true、尚無設定、DB 讀取失敗，總覽、管理頁與 health 對實際生效值及原因一致，未知不能顯示啟用 |
| F4-T2／R11 | 7 天內到期的影片與短片出現在總覽清單，支數／容量／時間／原因與同時點 upcoming preview 一致；空清單與讀取錯誤有明確畫面；非 admin 不能讀設定或管理清單 |
| F4-T3／R12 | 同時 true／false、首次建立競爭及連續多次更新，成功紀錄的 from/to 可銜接、操作者／時間正確，只保留最近 50 筆，衝突重試不重複紀錄 |
| F4-T4／整合 | 啟用清理前取 enable 清單，取不到不啟用；確認期間資料改變仍受 F1／F2 保護；錯誤訊息不洩漏憑證，retry_limit 的動作限制及通知導向維持 |

本組以 F0 的 fixture 明確建立「憑證可用但 runtime 關閉」，不得依賴本機 `.env`；history 並行亦補隔離 Mongo 的實際寫入測試。R08、R09 已歸 F1，不能因為本組標示 P2 而漏修。

## 整合檢查與交付

- 先跑每組對應的 node:test；修改共用 harness、跨服務及發布前整合時，backend 執行 `npm.cmd test`。新增 API／回應欄位同步 [OpenAPI](../../../../backend/docs/openapi.yaml)、[API 契約](../../../../backend/docs/phase2-api-contract.md)與必要錯誤碼規範，執行 route 契約測試及 `npm.cmd run docs:lint`。
- F3／F4 整合後，在 `frontend/focus-flow` 執行 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`，並保留管理總覽、啟用確認、教師與 admin 補回後操作的實際畫面／流程證據。
- 檔案測試只使用自建暫存目錄；Mongo 測試先核對目標為隔離實例，無法使用時列為未完成。STT／FFmpeg、真實 YouTube 與正式清理是否執行分開列，mock 通過不寫成外部驗收。
- 用一份整合案例完成：正常影片／短片與共用來源 → enable／upcoming 預告 → 開關／空間變動 → 清理及故障恢復 → 補回原片 → 重新處理；同時執行競爭請求，證明保留期、播放、來源與外部副作用一致。
- 每組交付「R 編號 → 修改檔案 → 測試名稱／結果 → 未完成限制」對照；全部 R01～R12 都要有結案證據。功能進度只更新 `docs/current-status.md`，本工單與審查報告保留為工作範圍與證據，不倒改原始審查結論。
- 實作完成另作獨立 diff review，確認無誤刪、無重複上傳及未破壞既有匯入／短片流程，再依決策 #33 安排正式驗收。實作 commit、push、部署與啟用清理均依當時使用者授權，不沿用本次僅提交審查文件的同意。

本輪停止點：補完以上規則後只提交此工單，不執行上述實作、不 push。
