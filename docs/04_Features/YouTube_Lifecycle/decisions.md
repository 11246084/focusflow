# YouTube 上傳恢復與原片清理設計決策

教師上傳的影片處理完成後會自動傳到 YouTube（不公開），之後播放改走 YouTube，伺服器上的原片就可以刪掉省空間。這份文件記錄「上傳失敗怎麼恢復」與「原片何時、怎麼清理」的設計：已定案的規則、還在討論的問題與實作切分，讓接手的人或 AI 不用重讀對話。功能是否完成只看[目前狀態](../../current-status.md)。

## 名詞

- **恢復（recovery）**：把上傳失敗、但確定可以安全重來的影片重新上傳。
- **可安全重試（retrySafe）**：失敗發生在影片內容送出之前，YouTube 上不會有半成品；送出後才失敗的一律不自動重試，避免 YouTube 出現兩支同樣的影片。
- **隔離（quarantine）**：卡在「上傳中」超過時限的影片，因為不確定 YouTube 是否已收到，改標成失敗且不可自動重試，等人工確認。
- **清理（cleanup）**：刪除 `UPLOAD_DIR` 裡已上傳完成的原片，播放欄位先改指向 YouTube。
- **兩層開關**：環境變數是總開關，決定這個環境「允不允許」開啟；管理員介面的執行期開關存在資料庫，在允許範圍內隨時切換，不需重啟。兩者都開才生效。

## 整體流程（例）

教師上傳 `week3.mp4` → 語音轉文字完成 → 自動上傳 YouTube →
- 成功：播放改走 YouTube → 清理開關開著就刪除 `uploads/week3.mp4`
- 送出前失敗（例如憑證過期）：標成可安全重試，依退避時間重試，最多 3 次
- 送出後失敗或卡住：隔離，教師畫面顯示「YouTube 失敗」，等人工確認 YouTube Studio

## 已定案

依 2026-10-18 程式查證；行號以當日 `dev` 為準。

| # | 規則 | 依據 |
|---|---|---|
| 1 | 恢復與清理各有開關 `YOUTUBE_UPLOAD_RECOVERY_ENABLED`、`YOUTUBE_UPLOAD_CLEANUP_ENABLED`，預設都關閉，與上傳開關分開 | [環境設定](../../../backend/src/config/env.js)、[API 契約](../../../backend/docs/phase2-api-contract.md) |
| 2 | 只有可安全重試的失敗會自動重試；上限 `YOUTUBE_UPLOAD_MAX_ATTEMPTS`（預設 3），間隔從 60 秒起倍增 | [上傳服務](../../../backend/src/services/youtubeUpload.service.js) `autoUploadVideoToYouTube` |
| 3 | 卡在上傳中超過 `YOUTUBE_UPLOAD_STUCK_AFTER_MS`（預設 15 分鐘）就隔離，不自動重試 | 同上 `recoverPendingYouTubeUploads` |
| 4 | 清理必須同時符合：處理完成、YouTube 上傳完成、路徑在 `UPLOAD_DIR` 內、沒有其他影片共用同一檔案；先切播放欄位再刪檔，刪檔失敗不影響播放 | 同上 `cleanupUploadedLocalVideo` |
| 5 | 教師可對「可安全重試」的失敗按重試；不可安全重試時顯示請先查 YouTube Studio | `POST /videos/:videoId/youtube-upload/retry`、[教師課程頁](../../../frontend/focus-flow/src/pages/TeacherCourses.jsx) |
| 6 | 狀態診斷放在 `/health` 的 `runtime.youtubeUpload` | 同上 `buildYouTubeUploadSnapshot` |

以下為 2026-10-18 討論定案：

| # | 決策 | 理由／證據 |
|---|---|---|
| 7 | 恢復改為定期執行：開機先跑一次，之後依 `YOUTUBE_UPLOAD_RECOVERY_INTERVAL_MS`（預設 5 分鐘，0 代表只在開機跑）重複執行，寫法比照[批次排程](../../../backend/src/services/videoBatchReconciliation.service.js) | 原本只在開機跑一次（[server.js](../../../backend/src/server.js)），`nextRetryAt` 沒有人讀，#2 的退避重試實際不會發生 |
| 8 | 修正恢復撈資料條件：失敗的只撈「可安全重試、未達上限、已到重試時間」，加上卡在上傳中待判斷隔離的，依時間排序 | 原查詢含永遠不會重試的失敗且未排序，累積 5 支後每次撈到同樣 5 筆，可重試的影片永遠輪不到 |
| 9 | 上傳、恢復、清理三個開關改為**兩層開關**；間隔、每次筆數、重試上限、卡住時限仍只用環境變數；憑證只放環境變數 | 三者是出狀況要能立即停的營運開關（[Feature Toggles](https://martinfowler.com/articles/feature-toggles.html) 的 ops toggle），清理會刪檔無法復原；調整用參數很少變動。使用者選擇讓沒有 VM 權限的人也能停用 |
| 10 | 執行期開關存在資料庫的新設定集合，第一批只放這三個開關，寫法保留給其他開關日後加入；不一次搬移全專案開關 | 控制範圍；其他開關各自討論 |
| 11 | 每次使用前直接讀資料庫，不做快取；修改後下一次檢查即生效 | 部署只有一個 pm2 行程 `focusflow-backend`（[部署設定](../../../.github/workflows/deploy.yml)），無多台不同步問題；上傳與排程頻率低 |
| 12 | 修改紀錄（誰、何時、從什麼改成什麼）存在設定文件內，保留最近 50 筆；不寫入 `UsageLog` | `UsageLog` 用於問答用量統計與配額，混入會干擾統計 |
| 13 | 只有 admin 可以查看與修改；環境變數關閉時，畫面顯示開關但不可切換並說明原因；`/health` 與系統狀態顯示實際生效值與原因 | 沿用既有管理員權限與[系統狀態](../../../backend/src/services/systemStatus.service.js) |
| 14 | 關閉時不中斷進行中的工作：正在上傳的影片傳完；排程每輪開始前檢查；清理在每次刪檔前檢查 | 上傳中途中斷會產生無法判斷是否已送出的影片，等於製造隔離案例 |
| 15 | 管理員介面另有「立即執行恢復」按鈕，受兩層開關限制 | 出狀況時不必等下一輪排程 |
| 16 | 資料庫還沒有設定時：上傳與恢復跟隨環境變數（視為開啟）；**清理視為關閉**，需管理員在介面明確啟用一次 | 上傳已在使用，視為關閉會在部署後悄悄停止上傳；清理刪檔無法復原，需 VM 允許加管理員啟用兩道確認 |

| 17 | 被隔離的影片由**管理員介面**收尾，有三個動作：「查詢 YouTube」由系統用上傳時寫入描述的 `Uploaded by FocusFlow (video <影片ID>)` 比對自家頻道上傳清單，只顯示結果；「確認套用」把找到的 YouTube 影片標成已上傳並切換播放；「重設為可重試」用於確定沒有上傳的影片，重試次數歸零。憑證沒有讀取權限時隱藏「查詢 YouTube」，改由管理員手動填入影片 ID | 教師與多數管理員沒有頻道帳號，無法到 YouTube Studio 確認；描述文字見[上傳服務](../../../backend/src/services/youtubeUpload.service.js) `autoUploadVideoToYouTube` |
| 18 | 填入或套用的 YouTube 影片 ID 必須先呼叫 YouTube 確認影片存在且屬於自家頻道；系統只提示結果，不自動套用 | 填錯 ID 會讓學生看到別的影片，清理開著時還會刪掉唯一的原片 |
| 19 | 教師畫面不再要求教師到 YouTube Studio 確認：影片上傳在[教師課程頁](../../../frontend/focus-flow/src/pages/TeacherCourses.jsx)與[錯誤訊息表](../../../frontend/focus-flow/src/utils/errorMessages.js)，短影片上架在[腳本頁](../../../frontend/focus-flow/src/pages/TeacherShortScripts.jsx)，三處改為說明「需由管理員確認，處理後自動更新」 | 影片上傳到系統自己的頻道，教師沒有該帳號 |
| 20 | 影片被隔離時通知所有啟用中的管理員，點擊進入處理頁；同一支影片同一次失敗只通知一次。管理員處理完成後自動通知上傳該影片的教師（`uploadedBy`，沒有時改通知課程教師），內容為「已上傳完成」或「已重新排入上傳」 | 目前沒有人會得知影片卡住；通知系統已支援指定對象與防重複（[通知服務](../../../backend/src/services/notification.service.js) `notifyShortAssetRejected`） |
| 21 | 原片清理後系統**不會自動取回**：不改走 YouTube 網址下載；重新處理按鈕在沒有原片時停用，並提示可用「補回原片」（#23） | YouTube 常擋雲端主機下載、官方 API 不提供下載、只拿得到重新壓縮的音訊；先前實查線上用 Whisper `tiny`，日後換模型需全部重跑，屆時最需要可靠來源 |
| 22 | 清理改由定期排程執行，不在上傳完成時立刻刪。符合清理條件（#4）的影片依兩條規則刪除：**空間不足**時（可用空間低於 `YOUTUBE_UPLOAD_CLEANUP_MIN_FREE_GB`，建議 10）從最早上傳完成的開始刪，回到門檻以上即停，但上傳完成未滿 `YOUTUBE_UPLOAD_CLEANUP_MIN_AGE_DAYS`（建議 14）天的不刪；**超過最長保留期**（`YOUTUBE_UPLOAD_CLEANUP_MAX_AGE_DAYS`，定為 180，0 代表只依空間清理）的不論空間一律刪除。可用空間以 Node 內建 `fs.statfs` 查詢 | 原片清理後無法重新處理（#21），能留就留；最舊的影片最不可能再處理；最短保留期避免剛上傳就被刪；最長保留期由使用者要求，避免原片無限期留在伺服器；180 天＝一學期約 126 天加緩衝，學期內的影片都能直接重新處理，更舊的可用補回原片（#23） |
| 23 | 新增「**補回原片**」：對已清理的影片上傳檔案，存回同一支影片（影片 ID 不變），之後可重新處理。不重新上傳 YouTube，學生照常看 YouTube 版本。教師可操作自己課程的影片，管理員可操作全部；沿用現有上傳的格式與容器完整性檢查，且只接受已清理狀態的影片 | 系統沒有替換原片的功能，重新上傳會建立新影片：ID 改變、問答紀錄與引用連不回去、YouTube 多一支重複影片。原片可由頻道擁有者從 YouTube Studio 下載，或由教師提供原檔 |
| 24 | 補回的原片，保留期從**補回時間**重新起算，不沿用當初的上傳完成時間 | 否則補回超過最長保留期的影片，下一輪排程就會立刻再刪掉 |
| 25 | 重新處理完成時不會重新上傳 YouTube | 已在程式中成立：自動上傳遇到已有 `youtubeVideoId` 就略過（[上傳服務](../../../backend/src/services/youtubeUpload.service.js) `autoUploadVideoToYouTube`） |
| 26 | 開關打開前已上傳的舊影片不另做補清理工具，由 #22 的定期排程一併掃描 | 排程每輪檢查所有符合條件的影片，不只新上傳的 |
| 27 | 刪除前預告，兩處都只顯示資訊、不新增操作：① 管理員啟用清理時先顯示「啟用後會立即刪除 N 支（共 X GB）」與清單，確認後才啟用；② 系統狀態固定顯示「7 天內將到期刪除」的數量與清單。兩者與排程共用同一套判斷條件 | 第一次啟用時，所有超過 180 天的影片會在下一輪一次刪除，是影響最大的時刻；7 天預告讓管理員能先重新處理 |
| 28 | **短影片成品納入**定期恢復、隔離收尾、通知與教師提示（#7～#20）及原片清理（#22、#27），使用同一組兩層開關與預告 | 使用者要求系統完整度一致：所有上傳到 YouTube 的檔案適用同一套規則 |
| 29 | 短片上傳 YouTube 時在描述欄末尾加上 `(FocusFlow short <成品ID>)`，供「查詢 YouTube」比對 | 短片描述用教師自填內容，沒有系統標記，#17 的代查找不到（[短片發布](../../../backend/src/services/shortAssetPublish.service.js) `uploadShortAssetToYouTube`） |
| 30 | 短片成品只在**已上架或已封存、且 YouTube 上傳完成**時才可清理；被退回、尚未重拍的草稿不清理。保留期從 YouTube 上傳完成起算 | 核准後上架與退回轉私人都還需要這筆成品；草稿檔案小，重拍時舊檔本來就會刪（同檔 `cleanupUploadedFile` 換代邏輯） |
| 31 | 短片清理後**保留 `filePath` 欄位**，另記 `localCleanupAt`；不比照一般影片把路徑設成空值 | 短片程式以 `filePath` 是否有值判斷「是不是本功能上傳的成品」（上傳排程、退回轉私人、核准上架三處）；設成空值會讓這三處靜默跳過。重新上傳時已有找不到檔案的錯誤 `SHORT_ASSET_SOURCE_FILE_MISSING` |
| 32 | 短片不提供「補回原片」 | 短片不需要重新處理；成品檔只用於上傳 YouTube，上架後 YouTube 已有一份 |
| 33 | 依時程分階段開啟與驗收（見「實作切分」的時程表）：複評前只在分支開發；10/24 合併部署並開啟恢復；清理以**本機端到端驗收**為正式證據，11/13 前在正式環境開啟清理並確認預告為 0 支；11/16～11/27 凍結部署。正式環境第一次自動刪檔的紀錄於展覽後補入 | 11/24 佈展前功能須全部完成、11/16 那週準備佈展；正式環境短期內不會達到刪除條件（可用 30G、影片未滿 180 天），無法等待自然發生 |

以下為 2026-10-20 討論定案：

| # | 決策 | 理由／證據 |
|---|---|---|
| 34 | **已達重試上限**的上傳（失敗時判定可安全重試，但重試次數已達 `YOUTUBE_UPLOAD_MAX_ATTEMPTS`）列入管理員待處理清單，每筆以 `reason` 區分 `quarantined`（需確認 YouTube）與 `retry_limit`（已達重試上限）。管理員確認原因排除後，用既有的「重設」替教師把次數歸零並立即排入；這類項目不提供「查詢 YouTube」與「確認套用」。達到上限時比照 #20 通知所有啟用中的管理員（同一次失敗只通知一次），重設後沿用「已重新排入上傳」通知教師；教師按重試時改提示「已達重試上限，已通知管理員處理，處理後會自動更新」。影片與短片都適用 | 原本這類項目不在清單內：恢復排程不再撈、教師按重試只看到「已達上限」，**教師沒有其他出路**，也沒有人會得知。上限存在是為了避免同一個原因（例如憑證過期、配額用完）造成**無限重試**；改由管理員確認原因排除後才重設，保留上限的保護又不會讓影片永遠卡住。這類失敗都發生在送出影片內容之前，YouTube 上確定沒有這支，查詢不會有結果，套用只可能接上錯的影片（#18 的風險），所以只開放重設（[隔離收尾服務](../../../backend/src/services/youtubeQuarantine.service.js)） |

以下為 2026-10-25 討論定案（額度用完的處理，查證見下方「額度用完的處理」）：

| # | 決策 | 理由／證據 |
|---|---|---|
| 35 | 上傳額度錯誤只在**建立上傳工作階段時**（送出影片內容前）辨識，依 HTTP 狀態、`error.errors[].reason` 與訊息分成四類：① **API 每日上傳配額**：`reason` 為 `quotaExceeded`，或訊息明確寫出配額名稱 `Video Uploads per day`（例如 `429 rateLimitExceeded`）；② **頻道上傳上限**：`reason` 為 `uploadLimitExceeded`；③ **短時間限流**：其他 `429` 或 `rateLimitExceeded`，有 `Retry-After` 就照它等，沒有就用現有退避；④ **無法辨識**：維持現有可安全重試流程（3 次後進入 #34），不只憑訊息含 `per day` 就推定是哪一種額度。送出影片內容後才失敗的照舊隔離（#3） | ①② 要等到隔天才恢復，而且恢復時間不同（#36），必須分開；只看 `reason` 會漏掉 2026-05 回報的 `429` 但訊息是 `Video Uploads per day` 的情況（[google-api-python-client #2753](https://github.com/googleapis/google-api-python-client/issues/2753)）；比對完整配額名稱，避免誤判其他錯誤。送出內容後仍可能已上傳，避免重複影片優先 |
| 36 | 恢復時間：API 每日上傳配額等到**下一個太平洋時間午夜後 10 分鐘**，以 `America/Los_Angeles` 時區計算（台灣 15:10 或冬令 16:10），不寫死台灣時間；頻道上傳上限等**失敗後 24 小時又 10 分鐘**。恢復後第一支又碰到額度錯誤，就再等一輪 | 官方：配額在太平洋時間午夜重置（[配額計算](https://developers.google.com/youtube/v3/determine_quota_cost)）；頻道上限是「24 小時內」的上傳數，碰到時「24 小時後再試」（[YouTube 說明](https://support.google.com/youtube/answer/10383400)）。10 分鐘緩衝避免時鐘誤差剛好撞在重置前 |
| 37 | 教師端：等待額度的影片與短片顯示「等待 YouTube 每日額度，最快 X 後開始自動補傳」，不保證完成時間，並說明學生照常觀看原片；重試按鈕停用，API 回 `409 YOUTUBE_UPLOAD_QUOTA_WAITING` 並附最快恢復時間；不另發通知 | 教師不需要做任何事；頻道上限未公開，無法預估完成時間；重試只會再浪費一次呼叫（失敗的請求也計入配額）。影片未上傳前播放原片、問答不受影響 |
| 38 | 管理員頁不顯示「剩餘額度」，改顯示 **FocusFlow 自己的上傳紀錄**：「過去 24 小時 FocusFlow 成功上傳 N 支（不含從 YouTube Studio 或手機上傳的）」與上次暫停時的支數（例如「上次在第 11 支時暫停」）；不依計數提前暫停，以 YouTube 回的錯誤為準 | 頻道上限依地區與頻道紀錄而變、未公開，網頁與手機上傳也會算進去，顯示「剩 89 支」會誤導；實際碰到上限時的支數，才能看出這個頻道的上限。查 API 剩餘量要另接 Cloud Monitoring 與新憑證 |
| 39 | 批次上傳不做事前提醒；只有暫停中時，上傳頁顯示「YouTube 額度已用完，影片照常處理、可播放與問答，YouTube 版本最快在 X 後開始補傳」 | 上傳 YouTube 不影響播放與問答，教師不需要因此改變上傳方式 |
| 40 | 現階段不開第二個頻道、不申請提高配額。部署到學校時：學校用自己的 Cloud 專案與**已驗證**的頻道；管理員頁顯示的實際上限（#38）長期不夠時，先向 YouTube 創作者支援詢問頻道上限，API 配額不夠時才填 [Audit and Quota Extension Form](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) 申請稽核 | API 配額每天 100 次已高於用量；申請提高配額解除不了頻道上限（有人配額 220,000 仍在第 11～12 支被拒，[Stack Overflow](https://stackoverflow.com/questions/78734881)）；第二個頻道會讓查詢 YouTube（#17）與播放來源分散。未驗證的帳號只能上傳 15 分鐘內的影片 |
| 41 | 送出影片內容後中斷、或卡在上傳中的上傳，先**查詢上傳狀態**再決定：建立工作階段後把上傳網址存進資料庫（不經 API 回傳、不寫入 log）；排程判斷隔離前，對該網址送空的 `PUT` 查詢。`201`：自動套用回傳的影片 ID，仍須通過 #18 的自家頻道檢查；`308`、`404` 或查詢失敗：**照舊隔離**，不自動重新上傳。不做從中斷處接著傳。上傳網址存進資料庫成功後，才能開始送出影片內容；存不進去就停止，標成可安全重試（尚未送出內容） | 官方：`201` 表示已完成；`308` 表示「中斷或仍在進行中」，可能已收到部分資料，不能據此斷定原上傳已終止；`404` 是網址過期（[續傳協定](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)）。只自動收尾 `201`，其餘交給管理員（#17），避免重複影片優先；完整續傳日後再評估 |

以下為 2026-10-26 討論定案（第二輪，依審查意見修正 R1-3、R1-4、R1-8、R2-1）：

| # | 決策 | 理由／證據 |
|---|---|---|
| 42 | 範圍：只補兩種例外，**額度型錯誤**（#35～#40、#43～#46）與**不確定的上傳結果**（#41、#48）；沿用現有資料庫佇列與恢復排程，不重構上傳架構、不引入 Redis 或 BullMQ 等新元件；另備面試用標準回答 | 每支影片與短片的上傳狀態、次數、下次重試時間已存在資料庫，恢復排程每 5 分鐘一輪（#7、#8），重啟不遺失工作；評審問的是「學期初大量上傳，額度滿了怎麼辦」，補齊這兩種例外就能回答 |
| 43 | 等待額度**不扣**任何影片或短片的重試次數，也**不會**因等待太久改列待處理清單。改以**全站**計算：連續 3 個恢復週期「實際送出了上傳請求，仍碰到每日額度」，就發出**一筆系統警示**給所有啟用中的管理員；排隊中的影片繼續等待。成功上傳一支後計數歸零 | 全站暫停時，每輪只有排在最前面的一支真的嘗試，其餘根本沒試過；以單支等待次數計算，會把大量沒嘗試過的影片誤判成失敗。額度是整個專案或頻道共用，問題也只需要通知一次 |
| 44 | 全站暫停分開記錄兩種限制：**API 每日配額**與**頻道上傳上限**，各有恢復時間（#36），存在 `RuntimeSetting`，重啟不遺失。兩種同時存在時，要**兩者都過了**才恢復。所有會開始新上傳的入口（處理完成自動上傳、教師重試、恢復排程、管理員重設與提前恢復；影片與短片）共用**同一個上傳閘門**：在開始新上傳前確認暫停狀態並領取工作，避免另一支在寫入暫停的同時送出請求。暫停**只擋新的影片上傳**；上傳狀態查詢（#41）、轉私人、查詢 YouTube（#17）等其他 API 照常 | API 配額可能今天 15:10 恢復、頻道上限明天才恢復，前者恢復不代表後者解除；沒有共用閘門時，並行的上傳仍可能多送一次請求（失敗的請求也計入配額） |
| 45 | 恢復排隊順序：依**首次排入上傳的時間**由舊到新，相同時再依 ID 排序，每輪順序固定；沒有嘗試紀錄的工作也用首次排入時間。每 5 分鐘 5 支、影片先、短片後的做法保留；日後學校大量使用、短片長期排不到時再評估公平排程 | 原本依上次嘗試時間排序，從未嘗試過的工作沒有這個值；次要排序鍵避免每輪順序不一致 |
| 46 | 管理員頁頂端顯示目前有效的暫停類型、各自的最快恢復時間與等待支數；每次進入暫停**只通知一次**。提供「**提前檢查並嘗試恢復**」：① 列出所有仍有效的暫停原因；② 只放行**一支**排在最前面的工作試傳；③ 成功才恢復正常排程；④ 又碰到額度就重新暫停，不另發通知。按鈕在試傳進行中停用；每次操作（誰、何時、結果）記在暫停狀態的紀錄裡。等待中的項目不列入待處理清單 | 管理員誤判額度已恢復時，直接解除會讓下一輪排程放行 5 支、5 支都被拒；先試一支可控制損失，紀錄避免反覆解除、反覆失敗 |
| 47 | 其他 API 的配額（每天 10,000 單位）本次不實作控制，在[後端注意事項](../../../backend/docs/handoff-known-issues.md)記為既有限制：刪除課程時每支轉私人約 51 單位，一次刪約 190 支以上會用完；轉私人失敗目前只寫 log、不重試，**課程已刪除或影片已撤銷存取，但 YouTube 上的影片仍維持不公開可見**，知道連結的人仍能觀看，需管理員到 YouTube Studio 人工確認 | 正常用量不到 2%；寫清楚真正的影響（影片仍可見），而不只是「配額可能用完」 |
| 48 | #41 隔離時，待處理清單顯示上傳狀態查詢的結果，與「查詢 YouTube」並列：`308` 有 `Range`：「上傳尚未完成，YouTube 已接收 X／Y MB」；`308` 無 `Range`：「上傳尚未完成，目前未回報已接收資料」；`404`：「上傳工作階段不存在或已失效，無法確認遠端影片狀態」；查詢失敗：「無法取得上傳狀態，需人工確認」。這些結果都**不代表 YouTube 沒有這支影片**；人工套用影片 ID 仍須通過 #18 的自家頻道檢查 | 官方：`308` 是未完成或仍在進行，`Range` 為已收到的位元組；`404` 不能用來判斷遠端影片是否存在（[續傳協定](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)） |

以下為 2026-10-26 定案（技術審查，依據見[技術研究](quota-upload-research.md)）：

| # | 決策 | 理由／證據 |
|---|---|---|
| 49 | #41 查詢上傳狀態時一律設 `redirect: 'manual'`；`308`，或 `200` 加 `X-Http-Status-Code-Override: 308`，都視為**未完成**；`200`／`201` 且回應有影片 `id` 才算完成；其他情況一律隔離。可以送 `X-GUploader-No-308`，但不作為必要條件 | 官方：`308` 是中斷或進行中（[續傳協定](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)）。實測 Node 22.23.4 fetch：回應帶 `Location` 時，預設會跳到別的網址拿到 `200`，把未完成誤讀成成功；`manual` 能正確取得 `308`（[技術研究 §3](quota-upload-research.md#3-本機實測node-fetch-碰到-308測試)）。`X-GUploader-No-308` 只見於 Google 的 Go 用戶端，REST 文件未記載 |
| 50 | 維持自寫 fetch 呼叫 YouTube，不改用 `googleapis` 套件 | `googleapis` 的 `videos.insert` 沒有內建續傳（用 `multipart` 一次送完）；要續傳仍得用同一套 OAuth 自己送建立工作階段與 PUT，等於重寫協定。現有上傳與測試替身都建立在 fetch 上（[技術研究 §2.3](quota-upload-research.md#23-官方-node-用戶端開源)） |

以下為 2026-10-26 定案（第三輪；原題號 #51～#64 依序改為 #51～#64；對既有決策的修改見下表）：

| # | 決策 | 理由／證據 |
|---|---|---|
| 51 | **等待中的工作用 `waiting` 狀態表示**：新增上傳狀態 `waiting`，另記 `waitReason`（`api_quota`、`channel_limit` 或 `gate_busy`）、`nextRetryAt`（最快可再試的時間）與 `queuedAt`（首次排入時間，#45）；恢復排程多撈「`waiting` 且已到時間」的工作。碰到額度的那一次嘗試不計入次數 | 沿用 `failed` 會讓教師畫面、錯誤訊息與待處理清單都要另外排除；現有領取條件是「不是上傳中或已上傳」，`waiting` 可直接被領取 |
| 52 | **上傳閘門用 MongoDB 租約**：① **閘門**：一份 `RuntimeSetting` 文件，欄位 `ownerToken`（每次取得時產生的隨機 UUID）、`leaseUntil`。取得、續約、釋放都用一次條件式 `findOneAndUpdate`，條件包含 `ownerToken` 相符，不相符就不寫。到期時間以資料庫時間 `$$NOW` 計算，不用各行程的時鐘。租約 2 分鐘，只涵蓋「換 token → 建立工作階段 → 存上傳網址」；影片內容在租約外傳送、可並行。拿不到時每 0.5 秒重試、最多 30 秒，仍拿不到改成 `waiting`（`gate_busy`，1 分鐘後再試）。② **租約過期不等於舊工作停止**：過期只代表別人可以替**另一支**工作建立工作階段；同一支工作不會因租約過期被接手，只能走 #57 的恢復流程。③ **舊工作保護**：每次領取單支工作寫入新的 `youtubeUpload.attemptId`；之後存上傳網址、標成完成、失敗或等待，都要求 `attemptId` 相符，不符就放棄寫入。開始送出內容前再以條件寫入確認 `attemptId` 仍相符且上傳網址已保存，否則不送。**孤兒上傳的例外**：舊工作在 `attemptId` 已改變後才上傳成功時，只允許做一件事：用只看 `_id` 的條件，把 `{ youtubeVideoId, attemptId, detectedAt }` 加進該筆的 `youtubeUpload.orphanUploads`（`$addToSet`，只動這個陣列），不得改 `status`、`youtubeVideoId`、播放來源或任何其他欄位；接著通知所有管理員（以 YouTube ID 去重）。管理員頁列出孤兒上傳；要接回這支影片時，走 #17、#18 的「確認套用」（含自家頻道檢查），否則請頻道擁有者到 YouTube Studio 刪除。④ **Atlas 無法確認時一律不放行（fail-closed）**：取得租約、讀暫停狀態、領取或存上傳網址任一步讀寫失敗，就不建立工作階段、不送內容，工作維持原狀等下一輪；釋放失敗就等租約過期。單支工作的原子領取照舊 | 互斥鎖只在一個行程內有效；本機開發也連 Atlas。`ownerToken` 防止過期的持有者改到別人的租約；`attemptId` 是單支工作的防護標記（fencing token），即使舊工作還活著，它的寫入也會被擋下，且沒有保存網址就不能送內容。孤兒紀錄只追加、不覆蓋，所以新狀態不會被舊工作改掉，而遠端已存在的影片 ID 不會遺失、可追查。`$$NOW` 避免兩台機器時鐘不一致。開關讀不到資料庫時已回 `false`（[技術研究 §4.4](quota-upload-research.md#44-現有機制與缺口)），閘門比照 |
| 53 | **短片的重複上傳缺口由 F2 處理**：已由審查修正工單 [F2](work-orders/F-review-fixes.md) 處理：分支 `fix/youtube-lifecycle-review` 的 `455c1eb` 讓影片與短片都以 `uploadClaimQuery` 原子領取、寫入 `youtubeUpload.attemptId`，回寫用 `attemptOwnerQuery` 比對。本次不重做，Q-A 以它為基礎；F 合併進 `dev` 前不開始 Q-A | 避免兩條分支改同一段程式；F2 的 `attemptId` 正好是 #52、#57 需要的防護標記（[技術研究 §4.4](quota-upload-research.md#44-現有機制與缺口)） |
| 54 | **試傳成功解除全部限制**：全部解除：成功上傳一支，代表 API 配額與頻道上限此刻都允許 | 兩種限制都會擋同一個上傳請求，成功就表示兩者都已解除 |
| 55 | **面試用的標準回答**：採用下方「標準回答」段落；對外說明須包含額度用完時的系統行為 | 依 #35～#50 與第三輪的系統行為撰寫 |
| 56 | **上傳時指定與讀回隱私狀態**：① 教學影片上傳一律明確送出 `privacyStatus: 'unlisted'`，比照短片寫死，不再讀 `YOUTUBE_UPLOAD_PRIVACY`（環境變數設成別的值時忽略，並在 `/health` 顯示警告）。② 以 `videos.insert` 回應的 `status.privacyStatus` 為準；回應沒有這個值時呼叫一次 `videos.list(part=status)`（1 單位）；再失敗就存 `null`，**不得用要求的值代替**。短片寫入既有的 `youtubePrivacyStatus`，影片新增 `youtubeUpload.privacyStatus`。③ 讀回值是否合格由 #59 判定，`public` 依 #60 處理。④ 第一次正式上傳時，人工比對 insert 回應與 `videos.list` 一次；不一致就改成每次都用 `videos.list` 讀回 | 產品政策：教學影片只能是不公開，部分教師不希望教材出現在公開頻道或搜尋結果（使用者 2026-10-26）。目前 [env.js](../../../backend/src/config/env.js) 允許用環境變數改成 `public`；回傳的是送出的值，現有測試的假回應是 `private` 也沒抓到（[技術研究 §4.4](quota-upload-research.md#44-現有機制與缺口)）。insert 回應是否反映強制調整後的值屬於推論，留一次實際比對 |
| 57 | **部署或行程中斷時的處理（媒體傳送邊界）**：**媒體傳送邊界**：以 `phase: sending` 的條件寫入**成功**為界。邊界之前（`claimed`、`session_saved`）可證明尚未送出任何影片資料，可以重新排程；已跨越邊界（`sending`）、`sending` 寫入結果不明（例如資料庫逾時），或沒有 `phase` 的舊資料，一律依 #41 查詢一次，`201` 以外隔離，**不建立新的工作階段**。① **前提**：`pm2 restart` 先送 SIGINT，1.6 秒內沒結束就送 SIGKILL（VM 的 `kill_timeout` 待驗證）；關機流程不等背景上傳，所以部署當下若有上傳在進行就會被中斷。不改關機流程。② **進度階段**：`youtubeUpload.phase` 依序為 `claimed`（已領取，尚未保存工作階段）→ `session_saved`（上傳網址、檔案大小已保存）→ `sending`（即將送內容）。每一階段都以 F2 的 `attemptOwnerQuery` 條件寫入成功後才做下一步；**`sending` 寫入成功之前不得送出任何影片資料**。③ **中斷後**（沿用現行判斷：「上傳中」超過 15 分鐘且不在本行程的進行中清單）：`claimed` 或 `session_saved` → 以條件寫入（`attemptId` 與 `phase` 都未變）換成新的 `attemptId`，改為可安全重試；舊工作若還活著，它的 `sending` 寫入會因 `attemptId` 不符而失敗，因此不可能開始送內容。`sending` → 依 #41：用已保存的上傳網址查一次狀態（#49），`201` 就套用（經 #18），其他一律隔離並顯示 #48 的資訊。沒有 `phase` 的舊資料照舊隔離。④ **不做自動續傳**：同一工作階段的自動續傳列為後續擴充，等有可靠的排他機制（能證明舊 PUT 已終止）再評估。⑤ **營運**：部署前先看管理員頁「上傳中」為 0；11/16～27 凍結部署 | `attemptId` 只能擋資料庫的過期回寫，擋不住已經送出的 HTTP PUT；「心跳過期」加「兩次 `Range` 相同」也只是間接證據，無法嚴格證明舊 PUT 已終止，所以不自動續傳。邊界之前的保證來自程式順序，而不是推論 HTTP 傳送不會重疊：只有拿到 `sending` 寫入成功結果的工作才會開始送影片資料；接手是對同一份文件、以 `attemptId` 與 `phase` 為條件的寫入，成功後舊工作的 `sending` 寫入必定失敗。寫入結果不明時，舊工作自己不送，恢復端看到 `sending` 就隔離。這樣只有 `sending` 階段需要人工，且不影響本輪的額度自動恢復 |
| 58 | **「上傳完成」與「可給學生播放」分開判定**：要分開，分三層判斷：① **上傳完成**：YouTube 收下內容、回傳影片 ID。② **技術上可播放**：`status.uploadStatus` 為 `processed`，且 `embeddable` 不是 `false`。③ **符合隱私政策**：讀回的隱私等於 #59 規定的值。②③都成立才切換播放來源（`videoUrl`、`videoSource`）、記下 `youtubeUpload.readyAt` 並從這時開始算清理保留期，短片才上架到學生牆；否則依 #62 的播放來源判斷（`LOCAL_PLAYBACK_ENABLED` 開啟且原片相容時播放受保護原片，否則顯示「影片準備中，可先提問」）、不清理、不自動重傳。恢復排程每輪用 `videos.list(part=status)` 一次查最多 50 支（1 單位）。**查詢故障與影片處理失敗分開**：查詢失敗（網路、配額、權限）只記 `lastCheckError`，狀態維持 `processing`、下一輪再查，不算失敗；連續失敗 1 小時以上發一筆系統警示。**影片處理失敗**：`failed`、`rejected`、`deleted`，或隱私不合格，記 `remoteState = blocked` 與原因（例如 `rejectionReason: length`），通知管理員一次。查詢一直成功但 24 小時仍是 `uploaded`，也記 `blocked`（原因 `processing_timeout`）——**24 小時是 FocusFlow 的人工介入門檻，不是 YouTube 保證的處理時間**。隔離套用（#17、#18）同樣要通過②③。本條修改 #4、#22、#30 的清理條件：「YouTube 上傳完成」改為「②③都通過」；已上傳的舊影片第一次被清理排程考慮前先查一次。**正式驗收**：用 FocusFlow 學生播放器（[StudentCourses.jsx](../../../frontend/focus-flow/src/pages/StudentCourses.jsx) 的 YouTube IFrame 播放器）以學生帳號在正式站實際播放一支系統上傳的影片，確認開始播放、拖曳時間軸可用、沒有出現錯誤碼 101／150（不允許嵌入）或 100（找不到或私人）；結果記入上線紀錄。`embeddable` 為 `true` 只代表擁有者允許，不保證實際能嵌入 | 官方：`uploadStatus` 有 `uploaded`、`processed`、`failed`、`rejected`、`deleted`；即使允許嵌入，仍可能因平台政策或版權主張無法嵌入（[videos 資源](https://developers.google.com/youtube/v3/docs/videos)）；IFrame 播放器的錯誤碼 100、101、150（[IFrame API](https://developers.google.com/youtube/iframe_api_reference)）。查詢用一般配額，50 支 1 單位。目前學生播放器沒有處理 `onError`，播放失敗系統不會知道，所以以正式驗收補足 |
| 59 | **各類影片的隱私政策**：分別定義、不共用判定：**教學影片**：上傳後到播放期間**只接受 `unlisted`**；`public`、`private`、`null` 都不合格；課程或影片刪除後轉 `private`（既有 `privatizeVideoOnDelete`），之後不再檢查是否合格。**短片成品**：草稿、審核中、已上架只接受 `unlisted`；被退回後應為 `private`（既有 `privatizeRejectedShortAsset`）；已封存（課程刪除時封存，現行程式不改隱私）接受 `unlisted` 或 `private`，系統不因封存而改隱私。判定集中成一個函式，依類型與生命週期回傳應有的隱私，#58、#60 共用 | 教學影片與短片的生命週期不同（短片多了審核與退回），各自定義才不會互相誤判。不公開仍是唯一能讓學生端嵌入、又不出現在搜尋與頻道頁的選項（[短片規格](../Short_Script_Automation/specs/2026-09_Short_Script_Automation_Spec.md)「上傳預設 unlisted 是架構限制」） |
| 60 | **影片意外公開時自動轉私人**：視為**高優先的隱私異常**，由系統自動處理，不逐次等管理員確認：① **前置檢查**：影片 ID 必須是資料庫記錄由 FocusFlow 上傳的影片或短片，且 `videos.list` 讀回的 `snippet.channelId` 等於自家頻道（沿用 #17 取得頻道的方式）；#59 規定的隱私不是 `public`。任一項不符就只通知、不動作。② **處置**：用既有的 `setVideoPrivacy` 轉成 `private`（`videos.update`，50 單位，需要 `youtube.force-ssl`，會保留其他狀態欄位），再用 `videos.list` 讀回確認已是 `private`；不切換播放、不清理。③ **通知與稽核**：通知所有管理員（高優先，以影片與偵測時間去重）；在該筆的 `youtubeUpload.privacyIncidents` 記錄偵測時間、偵測到的值、處置、讀回結果、執行者（系統或管理員 ID）。④ **重試與限流**：失敗後依 5 分鐘、15 分鐘、1 小時、之後每 6 小時重試；全站每小時最多 10 次 `videos.update`；碰到一般配額用完（`403 quotaExceeded`）就暫停到太平洋時間午夜（比照 #36）。管理員頁持續顯示「仍為公開」。⑤ **改回**：管理員確認後可按「改回不公開」（改 `unlisted`、讀回確認、記錄操作者），再回到 #58 判斷。⑥ **偵測時機**：insert 讀回、#58 的處理狀態查詢、隔離套用檢查（#18），以及每天一次檢查所有系統上傳的影片與短片（50 支 1 單位）。⑦ **啟用**：加為兩層開關的第四個 key `privacy_guard`（#9、#10），預設關閉；關閉時照常偵測與通知、但不自動改隱私。正式環境開啟前須使用者授權。`private` 或 `null` 不屬於隱私異常 | 公開影片已能被搜尋到，要先收回再調查；轉私人可以再改回，是可逆的安全處置。所有權檢查避免動到教師貼入的他人頻道影片；讀回確認避免把「呼叫成功」當成「已經私人」；退避與限流避免持續失敗時用光一般配額（每次 50 單位） |
| 61 | **原片暫存與授權播放的生命週期**：`uploads/` 定位為 **YouTube 可播放前的原片暫存區**，不是永久的影片儲存平台；YouTube 是最終播放來源。生命週期：① 教師上傳 → 原片存入 `uploads/`，學生端播放來源為受保護的原片（#62；`LOCAL_PLAYBACK_ENABLED` 關閉時顯示「影片準備中，可先提問」）。② 知識化與 YouTube 背景上傳各自進行；問答只看知識化狀態與課程權限，不受 YouTube 影響。③ YouTube 上傳完成但還沒通過 #58 → 繼續播原片。④ 通過 #58（處理完成、可嵌入、`unlisted`）→ 切換成 YouTube 播放器，記 `readyAt`；之後受保護端點**不再對學生提供**這支原片（教師與管理員仍可預覽到清理為止）。⑤ 依 #22 的保留期與空間規則清理，刪檔前在同一輪再查一次 YouTube 狀態，仍通過才刪；只有「上傳成功」不能刪。⑥ 已切換後，每日檢查（#60）發現 YouTube 版不再合格（被刪除、改成私人、處理失敗）：原片還在就自動切回原片並通知管理員；已清理就通知管理員，用補回原片（#23）恢復。⑦ `blocked` 的影片持續播原片、不清理，由管理員處理。本條讓 #37、#39 的「學生照常觀看原片」在實作後成立，並取代先前「顯示影片準備中」的建議 | 學生在 YouTube 準備好之前也要能看影片，但伺服器空間有限（正式 VM 可用約 30 GB，單檔上限 500 MB，見 #33 與[原片暫存播放研究](local-playback-research.md)），所以原片只能過渡。切換後停止對學生提供原片，可降低伺服器負載；刪前再查一次，避免刪掉唯一能播的教材 |
| 62 | **受保護的原片播放**：**Express 驗權限、nginx 送檔案（X-Accel-Redirect）**：① 新增 `GET /videos/:videoId/source`：要求登入（cookie），沿用學生取得影片資料時的同一套可見性判斷（課程已發布、有效選課、影片未刪除，教師為課程擁有者、admin 全部），學生只在播放來源仍是原片時可取用，課程擁有者教師與 admin 可預覽到清理為止；通過後回應 `X-Accel-Redirect: /_protected-uploads/<檔名>`，由 nginx 的 `internal` 位置直接送檔（支援 Range 與拖曳、用 `sendfile`，Node 不經手影片資料）。② 本機開發沒有 nginx：以環境變數切換成 `res.sendFile`（Express 4.22.1 內建 Range 支援，串流讀檔、不整檔載入記憶體）。③ **移除** `app.use('/uploads', express.static(...))`；API 回給學生的播放網址改成這個端點，不再暴露檔名；資料庫既有的 `/uploads/...` 由 API 轉換，不改資料。④ 回應加 `Cache-Control: private, no-store` 與 `Content-Disposition: inline`。⑤ nginx 只新增 `internal` 位置（`alias` 與 `location` 結尾斜線一致、`max_ranges 1`、不啟用 `proxy_cache`），不開放 `/uploads`；這是正式環境設定變更，部署時需使用者授權。⑥ **防繞過**：檔案只依資料庫的 `filePath` 定位，經 `realpath` 確認仍在 `UPLOAD_DIR` 內（擋符號連結），`X-Accel-Redirect` 只放編碼後的檔名；只接受 GET 與 HEAD，HEAD 同樣驗權限；每個 Range 請求都重新驗權限，已送出中的回應無法中途撤回（文件註明）。⑦ 前端在播放中收到 403、404 或 409 時重新取得影片資料：已切換就改用 YouTube 播放器、從同一時間點續播；沒有權限就顯示原因。傳輸方式見 #64⑧ `LOCAL_PLAYBACK_ENABLED` 預設關閉，nginx、授權播放與學生播放器驗收通過後才開啟。⑨ 問答、FAQ 快取、LINE 回應與 `bridgeScope` 比對使用的 `sourceUrl`／`videoUrl` 原值不變，只有影片 API 回給前端的播放欄位改用播放端點。 | 現在 `/uploads` 不需登入、檔名是「時間戳＋原始檔名」很容易猜（[原片暫存播放研究 §1](local-playback-research.md#1-現況)）。X-Accel-Redirect 是 nginx 官方的內部轉送機制，外部直接請求 `internal` 位置會得到 404；權限仍由現有的 cookie 驗證與課程權限決定，不新增元件。拖曳播放時瀏覽器會多發幾次 Range 請求，每次都會重新驗權限，這是刻意的（撤銷選課立即生效） |
| 63 | **原片累積時的儲存空間保護**：不為了空間刪除還沒通過 #58 的原片。適用影片上傳、批次上傳、補回原片與短片成品上傳（都寫入 `UPLOAD_DIR`）。① **請求大小**：只接受有效的 `Content-Length`；缺少回 `411`，非整數、負數或 `Transfer-Encoding: chunked` 回 `400`，超過上限（批次最多 10 支 × 500 MB 加表單開銷）回 `413`；以上都不預約、不寫檔。② **寫入前的容量預約**：在 multer 之前，需要空間 = `Content-Length` × `UPLOAD_SPACE_FACTOR`（nginx 會先把請求暫存到同一個磁碟時為 2，否則為 1）。預約存在 `RuntimeSetting`，key 為「主機名稱＋`UPLOAD_DIR` 的 `realpath`＋檔案系統裝置編號（`fs.statSync().dev`）」，本機開發與正式 VM 各自獨立；以帶版本條件的寫入加入 `{ token, bytes, expiresAt }`，條件是「`statfs` 可用空間 − 同一個 key 的其他有效預約 − 需要空間 ≥ `UPLOAD_MIN_FREE_GB`（建議 5）」；不足就在寫檔前回 `507 UPLOAD_STORAGE_LOW`。③ **實際寫入上限**：multer `limits`（單檔 500 MB、最多 10 個檔案）加上本次請求的位元組計數，寫入總量超過預約就中止、刪除半成品。④ **長時間上傳**：預約有效 2 小時；上傳期間每 10 分鐘、且有收到新資料才續約；超過 10 分鐘沒收到資料就中止請求並釋放。**逾時設定**：Node 的 `server.requestTimeout` 只能整台伺服器一起設，預設 5 分鐘，改為 60 分鐘，其他路由仍由 nginx 的閒置逾時保護；上傳路由另以「10 分鐘沒收到資料就中止」控制閒置。nginx 的 `client_body_timeout`、`proxy_send_timeout`、`proxy_read_timeout` 預設都是 60 秒、只計算兩次讀寫之間的間隔；上傳完成後後端要計算雜湊與檢查容器才回應，上傳路由的 `proxy_read_timeout` 建議改為 300 秒。正式 VM 目前的值待驗證。⑤ **寫入中途磁碟不足與殘留檔**：multer 先寫到 `UPLOAD_DIR/.incoming/`，成功才在同一個磁碟內改名搬到正式位置；`ENOSPC` 或任何失敗時刪除半成品、釋放預約、回 507，不建立影片紀錄。行程中斷留下的半成品只會在 `.incoming/`：排程只刪除同時符合以下條件的檔案：以 `realpath` 確認位於 `.incoming/` 內、超過 3 小時、不屬於任何有效預約、不在本行程進行中的上傳；任一項無法確認就不刪並記錄異常。不會碰正式位置的原片。上傳完成或失敗都釋放預約。⑥ **nginx 暫存**：上傳路由（影片上傳、批次、補回原片）設 `proxy_request_buffering off`，保留 `client_max_body_size`、設定逾時；正式套用需授權，且須通過 Q-F 的驗收：經 nginx 上傳 500 MB 成功、上傳中途斷線後端刪除半成品、空間不足時前端顯示正確的 507 訊息、`nginx -t` 通過、可退回原設定。⑦ **預警**：可用空間低於 `YOUTUBE_UPLOAD_CLEANUP_MIN_FREE_GB` 的 2 倍，每天通知管理員一次；管理員頁顯示「尚未上 YouTube 的原片總量」與 `blocked` 清單。⑧ **照常清理**：#22 的空間規則只刪已通過 #58 且滿 14 天的。前端送檔前可查詢剩餘容量提示教師，以伺服器的預約結果為準 | 只看一次 `statfs` 會在並行或批次上傳時重複計算同一塊空間；multer 用 `diskStorage` 邊收邊寫，預約必須在它之前。nginx 預設先把整個請求寫成暫存檔（[proxy_request_buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering) 預設 `on`）；用戶端以 chunked 傳送時即使關閉也會緩衝，所以拒收 chunked。Node 的 HTTP 解析器只讀 `Content-Length` 宣告的位元組（推論），再加上位元組計數，寫入量不會超過預約。本機實測 Node 22.23.4 `requestTimeout` 為 300000 毫秒。預約 key 分開，避免本機開發連到 Atlas 時佔用正式環境的額度。刪唯一的原片無法復原（#21） |
| 64 | **暫存播放的傳輸方式**：採 **HTTP 漸進式下載＋Range**（#62），加上**本機播放相容性檢查**：上傳後以 `ffprobe` 讀容器與編碼，只有 MP4／WebM 容器，且視訊為 H.264、VP9 或 AV1、音訊為 AAC、Opus 或 MP3 時才提供本機播放，並記下 `moov` 是否在 `mdat` 前（決定起播快慢）；不相容的影片顯示「影片準備中，可先提問」等 YouTube。**不轉碼、不切片、不另存副本**。`ffprobe` 不可用時仍提供播放，由前端 `<video>` 的錯誤事件改顯示同一段提示。`ffprobe` 只是初步篩選，必須搭配瀏覽器實際播放與錯誤處理驗收（Chrome、Edge、Firefox 桌面版與 iOS Safari 各一，含相容與不相容的檔案各一支）。HLS／MPEG-DASH 本次不採用，以下任一情況出現時重新評估（**FocusFlow 自訂的門檻，不是業界標準**）：試用期間超過 2 成原片不相容、同時觀看時首播 p95 超過 3 秒或頻繁緩衝、原片位元率普遍高於「VM 頻寬 ÷ 預期同時人數」。重新評估時先試「單一畫質 H.264 快速起播的轉檔」，需要自適應畫質才上 HLS | 比較見[原片暫存播放研究 §6](local-playback-research.md#6-傳輸方式比較)。原片只播到 YouTube 可播放為止（通常數小時內），之後由 YouTube 提供自適應畫質；HLS／DASH 的主要收益（自適應畫質）在這段過渡期很小，卻要額外轉碼 CPU（VM 同時跑 Whisper）、1.3～2 倍的暫存空間、每個片段都要驗權限、前端整合 hls.js 或 dash.js（Firefox 沒有原生 HLS、DASH 沒有瀏覽器原生支援），清理也要刪整個目錄。VM 的 CPU 與頻寬尚無實測數據，所以不以「VM 跑不動」為理由，而以「過渡期收益小於成本」判斷，並設下重新評估的量化條件 |

**第三輪對既有決策的修改**（實作時以新條文為準，舊條文保留以便追溯）：

| 既有 | 修改內容 | 依據 |
|---|---|---|
| #3 | 「卡在上傳中超過 15 分鐘就隔離」只適用已跨越媒體傳送邊界（`sending`）或沒有 `phase` 的舊資料；邊界之前的工作改為重新排程 | #57 |
| #4、#22、#27、#30 | 清理條件從「YouTube 上傳完成」改為「通過就緒判定且已切換播放來源」；保留期從 `readyAt` 與 `localSourceRestoredAt` 較晚者起算；預告清單用同一條件；短片已封存者接受 `unlisted` 或 `private` | #58、#59、#61 |
| #9、#10 | 執行期開關新增第四個 key `privacy_guard`，預設關閉 | #60 |
| #33 | 開啟清理的時程改為：#58 的就緒判定在正式環境以第一次實際上傳驗收通過後 | #58 |
| #37、#39 | 「學生照常觀看原片」改為「`LOCAL_PLAYBACK_ENABLED` 開啟後經受保護端點觀看；關閉時顯示影片準備中，可先提問」 | #61、#62 |
| #41 | 範圍不變：查詢後只有 `201` 自動套用，其餘隔離；只用於已跨越媒體傳送邊界或沒有 `phase` 的工作，不做自動續傳 | #57 |
| `YOUTUBE_UPLOAD_PRIVACY` | 教學影片不再讀取，一律送出 `unlisted` | #56 |
| `/uploads` 公開路徑 | 移除；[httpOnly cookie 決策](../HttpOnly_Cookie/decisions.md)待討論的「`/uploads` 存取控制」由 #62 處理，該文件需同步 | #62 |


## 待討論（實作前需定案）

1. ~~恢復要不要定期執行~~：已定案，見 #7～#16。
2. ~~被隔離的影片怎麼收尾~~：已定案，見 #17～#19。短影片成品的隔離處理併入第 6 題。
2a. ~~隔離時要不要主動通知管理員~~：已定案，見 #20。
3. ~~開關打開前已上傳的舊影片要不要補清理~~：已定案，見 #26。
4. ~~原片刪掉後要重新處理怎麼辦~~：已定案，見 #21、#23～#25。
5. ~~清理時機~~：已定案，見 #22、#24。
5b. ~~到期刪除前的預告~~：已定案，見 #27。
6. ~~短影片成品要不要納入~~：已定案，見 #28～#32。
7. ~~開啟與驗收~~：已定案，見 #33。
8. ~~YouTube 每日上傳額度用完怎麼辦~~：已定案，見 #35～#64（2026-10-24～26 討論；技術依據見[額度研究](quota-upload-research.md)、[原片暫存播放研究](local-playback-research.md)，欄位見[共用資料契約](shared-data-contract.md)）。

### 額度用完的處理

**名詞**：**API 配額（quota）**是 Google Cloud 專案每天能呼叫 YouTube API 的次數；**頻道上傳上限**是 YouTube 對單一頻道一天能上傳幾支的限制。兩者不同，各有自己的錯誤代碼。

**技術依據**：官方限制、五個開源專案的原始碼比較、本機實測、FocusFlow 現有程式與上傳入口，都在[技術研究](quota-upload-research.md)；原片暫存與授權播放在[原片暫存播放研究](local-playback-research.md)，這裡不重複。

**討論紀錄**：

| 日期 | 內容 | 結果 |
|---|---|---|
| 10-24 | 查證官方配額：2026-06 起上傳有獨立配額每天 100 次，不是舊制的 6 支 | 第一輪 12 題 |
| 10-25 | 審查意見：頻道上限可能只有十幾支；`429` 也可能是每日配額；`308` 不能當成可重傳 | #35～#41 |
| 10-26 | 審查意見：等待不算單支失敗、兩種限制分開記錄、上傳閘門、受控的提前恢復 | #42～#48 |
| 10-26 | 研究五個開源專案原始碼、實測 fetch 處理 308 | #49、#50；修改 #52，新增 #56、#57 |
| 10-26 | 審查意見：租約的持有者比對與舊工作保護、fail-closed；隱私不符時是否擋切換與清理；部署中斷的完整條文 | 補強 #52、#56、#57，新增 #58 |
| 10-26 | 審查意見：可播放與隱私政策分開、正式播放驗收、先保存 `sending` 才送內容、孤兒上傳例外、24 小時是內部政策；產品政策：教學影片只能 `unlisted` | 修正 #52、#56～#58，新增 #59～#61；查證發現正式站學生看不到未上 YouTube 的原片（#61） |
| 10-26 | 使用者要求：自動轉私人要有防護與限流；#57 三個階段與 #41 一致；原片暫存期間讓授權學生安全觀看 | 修正 #57、#58、#60，改寫 #61，新增 #62、#63 |
| 10-26 | 審查意見：容量預約與 nginx 暫存、同一工作階段續傳、播放／切換／清理競態與防繞過、傳輸方式比較；查證審查修正分支已有原子領取 | 修正 #53、#57、#62、#63，新增 #64；work-order 草案見 [Q-plan](work-orders/Q-quota-playback-plan.md) |
| 10-26 | 審查意見：續傳必須證明舊 PUT 已停止、容量預約的請求大小／續約／磁碟隔離、F2 合併前提與資料契約、部署順序 | 修正 #57（行程存活紀錄、`AbortController`、兩次 Range 驗證）、#63、#64，#41 加註範圍變更；work-order 補上合併前提、資料契約與部署順序 |
| 10-26 | 審查意見：兩次 Range 仍不能嚴格證明舊 PUT 已終止；容量預約要處理殘留檔與實際逾時；Q-0 單獨整理 | #57 改回保守方案（不自動續傳、撤回 #41 的範圍變更）；#63 補 `.incoming/` 與逾時；新增[共用資料契約](shared-data-contract.md) |
| 10-26 | 最終一致性檢查：補上媒體傳送邊界定義、已封存短片的隱私、短片成品上傳納入容量預約、問答與 LINE 回應的網址欄位不變、F2 領取條件需加入 `waiting`、可執行的退回程序；共用資料契約五項事項核可 | 第三輪定案為 #51～#64，共用資料契約轉為正式，work-order 定稿 |


**第三輪決策的測試要點**（完整案例與驗收標準以 [work-order](work-orders/Q-quota-playback-plan.md) 為準；欄位名稱以[共用資料契約](shared-data-contract.md)為準）：

- 閘門：兩個呼叫同時取得 → 只有一個成功；租約過期後舊持有者釋放 → 不影響新持有者；讀暫停狀態或存上傳網址時資料庫拋錯 → 不呼叫 YouTube。
- 舊工作：`attemptId` 已改變後舊工作上傳成功 → 不覆蓋狀態，記入 `orphanUploads` 並通知；網址未保存或 `sending` 寫入失敗 → 不送內容。
- 隱私讀回：insert 回應為 `unlisted` → 存 `unlisted`、不呼叫 `videos.list`；為 `private` → 存 `private`、通知一次、不重傳；沒有 `status` → 呼叫一次 `videos.list`；也失敗 → 存 `null`。修正 [short-asset.routes.test.js](../../../backend/tests/short-asset.routes.test.js) 第 86 行附近的期待值。
- 可播放：`uploaded` → 不切換、不清理；`processed`＋`unlisted` → 切換並開始算保留期；`processed`＋`public`／`private`／`null` → 不切換、不清理；`rejected`（`length`）→ `blocked`、通知一次；查詢失敗 → 維持 `processing`、不算失敗；短片未通過 → 不上架。
- 隱私異常：讀回 `public` → 呼叫轉私人、通知高優先、寫入 `privacyIncidents`；轉私人失敗 → 下一輪重試；管理員改回不公開 → 記錄操作者。
- 上傳參數：教學影片 `YOUTUBE_UPLOAD_PRIVACY=public` 時，送出的仍是 `unlisted`。
- 隱私保護：不是自家頻道的影片 → 只通知不改；轉私人後讀回不是 `private` → 記為失敗並排入退避；1 小時內第 11 次 → 延後；`privacy_guard` 關閉 → 只通知。
- 受保護播放：未登入、未選課、課程未發布、影片已刪除 → 403／404 且沒有 `X-Accel-Redirect`；已切換到 YouTube 的影片對學生 → 不提供；合格學生 → 回 `X-Accel-Redirect`（正式）或 `206` 部分內容（開發用 `sendFile`，帶 `Range`）；直接請求 `/uploads/...` → 404。
- 生命週期：通過 #58 → 切換並記 `readyAt`；清理前再查狀態不合格 → 不刪；切換後 YouTube 被改成私人且原片還在 → 切回原片並通知。
- 儲存空間：兩個上傳同時預約、合計超過可用空間 → 只有一個成功、另一個在寫檔前回 507；預約後行程中斷 → 2 小時後失效；寫入中途 `ENOSPC` → 刪除半成品、釋放預約、不建立影片；沒有 `Content-Length` → 拒收；未通過 #58 的原片在空間不足時不刪。
- 播放、切換與清理的競態：學生正在播原片時切換到 YouTube → 已開始的回應送完，下一個 Range 回 409、前端改用 YouTube 並從同一時間點續播；清理刪檔時 nginx 正在送檔 → 已開啟的回應送完（Linux 刪除仍開啟中的檔案可讀完，需實測），之後 404；切換與清理同一輪交錯 → 清理只接受已寫入 `readyAt` 且播放來源已是 YouTube 的候選，並以條件寫入確認候選狀態未變；補回原片與清理交錯 → 沿用 F2 的觀察欄位規則。
- 繞過：直接請求 `/_protected-uploads/...` 與 `/uploads/...` → 404；檔名含 `..`、`%2e%2e`、`%2F`、反斜線、中文與空白 → 只能取到資料庫記錄的那個檔案；`filePath` 是指到 `UPLOAD_DIR` 外的符號連結 → 拒絕；撤銷選課後的下一個 Range → 403；多段 Range → 依 `max_ranges 1` 回整段；回應含 `Cache-Control: private, no-store`，登出後重新整理不能播放。
- 傳輸與相容性：MP4（H.264＋AAC）→ 提供本機播放；MKV 或 HEVC → 不提供、顯示準備中；`ffprobe` 不可用 → 提供播放、前端錯誤時顯示準備中；`moov` 在檔尾 → 仍可播放並記錄。
- 中斷恢復（#57 保守方案）：`claimed`／`session_saved` 超過 15 分鐘 → 換新 `attemptId`、改為可重試；接手與舊工作的 `sending` 寫入同時發生 → 只有一個成功，接手成功時舊工作不送內容；`sending` 中斷 → 查狀態，`201` 套用、其他隔離；不會建立新的工作階段續傳；接手後舊工作的完成回寫 → 被擋下並記為孤兒上傳。
- 請求大小與逾時：缺少 `Content-Length` → 411；chunked 或無效 → 400；超過上限 → 413；寫入量超過預約 → 中止並刪半成品；10 分鐘沒有新資料 → 中止並釋放；20 分鐘持續上傳 → 預約已續約、不被 `requestTimeout` 中斷；上傳完成後後端處理超過 60 秒 → 不被 nginx 中斷（`proxy_read_timeout` 300 秒）；`.incoming/` 中 3 小時前、不屬於有效預約的檔案 → 被刪除，正式位置的檔案與有效預約的檔案 → 不動；本機與正式的預約 key 不同。

**實作切分**（工作說明見 [work-order](work-orders/Q-quota-playback-plan.md)；審查修正 F 完成並合併進 `dev` 前不開始；規格定案不代表授權修改程式或部署）：

| 塊 | 內容 | 主要位置 | 依賴 |
|---|---|---|---|
| Q-A 上傳可靠性 | 錯誤分類（#35）、全站暫停與租約閘門（#44、#52）、`waiting` 狀態（#51）、`phase` 與中斷處理（#57 保守方案，沿用 F2 的 `attemptId`）、上傳網址保存與狀態查詢（#41、#49）、短片原子領取（#53）、排隊順序（#45） | `youtubeUpload.service.js`、`shortAssetPublish.service.js`、`shortAssetRecovery.service.js`、Video／ShortAsset／RuntimeSetting model | 先做 |
| Q-C 受保護播放與儲存保護 | 播放端點與 X-Accel-Redirect（#62）、移除 `/uploads` 靜態公開、播放網址轉換、寫檔前空間檢查（#63）、nginx 設定說明 | `app.js`、`video.routes.js`、`video.service.js`、`upload.middleware.js`、部署文件 | 與 Q-A 平行 |
| Q-B 就緒與隱私 | 寫死 `unlisted` 與讀回（#56）、可播放判定與輪詢（#58）、隱私政策函式（#59）、`privacy_guard`（#60）、清理條件改用 `readyAt`、切回原片（#61） | `youtubeUpload.service.js`、`youtubeLifecycle.service.js`、`shortAssetPublish.service.js` | Q-A 合併後 |
| Q-D 管理員 API 與通知 | 暫停狀態與提前恢復（#46、#54）、上傳紀錄（#38）、系統警示（#43）、狀態查詢結果（#48）、孤兒上傳、隱私事件、空間預警 | `admin.routes.js`、`youtubeAdmin.service.js`、`notification.service.js`、`systemStatus.service.js` | Q-A、Q-B 的服務介面 |
| Q-E 前端 | 教師等待提示（#37、#39）、管理員頁、學生播放器改用播放端點與自動切換 | `TeacherCourses.jsx`、`TeacherShortScripts.jsx`、管理員頁、`StudentCourses.jsx` | Q-C、Q-D 的回應格式 |
| Q-F 文件與驗收 | OpenAPI、錯誤碼（`YOUTUBE_UPLOAD_QUOTA_WAITING`、`UPLOAD_STORAGE_LOW`）、功能開關、`.env.example`、[後端注意事項](../../../backend/docs/handoff-known-issues.md)（#47）、正式驗收清單（#58 播放驗收、#62 nginx） | 各文件 | 每塊同步 |

**標準回答**（#55，已定稿；描述的是 `LOCAL_PLAYBACK_ENABLED` 開啟後的完整行為）：

> YouTube 有兩種上限：一是 Google Cloud 專案每天 100 次的上傳配額，二是 YouTube 對單一頻道一天能上傳幾支的限制，後者沒有公開數字，實際可能只有十幾支。FocusFlow 把上傳 YouTube 設計成背景工作：影片處理完，修課學生就能先在 FocusFlow 內觀看伺服器上的暫存原片並提問，播放前會檢查登入與選課，不必等 YouTube。碰到上限時，系統會辨識是哪一種，全站暫停新的上傳，等配額在太平洋時間午夜重置，或頻道上限 24 小時後，自動依排隊順序補傳；不扣重試次數，老師也不用重按，畫面會顯示最快的補傳時間，管理員只收到一次通知。YouTube 處理完成、確認影片是「不公開」之後，學生端才自動改用 YouTube 播放，伺服器上的原片再依保留期清理。上傳中途斷線時，系統會先向 YouTube 查詢上傳狀態，不會盲目重傳造成重複影片。伺服器空間不足時，系統會先停止收新影片，而不是刪掉還沒上 YouTube 的唯一原片。如果之後學校用量長期超過，可以改用學校自己的頻道，並向 YouTube 申請提高配額。

**追問「不公開安全嗎？」的回答**：不公開的影片不會出現在搜尋與頻道頁，但**知道連結的人都能觀看**，課程權限擋不住轉貼。FocusFlow 只在學生通過選課檢查後才回傳影片編號，並在刪除時轉成私人；系統也會每天檢查，發現被改成公開就立即轉私人並通知管理員（#60）。若教師要求教材只能由授權學生觀看，就不該上傳 YouTube；FocusFlow 的原片播放雖然有權限檢查（#62），但只是上 YouTube 前的過渡，伺服器空間無法長期保存，永久的校內播放要另外評估。

佈展與面試的對外說明須包含額度用完時的系統行為，不能只講部署做法；標準回答已於 #55 定稿（來源：複評 1-2，2026-10-25 複評檢查追加）。

## 實作切分

依 #33，10/20～10/23 在分支 `feat/youtube-lifecycle` 開發，不合併 `main`。工作分五塊，A 先做介面，B～E 可在各自的 worktree 平行開發；每塊完成都要有自動化測試，只用暫存目錄與測試替身，不連 VM、Atlas 或 YouTube。

| 塊 | 內容 | 主要位置 | 對應決策 |
|---|---|---|---|
| A 核心 | 設定集合與兩層開關服務（含修改紀錄 50 筆）；恢復排程與撈資料修正；清理改排程、依空間與保留期判斷（`fs.statfs`）、補回時間起算；「誰符合刪除條件」共用函式供預告使用；新環境變數 | `backend/src/models/`（新設定集合）、`services/youtubeUpload.service.js`、`server.js`、`config/env.js`、`.env.example` | #7～#16、#22、#24、#26 |
| B 管理員 API 與通知 | 下表管理員介面；隔離時通知管理員、處理後通知教師（新增通知來源）；`/health` 與系統狀態顯示實際生效值與預告 | `routes/admin.routes.js`、`controllers/`、`services/notification.service.js`、`services/systemStatus.service.js`、`constants/enums.js` | #13、#15、#17、#18、#20、#27 |
| C 補回原片 | 補回原片介面、沿用上傳檢查、只接受已清理影片；重新處理按鈕的停用狀態 | `routes/video.routes.js`、`services/video.service.js` | #21、#23～#25 |
| D 短片納入 | 描述欄標記；短片隔離收尾與清理條件；清理保留 `filePath`、記 `localCleanupAt` | `services/shortAssetPublish.service.js`、`models/shortAsset.model.js` | #28～#32 |
| E 前端 | 管理員頁（開關與停用原因、啟用清理的預告確認、待處理清單與三個動作、即將到期清單、立即執行恢復）；教師三處提示文字；補回原片按鈕 | `frontend/focus-flow/src/pages/`（管理員頁、`TeacherCourses.jsx`、`TeacherShortScripts.jsx`）、`utils/errorMessages.js` | #13、#15、#17、#19、#23、#27 |

**介面草案**（A 完成時定稿，之後修改要同步本表、OpenAPI 與 route 測試）：

| 方法與路徑 | 用途 | 權限 |
|---|---|---|
| `GET /admin/youtube-lifecycle/settings` | 三個開關的環境允許、執行期設定、實際生效與原因，加修改紀錄 | admin |
| `PATCH /admin/youtube-lifecycle/settings` | 切換單一開關 `{ key, enabled }` | admin |
| `GET /admin/youtube-lifecycle/cleanup-preview` | `?scope=enable` 啟用後立即刪除清單；`?scope=upcoming` 7 天內到期清單 | admin |
| `POST /admin/youtube-lifecycle/recovery/run` | 立即執行一次恢復 | admin |
| `GET /admin/youtube-quarantine` | 待處理清單（影片與短片），每筆附 `reason`：`quarantined` 或 `retry_limit`（#34） | admin |
| `POST /admin/youtube-quarantine/{videos\|short-assets}/:id/lookup` | 查詢 YouTube，只回傳比對結果 | admin |
| `POST /admin/youtube-quarantine/{videos\|short-assets}/:id/apply` | 驗證並套用 `{ youtubeVideoId }` | admin |
| `POST /admin/youtube-quarantine/{videos\|short-assets}/:id/reset` | 重設為可重試、次數歸零、立即排入；兩種原因都接受 | admin |
| `POST /videos/:videoId/source/restore` | 補回原片（multipart） | 課程教師、admin |

**核心服務介面**（A 塊匯出，供 B、D 塊呼叫；改簽名要同步本表）：

開關 `key` 為 `upload`、`recovery`、`cleanup`。開關狀態物件：`{ key, envName, envAllowed, runtimeEnabled, effective, reason, updatedAt, updatedBy }`，`runtimeEnabled` 為 `null` 代表資料庫未設定，`reason` 為 `env_disabled`、`runtime_disabled`、`default_off` 或 `null`。

| 函式 | 參數 | 回傳 |
|---|---|---|
| `getYouTubeLifecycleSettings()` | — | `{ switches: [開關狀態 ×3], history: [{ key, from, to, changedBy, changedByEmail, changedAt }] }`，紀錄由新到舊、最多 50 筆 |
| `getYouTubeLifecycleSwitch(key)` | 開關 key | 開關狀態；未知 key 拋 `400 VALIDATION_ERROR` |
| `isYouTubeLifecycleSwitchEnabled(key)` | 開關 key | `effective` 布林值；讀不到資料庫時回 `false` |
| `setYouTubeLifecycleSwitch({ key, enabled, user })` | `enabled` 須為布林，`user` 取 `id`、`email` | `{ switch: 開關狀態, change: 紀錄一筆 }`；環境變數不允許時拋 `409 YOUTUBE_LIFECYCLE_SWITCH_ENV_DISABLED` |
| `runYouTubeUploadRecoveryNow({ fetchImpl?, now? })` | — | `{ recovered, quarantined, skipped, skippedItems }`；`skippedItems` 是撈到但這一輪沒處理的筆數（含短片）；整輪略過時沒有 `skippedItems`，另有 `reason`：`recovery_disabled`、`upload_not_configured`、`upload_disabled`、`already_running` |
| `listYouTubeCleanupCandidates({ scope, now?, getFreeBytes? })` | `scope`：`enable`（假設現在啟用，下一輪會刪的）或 `upcoming`（7 天內到期，含已到期） | `[{ kind, id, title, courseId, sizeBytes, retentionStartAt, eligibleAt, reason }]`，`reason` 為 `max_age` 或 `low_space`；未知 scope 拋 `400 VALIDATION_ERROR` |
| `buildYouTubeCleanupPreview({ scope, now?, getFreeBytes? })` | 同上 | `{ scope, generatedAt, windowDays, count, totalBytes, freeBytes, freeBytesError, policy: { maxAgeDays, minAgeDays, minFreeGb }, items }`，`items` 即上一列的陣列 |
| `runYouTubeCleanup({ now?, getFreeBytes? })` | — | `{ skipped, candidates, cleaned, freedBytes, results: [{ kind, id, reason, cleaned, skipReason }] }`；略過時 `reason` 為 `cleanup_disabled` 或 `already_running` |
| `buildYouTubeLifecycleSnapshot()` | — | `/health` 的 `runtime.youtubeUpload` 補充欄位：`switches`、`schedulers.{recovery,cleanup}`、`disk`、`cleanupPolicy` |

開關函式在 `services/youtubeLifecycleSettings.service.js`（資料存在 `RuntimeSetting` model、`runtimesettings` 集合，一個 key 一份文件）；恢復在 `services/youtubeUpload.service.js`；清理、預告與快照在 `services/youtubeLifecycle.service.js`。

- **短片納入（D 塊）**：在 `youtubeLifecycle.service.js` 的 `CLEANUP_SOURCES` 加一個 kind，提供 `listEntries()`（回傳 `{ kind, id, title, courseId, sizeBytes, retentionStartTime }`，只列出符合短片安全條件的項目，`retentionStartTime` 為毫秒）與 `cleanup(id)`（刪檔前呼叫 `isYouTubeLifecycleSwitchEnabled('cleanup')`，回傳 `{ cleaned, reason }`，關閉時 `reason` 為 `disabled`）。保留期與空間判斷、預告與排程會自動涵蓋新 kind。
- **短片恢復與隔離（B 塊）**：`youtubeUpload.service.js` 的 `RECOVERY_SOURCES` 在處理完影片後依序呼叫，`short_asset` 由 `shortAssetRecovery.service.js` 的 `recoverShortAssetUploads({ fetchImpl, now })` 處理，回傳 `{ recovered, quarantined, skippedItems }`；兩層開關、同一輪的鎖與批次大小沿用影片。短片上傳的入口都經 `shortAssetPublish.service.js` 的 `runTrackedShortAssetUpload`，失敗時寫入 `youtubeUpload.nextRetryAt`。
- **隔離收尾與通知（B 塊）**：`youtubeQuarantine.service.js` 提供 `listQuarantinedItems`、`lookupQuarantinedItem`、`applyQuarantinedItem`、`resetQuarantinedItem`、`countQuarantinedItems`。待處理條件為失敗、尚無 YouTube ID（短片另需有 `filePath`、未封存），且符合其一：`retrySafe` 不是 `true`（`quarantined`），或 `retrySafe` 為 `true` 但次數已達上限（`retry_limit`，#34）；查詢與套用只接受 `quarantined`。通知在 `notification.service.js` 的 `notifyYouTubeUploadNeedsReview({ kind, item, reason })` 與 `notifyYouTubeUploadResolved({ kind, item, uploaderId, action })`，`dedupeKey` 含失敗時間，失敗只記 log。
- **補回原片（C 塊）**：補回成功時寫入 `youtubeUpload.localSourceRestoredAt`，保留期即從這個時間重新起算。
- `getFreeBytes` 只供測試注入；正式執行用 `fs.statfs` 查 `UPLOAD_DIR`。

**時程與驗收**：

| 日期 | 內容 | 驗收證據 |
|---|---|---|
| 10/20～10/23 | A～E 開發，各自測試 | Backend 相關 `node:test`、`npm run docs:lint`；Frontend `npm test`、`lint`、`build` |
| 10/22（原訂 10/24，複評結束後提前） | ✅ 合併部署（使用者授權並自行 push）；開啟恢復。清理的環境變數依使用者決定維持 `false`，11/9 開清理時才改：刪檔無法復原，上線初期保留 VM 這道關卡 | ✅ `/health` 顯示恢復排程執行、憑證含 `youtube.force-ssl`；✅ 管理員頁截圖。測試上傳延後到團隊下次實際上傳課程影片，不為驗收另傳測試片到頻道。見[上線紀錄](../../10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md) |
| 10/26～11/6 | 本機端到端驗收清理；另開 session 做獨立 code review | 結果寫入 `evidence/`：依規則刪檔、補回原片、預告清單、短片清理、隔離收尾 |
| 11/9～11/13 | 正式環境開啟清理（需使用者授權）：先把 VM 的 `YOUTUBE_UPLOAD_CLEANUP_ENABLED` 改成 `true` 並重啟，再由管理員啟用，預告須為 0 支；瀏覽器實際操作管理員介面 | 截圖與 `/health` 紀錄；更新[目前狀態](../../current-status.md) |
| 11/16～11/27 | 凍結部署，只修緊急問題 | — |

完成時同步：[功能開關](../../../backend/docs/feature-flags.md)、`backend/.env.example`、[OpenAPI](../../../backend/docs/openapi.yaml)、[API 設計規範](../../../.claude/rules/api-design.md)錯誤碼、[API 契約](../../../backend/docs/phase2-api-contract.md)、[目前狀態](../../current-status.md)，以及 `backend/docs/` 的 todo、implementation-log 與 README。

## 風險與授權點

- **2026-10 複評（10/22～10/23）結束前，任何環境都不得啟用清理或刪除 VM 上的原片與資料**；實作與測試只能在暫存目錄操作，部署時清理開關維持關閉。結束後是否啟用，依第 7 題另行授權。

- **部署前提：YouTube 憑證需要 `youtube.force-ssl` 權限**。「查詢 YouTube」與「確認套用」要讀自家頻道（#17、#18），只有 `youtube.upload` 時查詢會退回手動輸入、套用會回 `502 YOUTUBE_QUARANTINE_VERIFY_FAILED`，刪除影片也無法轉私人。10/24 部署後依[部署前檢查](../../10_Operations/deployment/部署與連線排錯.md#部署前檢查youtube-憑證權限)確認 `/health` 的 `runtime.youtubeUpload`；缺少時需用頻道擁有者帳號重新授權，換新的 refresh token。
- 實際上傳、改隱私或刪除 YouTube 影片都會動到外部帳號，每次執行前需使用者明確授權。
- 清理會刪除伺服器檔案，無法復原；正式環境開啟前需確認備份或可從 YouTube 取回。
- 不公開（unlisted）影片只要知道連結就能看，課程權限擋不住轉貼，見[後端注意事項](../../../backend/docs/handoff-known-issues.md)。
