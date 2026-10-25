# YouTube 上傳恢復與原片清理：獨立程式審查

本報告依[設計決策第 1～34 條](../decisions.md)審查 `dev` 的實作，供修正與清理啟用前驗收使用。結論為**需修正後再驗收**：確認 7 項 P1、5 項 P2，涉及誤刪、重複上傳、補回後無法重新處理，以及管理資訊不完整。這是本機程式審查證據，不代表部署或正式環境驗收。

## 審查基準與邊界

- 實際審查日期：2026-10-25（Asia/Taipei）；檔名與審查日期一致。
- 分支／版本：`dev`，`e22c98731c01aa078a47291ad509657098ae23dd`；開始時工作目錄乾淨。以下行號皆指此版本。
- 範圍：上傳、恢復、清理、隔離收尾、通知、runtime 設定、admin／video 路由，以及管理頁、教師頁、補回原片與相關測試；必要時追查直接相依的 service／model。
- 方法：主審檢查清理與 runtime，另由兩個 `focusflow_reviewer` 分別唯讀檢查上傳／隔離與前端。問題經程式交叉核對；下文「重現」明確區分測試替身實驗與靜態追蹤。
- 未修改程式、測試、設定或資料庫；未連 Atlas、未啟動正式 backend、未呼叫真實 YouTube API、未部署、未刪使用者原片。實驗檔案只建立在各次新建的暫存目錄，Mongo 使用既有記憶體替身，YouTube 使用 mock。
- 僅新增本報告與修改同功能的 `HANDOFF.md`；依本次兩檔範圍，不另修改文件總索引或功能狀態正本。尚未 stage、commit 或 push。
- 額度用完的 R1 待答方案不在第 1～34 條內，不以未定案方案判定缺陷。第 33 條涉及部署與正式驗收，不能用本次測試代替。

## 問題總表

P1：應優先修復，可能造成不可逆刪檔、重複外部上傳或主要流程無法使用。P2：應修復的行為／決策落差；不是純風格建議。未確認 P0。

| 編號 | 嚴重度 | 問題 | 決策 |
|---|---|---|---|
| R01 | P1 | 一般影片清理未檢查短片共用檔，能刪掉草稿來源 | #4、#28、#30 |
| R02 | P1 | 共用檔只比較路徑字串，同檔不同寫法可繞過保護 | #4、#28 |
| R03 | P1 | 清理鎖有空窗，重疊執行可刪掉剛補回的原片 | #22、#24、#27 |
| R04 | P1 | 恢復沿用舊候選，可重新上傳已變成不可安全重試的影片 | #2、#3、#8、#28 |
| R05 | P1 | 短片上傳沒有原子佔用，同時重試會上傳兩份 | #2、#28 |
| R06 | P1 | 隔離套用的 YouTube ID 檢查非原子，兩支能綁同一份備份 | #18、#4、#28 |
| R07 | P1 | 正常清理後補回仍為 completed，無法重新處理 | #21、#23、#25 |
| R08 | P2 | 清理只讀一次磁碟空間，達門檻後仍可繼續刪 | #22、#27 |
| R09 | P2 | 開關檢查後還有多次等待，停用後仍可刪目前檔案 | #11、#14 |
| R10 | P2 | 系統狀態未呈現 runtime 開關實際生效值與原因 | #13 |
| R11 | P2 | 系統狀態只有到期數量，缺少將刪除清單 | #27② |
| R12 | P2 | 同時切換開關會產生錯誤的 from 修改紀錄 | #12 |

## 問題與修正建議

### R01｜P1：一般影片清理未檢查 ShortAsset 引用

**位置：**[youtubeLifecycle.service.js:126–143](../../../../backend/src/services/youtubeLifecycle.service.js#L126)、[youtubeUpload.service.js:377–381](../../../../backend/src/services/youtubeUpload.service.js#L377)。相對照，[shortAssetCleanup.service.js:59–68](../../../../backend/src/services/shortAssetCleanup.service.js#L59)同時查兩個集合。

**情境與影響：**一支已到期、處理與上傳皆完成的 Video，和一筆尚未完成上傳的短片草稿使用相同 `filePath`。一般影片的預告與刪除都只查 Video，會刪除短片仍需使用的來源，繞過草稿不清理的保護。

**重現：**記憶體資料建立上述兩筆、檔案置於新暫存 `UPLOAD_DIR`，執行預告與 `runYouTubeCleanup`。實測 `preview.count=1`、`cleaned=1`、`draftSourceExists=false`。這是指定共用資料狀態的重現，未宣稱正式資料已有此情形。

**建議：**影片、短片共用同一個檔案引用檢查，預告與實刪均納入兩個集合；不依引用方是否已上傳或是否為候選決定要不要保護。補兩個清理方向的測試，目前短片測試的跨集合保護不能證明一般影片方向安全。

### R02｜P1：路徑字串相等不等於實體檔案相同

**位置：**[youtubeUpload.service.js:87–95](../../../../backend/src/services/youtubeUpload.service.js#L87)、[youtubeLifecycle.service.js:126–143](../../../../backend/src/services/youtubeLifecycle.service.js#L126)、[shortAssetCleanup.service.js:59–68](../../../../backend/src/services/shortAssetCleanup.service.js#L59)。實刪同樣以原始 `filePath` 查引用，見 [youtubeUpload.service.js:377](../../../../backend/src/services/youtubeUpload.service.js#L377)、[shortAssetCleanup.service.js:135–138](../../../../backend/src/services/shortAssetCleanup.service.js#L135)。

**情境與影響：**A 儲存絕對路徑，B 儲存相對 `projectRoot` 的路徑；兩者經 `resolveLocalUploadPath` 指向同一個檔案，但引用查詢沒有正規化。A 到期時會刪掉 B 尚在處理的原片。

**重現：**A 為到期影片，B 為 `processing`，用絕對／相對兩種寫法指向同一暫存檔。實測 `cleaned=1`、`otherVideoSourceExists=false`。

**路徑防護的額外限制：**`isPathInside` 只做字面路徑檢查，沒有 `realpath`／`lstat`；若 `UPLOAD_DIR` 內的子目錄是指向外部的符號連結／junction，字面在根目錄內不代表實際刪除目標也在內。本輪 Windows 沙箱建立 junction 回 `EPERM`，因此這個變體僅完成靜態確認，未完成刪除重現；未查正式環境是否存在此類連結，也未證明 HTTP 使用者能建立它。

**建議：**建立共同的檔案識別與路徑政策，先確認實際路徑位於實際 `UPLOAD_DIR` 內，再以一致的識別比對兩集合的引用；明確拒絕或正確處理連結目錄。補絕對／相對、路徑正規化及連結逃逸測試，且須在具有對應檔案系統行為的環境驗證。

### R03｜P1：重疊清理會刪掉剛補回的檔案

**位置：**[youtubeLifecycle.service.js:291–315](../../../../backend/src/services/youtubeLifecycle.service.js#L291)、[youtubeUpload.service.js:351–407](../../../../backend/src/services/youtubeUpload.service.js#L351)。

**原因：**`running` 在第 292 行檢查，但直到等待資料庫讀取開關之後，第 300 行才設為 true，且未重查。兩輪可以同時通過。候選只把 ID 傳給刪除函式；刪除函式重新取最新 `filePath`，卻不再核對候選的路徑、保留期起點或版本。

**重現：**同時啟動兩輪清理，讓第二輪停在單支 cleanup 入口；第一輪刪完後，透過真正的 `restoreVideoSource` 補回，再放行第二輪。實測兩輪均未 skipped、各回 `cleaned=1`，剛補回約 0.002 秒的檔案再次消失。只使用暫存檔與 Mongo 替身，等待點用來固定交錯順序。正式排程若讀開關長時間阻塞至下一個 tick，也有進入這個空窗的條件。

**建議：**在第一個 await 前取得行程鎖，或 await 後再次確認並原子佔用；另以路徑、保留期起點、狀態／版本做條件佔用，刪除與補回共用互斥規則。不能只修全域鎖而保留「拿舊候選 ID 刪最新來源」的設計。補兩輪清理與 restore 交錯測試，斷言新來源仍存在。

### R04｜P1：候選取出後變成 unsafe，恢復仍重傳

**位置：**[youtubeUpload.service.js:697–700](../../../../backend/src/services/youtubeUpload.service.js#L697)、[750–754](../../../../backend/src/services/youtubeUpload.service.js#L750)、[435–485](../../../../backend/src/services/youtubeUpload.service.js#L435)；短片對應 [shortAssetRecovery.service.js:115–147](../../../../backend/src/services/shortAssetRecovery.service.js#L115)與 [shortAssetPublish.service.js:159–206](../../../../backend/src/services/shortAssetPublish.service.js#L159)。

**情境與影響：**恢復先取出 A、B 兩筆安全失敗；等待 A 上傳時，教師重試 B，而 B 在送出內容後失敗，已被改為 `retrySafe=false`。A 完成後排程仍按舊候選重試 B。上傳核心雖再讀目前紀錄，卻沒有把目前 `retrySafe=true` 納入佔用條件，因而可能在 YouTube 留下兩份內容。

**重現：**後端審查子代理使用真正的 recovery 與教師重試服務、mock PUT 等待點，重現 B 從 `failed/retrySafe=false/attemptCount=2` 被排程再次上傳成 `uploaded/attemptCount=3`；恢復 PUT 共 2 次、教師 PUT 1 次。為模擬真實 Mongo 的獨立查詢快照，將測試替身 `.lean()` 結果複製；既有 harness 直接共用 store 物件，否則會掩蓋這個問題。短片有相同程式缺口，本輪此交錯實驗針對一般影片。

**建議：**在實際開始每次上傳時，以條件更新同時核對目前的失敗狀態、`retrySafe`、attempt 上限、到期時間及所觀察版本；候選僅作排程提示。初次上傳應與重試有明確不同的條件。補候選取出後被教師重試為 unsafe、退避時間被更新等測試。

### R05｜P1：同一短片可同時上傳兩份

**位置：**[shortAssetPublish.service.js:197–206](../../../../backend/src/services/shortAssetPublish.service.js#L197)、[261–269](../../../../backend/src/services/shortAssetPublish.service.js#L261)、[412–452](../../../../backend/src/services/shortAssetPublish.service.js#L412)。

**情境與影響：**兩個分頁同時重試同一筆安全失敗短片，皆可通過前置檢查。`runningShortAssetUploads` 只計數，沒有拒絕第二個工作；`findByIdAndUpdate` 也沒有狀態條件，兩者都呼叫 YouTube，結果再互相覆寫。

**重現：**後端審查子代理對 `retryShortAssetUpload` 做 `Promise.all`，YouTube 全部 mock。兩個 promise 均 fulfilled，建立 session 2 次、PUT 2 次，而最後記錄的 `attemptCount` 僅為 2，無法代表兩次並行外部動作。

**建議：**短片上傳核心以原子條件更新取得單筆工作所有權，包含尚無 YouTube ID、允許狀態與目前版本；成功／失敗回寫也須核對該次 attempt。行程內互斥作輔助，不能只在外層按鈕或排程檢查。補教師雙重試、教師與恢復同時開始的測試，斷言只有一個 session／PUT。

### R06｜P1：兩筆隔離項目可同時套用相同 YouTube ID

**位置：**[youtubeQuarantine.service.js:376–388](../../../../backend/src/services/youtubeQuarantine.service.js#L376)、[446–456](../../../../backend/src/services/youtubeQuarantine.service.js#L446)；[video.model.js:237–238](../../../../backend/src/models/video.model.js#L237)沒有此唯一限制。ShortAsset 的唯一索引也只在自己的集合內。

**情境與影響：**兩名管理員同時替不同隔離影片填入同一 ID。兩者先查均「未使用」，等待 YouTube 驗證後各自寫入成功。至少一支影片的播放會接到另一份內容，之後符合清理條件時還會刪除其唯一原片。

**重現：**兩筆 Video 同時 `applyQuarantinedItem`，mock 回相同自家頻道影片；實測兩個結果皆 fulfilled，兩筆 `youtubeVideoId` 均為 `sameVideo01`。現有測試只覆蓋呼叫前已被占用的情形。

**建議：**使用影片與短片共用、具唯一性的 YouTube ID 所有權保留機制，或在目前單行程部署下先提供涵蓋兩類來源的同 ID 互斥並清楚限制；成功寫入前須維持占用，失敗要釋放。不可直接對所有 Video 加唯一索引而忽略既有匯入／共用語意；資料契約與遷移須另行核對。補兩個 Video 及 Video／ShortAsset 交錯套用測試。

### R07｜P1：正常補回後沒有可用的重新處理路徑

**位置：**[videoProcessing.service.js:105–110](../../../../backend/src/services/videoProcessing.service.js#L105)、[video.service.js:548–561](../../../../backend/src/services/video.service.js#L548)、[youtubeLifecycle.js:291–304](../../../../frontend/focus-flow/src/services/youtubeLifecycle.js#L291)、[TeacherCourses.jsx:710](../../../../frontend/focus-flow/src/pages/TeacherCourses.jsx#L710)、[754–762](../../../../frontend/focus-flow/src/pages/TeacherCourses.jsx#L754)、[AdminVideos.jsx:50–53](../../../../frontend/focus-flow/src/pages/AdminVideos.jsx#L50)。

**情境與影響：**清理只接受 `processing.status=completed`；補回保留這個狀態，但重新處理只允許 `failed → queued`，前端也只有 failed 才顯示按鈕。正常使用者補回成功後，無法完成此功能承諾的重新處理。

**重現：**以 completed 且已清理的影片呼叫 `restoreVideoSource`，再呼叫路由實際使用的 `retryExistingVideoProcessing`，實測 `409 VIDEO_PROCESSING_TRANSITION_INVALID`，訊息為 `Cannot transition video processing from completed to queued.`。前端條件追蹤同樣沒有按鈕；管理員頁卻提示「現在可以重新處理」。

**測試缺口：**[video-source-restore.routes.test.js:287–297](../../../../backend/tests/video-source-restore.routes.test.js#L287)聲稱測補回後重新處理，卻先手工設為 `failed`；[前端測試:264–279](../../../../frontend/focus-flow/tests/youtubeLifecycle.test.js#L264)也只測 failed，沒有走真正清理後的狀態。

**建議：**提供已完成影片的明確重新處理狀態轉移及教師／管理員操作，保留原影片與 YouTube ID，並以條件更新避免重複排程、與清理互撞。不要靠偽造 failed 狀態修補。驗收應走 `completed → 清理 → 補回 → 重新處理 → completed` 且斷言 YouTube 上傳次數不增加。

### R08｜P2：空間恢復後，清理仍照最初推估刪除

**位置：**[youtubeLifecycle.service.js:205–216](../../../../backend/src/services/youtubeLifecycle.service.js#L205)、[304–328](../../../../backend/src/services/youtubeLifecycle.service.js#L304)。

**情境與影響：**候選以一開始的可用空間及檔案大小推估，一次決定整批；執行時沒有再讀 `statfs`。清理第一支後，其他工作也釋放空間而已達門檻，剩餘未超最長保留期的原片仍被刪。反之，預估能釋放的檔案若刪失敗／跳過，可能尚未恢復門檻就結束。

**重現：**以 `getFreeBytes` 模擬低於門檻 12 bytes、兩個各 8 bytes 的合格檔案；第一支刪完把空間改為 11 GiB。實測讀取次數僅 1、兩支皆刪。這個實驗確認執行控制，不是用 mock 數值宣稱真實磁碟容量。

**建議：**每個 `low_space` 刪除前重讀空間，達門檻即停；`max_age` 仍依最長保留期處理。依實際成功結果補選，不把未成功刪除視為已釋放。預告共用候選判斷，但應標明是某一時間的估算，不能用維持舊清單一致作為繼續刪除的理由。

### R09｜P2：停用清理後，尚未刪除的目前檔案仍可能被刪

**位置：**[youtubeUpload.service.js:353–399](../../../../backend/src/services/youtubeUpload.service.js#L353)、[shortAssetCleanup.service.js:118–146](../../../../backend/src/services/shortAssetCleanup.service.js#L118)。

**情境與影響：**開關在 cleanup 函式入口讀取，其後等待影片查詢、共用引用查詢及播放欄位更新。管理員在等待期間停用，該檔尚未開始刪除，後續仍直接 `unlinkSync`。目前測試只在上一支刪完後關閉，所以無法驗證決策要求的刪檔前檢查。

**重現：**在共用引用查詢的等待點，將 runtime cleanup 改為 false 後繼續執行；實測 `switchEnabled=false`、`cleaned=1`、檔案消失。

**建議：**完成其他非破壞性等待後，在最接近 unlink 的位置重新讀取開關，失敗或關閉就停止；一般影片與短片一致處理。補單支檔案刪除前關閉／讀取設定失敗的交錯測試。

### R10｜P2：系統狀態忽略 runtime 開關

**位置：**[systemStatus.service.js:93–103](../../../../backend/src/services/systemStatus.service.js#L93)、[189–196](../../../../backend/src/services/systemStatus.service.js#L189)、[youtubeUpload.service.js:963–977](../../../../backend/src/services/youtubeUpload.service.js#L963)、[AdminOverview.jsx:115–133](../../../../frontend/focus-flow/src/pages/AdminOverview.jsx#L115)。

**情境與影響：**環境允許且憑證正常，管理員 runtime 關閉上傳後，實際工作已停止；系統總覽仍使用只看環境／憑證的快照，不提供三開關的 effective／reason，容易誤判目前仍可上傳。

**證據：**靜態追蹤 `getSystemStatus → buildYouTubeUploadSnapshot → services`，沒有讀 lifecycle settings。相對地 `/health` 確實另讀 `buildYouTubeLifecycleSnapshot`，不能以 health 已完成推定總覽也完成。

**建議：**系統狀態也讀當次兩層開關結果，分開呈現憑證可用與工作實際啟用。補「環境 true、runtime false」的 API 與畫面測試。

### R11｜P2：系統狀態缺少 7 天內將刪除的清單

**位置：**[systemStatus.service.js:128–138](../../../../backend/src/services/systemStatus.service.js#L128)、[179–184](../../../../backend/src/services/systemStatus.service.js#L179)、[AdminOverview.jsx:115–133](../../../../frontend/focus-flow/src/pages/AdminOverview.jsx#L115)。

**情境與影響：**已有 7 天內到期影片時，總覽只顯示支數／容量，無法看到是哪幾支，也沒有直接導向；完整清單只有 [AdminYouTubeLifecycle.jsx:362–372](../../../../frontend/focus-flow/src/pages/AdminYouTubeLifecycle.jsx#L362)。這是第 27② 條的明確落差，並非誤刪證據。

**證據：**後端取得完整 upcoming preview 後丟棄 items，前端只顯示 detail 字串；沒有進行瀏覽器實測。

**建議：**總覽共用 preview 的 items，呈現數量與清單。若要改為僅提供導向，應先調整決策，不把現有另一頁當作已符合要求。補回應契約及元件顯示測試。

### R12｜P2：開關的修改紀錄無法準確反映並行操作

**位置：**[youtubeLifecycleSettings.service.js:163–183](../../../../backend/src/services/youtubeLifecycleSettings.service.js#L163)。

**情境與影響：**兩名管理員同時修改同一開關，兩者先讀到相同舊值，再依序寫入；後一筆 history 的 `from` 不是寫入前實際值。單一 pm2 行程仍會在 await 間交錯，不能消除此問題。

**重現：**尚無 runtime upload 設定時，同時執行 true 與 false；實測 history 為 `null→true`、`null→false`，後者應反映實際前值 true。開關最終值可寫入，但事故追查紀錄失真。

**建議：**以版本／舊值做條件更新並重試，或使用能從當下文件值建立 history 的原子更新；首次 upsert 競爭也要處理。補並行更新測試，除了 50 筆上限，也驗證每筆 from/to 可連續銜接。

## 已確認合理的實作與決策對照

「符合」限於下列程式與隔離測試所涵蓋條件，不代表上述競態已安全，也不代表正式環境已驗收。

| 決策 | 確認結果與依據 | 限制 |
|---|---|---|
| #1、#9～#11、#16 | [設定服務](../../../../backend/src/services/youtubeLifecycleSettings.service.js)每次讀 DB；實際值受環境與 runtime 雙重限制；缺設定時上傳／恢復沿用環境，清理預設關；DB 讀取失敗視為停用 | 停用時點另見 R09 |
| #2、#5、#8 | [上傳服務](../../../../backend/src/services/youtubeUpload.service.js)區分送出內容前／後失敗；一般教師重試有權限、safe 與上限檢查；恢復查詢篩選 due、安全與次數並排序 | 候選後變更與短片並行見 R04、R05 |
| #3、#7、#15 | 恢復開機執行、可定期執行、0 不建 timer；卡住項目做條件隔離；本行程仍在上傳的不誤隔離；立即恢復受開關控制 | 不代表外部 YouTube 故障已驗收 |
| #4 | 一般影片處理與 YouTube 狀態未完成時不清理；字面路徑在根外時拒絕；先切播放欄位再刪檔；刪失敗記錄錯誤 | 共用檔與實體路徑見 R01、R02；並行見 R03 |
| #6、#13 | [health.routes.js:16–34](../../../../backend/src/routes/health.routes.js#L16)含實際開關、排程與磁碟診斷；[admin.routes.js:11–23](../../../../backend/src/routes/admin.routes.js#L11)整組先驗證登入與 admin 身分 | 系統總覽另見 R10、R11；本次未查 live health |
| #12 | [runtimeSetting model](../../../../backend/src/models/runtimeSetting.model.js)記操作者、時間與歷程，更新以 `$slice` 保留最近 50 筆，未混入 UsageLog | 並行 from 值見 R12 |
| #14 | 已開始的一般上傳不因 runtime 關閉被中斷，下一次上傳／下一輪恢復檢查開關 | 清理的單檔等待空窗見 R09 |
| #17、#18、#29 | [隔離服務](../../../../backend/src/services/youtubeQuarantine.service.js)按影片／短片標記查詢；查詢不自動套用；套用前確認存在與自家頻道；無讀取能力時回報不可查詢 | 同 ID 的佔用競態見 R06；沒有讀權限的憑證也無法完成所有權驗證，手動填 ID 不會繞過安全檢查 |
| #19、#20、#34 | 教師頁／短片頁／錯誤表改為由管理員處理；[通知服務:513–578](../../../../backend/src/services/notification.service.js#L513)選啟用中 admin、依失敗時間防重複，處理後通知上傳者或課程教師；retry_limit 只允許重設，不能查詢／套用 | 以 mock 驗證通知寫入及前端導向，未查真實投遞 |
| #21、#23～#25 | [補回服務:506–577](../../../../backend/src/services/video.service.js#L506)驗課程權限、只接受已清理、沿用格式／容器檢查、同 ID 存回、條件更新防雙補回，錯誤清理新檔；保留 YouTube 播放與 ID，寫 restoredAt；既有 YouTube ID 會略過自動上傳 | 真正 completed 補回後重處理被 R07 阻斷 |
| #22、#24、#26、#27① | [清理服務](../../../../backend/src/services/youtubeLifecycle.service.js)一般與短片共用候選選擇；靜態資料下驗證最短／最長保留、0 關最長保留、補回重算、舊影片掃描與 enable 預告一致；查空間失敗只按最長保留期 | 動態空間與資料交錯見 R03、R08；不能把靜態清單一致等同每次實刪安全 |
| #27① | [前端服務:188–206](../../../../frontend/focus-flow/src/services/youtubeLifecycle.js#L188)啟用前先取預告，取不到即不產生確認動作；環境不允許時顯示原因且不能切換 | 未進行真實瀏覽器確認視窗驗收；preview 與啟用不是同一個交易快照 |
| #28、#30～#32 | [短片清理](../../../../backend/src/services/shortAssetCleanup.service.js)只接受 published／archived 且已上傳，草稿與退回不列入；保留 filePath、另記 localCleanupAt；清理後既有核准／退回仍能走 YouTube 路徑；無短片補回入口 | 共用、路徑與競態仍適用本報告問題 |
| #33 | 本次僅完成獨立 code review 與隔離測試 | 正式開啟、預告 0 支、本機端到端正式驗收、部署凍結及正式首次刪除紀錄均未驗證 |

## 測試結果與其證明範圍

執行前確認 `node -v = v22.23.4`，符合根 README。沒有因為 review 而更改測試原始碼，也沒有建立永久回歸測試；上文新增重現以 stdin 執行，在記憶體設定等待點或替身，供後續轉為正式測試。

| 執行 | 結果 | 說明 |
|---|---|---|
| Backend 11 個相關測試檔首次合跑 | 232 項：172 通過、60 失敗 | 不能稱全通過；多個 HTTP 測試受沙箱阻擋，另有設定 fixture 問題及失敗後 fetch 還原連鎖影響 |
| 獨立 loopback 診斷 | `connect EACCES 127.0.0.1` | 確認沙箱連線限制，不把這部分記為產品缺陷 |
| 四個路由檔移出沙箱重跑 | **78／78 通過** | upload routes、admin routes、source restore routes、short asset routes；仍用 Mongo 記憶體替身與 YouTube mock，UPLOAD_DIR 為新暫存目錄 |
| 七個 service／notification 檔分組重跑 | **152／154 通過** | upload、notification、quarantine、lifecycle、short recovery、short lifecycle、short asset service；兩筆 quarantine 無憑證情境失敗，見下文 |
| quarantine 檔隔離所有憑證初始值後重跑 | **25／25 通過** | 以 stdin 啟動前清空主名稱與別名的環境輸入，再載入原測試檔；未修改測試，確認失敗受 fixture 初始值影響 |
| 前端 youtubeLifecycle.test.js | **24／24 通過** | API mock 與純函式；未掛載頁面 |
| 前端 notificationTarget.test.js | **4／4 通過** | 通知導向 |
| 新增情境實驗 | R01～R09、R12 的上述重現成立 | 其中 R04、R05 由後端審查子代理執行；R02 連結目錄變體未成功建立；R10、R11 為靜態跨層追蹤 |

兩筆尚存的原始測試 fixture 問題位於 [youtube-quarantine.service.test.js:188–191](../../../../backend/tests/youtube-quarantine.service.test.js#L188)、[242–249](../../../../backend/tests/youtube-quarantine.service.test.js#L242)：只清掉 `youtubeClientId`／`youtubeRefreshToken`，但 [getOAuthCredentials:146–151](../../../../backend/src/services/youtubeUpload.service.js#L146)還會讀 `youtubeOAuth*` 別名。測試未隔離別名初始值，無法穩定建立「沒有憑證」情境。應把所有設定入口納入 fixture，不能只修斷言或把失敗當產品無憑證檢查失效。未讀取或輸出任何憑證內容。

代表性執行方式（各命令由對應 backend／frontend 目錄執行；HTTP 組需允許 loopback）：

```powershell
# backend；UPLOAD_DIR 先指定至本次新建的暫存位置
node --test --experimental-test-isolation=none --test-concurrency=1 tests/youtube-upload.routes.test.js tests/youtube-admin.routes.test.js tests/video-source-restore.routes.test.js tests/short-asset.routes.test.js
node --test --experimental-test-isolation=none --test-concurrency=1 tests/youtube-upload.service.test.js tests/youtube-upload-notification.test.js tests/youtube-quarantine.service.test.js tests/youtube-lifecycle.service.test.js tests/short-asset-recovery.service.test.js tests/short-asset-lifecycle.service.test.js tests/short-asset.service.test.js
# frontend/focus-flow
node --test tests/youtubeLifecycle.test.js
node --test tests/notificationTarget.test.js
```

**重要缺口：**現有 harness 的 `.lean()` 回傳同一個 store 物件（[backendTestHarness.js:401–403](../../../../backend/tests/helpers/backendTestHarness.js#L401)），不同於真實 Mongo 查詢快照，會掩蓋候選過時問題；也不實作真正索引／交易隔離。補回後重新處理的 fixture 不符合真實清理狀態，清理測試主要涵蓋固定資料與固定空間，前端只有 service／純函式測試。測試數量不能取代這些決策路徑。

**未執行：**完整 backend 全套、frontend lint／build、真實瀏覽器、隔離 Mongo 整合、FFmpeg／STT、真實 YouTube、Atlas、VM 與正式刪檔驗收。本次未改執行碼或介面契約，故不為文件變更重跑全專案建置；資料庫原子性與實際操作仍需修正後另作驗收。

## 修正後的必要驗收

1. 先修 R01～R06 的檔案識別、原子佔用及交錯問題；每個案例斷言「不應刪的仍存在」「外部上傳至多一次」「一份 YouTube 備份不被兩個不同內容占用」。
2. 以正常 completed 影片完成清理、補回、重新處理，確認來源保留期重算、學生播放不中斷、不新增 YouTube 上傳。
3. 實際磁碟空間與開關在清理期間改變時，確認立即停止不再需要的刪除；刪除失敗與 DB 回寫失敗要有可恢復的結果。
4. 補隔離 Mongo 的條件更新／唯一性測試，修正測試快照與憑證 fixture；以瀏覽器驗證 admin 確認清單、總覽狀態與教師補回後的按鈕。
5. 上述完成後，再依第 33 條另行取得正式環境開啟與刪檔授權。此報告不授權部署或啟用清理。
