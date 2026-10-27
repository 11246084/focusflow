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
8. **YouTube 每日上傳額度用完怎麼辦**（2026-10-24 開始討論）：複評時評審問「影片都透過你們的帳號上傳，當日上傳上限滿了怎麼辦？」，目前程式沒有處理。查證結果與第一輪題目見下方「額度用完的處理」。

### 額度用完的處理

**名詞**：**API 配額（quota）**是 Google Cloud 專案每天能呼叫 YouTube API 的次數；**頻道上傳上限**是 YouTube 對單一頻道一天能上傳幾支的限制。兩者不同，各有自己的錯誤代碼。

**查證結果**（2026-10-24）：

| 項目 | 內容 | 來源 |
|---|---|---|
| 上傳配額 | 2026-06-01 起 `videos.insert` 有**獨立的配額**，預設每天 100 次、每次 1 單位；舊制每次約 1600 單位、與其他 API 共用 10,000 單位（約 6 支），已不適用 | [配額計算](https://developers.google.com/youtube/v3/determine_quota_cost)、[修訂紀錄](https://developers.google.com/youtube/v3/revision_history) 2025-12-04、2026-06-01 |
| 其他 API | 共用每天 10,000 單位：`videos.list`、`playlistItems.list`、`channels.list` 各 1，`videos.update`（轉私人）50 | 同上 |
| 重置時間 | 太平洋時間午夜：台灣 15:00（夏令）或 16:00（2026-11-01 起冬令） | 同上 |
| 失敗也計次 | 「所有請求，包括無效的請求，至少消耗 1 單位」 | 同上 |
| 配額用完 | `403 quotaExceeded` | [錯誤代碼](https://developers.google.com/youtube/v3/docs/errors) |
| 頻道上限 | `400 uploadLimitExceeded`：頻道當日上傳數已達上限；屬於 YouTube 平台限制，與 Cloud 專案配額無關，換專案無法繞過。YouTube 未公開實際數字與重置方式 | 同上、[videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| 提高配額 | 填 Audit and Quota Extension Form，須先通過 API 服務條款稽核；官方未給審核時間，未提及費用 | [配額與稽核](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) |
| 影片長度 | 未驗證的帳號只能上傳 15 分鐘內的影片；上限 256 GB 或 12 小時 | [YouTube 說明](https://support.google.com/youtube/answer/71673) |

**現行程式碰到這兩種錯誤時**：

- 兩種錯誤都發生在建立上傳工作階段（影片內容送出前），[上傳服務](../../../backend/src/services/youtubeUpload.service.js) `uploadLocalVideo` 一律標成**可安全重試**，不分辨原因；錯誤原因只留在 `youtubeUpload.error` 的文字裡。
- 退避 60 秒、120 秒，恢復排程每 5 分鐘一輪，所以約 10～15 分鐘用完 3 次，進入 #34 的「已達重試上限」，**每支影片各通知管理員一次**。重設後下一次多半還是失敗。
- 每次失敗的呼叫也算一次配額；額度用完期間新處理完的影片仍會各自呼叫一次再失敗。
- 短片走 [短片發布](../../../backend/src/services/shortAssetPublish.service.js) `uploadShortAssetToYouTube`，共用 `uploadLocalVideo`，行為相同；教師建立成品時會直接收到 `502 YOUTUBE_UPLOAD_FAILED`。
- 影片還沒上傳 YouTube 前，學生照常播放伺服器上的原片，問答不受影響；清理只處理已上傳完成的影片（#4），不會刪到等待中的原片。

**用量估算**：Atlas `focusflow` 資料庫目前 20 支影片，單日最多新增 8 支（2026-05-12）；每天 100 次的上傳配額遠高於實際用量。其他 API 主要是短片同步（每 10 分鐘 1 次 `videos.list`，約 144 單位／天）與短片牆（快取 10 分鐘），遠低於 10,000。

**第一輪待答**（建議答案在每題後；答完的題目移到「已定案」）：

| 題 | 問題 | 建議答案 | 理由 |
|---|---|---|---|
| R1-1 | 這次的目的 | 讓額度用完時影片**不卡住、不需人工、不重複通知**，額度恢復後自動補傳；同時有一段能在面試講清楚的標準回答 | 評審問的是「滿了怎麼辦」，要能說出系統行為，而不只是「不會滿」 |
| R1-2 | 哪些錯誤算「額度用完」 | `quotaExceeded`（專案配額）與 `uploadLimitExceeded`（頻道上限）兩種，從 YouTube 回應的 `error.errors[].reason` 判斷；只在建立工作階段時辨識，送出影片內容後的失敗照舊隔離。`rateLimitExceeded`（短時間太頻繁）維持現有退避 | 兩者都要等到隔天才會恢復；送出內容後才失敗仍可能已上傳，安全規則（#3）優先 |
| R1-3 | 等待額度要不要扣重試次數 | 不扣。新增狀態「等待額度」，到時間自動重試；同一支連續等待 3 次重置仍失敗，才改列管理員待處理清單（新 `reason`：`quota_blocked`） | 額度用完不是影片本身的問題；保留上限避免配額被永久調成 0 時每天空轉 |
| R1-4 | 暫停範圍：逐支還是全站 | **全站暫停**：任一支碰到額度錯誤，就記下「暫停到某時間」（存在 `RuntimeSetting`，重啟不遺失）；暫停期間新處理完的影片與短片直接進入等待，不呼叫 YouTube | 額度是整個頻道／專案共用，逐支試只會浪費呼叫、讓每支都失敗一次 |
| R1-5 | 什麼時候恢復 | `quotaExceeded`：下一個太平洋時間午夜後 10 分鐘，以 `America/Los_Angeles` 時區計算，不寫死台灣時間；`uploadLimitExceeded`：失敗後 24 小時 | 前者有官方重置時間，夏令／冬令差 1 小時；後者官方未公開，24 小時是保守值 |
| R1-6 | 恢復後的排隊順序 | 沿用恢復排程：依上次嘗試時間由舊到新，每 5 分鐘 5 支，影片先、短片後；不新增優先序 | 等最久的先傳；量很少（100 支配額 vs 單日最多 8 支），不需要優先序 |
| R1-7 | 教師端顯示 | 狀態顯示「等待 YouTube 每日額度，預計 10/25 15:10 後自動上傳」；這段期間學生照常看原片。重試按鈕停用，API 回新錯誤碼 `409 YOUTUBE_UPLOAD_QUOTA_WAITING` 並附預計時間；不另發通知 | 教師不需要做任何事；按重試只會再浪費一次呼叫 |
| R1-8 | 管理員端顯示與操作 | 「YouTube 上傳管理」頁頂端顯示暫停原因、預計恢復時間與等待支數；每次進入暫停**只通知管理員一次**；提供「提前解除暫停」按鈕（例如配額申請通過後）；等待中的項目不列入待處理清單 | 等待不需人工處理；提前解除是唯一需要人的情境 |
| R1-9 | 要不要預估當日剩餘額度 | 只顯示「今日已呼叫上傳 N 次（配額 100）」，以系統自己的計數為準、太平洋午夜歸零；不依計數提前暫停，以 YouTube 回的錯誤為準 | 查實際剩餘量要另接 Cloud Monitoring 與新憑證；頻道上限沒有公開數字，計數無法預測它 |
| R1-10 | 批次上傳時的提醒 | 不做事前提醒；只有暫停中時，上傳頁顯示「YouTube 額度已用完，影片照常處理、可播放與問答，YouTube 版本會在 X 後自動上傳」 | 單批最多 10 支，遠低於 100；只在真的暫停時提醒，避免平常多一段沒用的文字 |
| R1-11 | 第二個頻道或申請提高配額 | 現階段都不做；寫進部署到學校的作法：學校用自己的 Cloud 專案與頻道，預估每天超過 50 支時再申請稽核 | 用量遠低於配額；第二個專案繞不過頻道上限，第二個頻道會讓查詢 YouTube（#17）與播放來源分散 |
| R1-12 | 其他 API 的配額（10,000 單位） | 不納入本次實作；在[後端注意事項](../../../backend/docs/handoff-known-issues.md)記一條：刪除課程時每支轉私人約 51 單位，一次刪約 190 支以上會用完，用完時轉私人只寫 log、不重試 | 正常用量不到 2%；只有大量刪除會碰到，記錄風險即可 |

標準回答（R1 定案後定稿）待第二輪。

佈展與面試的對外說明須包含額度用完時的系統行為，不能只講部署做法；標準回答待本題定案後定稿（來源：複評 1-2，2026-10-25 複評檢查追加）。

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

## F 工單的實作約束（2026-10-26）

本節保留當時方案。FR01～FR06 的共用 DB 修復改以下一節為準，取代此處的單一 writer 前提、沒有新集合與清理恢復方式；第 1～34 條及每日額度規格不受影響。

以下是 F0～F2 採用的技術方案，沿用第 1～34 條，沒有加入每日額度方案。修正進度與驗證結果只見[目前狀態](../../current-status.md)。

- **單一寫入行程**：採 [F 工單](work-orders/F-review-fixes.md)允許的單行程互斥方案，沿用 #11 的部署前提。來源、短片狀態、實體檔案與 YouTube ID 的鎖共用 [youtubeWorkOwnership.service.js](../../../backend/src/services/youtubeWorkOwnership.service.js)，在第一個 await 前佔用並於 finally 釋放。不得同時由多個 backend、cluster worker 或外部寫入工具改動這些來源／備份欄位；擴為多台前須改用共用所有權儲存。repo 的部署指令只顯示 `pm2 restart focusflow-backend`，不證明現場實際 instance 數；部署前需另行查證，本輪沒有讀 VM。
- **上傳所有權**：Video／ShortAsset 的 `youtubeUpload.attemptId` 是每次佔用產生的 UUID。重試的同一次條件更新核對 failed、安全、未達上限、已到期及觀察到的來源／attempt 版本；成功與失敗都只接受本次 attempt 回寫。重啟後遺留的 uploading 仍依 #3 隔離，不因 token 存在就重傳；進行中的工作不因開關關閉而中斷。
- **來源版本**：兩個 model 的 `youtubeUpload.localSourceVersion` 是來源操作成功佔用時換新的 UUID，用來拒絕舊候選與過期收尾，不是要等待到期的持久鎖。清理核對候選的 filePath、上傳／補回時間、狀態、短片代數、來源版本與實體檔案身份；補回、既有 failed 重處理及短片建立／換代共用來源與檔案鎖。短片審核、封存及回復另共用狀態鎖，避免在刪檔前最後一次設定等待中轉回草稿；狀態鎖與上傳分開，保留上傳中仍可審核的行為，封存後完成上傳也不重新上架。
- **舊資料相容**：上述兩個欄位都可缺省，schema 預設 null；lean 讀取保留舊資料的缺欄位，條件更新區分缺欄位與明確 null。初次上傳或略過上傳遇到 youtubeUpload 為 null／缺欄位時，一次建立完整狀態，避免 Mongo 無法對 null parent 寫子欄位。不新增 collection、index 或批次遷移，不對 Video 的 YouTube ID 加 unique index。匯入的 Video URL 仍可跨課程共用；系統上傳的備份不能被另一筆上傳內容佔用。發現舊資料重複佔用備份時，預告與清理拒絕刪原片，交由管理員確認，沒有自動修正 Shared Atlas。
- **失敗恢復**：不能確認 DB 所有權／引用時不傳送影片或刪檔。驗證、佔用或回寫失敗會釋放行程鎖；來源版本可在下一次成功條件更新時換新，不會永久卡住。unlink 失敗保留來源並維持 YouTube 播放；unlink 成功但 DB 收尾失敗會回報 `state_write_failed`，下輪以缺檔補寫清理狀態，不再計入刪除數量／釋放容量。遭拒的上傳檔案只有在 DB 確認無引用且沒有其他工作持有檔案鎖時才移除，否則保留待確認。

F3 的 completed 影片重新處理入口接續同一套來源所有權；本節沒有新增該狀態轉移或教師操作。

## FR01～FR06 共用資料庫修復約束（2026-10-27）

依本輪授權，修復須支援不同 backend 共用同一資料庫，不能只靠行程內的 Set。以下是本次實作選擇及理由；驗證與待審狀態見[目前狀態](../../current-status.md)與[複驗交接](evidence/2026-10-27_fr01-fr06-fixes.md)。沒有變更 Q-A～Q-F，也沒有提前實作 F3／F4。

- **備份歸屬**：新增 `youtubebackups`，`_id` 為 YouTube ID、`contentKey` 為 `video:<id>` 或 `short_asset:<id>:<generation>`，另有 timestamps。依內建 `_id` 唯一索引條件 upsert；所有系統上傳完成、隔離套用、ShortAsset 建立／更新／換代都經此處。驗證 YouTube 成功後才預留，DB 結果不明時保留預留，同一內容可以續做，其他內容不得繼承。沒有 TTL 或自動回收，避免遲到結果錯綁；需要處理孤立預留時應先確認實際歸屬，不能逕刪紀錄。匯入 Video URL 仍可共用，attach／detach 不改內容歸屬。
- **清理佔用**：`youtubeUpload.cleanupIntent` 記 id、storageKey 與檔案身份，`cleanupClaimedAt` 由 Mongo 設定。claim 與來源版本檢查在同一次原子更新完成；來源補回、failed 重處理佔用、上傳、短片審核／換代／封存／回復的 DB 寫入都要求沒有 intent。刪除及 DB 收尾之前持續保留 intent；競爭不靠「先讀一次」判斷。清理完成的短片不得直接回到需要原片的 draft。
- **清理過期與收尾**：工作從 claim 前開始計算 120 秒單調時間期限；每次 await 後，在同步 unlink 前檢查期限、實體身份及空間。仍有檔案的過期 intent 可由同 storage 的下一輪依 Mongo 時間取消，舊 worker 超時不得刪檔。已無檔案則補寫 `localCleanupAt`，Video 清空 filePath、ShortAsset 保留 filePath；不重新計入刪除數／釋放量。補寫在每輪清理入口、開關與候選選擇之前執行，所以不依賴 low_space 或 max_age。storageKey 為 hostname 與 UPLOAD_DIR realpath 的雜湊，其他本機 backend 不能因自己看不到原片而收尾別台的 intent。
- **活躍上傳**：佔用時寫入伺服器時間 `heartbeatAt`，執行中每 15 秒以相同 attempt／來源條件續寫。恢復隔離的原子更新要求 heartbeat 缺省或比 Mongo `$$NOW` 舊 120 秒；排程傳入的 now 只影響候選，不可讓健康工作被誤隔離。續寫失敗或失去 attempt 時中止遠端 session／PUT；成功與失敗結果仍須符合原 attempt。長時間無法續租或程序死亡後照既有規則隔離、不自動重傳。
- **最後上架**：`markShortAssetPublished` 的 DB 更新同時核對未封存／未上架、approved、審核代數、來源、YouTube ID 與 attempt；呼叫端 await 收尾。新一代一律回 pending，未指定新 ID 時清除舊備份；不能把舊一代的 ID 當成新內容。一般 metadata 更新不得換 filePath，必須走換代入口。
- **最終空間判斷**：low_space 的正式路徑在所有 DB／設定 await 結束後使用 `statfsSync`，同步核對檔案／期限再 unlink。空間恢復或無法讀取即保留來源。測試可注入非同步空間 provider，但不把正式路徑改為先查空間再等待 DB。
- **相容與邊界**：attemptId、localSourceVersion、heartbeatAt、cleanupIntent 可為缺欄位或 null；不需先批次回填。null 的整份 youtubeUpload 以一次更新建立；公開回應不暴露內部佔用欄位。舊重複備份只拒絕新增錯綁／刪檔，不自動修正式資料。多 writer 保證適用所有 writer 都執行新版協定；舊 binary 或外部直接寫入不受應用層條件保護。檔案與 Mongo 不是共同 transaction；本輪用持久 intent、期限及恢復補齊，檔案不得由不遵守協定的外部程式任意替換。租期假設 Mongo 時鐘正常前進；主機／目錄改名後要確認原 storage intent，不能自動認領。

本輪不需追加產品規格問題；使用者已授權自行選擇最小可靠修復。下一道關卡是獨立審查 FR01～FR06，不代表可以提交、部署或啟用正式清理。

## NR01／NR02 再複驗修復約束（2026-10-27）

使用者依獨立複驗授權只修兩個根因。本節取代上一節的過期 intent 取消描述，並補上課程刪除的一致性；FR01、FR03、FR04、FR06 的核心協定沿用。結果與待審狀態見[目前狀態](../../current-status.md)，重現及故障測試見[修復交接](evidence/2026-10-27_nr01-nr02-fixes.md)。

- **清理狀態機**：claim 寫 `phase=claimed`，刪檔工作先以相同 owner 原子轉成 `deleting`。unlink 後收尾失敗，原 owner 可標 `repairable` 提前交接；這時不再做檔案操作。若 DB 也寫失敗，保留舊 intent，等 120 秒過期。租期與同步 unlink 的最後防線不變，沒有靠延長租期解競態。
- **先接管再觀察**：恢復者以舊 id、storageKey 所屬資料、過期或 repairable 條件原子換成新的 id／來源版本與 `recovering`，intent 全程不消失。取得所有權後才查看檔案，且取消或補寫只能用新的 id／版本。檔案存在才取消；缺檔補寫清理完成，Video 清 filePath，ShortAsset 保留路徑及 localCleanupAt。舊 worker 的取消／收尾不能清掉新 owner；恢復者死亡或 DB 失敗也留 intent，下一次過期接管重做。缺 phase 的舊 intent 僅在過期後接管。
- **課程 DB 原子刪除**：以 Mongoose transaction、snapshot readConcern、majority writeConcern 連續處理課程、ShortAsset 封存、影片／兩種 segments／通知／選課／FAQ、其他課程掛載與使用者 activeCourseId。課程先取得寫入衝突鎖；Video 刪除條件要求無 cleanupIntent 且非 uploading，ShortAsset 封存使用原有狀態／intent 條件。任一步失敗全部 abort，不以普通前置讀取或事後 best-effort 回滾代替。UsageLog／Question 保留歷史行為。
- **部署前提**：Mongo 必須支援 transaction（replica set 或 sharded cluster）；standalone 明確回 `503 COURSE_DELETE_UNAVAILABLE`，不做降級刪除。這是最小可驗證的一致性方案；若採跨集合持久鎖，所有刪除與復原步驟都需額外補償，複雜度更高。本輪只驗證本機 replica set 與 standalone 拒絕，沒有查正式 Atlas 設定。
- **外部操作恢復**：新增 `coursedeletionjobs`，課程 DB 交易內以 `_id=<courseId>:<youtubeVideoId>` 寫 pending 待辦，同時為舊 Video 補齊既有備份歸屬。保留歸屬可避免影片被刪後 ID 轉給其他內容，讓遲到的 private 操作誤傷。交易確認提交後、服務啟動與每分鐘批次執行。以原子 claim／attemptId／伺服器 claimedAt 取得 120 秒租約，失敗轉 pending，程序死亡則到期接管；已在 YouTube 生效但回應或 DB 確認遺失時重做 private。無法在交易內撤銷外部操作，因此採持久向前完成，不在 abort 時改回公開。
- **集合及邊界**：待辦保留 courseId、youtubeVideoId、status、attemptId／Count、claimedAt、nextAttemptAt、completedAt、lastError 與 timestamps，沒有 token、TTL 或額外索引；model 關閉 autoIndex／autoCreate。轉私人受原開關／OAuth 設定控制，停用時保留待辦。完成紀錄與備份歸屬不自動回收。這不增加單支影片刪除工作，也不改外部 pipeline 或任意 DB writer 的協定。
- **外部操作期限**：收尾複驗確認無回應的外部請求會卡住整輪待辦。單筆 token、轉私人及回應本文合計限 30 秒，超時發出 AbortSignal、結束等待並轉回 pending，繼續下一筆。逾時後不得開始後續 HTTP 呼叫或把遲到結果當成工作完成；若外部已生效，仍按相同 private 動作重試。此期限小於 120 秒工作租期，不改上傳 heartbeat 或清理協定。

無新增待答產品問題；後續技術收尾依[最終審查與驗證](evidence/2026-10-27_f0-f2-final-review.md)，結案判定見狀態正本。未授權 Commit、Push、Merge 或部署。
