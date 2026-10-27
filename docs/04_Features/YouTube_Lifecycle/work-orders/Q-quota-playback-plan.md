# 工作說明：上傳額度、上傳可靠性與原片暫存播放（Q-A～Q-F）

**狀態（2026-10-26）**：規格已定案（[decisions.md](../decisions.md) #35～#64）、[共用資料契約](../shared-data-contract.md)已核可，本工作說明可交付實作。**開始條件**：下方「F 合併前提」全部完成，且使用者另行授權開始實作；規格定案不代表授權修改程式或部署。技術依據見[額度研究](../quota-upload-research.md)與[原片暫存播放研究](../local-playback-research.md)。

建立日期：2026-10-26。

## 共同規則

- **前提**：下方「F 合併前提」與使用者實作授權仍適用；F0～F2 已合併，F3／F4 不能視為已完成。沿用 F2 的 `uploadClaimQuery`、`uploadClaimUpdate`、`attemptOwnerQuery`、heartbeat、cleanup intent 與持久備份歸屬，`tryAcquireWork` 只是行程內輔助，不另寫一套（#53）。欄位與狀態一律依[共用資料契約](../shared-data-contract.md)，需要新增或改名欄位時先改契約並經使用者核可。
- 每塊從當時的 `dev` 切出 `wip/yt-q-<代號>-<用途>`；先讀根目錄 [AGENTS.md](../../../../AGENTS.md)、決策 #35～#64、共用資料契約、兩份研究與本文件對應段落。
- **小步 commit**：一個可獨立說明的修改一筆，每筆都通過相關測試；作者用本機 Git 身分，不加任何 AI 署名；不 push、不合併、不切換其他分支。
- **禁止**：不連 VM、Shared Atlas、YouTube 或任何外部網路；YouTube 一律注入假的 `fetchImpl`；資料庫行為用 F0 的隔離 Mongo（`backend/integration/helpers/isolatedYouTubeMongo.js`），不得以正式連線作為測試預設；不修改決策已定案的內容。
- **安全**：上傳網址（工作階段 URI）不得出現在 API 回應或 log；`X-Accel-Redirect` 只由播放端點設定。
- 每塊完成時：Backend `npm.cmd test` 全套與 `npm.cmd run docs:lint`；有前端改動時 Frontend `npm.cmd test`、`lint`、`build`。新增或刪除 route 要同步 OpenAPI。

## 依賴與時程

| 塊 | 依賴 | 可平行 | 預計 |
|---|---|---|---|
| F 審查修正 | — | — | F0～F2 已本機合併；F3／F4 待另行授權，見[目前狀態](../../../current-status.md) |
| Q-A 上傳可靠性 | F | Q-C | 10/28～11/3 |
| Q-C 受保護播放與儲存保護 | F（F 改過 `video.service.js`） | Q-A | 10/28～11/3 |
| Q-B 就緒判定與隱私 | Q-A（同檔案） | — | 11/3～11/6 |
| Q-D 管理員 API 與通知 | Q-A、Q-B 的服務介面 | — | 11/5～11/7 |
| Q-E 前端 | Q-C、Q-D 的回應格式 | — | 11/6～11/9 |
| Q-F 文件與驗收 | 每塊同步，最後整合 | — | 11/9～11/13 |

11/16～11/27 凍結部署。#33 原訂 11/9～11/13 開啟清理；#58 改變了清理條件，**清理只能在 Q-B 的就緒判定於正式環境驗收通過後開啟**，這一點列入下方部署順序。

## F 合併前提

2026-10-26 的「dev=c52682f、可直接快轉」是舊快照。F0～F2 已於 2026-10-27 以 `5f60c12` 本機合併，驗收見[最終審查](../evidence/2026-10-27_f0-f2-final-review.md)，現況只看[目前狀態](../../../current-status.md)。以下保留 Q 開始前的剩餘門檻；此次只整合文件，不授權實作：

1. **F3、F4 先完成再開始 Q**（沿用使用者 2026-10-26 決定）：F3 補回後重新處理、F4 狀態顯示會改到 `video.service.js` 與前端，仍須處理與 Q-C、Q-E 的銜接；F0～F2 已先合併不代表這兩項已完成。
2. F0～F2 的 Backend 1199、隔離 Mongo 62 及 docs:lint 結果沿用；F3／F4 後續修改再按影響範圍執行驗證，不為本次純文件整合重跑。
3. F0～F2 最終審查已通過；新增實作仍須檢查無誤刪、無重複上傳、匯入與短片相容性，不重啟已結案的同一輪審查。
4. 介面核對已補入[共用資料契約 §2.1](../shared-data-contract.md#21-youtubeupload-子文件)：以現行 claim update、attempt、heartbeat、intent 與備份歸屬為基底。新欄位或語意變更仍先更新契約並經核可，不在 Q-A 重寫一套。

## Q-0 共用資料契約

已於 2026-10-26 核可為正式契約：[共用資料契約](../shared-data-contract.md)。本文件不重複欄位定義；平行安排依上方依賴表：Q-A 與 Q-C 可平行，Q-B 等 Q-A。F3／F4 的剩餘前提與另行實作授權不因本次文件整合而解除。

## 整合與部署順序（避免播放中斷）

正式站現況：已上傳的影片用 YouTube 播放；還沒上 YouTube 的原片在正式站本來就播不了（nginx 沒有轉送 `/uploads`）。`main` 推送時前後端會一起部署。

1. **Q-A**：只改後端上傳流程，播放不變。
2. **Q-C＋Q-E 的學生播放部分**：新增 `LOCAL_PLAYBACK_ENABLED`（預設 `false`）。關閉時播放端點回 409、前端對未上 YouTube 的影片顯示「影片準備中，可先提問」，和現況相同或更好；YouTube 播放完全不受影響。部署後經授權在 nginx 加上 `internal` 位置並驗收，再開啟 `LOCAL_PLAYBACK_ENABLED`。前端要同時相容新舊 API 回應。
3. **Q-B**：已上傳的舊影片維持 YouTube 播放，不批次改回原片；`remoteState` 在第一次查詢時才寫入，查到不合格才依 #61 處理並通知。
4. **Q-D、Q-E 管理員與教師畫面**。
5. **清理**：Q-B 在正式環境完成第一次實際上傳的就緒驗收後，才依 #33 的步驟開啟。


## Q-A 上傳可靠性

**修改範圍**：`youtubeUpload.service.js`、`shortAssetPublish.service.js`、`shortAssetRecovery.service.js`、`youtubeWorkOwnership.service.js`（F2 新增）、`notification.service.js`（只加兩個通知函式）、Video／ShortAsset model、`constants/enums.js`、`config/env.js`、`.env.example`。

**要做**：

1. **錯誤分類**（#35）：解析建立工作階段失敗的回應，回傳 `api_daily`、`channel_limit`、`rate_limit`（含 `Retry-After`）或 `unknown`；只在送出內容前使用。
2. **暫停狀態**（#36、#44）：`RuntimeSetting` 的 `youtube_upload_pause` 分開記錄 API 配額與頻道上限的開始與結束時間；恢復時間以 `America/Los_Angeles` 計算；兩種都過了才放行。
3. **租約閘門**（#52）：`RuntimeSetting` 的 `youtube_upload_gate`，欄位 `ownerToken`、`leaseUntil`；以帶 `ownerToken` 條件的 `findOneAndUpdate` 取得、續約、釋放，時間用 `$$NOW`（實作時先以測試確認 Mongoose 8.23 接受管線式更新）；租約只涵蓋「換 token → 建立工作階段 → 保存工作階段」；任何讀寫失敗都不放行。
4. **等待狀態**（#51、#45）：新增 `waiting` 與 `waitReason`、`nextRetryAt`、`queuedAt`；恢復排程撈到時間的 `waiting`，依 `queuedAt`、`_id` 排序；碰到額度的那次不計次數。
5. **教師重試**（#37）：等待中回 `409 YOUTUBE_UPLOAD_QUOTA_WAITING`，附 `earliestRetryAt`；影片與短片都要。
6. **全站警示與暫停通知**（#43、#46）：連續 3 個週期實際送出仍碰到額度 → 一筆系統警示；每次進入暫停只通知一次（`dedupeKey` 含暫停開始時間）。
7. **進度階段與中斷處理**（#57 保守方案）：`phase`（`claimed`／`session_saved`／`sending`）與 `session`；每一步以 `attemptOwnerQuery` 條件寫入，`sending` 寫入成功才送內容；中斷超過 15 分鐘且不在本行程只代表候選，原子接手／隔離另須通過既有 `expiredUploadHeartbeat()` 及來源／代數條件，避免誤隔離其他 Backend。`claimed`／`session_saved` 以條件寫入換新 `attemptId` 改為可重試，`sending` 依 #41 處理。**不做自動續傳、不新增行程存活紀錄；保留已合併 F2 的 attempt heartbeat**。
8. **狀態查詢**（#41、#49）：只用在 `sending` 中斷後；查詢用 `redirect: 'manual'`，相容 `200`＋`X-Http-Status-Code-Override: 308`；`201` 套用（經 #18 的既有檢查），`308`、`404` 與查詢失敗一律隔離並記下查詢結果供 #48 顯示。把 `uploadLocalVideo` 拆成「建立工作階段」「查詢」「送出內容」三個函式。
9. **領取條件擴充**：在 F2 的 `uploadClaimQuery` 加入第三種來源「`waiting` 且 `nextRetryAt` 已到」，觀察欄位加入 `waitReason`、`phase`，保留無清理 intent、來源及既有狀態條件；透過 `uploadClaimUpdate` 設定初次 `phase: claimed`、`queuedAt` 與伺服器 heartbeat（契約 §2.1）。
10. **退回工具**：`npm run youtube:release-waiting`，預設只列出 `waiting` 的影片與短片；加 `-- --write` 才把它們改為 `failed`、`retrySafe: true`、`nextRetryAt` 為現在（契約 §6）。
11. **孤兒上傳**（#52）：`attemptId` 不符的成功結果只以 `$addToSet` 寫入 `youtubeUpload.orphanUploads`，並通知管理員。

**測試案例**（至少）：

| 編號 | 情境 | 預期 |
|---|---|---|
| QA-T1 | `403 quotaExceeded`、`429` 且訊息為 `Video Uploads per day`、`400 uploadLimitExceeded`、其他 `429`、無法解析 | 分別歸為 `api_daily`、`api_daily`、`channel_limit`、`rate_limit`、`unknown` |
| QA-T2 | 暫停中，自動上傳、教師重試、恢復排程同時觸發 | 都不呼叫 YouTube；教師收到 409 與最快時間 |
| QA-T3 | 兩種限制同時存在，API 配額先到期 | 仍暫停到頻道上限到期 |
| QA-T4 | 夏令、冬令交界（11/1）計算恢復時間 | 台灣 15:10 與 16:10 各自正確 |
| QA-T5 | 兩個呼叫同時取得租約 | 只有一個成功；另一個重試後成功或改 `waiting`（`gate_busy`） |
| QA-T6 | 租約過期後舊持有者釋放 | 不影響新持有者 |
| QA-T7 | 讀暫停狀態、取得租約、保存工作階段時資料庫拋錯 | 不呼叫 YouTube、不送內容 |
| QA-T8 | 同一支連續 3 週期受阻 | 只發一筆系統警示，其餘影片維持 `waiting` |
| QA-T9 | `sending` 寫入失敗 | 不送任何資料 |
| QA-T10 | 中斷後 `claimed` 或 `session_saved` | 換新 `attemptId`、改為可重試、不扣次數 |
| QA-T11 | 接手的條件寫入與舊工作的 `sending` 寫入同時發生（隔離 Mongo） | 只有一個成功；接手成功時舊工作不送任何資料 |
| QA-T12 | 中斷後 `sending`，查到 `201`／`308`／`404`／查詢失敗 | 套用／隔離／隔離／隔離；全程不建立新的工作階段 |
| QA-T13 | 舊工作在接手後完成 | 狀態不變，寫入孤兒紀錄並通知 |
| QA-T14 | 查詢回應帶 `Location` 的 `308` | 判為未完成，不跟隨重新導向 |
| QA-T15 | API 回應與 log | 不含上傳網址 |
| QA-T16 | 沒有 `phase` 的舊資料卡住 | 依 #41 查詢一次，`201` 套用、其他隔離 |
| QA-T17 | `waiting` 且 `nextRetryAt` 已到、暫停已解除 | 可被領取；未到或仍暫停 → 不領取 |
| QA-T18 | `sending` 寫入逾時（結果不明） | 該工作不送資料；恢復端看到 `sending` 依 #41 處理 |
| QA-T19 | `youtube:release-waiting` 預覽與 `--write` | 預覽不寫入；寫入後 `waiting` 為 0、`attemptCount` 不變 |

**驗收標準**：上表全部通過（QA-T5、T6、T7、T11、T13 另在隔離 Mongo 驗證）；F 的既有測試仍全部通過；`/health` 顯示暫停狀態與閘門持有狀況。

## Q-B 就緒判定與隱私

**修改範圍**：`youtubeUpload.service.js`、`youtubeLifecycle.service.js`、`shortAssetPublish.service.js`、`shortAssetCleanup.service.js`、`youtubeQuarantine.service.js`、`youtubeLifecycleSettings.service.js`、`shortsSync.service.js`（只加隱私檢查）、model、`config/env.js`。

**要做**：

1. **隱私**（#56、#59）：教學影片寫死 `unlisted`，忽略 `YOUTUBE_UPLOAD_PRIVACY` 並在 `/health` 警告；讀回 insert 回應的 `status.privacyStatus`，沒有時呼叫一次 `videos.list`，再失敗存 `null`；影片新增 `youtubeUpload.privacyStatus`；新增「依類型與生命週期回傳應有隱私」的函式。
2. **可播放判定**（#58）：`remoteState`（`processing`／`ready`／`blocked`）、`readyAt`、`lastCheckError`；恢復排程每輪以 `videos.list(part=status)` 一次查 50 支；查詢失敗不算失敗，連續 1 小時發系統警示；`failed`、`rejected`、`deleted`、隱私不合格、24 小時仍 `uploaded` → `blocked`。
3. **切換**（#58、#61）：只有 `ready` 才切換 `videoUrl`、`videoSource`；短片只有 `ready` 才上架；隔離套用同樣要通過判定。
4. **清理條件**（#58、#61）：#4、#22、#30 改為「`ready` 且已切換」，保留期從 `readyAt` 起算；刪檔前同一輪再查一次；舊資料第一次被考慮前先查一次。
5. **切回原片**（#61）：每日檢查發現已切換的影片不再合格：原片還在 → 切回並通知；已清理 → 通知、提示補回原片。
6. **隱私保護**（#60）：兩層開關新增 `privacy_guard`（預設關閉）；偵測到 `public`：所有權與政策檢查 → 轉 `private` → 讀回確認 → 寫 `privacyIncidents`；退避 5 分、15 分、1 小時、之後每 6 小時；全站每小時最多 10 次；一般配額用完暫停到太平洋午夜；每日檢查所有系統上傳的影片與短片。

**測試案例**（至少）：insert 回應 `unlisted`／`private`／沒有 `status`／`videos.list` 也失敗；`YOUTUBE_UPLOAD_PRIVACY=public` 仍送出 `unlisted`；`uploaded` 不切換不清理；`processed`＋`unlisted` 切換並記 `readyAt`；`processed`＋`public`／`private`／`null` 不切換不清理；`rejected`（`length`）→ `blocked` 並通知一次；查詢失敗維持 `processing`；24 小時 → `processing_timeout`；清理前再查不合格 → 不刪；已切換後變成私人且原片在 → 切回；`public` 且 `privacy_guard` 開 → 轉私人、讀回、記錄；非自家頻道 → 只通知；`privacy_guard` 關 → 只通知；第 11 次轉私人 → 延後；短片被退回後為 `private` → 合格；已封存短片為 `unlisted` 或 `private` → 合格；保留期從 `readyAt` 與 `localSourceRestoredAt` 較晚者起算；清理預告（#27）與排程用同一條件。

**驗收標準**：上列全部通過；既有清理測試依新條件更新後通過；`/health` 顯示 `privacy_guard` 狀態與未就緒數量。

## Q-C 受保護播放與儲存保護

**修改範圍**：`app.js`、`routes/video.routes.js`、`controllers/video.controller.js`、`services/video.service.js`（播放網址轉換）、新的播放與容量服務、`middleware/upload.middleware.js`、`mediaIntegrity.service.js`（加 `ffprobe`）、`config/env.js`、`.env.example`；nginx 設定**只寫成文件範例**，不改 VM。

**要做**：

1. **播放端點**（#62）：`GET`／`HEAD /videos/:videoId/source`；沿用學生取得影片資料的可見性判斷；只在播放來源為原片且相容時提供；`MEDIA_ACCEL_REDIRECT_ENABLED` 開啟時回 `X-Accel-Redirect: <前綴><編碼後檔名>`，關閉時用 `res.sendFile`；`realpath` 確認在 `UPLOAD_DIR` 內；`Cache-Control: private, no-store`、`Content-Disposition: inline`。
2. **移除公開路徑**：刪除 `app.use('/uploads', express.static(...))`；API 回給前端的本機播放網址改成播放端點，既有資料的 `/uploads/...` 在輸出時轉換。
3. **相容性檢查**（#64）：上傳後以 `ffprobe` 記錄 `localPlayback`（容器、視訊與音訊編碼、`moov` 是否在前、是否相容）；`ffprobe` 不可用時記為未知、仍提供播放。
4. **容量預約**（#63）：影片上傳、批次上傳、補回原片與短片成品上傳（`short-script.routes.js` 的 `uploadSingleVideo`）在 multer 之前檢查 `Content-Length`（缺少 411、chunked 或無效 400、超過上限 413）並預約；預約 key 含主機、`UPLOAD_DIR` 的 `realpath` 與裝置編號；multer 先寫到 `UPLOAD_DIR/.incoming/`，成功才改名搬到正式位置；`limits` 加位元組計數，超過預約就中止；有收到資料才每 10 分鐘續約，10 分鐘沒資料就中止；`server.requestTimeout` 改為 60 分鐘；`ENOSPC` 刪半成品並回 507；`.incoming/` 的清理只刪契約 §5.5 條件全部成立的檔案，無法確認就不刪並記錄異常；`GET` 查詢剩餘容量供前端提示；每日預警。
6. **本機播放開關**：`LOCAL_PLAYBACK_ENABLED`（預設 `false`），關閉時播放端點回 409，見「整合與部署順序」。
5. **nginx 範例**：`internal` 位置（`alias` 結尾斜線、`max_ranges 1`、不啟用 `proxy_cache`）；上傳路徑 `proxy_request_buffering off`、保留 `client_max_body_size`、`proxy_read_timeout 300s`，並註明 `client_body_timeout` 與 `proxy_send_timeout` 預設 60 秒是兩次讀寫之間的間隔；寫進部署文件草稿，標明需授權才套用。

**測試案例**（至少）：未登入／未選課／課程未發布／影片已刪除 → 403 或 404 且沒有 `X-Accel-Redirect`；已切換到 YouTube → 學生不提供、教師可預覽；合格學生 → `X-Accel-Redirect`（正式設定）或 `206`＋`Content-Range`（`sendFile`）；HEAD 同樣驗權限；請求 `/uploads/...` → 404；檔名含中文、空白、`..`、`%2F`、反斜線；`filePath` 為指到外部的符號連結 → 拒絕；MKV 或 HEVC → 不提供；`ffprobe` 不存在 → 提供；兩個上傳同時預約超過容量 → 一個 507；缺少 `Content-Length` → 411；chunked → 400；超過上限 → 413；寫入量超過預約 → 中止並刪半成品；10 分鐘沒收到資料 → 中止並釋放；20 分鐘持續上傳 → 續約成功、不被逾時中斷；`.incoming/` 的舊半成品被刪、正式檔案與有效預約的檔案不動；行程中斷後正式位置沒有半成品；不同主機或不同磁碟的預約互不影響；`ENOSPC` → 無半成品、無影片紀錄；預約逾時釋放；`LOCAL_PLAYBACK_ENABLED=false` → 409；已切換到 YouTube 後教師與 admin 仍可預覽、學生不可；問答回應、FAQ 快取、LINE 回應與 `bridgeScope` 比對的 `sourceUrl`／`videoUrl` 與修改前相同（快照測試）；`.incoming/` 內正在上傳或屬於有效預約的檔案、`realpath` 不在 `.incoming/` 內的檔案 → 不刪並記錄。

**驗收標準**：上列全部通過；本機用 Vite 開發模式能播放受保護原片並拖曳；文件附上 nginx 設定範例與 `curl` 驗證步驟（含 `/_protected-uploads/` 直接請求回 404）。

## Q-D 管理員 API 與通知

**修改範圍**：`routes/admin.routes.js`、`controllers/`、`youtubeAdmin.service.js`、`notification.service.js`、`systemStatus.service.js`、OpenAPI、`.claude/rules/api-design.md` 錯誤碼表。

**要做**：上傳狀態總覽（暫停類型與時間、等待支數、過去 24 小時成功支數與上次暫停時的支數，#38）；「提前檢查並嘗試恢復」只放行一支、試傳成功解除全部限制（#46、#54）；待處理清單加上傳狀態查詢結果（#48）與孤兒上傳；隱私事件清單與「改回不公開」；`privacy_guard` 開關；儲存狀態（預約量、尚未上 YouTube 的原片總量、`blocked` 清單）；新通知來源：暫停、連續受阻警示、隱私事件、YouTube 不可播放、空間預警，皆以 `dedupeKey` 去重。

**測試案例**：非 admin 403；每個 API 成功路徑；試傳進行中重複按 → 409；試傳失敗重新暫停且不重複通知；改回不公開記錄操作者；每種通知只發一次。

**驗收標準**：上列通過；`tests/docs.routes.test.js` 與 `docs:lint` 通過；回應格式先寫進 OpenAPI，Q-E 依 OpenAPI 實作。

## Q-E 前端

**修改範圍**：`TeacherCourses.jsx`、`TeacherShortScripts.jsx`、`utils/errorMessages.js`、管理員 YouTube 上傳管理頁、`StudentCourses.jsx`、對應 services 與測試。

**要做**：教師端等待文字與停用重試（#37）、暫停中的上傳頁提示（#39）、507 說明；管理員頁的暫停橫幅與試傳按鈕、上傳紀錄、孤兒上傳、隱私事件與改回按鈕、儲存狀態、`privacy_guard` 開關；學生端改用播放端點播放原片、`ready` 後改用 YouTube 播放器、播放中收到 403／404／409 時重新取得影片資料並從同一時間點續播、不相容或播放錯誤時顯示「影片準備中，可先提問」、YouTube 播放器 `onError` 100／101／150 顯示對應訊息。

**測試案例**：各狀態文字；按鈕停用；切換時續播位置；錯誤碼對應訊息。

**驗收標準**：Frontend `test`、`lint`、`build` 通過；本機瀏覽器實際操作教師、管理員、學生三種畫面並截圖；**瀏覽器播放驗收**（#64）：Chrome、Edge、Firefox 桌面版與 iOS Safari 各播放一支相容的原片（起播、拖曳）與一支不相容的檔案（顯示準備中、沒有空白播放器），記錄結果。

## Q-F 文件與驗收

**每塊同步**：OpenAPI、錯誤碼（`YOUTUBE_UPLOAD_QUOTA_WAITING`、`UPLOAD_STORAGE_LOW` 等）、[功能開關](../../../../backend/docs/feature-flags.md)、`backend/.env.example`、[後端注意事項](../../../../backend/docs/handoff-known-issues.md)（#47、unlisted 限制、所有 writer 遵守新版協定）、[部署與連線排錯](../../../10_Operations/deployment/部署與連線排錯.md)（nginx 範例）、[目前狀態](../../../current-status.md)、`backend/docs/` 的 todo、implementation-log 與 README。

**整合驗收（本機）**：隔離 Mongo、假 YouTube，跑一次完整生命週期：上傳 → 受保護原片播放 → 額度暫停與恢復 → 中斷後依階段恢復或隔離 → 可播放判定 → 切換 → 清理預告與清理；另做一次 `public` 事件。結果寫入 `evidence/`。

**正式環境（每一步都需使用者授權）**：

1. 唯讀查證：`nginx -T`、`nproc`、`free -h`、`df -h`（含 nginx 暫存目錄）、`ffprobe -version`、`pm2 jlist`（`exec_mode`、`instances`、`kill_timeout`）。
2. 部署順序依上方「整合與部署順序」：後端與前端（`LOCAL_PLAYBACK_ENABLED=false`）→ nginx 新增 `internal` 位置與上傳路由的 `proxy_request_buffering off`（`nginx -t` 後重讀，保留原設定可退回）→ 確認 `/uploads/...` 與 `/_protected-uploads/...` 都回 404 → 經 nginx 上傳 500 MB、上傳中途斷線、空間不足回 507 → 開啟 `LOCAL_PLAYBACK_ENABLED`。
3. 第一次實際上傳：比對 insert 回應與 `videos.list` 的隱私；學生帳號播放受保護原片並拖曳；`ready` 後切換到 YouTube 播放器，確認沒有 100／101／150。
4. 經授權後開啟 `privacy_guard`；經授權後於維護時段做 20 個並行 Range 請求測試。
5. Q-B 的就緒判定在正式環境以第一次實際上傳驗收通過後，才依 #33 的步驟開啟清理。

**驗收標準**：本機整合驗收證據齊全；正式環境每一步有截圖或指令輸出，記入上線紀錄；未做的步驟明確列出原因。

## 交付方式

1. 每塊開始前，負責人（Claude 或使用者）在當時的 `dev` 建 worktree 與分支，先在該 worktree 的 `backend/` 執行 `npm.cmd ci`（Codex 沙箱預設不能連網）。
2. 交給 Codex 時，以本文件「共同規則」加上對應塊的段落為工作範圍，例如：

   ```bash
   codex exec -C .claude/worktrees/yt-q-a -s workspace-write --add-dir .git -o yt-q-a-result.md "依 docs/04_Features/YouTube_Lifecycle/work-orders/Q-quota-playback-plan.md 的「共同規則」與「Q-A 上傳可靠性」執行，完成後依「完成時回報」回報"
   ```

3. **完成時回報**：分支名、每一筆 commit（hash 與標題）、每個測試案例編號與結果、`npm.cmd test` 與 `docs:lint` 的通過／失敗數、與共用資料契約不一致之處、未完成或有疑慮的地方。
4. 合併前檢查身分：`git log --format="%h %an <%ae> | %cn <%ce> | %s" dev..<分支>` 只能有 Weihao；`git log --format=%B dev..<分支> | grep -i -c "co-authored\|claude-session\|generated with"` 必須為 0。
5. 合併、push、部署與正式環境步驟都由使用者決定並授權。
