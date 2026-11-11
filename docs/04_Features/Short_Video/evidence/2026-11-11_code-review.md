# 短影片程式審查（2026-11-11）

Weihao 的協調 session 對 `dev`（`60fedad`）的短影片程式做唯讀審查，這份文件只記發現與建議修法，**沒有修改任何短影片程式**。修不修、何時修由 recut 與短影片的負責人決定。

- 範圍：腳本與成品（`shortScript*`、`shortAsset*`、`shortsSync`）、recut 後端（`recut*` 的 route、controller、service、model）、`short_render/`，以及前端短影片頁面。
- 方法：三個審查代理分區讀程式，協調 session 再對「中」等級的後端與渲染項目逐一開檔核對；標「已核對」的是核對過程式確實如此，其餘是代理的讀碼結論。
- 沒有做：沒有啟動服務、沒有連資料庫或呼叫模型、沒有瀏覽器實測、沒有真實渲染。併發類問題都是讀碼推論，沒有實際重現。
- 離線工具（`recutCli`、`recutTrial*`、`recutCopyRuntime`、`recutFormalTrial`）沒有掛在 route 上，只略讀。

結論：沒有發現未授權的人可以越權操作的問題。問題集中在三類：一筆壞資料卡住整條流程、沒有比對狀態就寫入、前端舊回應蓋掉新畫面。

## 建議優先處理

| # | 等級 | 位置 | 問題 | 建議修法 | 核對 |
|---|---|---|---|---|---|
| 1 | 中 | `backend/src/services/recutWorker.service.js` `recoverRenderJobs`（第 148～162 行）、`claimRenderJob`（第 164 行起） | 領取工作前會先跑恢復，恢復迴圈沒有逐筆隔離錯誤。只要有一筆停在 `completing` 的工作每次收尾都失敗（例如成品檔不見、建立成品驗證失敗），所有 worker 的領取都會一直回錯，後面的恢復步驟也不會執行 | 恢復迴圈每筆各包 `try/catch` 並記錄；領取不被恢復失敗中斷；重複失敗的 `completing` 工作設上限後轉 `failed` | 已核對 |
| 2 | 中 | 同檔 `settleFailure`（第 130～141 行）、`claimRenderJob` 的排除判斷 | 工作失敗或租約逾時時，那台 worker 會被加進 `excludedWorkerIds`，之後領取會跳過。只有一台 worker 時，重試過一次的工作就再也沒人能領，腳本停在 `render_queued`，只有教師重新排入才會清掉 | 沒有其他啟用中的 worker 時不排除，或排除名單加時效 | 已核對程式；正式站是否只有一台 worker 待確認 |
| 3 | 中 | `backend/src/services/shortScript.service.js` `generateScriptVersion`（第 387～474 行） | 先讀狀態、呼叫模型、最後只用 `_id` 更新，版本號用讀取當下的 `versions.length + 1`。教師連點或兩個分頁同時生成時，會各自呼叫模型並各推一筆，出現兩筆相同 `versionNo`；之後上傳與退回只會找到第一筆。`submitReview` 用讀取當下的索引寫回饋，也有同樣問題 | 更新條件加上讀到的狀態與版本數，沒命中回 409 `SHORT_SCRIPT_STATE_INVALID` | 已核對 |
| 4 | 中 | `backend/src/services/recutWholeCheck.service.js`（第 83～92 行） | 整段檢查發現「品質」類問題時會呼叫 `repair`，沒有接住錯誤。修正過程用完共用額度時整個任務失敗，已經通過驗證的版本一起作廢；品質問題本來可以降級成建議 | `repair` 或複檢失敗時接住，保留原版本，把品質問題轉成建議 | 已核對程式結構；`repair` 實際會不會丟錯沒有重現 |
| 5 | 中 | `backend/src/services/recutWorker.service.js` `sourceFile`；`recutSource.service.js`、`recutRuntimeAdapters.service.js` | 渲染時直接用影片目前的檔案，沒有比對它是不是凍結證據時的那個檔。原片被清理後補回的若是不同檔案，會用新檔配舊時間軸。另外正式路徑的轉錄結果沒有帶 `sourceSha256`，這個欄位可能從來沒寫入 | 正式路徑補算雜湊，提供原片與完成渲染前比對 | 代理結論，未核對 |
| 6 | 中 | `short_render/src/worker/client.js`（第 127～138 行） | `finally` 裡清理暫存資料夾若丟錯（Windows 上剛結束的 Chrome、ffmpeg 常見 `EBUSY`），會跳過 `busy = false`，之後每次都回 `RECUT_WORKER_BUSY`；`run()` 沒有接錯，worker 直接結束。已上傳成功的工作也可能被回報成失敗 | `busy = false` 放到最外層一定會執行的位置；清理包 `try/catch` 並加重試；啟動時清掉殘留的 `recut-job-*` | 已核對 |
| 7 | 中 | `short_render/src/worker/http.js` | 逾時 120 秒是整個下載或上傳的總時限，不是「沒有資料才逾時」。原片大、頻寬小時一定中斷，被當成暫時性失敗後重派再失敗 | 改成閒置逾時，或依檔案大小放寬 | 代理結論，未核對 |
| 8 | 中 | `short_render/src/plan/sentences.js`（第 52 行） | 場景 id 的保留清單只擋 `root`、`hdr`、`endcard`、`end1`、`end2`、`narration`、`sub<數字>`；`html.js` 自己還用了 `subtitle<數字>`、`preview-viewport`、`play-toggle`、`preview-seek`。場景取這些名字能通過驗證，畫面上 id 重複，動畫會作用到錯的元素 | 保留清單補上這幾個，或場景 id 強制加前綴 | 已核對 |

## 前端（短影片頁面）

| # | 等級 | 位置 | 問題 | 建議修法 |
|---|---|---|---|---|
| 9 | 中 | `TeacherShortScripts.jsx`（`refresh`、`loadScript`），`TeacherShortUploads.jsx` 同樣寫法 | 沒有請求編號或取消。切課程或連點腳本時，較慢回來的舊回應會蓋掉新畫面：下拉選的是課程 B，清單卻是課程 A | 用 ref 記住最新的課程與腳本 id，回應到達時不符就丟掉 |
| 10 | 中 | `TeacherShortScripts.jsx`（`handleGenerate`、`handleRegenerate`、`handleDismiss`） | 生成要 30～45 秒，期間清單沒有停用。生成腳本 A 時點了腳本 B，結果回來後畫面被拉回 A | 忙碌時停用切換，或回應回來時比對目前選取的 id |
| 11 | 中 | `ShortAssetPanel.jsx`、`TeacherShortUploads.jsx` | 上傳最大 500 MB。上傳中切換腳本，面板被卸載，完成後用舊的選取把畫面拉回舊腳本；上傳結果與錯誤看不到，教師可能再傳一份 | 上傳中鎖定切換，或完成時檢查目前選取的 id |
| 12 | 中 | `TeacherShortUploads.jsx`（第 328 行附近） | 文案寫「等待中的會自動更新」，但這幾頁沒有任何自動更新，狀態要按重新整理或切課程才會變 | 對傳送中、等待、審核中的狀態定時更新，離開頁面時停止；或改文案 |
| 13 | 低 | `ShortAssetPanel.jsx` `pickFile` | 拖放沒有先檢查檔案類型與大小（點選才有），整個檔案傳完才被後端拒絕 | 先呼叫 `teacherUploadUtils` 的 `validateVideoFile` |
| 14 | 低 | `StudentShortsWall.jsx`（第 79 行） | iframe 網址直接接 `videoId`，網域固定是 youtube.com 所以不會換主機，但沒驗證格式 | 用 `^[A-Za-z0-9_-]{11}$` 驗證 |
| 15 | 低 | `StudentShortsWall.jsx` | 「載入更多」進行中按重試，舊分頁會接到新清單後面 | 加請求編號 |
| 16 | 低 | `ShortAssetPanel.jsx`（第 284 行） | `asset.youtubeUrl` 直接放進連結，沒檢查是 https 的 YouTube 網址 | 只在符合時輸出連結 |
| 17 | 低，待確認 | `TeacherShortScripts.jsx`（第 716～769 行） | 讀 `version.payload.xxx` 沒有防空值，model 的 `payload` 預設是 null，遇到會整頁壞掉 | 加 `?.`；要先確認實際資料有沒有這種版本 |
| 18 | 低，待確認 | 前端沒有讀 `productionMode` | recut 模式的腳本若出現在教師清單，會顯示「生成腳本」，按了一定被後端拒絕 | 先確認正式環境會不會列出 recut 腳本 |

## 其他後端與渲染項目（低）

- `shortAsset.service.js` `reviewShortAssetOwned`（第 571～588 行）：審核的更新條件沒有排除已封存的成品，退回時還會把它改回 `draft`。課程刪除後教師已被擋，管理員仍可操作，之後補傳排程可能把它撿回去。建議條件加 `status` 不等於 `archived`，待審清單也排除。（已核對更新內容；`buildLegacyAwareReviewCasFilter` 只看到前半段，沒有看到 `status` 條件）
- `shortAssetPublish.service.js`（第 570～585 行）：上傳成品不檢查腳本狀態，已否決（`dismissed`）的腳本仍可上傳、審核後上架。
- `short-script.routes.js`（第 51 行）：上傳先把最多 500 MB 寫進磁碟，之後才檢查腳本是不是自己的；有容量預約與失敗清檔，影響是浪費頻寬。
- `shortScript.service.js`（第 71 行）：補鄰近片段時只用 `videoId` 查，沒有課程過濾。同一個 `videoId` 掛在別的課程或混有 Parent 層資料時可能混進凍結證據，要看實際資料才知道。
- `shortAssetRecovery.service.js`：領取前就丟錯的項目（同意撤回、超過次數）不寫任何狀態，每輪又排在最前面；數量超過一批時後面可恢復的項目會一直輪不到。待確認。
- `recutQueue.service.js`：呼叫上限只限單一任務，失敗或取消後教師可以立刻再開新任務，每次都有全新額度；沒有以腳本或教師為單位的累計上限。
- `recutCodeCard.service.js`（第 47、53 行）：程式碼圖卡的辨識呼叫不計入額度，每個區間最多 2 次；重試時換不同區間就再多 2 次。只在 `codeCardsEnabled` 開啟時發生。
- `recutWorker.service.js`：
  - 後端不檢查上傳的 MP4，時長、音軌、響度都信任 worker 自己回報；有教師審核當最後一關。
  - 領取過程失敗時的補償用到 `leaseHash`，但那個欄位預設不讀出，補償可能沒作用，要等 10 分鐘租約逾時。待確認。
  - 建立成品時直接把 AI 揭露與同意確認寫成 `true`，確認人寫腳本建立者，稽核上等於系統代簽。
- `recutAsrNormalization.service.js`：視窗開頭被切半的句子，正式路徑沒有標記，可能被選用。要對照設計決策確認是否要求排除第一句。
- `recutQueue.service.js` `recover()`：重啟時把所有執行中的任務當成中斷。部署重疊、兩個後端同時存活時，新的會中斷舊的正在跑的任務。
- `recutRuntimeAdapters.service.js`：模型錯誤只分 404、401／403，其餘都是 `RECUT_MODEL_FAILED`，分不出 429、逾時、5xx。這與[目前狀態](../../../current-status.md)記的教授試片問題是同一件事。
- `shortScriptGeneration.service.js` `callGemini`（第 322 行）：`fetch` 沒有逾時；回饋、否決原因、標題、描述沒有長度上限。
- `short_render`：
  - `sentence-v1` 路徑不檢查數字與簡體字，`stat` 的數值沒有檢查是有限數。
  - `compare`／`chips` 驗證用 `value`、畫面用 `text`，兩者不同時畫面顯示的不是驗證過的那個。
  - `stat` 的非整數一律顯示 1 位小數（3.14 顯示 3.1）。
  - 程式碼圖卡的框選區間重疊時，程式碼文字會重複。
  - 字幕沒有最短顯示時間，也沒要求每段至少一則。
  - 多數卡片文字沒有長度上限，要到渲染才失敗。
  - `--quality` 沒驗證就傳給渲染工具；對齊快取只看路徑不看內容。

## 審查通過的重點

- **權限**：腳本、成品、recut、審閱、同意的每個端點都在 service 層重新檢查課程擁有者；學生牆只回有效選課、課程已發布、成品已發布且可播放的短片，欄位不含教師專用資料。
- **上架**：審核狀態與世代要一致，發布用條件更新所以併發只會發布一次；AI 揭露與同意在上傳與發布兩處都檢查；重複上傳有資料庫端的領取條件。
- **worker**：金鑰只存雜湊並用固定時間比較，每次請求重查是否啟用；心跳、取原片、回報都要持有未過期的租約；兩台 worker 不會領到同一筆；租約逾時後舊 worker 蓋不掉新結果。
- **同意**：排入、渲染、掛成品、核准、發布與 worker 每一步都檢查，撤回後會停掉進行中的工作。
- **資料**：視窗 120～180 秒、選段 30～65 秒都在後端強制；只能用凍結來源的句子；逐字稿版本不同時拒絕。
- **指令與路徑**：外部程式都用參數陣列、不經 shell；ffmpeg 限制只讀本機檔；路徑限制在允許的目錄；金鑰只走 header，錯誤訊息不含金鑰。
- **渲染 HTML**：文字都經跳脫，行內指令碼只放數字與檢查過的 id，主題、圖示、樣式都是白名單。
- **worker 用戶端**：後端網址限 https 或本機，不跟隨轉址；租約到期或逾 10 分鐘就中止不送結果；檢查不合格不回報成功。

## 測試缺口

- 沒有任何併發測試（生成、審核、發布、上傳）。
- 沒有「單一 worker 重試後被排除」「持續失敗的 `completing` 工作」「管理員審核已封存成品」「已否決腳本上傳」的案例。
