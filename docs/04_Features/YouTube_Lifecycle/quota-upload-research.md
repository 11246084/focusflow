# YouTube 上傳額度與上傳可靠性：技術研究

這份文件保存「YouTube 每日上傳額度用完」與「上傳結果不確定」兩個問題的技術依據（原片暫存與授權播放另見[原片暫存播放研究](local-playback-research.md)）：官方文件、開源專案原始碼、本機實測與 FocusFlow 現況。設計決策與理由只記在 [decisions.md](decisions.md)（#35 之後），這裡不重複；實作者（Codex 或 Claude）寫 work-order 或程式前，先讀決策，再用本文件查證據與實作注意事項。

最後查證：2026-10-26（補充：影片處理狀態、PM2 終止行為、播放器錯誤碼、隱私政策、唯讀查證結果）；FocusFlow 對照 `dev` @ `c52682f`，行號以當日為準。

## 證據等級

每條結論標註來源類型，引用時保留標註：

| 標註 | 意思 | 可以怎麼用 |
|---|---|---|
| **官方** | Google／YouTube 官方文件 | 可作為設計依據 |
| **開源** | 開源專案原始碼（附 commit permalink） | 參考寫法；不代表 YouTube 的行為 |
| **測試** | 開源專案的測試或本機實測 | 證明「這段程式這樣運作」 |
| **宣稱** | README、註解或論壇回報，未看到程式或官方確認 | 只作為風險提示 |
| **推論** | 由上面幾項推出、尚未實際驗證 | 實作時要用測試或實際上傳確認 |

## 1. 官方限制（官方）

查證日 2026-10-24～26。

| 項目 | 內容 | 來源 |
|---|---|---|
| 上傳配額 | 2026-06-01 起 `videos.insert` 有獨立配額，預設每天 100 次、每次 1 單位；舊制每次約 1600 單位、與其他 API 共用 10,000 單位（約 6 支）已不適用 | [配額計算](https://developers.google.com/youtube/v3/determine_quota_cost)、[修訂紀錄](https://developers.google.com/youtube/v3/revision_history) 2025-12-04、2026-06-01 |
| 其他 API | 共用每天 10,000 單位：`videos.list`、`playlistItems.list`、`channels.list` 各 1，`videos.update`（轉私人）50 | 同上 |
| 重置時間 | 太平洋時間午夜：台灣 15:00（夏令）或 16:00（2026-11-01 起冬令） | 同上 |
| 失敗也計次 | 「所有請求，包括無效的請求，至少消耗 1 單位」 | 同上 |
| 配額用完 | `403 quotaExceeded` | [錯誤代碼](https://developers.google.com/youtube/v3/docs/errors) |
| 頻道上限 | `400 uploadLimitExceeded`，屬於 YouTube 平台限制，與 Cloud 專案配額無關。網頁、手機與 API 合併計算「24 小時內」的上傳數，依國家／地區與頻道紀錄而不同，違規警告會降低上限，碰到時「24 小時後再試」；未公開數字 | 同上、[videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)、[常見上傳錯誤](https://support.google.com/youtube/answer/10383400) |
| 提高配額 | 填 Audit and Quota Extension Form，須先通過稽核；未給審核時間、未提及費用；解除不了頻道上限 | [配額與稽核](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) |
| 影片長度 | 未驗證的帳號只能上傳 15 分鐘內的影片；上限 256 GB 或 12 小時 | [YouTube 說明](https://support.google.com/youtube/answer/71673) |
| 隱私狀態 | 未指定時預設 `public`；「未驗證 API 專案上傳的影片不限於私人」（2026-10-15 版） | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| 查詢上傳狀態 | 對上傳網址送空的 `PUT`（`Content-Range: bytes */檔案大小`）：完成時回當初完成的回應（成功為 `201` 加影片資源）；`308` 為中斷或仍在進行，`Range` 是已收到的位元組，沒有 `Range` 代表尚未收到資料；網址過期回 `404`。未公開有效期限。續傳是對**同一個上傳網址**再送 `PUT`，`Content-Range: bytes 起始位元組-最後位元組/總長度`，只送尚未上傳的部分；成功時回應「建立的影片資源」（一個工作階段只產生一支影片屬推論，官方未明文） | [續傳協定](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) |
| 影片處理狀態 | `status.uploadStatus`：`uploaded`、`processed`、`failed`、`rejected`、`deleted`；`failureReason` 含 `uploadAborted`、`codec` 等；`rejectionReason` 含 `length`（超過長度限制）、`duplicate`、`copyright` 等；`embeddable` 為布林值，但即使允許嵌入，仍可能因平台政策或版權主張無法嵌入播放；`processingDetails` 的處理進度只有影片擁有者讀得到 | [videos 資源](https://developers.google.com/youtube/v3/docs/videos) |
| PM2 終止 | 停止或重啟時先送 SIGINT（可用 `PM2_KILL_SIGNAL` 改），1.6 秒內沒結束就送 SIGKILL 強制結束；處理 SIGINT 後 `pm2 reload` 才是優雅重載 | [PM2 文件](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/) |
| 播放器錯誤 | IFrame 播放器 `onError`：`100` 找不到（通常是被刪除或改成私人）、`101`／`150` 擁有者不允許嵌入、`5` HTML5 播放錯誤、`153` 缺少 Referer | [IFrame API](https://developers.google.com/youtube/iframe_api_reference) |

**實際案例（宣稱）**：頻道上限常比 100 低很多。有人配額提高到 220,000 單位，仍在第 11～12 支被拒（[Stack Overflow 78734881](https://stackoverflow.com/questions/78734881)）；有人批次 81 支只成功 10 支（[78250445](https://stackoverflow.com/questions/78250445)）。2026-05 有人收到 `429 rateLimitExceeded`，訊息是 `Quota exceeded for quota metric 'Video Uploads' and limit 'Video Uploads per day'`，約第 7 支失敗；截至 2026-10-22 Google 未回覆（[google-api-python-client #2753](https://github.com/googleapis/google-api-python-client/issues/2753)）。

## 2. 開源專案比較

Stars 與更新日為 2026-10-26 查詢；commit 為研究時的 HEAD。

| 專案（commit） | Stars | 技術 | 最後更新 | 上傳方式 | 額度處理 | 防重複 | 測試 |
|---|---|---|---|---|---|---|---|
| [darkzOGx/youtube-automation-agent](https://github.com/darkzOGx/youtube-automation-agent)（`24f9cb5`） | 4,635 | Node.js、SQLite、googleapis | 2026-10-20 | googleapis 單次請求 | 無，4xx 一律 `failed` | 結果不明就停住等人核對；領取無條件寫入 | 有，結果不明案例 |
| [googleapis/google-api-nodejs-client](https://github.com/googleapis/google-api-nodejs-client)（`206bd03`） | 12,275 | TypeScript | 2026-10-22 | `videos.insert` 用 `multipart` | 無 | gaxios 預設不重試 POST | 未查 |
| [codewest17-lab/Ai-YouTube-Automator](https://github.com/codewest17-lab/Ai-YouTube-Automator)（`6c1be77`） | 0 | Supabase Edge、PostgreSQL、pg_cron | 2026-09-20 | 自寫 fetch：建立工作階段＋單次 PUT | 有：三類分類、`quota_exceeded`、每天全部重排 | 無鎖、無條件寫入 | 無測試檔 |
| [porjo/youtubeuploader](https://github.com/porjo/youtubeuploader)（`9cf85ca`） | 889 | Go CLI、google-api-go-client v0.238.0 | 2026-08-07 | Go 用戶端分段續傳 | 無 | 單次 CLI，同行程內分段重試 | 只有頻寬限速 |
| [dreammis/social-auto-upload](https://github.com/dreammis/social-auto-upload)（`3847fff`） | 15,797 | Python、patchright 瀏覽器自動化 | 2026-10-22 | 操作 YouTube Studio 網頁 | 無 | — | 無 YouTube 測試 |

### 2.1 額度錯誤分類（開源，無測試）

Ai-YouTube-Automator 解析 `error.errors[0].reason` 與 `error.message` 分三類：`400 uploadLimitExceeded` → 頻道上限；`429` 且訊息含 `video uploads` → 上傳配額；`403 quotaExceeded`／`dailyLimitExceeded` → 一般配額（[youtube.ts L65-L103](https://github.com/codewest17-lab/Ai-YouTube-Automator/blob/6c1be77c06dc94a8187a64a191a5df1868f4028a/supabase/functions/_shared/youtube.ts#L65-L103)）。額度錯誤寫成 `quota_exceeded`，保留原檔（[process-video L137-L160](https://github.com/codewest17-lab/Ai-YouTube-Automator/blob/6c1be77c06dc94a8187a64a191a5df1868f4028a/supabase/functions/process-video/index.ts#L137-L160)）。

- 採用：分類方式，對應 #35。
- 不採用：每天 08:15 UTC 把所有等待項目**同時**重新觸發（[schema.sql L253-L281](https://github.com/codewest17-lab/Ai-YouTube-Automator/blob/6c1be77c06dc94a8187a64a191a5df1868f4028a/supabase/schema.sql#L253-L281)），額度仍不足時全部再失敗；FocusFlow 改用閘門與先試一支（#44、#46）。PUT 失敗不分辨結果不明（[youtube.ts L209-L220](https://github.com/codewest17-lab/Ai-YouTube-Automator/blob/6c1be77c06dc94a8187a64a191a5df1868f4028a/supabase/functions/_shared/youtube.ts#L209-L220)），可能重複上傳。

### 2.2 結果不明就停住（開源＋測試）

youtube-automation-agent 在呼叫 `videos.insert` 前設 `uploadAttempted = true`；沒有 HTTP 狀態或 5xx 視為結果不明，改成 `reconciliation_required` 並拒絕再傳；已有 YouTube ID 時先用 `videos.list` 核對（[publishing-scheduling-agent.js L144-L176](https://github.com/darkzOGx/youtube-automation-agent/blob/24f9cb521fcbebec70b7a193e0f6d972aeec88a6/agents/publishing-scheduling-agent.js#L144-L176)、[L228-L231](https://github.com/darkzOGx/youtube-automation-agent/blob/24f9cb521fcbebec70b7a193e0f6d972aeec88a6/agents/publishing-scheduling-agent.js#L228-L231)、[L273-L298](https://github.com/darkzOGx/youtube-automation-agent/blob/24f9cb521fcbebec70b7a193e0f6d972aeec88a6/agents/publishing-scheduling-agent.js#L273-L298)）。測試模擬 `ECONNRESET`，驗證第二次呼叫不會再上傳（[test.js L2547-L2575](https://github.com/darkzOGx/youtube-automation-agent/blob/24f9cb521fcbebec70b7a193e0f6d972aeec88a6/test.js#L2547-L2575)）。

- 與 FocusFlow 的隔離（#3）同一概念，證明方向正確；FocusFlow 另有原子領取，它沒有：領取是無條件 `UPDATE ... WHERE id = ?`（[db.js L1792-L1798](https://github.com/darkzOGx/youtube-automation-agent/blob/24f9cb521fcbebec70b7a193e0f6d972aeec88a6/database/db.js#L1792-L1798)）。

### 2.3 官方 Node 用戶端（開源）

- `googleapis` 產生的 `videos.insert` 帶 `media` 時用 `uploadType=multipart`，沒有續傳介面（[apirequest.ts L260-L322](https://github.com/googleapis/google-cloud-node-core/blob/76ba85a7f55c6e82943008b4eceb07a0f58b39e1/packages/nodejs-googleapis-common/src/apirequest.ts#L260-L322)；舊倉庫 nodejs-googleapis-common 已封存，內容移到 google-cloud-node-core）。
- 精確說法：**googleapis 的 `videos.insert` 沒有內建續傳**；要續傳仍可用同一套 OAuth 的 `auth.request()` 或 gaxios 自己送建立工作階段與 PUT，等於自己實作協定。FocusFlow 已用 fetch 實作建立工作階段與 PUT，換 SDK 不會少寫續傳邏輯（#50）。
- gaxios 預設只重試 GET／HEAD／PUT／OPTIONS／DELETE，不重試 POST；重試狀態碼為 1xx、408、429、5xx（[retry.ts L23-L65](https://github.com/googleapis/google-cloud-node-core/blob/76ba85a7f55c6e82943008b4eceb07a0f58b39e1/packages/gaxios/src/retry.ts#L23-L65)）。官方範例只有單次 `videos.insert`，無額度處理（[upload.js L42-L70](https://github.com/googleapis/google-api-nodejs-client/blob/206bd0334f32aee0fefe02595f88641a5899c2d1/samples/youtube/upload.js#L42-L70)）。

### 2.4 續傳協定細節（開源）

Google 官方 Go 用戶端（youtubeuploader 的依賴）查詢狀態用 `Content-Range: bytes */大小`，並送 `X-GUploader-No-308: yes`，讓伺服器改回 `200` 加 `X-Http-Status-Code-Override: 308`，避免 HTTP 函式庫把 `308` 當重新導向（[resumable.go L67-L112](https://github.com/googleapis/google-api-go-client/blob/971a6f11306117ea413163c374ae648741b34bac/internal/gensupport/resumable.go#L67-L112)）。分段重試只在同一行程內，不保存上傳網址（[L169-L240](https://github.com/googleapis/google-api-go-client/blob/971a6f11306117ea413163c374ae648741b34bac/internal/gensupport/resumable.go#L169-L240)）。這個標頭不在 REST 文件中，FocusFlow 不把它當必要條件（#49）。

### 2.5 不適用的做法

social-auto-upload 用 patchright（反偵測的 Playwright 分支）操作 YouTube Studio，理由是「未稽核 API 專案上傳會被鎖成私人」（[main.py L1-L13](https://github.com/dreammis/social-auto-upload/blob/3847fff01f5434a8a32829833163cd6723cabc59/uploader/youtube_uploader/main.py#L1-L13)，宣稱）。不採用：有違反服務條款的風險、要保存登入狀態，頻道上限對網頁一樣適用。這個理由與目前官方文件「不限於私人」相反；Ai-YouTube-Automator 的註解也採舊說法（[youtube.ts L224-L228](https://github.com/codewest17-lab/Ai-YouTube-Automator/blob/6c1be77c06dc94a8187a64a191a5df1868f4028a/supabase/functions/_shared/youtube.ts#L224-L228)）。實際行為見 §5 待驗證。

## 3. 本機實測：Node fetch 碰到 308（測試）

2026-10-26 以 Node.js v22.23.4 內建 fetch 對本機測試伺服器送 `PUT`，比較 `redirect` 兩種設定：

| 伺服器回應 | `redirect: 'follow'`（預設） | `redirect: 'manual'` |
|---|---|---|
| `308`＋`Range`，無 `Location` | `308`，讀得到 `Range` | 同左 |
| `308`，無 `Range`、無 `Location` | `308` | 同左 |
| `200`＋`X-Http-Status-Code-Override: 308` | `200`，讀得到 override 與 `Range` | 同左 |
| `308`＋`Location` | **跟著跳到另一個網址，拿到 `200`** | `308`，讀得到 `Range` |

結論：只要回應帶了 `Location`，預設設定就會把「上傳未完成」誤讀成「成功」。查詢狀態時一律設 `redirect: 'manual'`；同時相容 `200`＋override 的形式；`200`／`201` 必須回應內容有影片 `id` 才算完成（#49）。

## 4. FocusFlow 現況

### 4.1 額度錯誤目前的行為

- 建立上傳工作階段失敗一律標成可安全重試，不看原因（[youtubeUpload.service.js L298-L301](../../../backend/src/services/youtubeUpload.service.js#L298)）；送出內容後失敗標成不可重試（L321-L337）。
- 退避 60 秒、120 秒，恢復排程每 5 分鐘一輪：約 10～15 分鐘用完 3 次，進入 #34「已達重試上限」，每支各通知管理員一次。
- 短片共用 `uploadLocalVideo`；建立成品時背景上傳，教師在腳本頁按重試是同步執行，失敗直接收到 `502`。
- 影片上傳前問答不受影響；清理只處理已上傳完成的影片（#4）。**播放原片在正式站其實不可行**：nginx 沒有轉送 `/uploads`，`/uploads/*` 回前端首頁（[cookie 上線紀錄](../../10_Operations/deployment/2026-10-25_httpOnly_cookie認證上線紀錄.md)，2026-10-25 實測）；本機開發時 Vite 會轉送，所以看得到。先前討論裡「學生照常看原片」的說法只在本機成立；#61、#62 改為經權限檢查的受保護播放，見[原片暫存播放研究](local-playback-research.md)。
- 用量：Atlas `focusflow` 20 支影片，單日最多新增 8 支（2026-05-12，2026-10-24 查詢）；短片同步每 10 分鐘 1 次 `videos.list`（約 144 單位／天）。

### 4.2 會開始新上傳的入口

上傳閘門（#44）要涵蓋全部：

| 入口 | 位置 | 觸發 |
|---|---|---|
| 處理完成自動上傳 | [videoProcessing.service.js L85](../../../backend/src/services/videoProcessing.service.js#L85) → `scheduleYouTubeAutoUpload`（[L921](../../../backend/src/services/youtubeUpload.service.js#L921)） | 背景，不等結果 |
| 教師重試影片 | [video.controller.js L107](../../../backend/src/controllers/video.controller.js#L107) → `scheduleYouTubeUploadRetry` | 背景 |
| 恢復排程（影片） | `recoverPendingYouTubeUploads`（[L681](../../../backend/src/services/youtubeUpload.service.js#L681)），開機一次後每 5 分鐘 | 依序 |
| 管理員立即恢復 | [youtubeAdmin.service.js L116](../../../backend/src/services/youtubeAdmin.service.js#L116) | 同恢復排程，有同輪鎖 |
| 管理員重設 | [youtubeQuarantine.service.js L472](../../../backend/src/services/youtubeQuarantine.service.js#L472) 只把 `nextRetryAt` 設為現在，由下一輪恢復處理 | 間接 |
| 短片建立／換代 | `scheduleUploadOnCreate`（[shortAssetPublish.service.js L343](../../../backend/src/services/shortAssetPublish.service.js#L343)） | 背景 |
| 教師重試短片 | [shortScript.controller.js L107](../../../backend/src/controllers/shortScript.controller.js#L107) → `retryShortAssetUpload`（[L412](../../../backend/src/services/shortAssetPublish.service.js#L412)） | **同步** |
| 恢復排程（短片） | [shortAssetRecovery.service.js L109](../../../backend/src/services/shortAssetRecovery.service.js#L109) | 依序 |
| 相容入口 | `uploadVideoFileToYouTube`（[L346](../../../backend/src/services/youtubeUpload.service.js#L346)）：只有測試呼叫，不寫資料庫 | — |

### 4.3 部署與行程

- 正式站只有一個 pm2 行程 `focusflow-backend`，沒有 ecosystem 設定檔；部署用 `pm2 restart`（[deploy.yml L78](../../../.github/workflows/deploy.yml#L78)），先停後啟，新舊行程不重疊。
- 關機流程只停排程與 HTTP，不等背景上傳（[server.js L64-L76](../../../backend/src/server.js#L64)）；`server.close` 要等連線結束，通常超過 PM2 的 1.6 秒就被 SIGKILL（官方＋推論）。部署時正在傳的影片會中斷，留在「上傳中」，現行程式 15 分鐘後隔離（#3）；#57 改為依進度階段處理，只有 `sending` 階段需要人工。
- 本機開發也連 Atlas；若有人在本機設定 YouTube 憑證並開啟上傳或恢復，就會出現第二個行程處理同一批資料。目前環境變數預設關閉，所以這是可能、但不常見的情況。

### 4.4 現有機制與缺口

| 機制 | 現況 | 缺口與對應 |
|---|---|---|
| 影片原子領取 | 有：`findOneAndUpdate` 帶狀態條件（[L466-L486](../../../backend/src/services/youtubeUpload.service.js#L466)） | — |
| 短片原子領取 | `dev` **沒有**：先讀（[L161](../../../backend/src/services/shortAssetPublish.service.js#L161)）再無條件寫入（[L197](../../../backend/src/services/shortAssetPublish.service.js#L197)）。審查修正分支 `fix/youtube-lifecycle-review` 的 `455c1eb`（[F2](work-orders/F-review-fixes.md)，尚未合併）已改為 `uploadClaimQuery` 原子領取，並在影片與短片都加上 `youtubeUpload.attemptId`、以 `attemptOwnerQuery` 擋過期回寫；行程內另有 `tryAcquireWork` 鎖，註明只適用單一後端行程 | #53：沿用 F2，Q-A 以它為基礎 |
| 全站閘門 | 沒有 | #44、#52 |
| 上傳網址保存 | 只在記憶體 | #41 |
| 通知去重 | 有：`dedupeKey` 含失敗時間 | 暫停與系統警示需以暫停開始時間為 key（#43、#46） |
| 等待狀態 | 沒有；恢復排程只撈失敗可重試與卡住的 | #51 |
| 實際隱私狀態 | 沒有：回傳的是送出的值（[L339-L343](../../../backend/src/services/youtubeUpload.service.js#L339)），短片把它存成 `youtubePrivacyStatus`（[L232](../../../backend/src/services/shortAssetPublish.service.js#L232)）；影片沒有欄位。現有測試的假回應是 `private`，程式仍存 `unlisted`，測試沒有抓到（[short-asset.routes.test.js L86](../../../backend/tests/short-asset.routes.test.js#L86)） | #56 |

### 4.5 隱私與播放權限

- 教學影片的隱私由環境變數決定，預設 `unlisted`，但可以設成 `public` 或 `private`（[env.js L285-L290](../../../backend/src/config/env.js#L285)）；短片寫死 `unlisted`（[shortAssetPublish.service.js](../../../backend/src/services/shortAssetPublish.service.js) `SHORT_ASSET_PRIVACY_STATUS`）。#56 改為教學影片也寫死。
- 既有的轉私人：刪除課程或影片時（`privatizeVideosOnDelete`，[course.service.js L184](../../../backend/src/services/course.service.js#L184)）、短片被退回時（`privatizeRejectedShortAsset`）；失敗都只寫 log。
- 學生播放器只處理 `onReady`，沒有處理 `onError`（[StudentCourses.jsx L152-L160](../../../frontend/focus-flow/src/pages/StudentCourses.jsx#L152)），播放失敗系統不會知道。
- `/uploads` 由 Express 以 `express.static` 公開提供、不需登入（[app.js L45](../../../backend/src/app.js#L45)）；目前因 nginx 沒轉送而在正式站無法存取。#62 改為受保護端點並移除這個公開路徑。

**不公開的限制（官方＋既有文件）**：`unlisted` 只代表不出現在搜尋與頻道頁，**知道連結的人都能觀看**，課程權限擋不住轉貼（[後端注意事項](../../../backend/docs/handoff-known-issues.md)）。FocusFlow 只在選課檢查後回傳影片編號，降低外流機會，但不是存取控制。教師若要求教材只能由授權學生觀看，就不應上傳 YouTube，要另外評估由 FocusFlow 受權限保護的伺服器播放；#62 的受保護播放只是上 YouTube 前的過渡（伺服器可用約 30 GB），不能當成永久方案；永久的校內播放要另外評估儲存與頻寬。

### 4.6 為什麼本輪不做自動續傳（推論）

`attemptId`（F2）讓過期的工作寫不進資料庫，但擋不住它已經送出的 HTTP PUT。能讓舊 PUT 停止的只有：同一行程內中止請求，或擁有者行程已死、作業系統關閉連線。第三輪曾草擬「行程存活紀錄＋心跳＋間隔 30 秒查兩次 `Range` 相同」，但這些都是間接證據，無法嚴格證明舊 PUT 已終止（例如行程卡住但連線未斷）。因此 #57 改回保守方案：

- `claimed`、`session_saved`：有嚴格保證。送內容前必須先以條件寫入成功記下 `sending`，而接手也是對同一份文件的條件寫入，兩者只會有一個成功；接手成功，舊工作就寫不進 `sending`、不可能送內容。所以可以安全改為重試。
- `sending`：沿用 #41，只在查到 `201` 時自動收尾，其他一律隔離交給管理員。

同一工作階段的自動續傳列為後續擴充，前提是先有能證明舊 PUT 已終止的排他機制。部署用 `pm2 restart`（先停後啟），正常情況下中斷的上傳都會進入隔離，由管理員依 #48 顯示的資訊重設；以「部署前確認上傳中為 0」降低次數。

## 5. 實作注意事項與待驗證

**技術建議**（已反映在決策或第三輪題目）：

1. 維持自寫 fetch，不換 SDK（#50）。
2. 上傳狀態查詢：`redirect: 'manual'`；`308` 或 `200`＋`X-Http-Status-Code-Override: 308` 都視為未完成；`200`／`201` 且有影片 `id` 才算完成；其他一律隔離（#41、#49）。測試替身要涵蓋 §3 的四種回應。
3. 上傳閘門以 MongoDB 租約為主，持有者以 `ownerToken` 比對、單支工作以 `attemptId` 防護、資料庫無法確認就不放行（#52）。租約時間用 `$$NOW` 需要管線式更新；目前 Mongoose 8.23.0、MongoDB driver 7.1.1，實作時以測試確認 `findOneAndUpdate` 接受管線（推論）。
4. 錯誤訊息比對 `Video Uploads per day` 依賴 Google 的文字；改字時落入「無法辨識」，退回現有 3 次重試，不會造成重複影片（#35）。
5. 「上傳完成」與「可播放」分開：切換播放、清理與短片上架都要等 `uploadStatus: processed` 且隱私與嵌入允許（#58）。
6. 隱私分兩層：技術上可播放與符合政策分開判斷；教學影片與短片各有政策，只接受規定的值；讀回 `public` 立即轉私人並通知（#58～#60）。
7. 進度階段先保存 `sending` 才送內容；孤兒上傳只追加紀錄、不覆蓋狀態（#52、#57）。

**待驗證**（實作或第一次正式上傳時確認；暫存播放的項目見[原片暫存播放研究](local-playback-research.md#5-待驗證)）：

| 項目 | 類型 | 驗證方式 |
|---|---|---|
| `videos.insert` 回應的 `status.privacyStatus` 是否反映 YouTube 強制調整後的值 | 推論 | 第一次正式上傳時，比對 insert 回應與 `videos.list(part=status)` |
| 正式頻道是否有長片資格（影響 15 分鐘限制） | 未驗證 | 2026-10-26 唯讀查證：頻道公開頁 `@FocusFlow-ai413/videos` 看不到任何影片（系統上傳的是不公開影片），無法判斷；資料庫 MCP 本次連不上，無法用影片 ID 查。資料庫有 6 支超過 15 分鐘的影片已有 YouTube ID，但不確定是不是上傳到本頻道（教師也可能貼他人頻道的網址）。確認方式：頻道擁有者在 YouTube Studio「設定 → 頻道 → 功能資格」查看；或用那 6 支的 ID 呼叫公開的 oEmbed，看作者是不是本頻道。未確認前，超過 15 分鐘的影片可能被拒（`rejectionReason: length`），#58 會擋下切換與清理 |
| 上傳網址的有效期限 | 官方未公開 | 不依賴；過期回 `404` 即隔離 |
| 頻道實際每日上限 | 官方未公開 | 由管理員頁的「上次在第 N 支時暫停」累積（#38） |
| 正式 VM 的 pm2 是否為單一 fork 行程 | 推論 | 依據：沒有 ecosystem 設定檔、部署用 `pm2 restart focusflow-backend`；[VM 資安檢查報告](../../10_Operations/deployment/2026-10-23_VM資安檢查報告.md)只記錄 `pm2 list` 為 online、重啟 0 次，沒有 `exec_mode`。本次沒有 VM 權限，未查。確認方式：在 VM 執行 `pm2 jlist`，看 `pm2_env.exec_mode` 與 `instances`。若是 cluster 多行程，#52 的資料庫租約仍成立，但 #11「每次直接讀資料庫」與記憶體中的 `runningUploadIds` 判斷要重新檢查 |
| VM 的 PM2 `kill_timeout` 是否另有設定 | 未驗證 | 在 VM 執行 `pm2 jlist`，看 `pm2_env.kill_timeout`；沒設定就是 1.6 秒 |
| 學生播放器能否實際播放系統上傳的影片 | 未驗證 | #58 的正式驗收：學生帳號在正式站播放一支，沒有錯誤碼 100／101／150；可和 HANDOFF 第 8 步的上傳驗收一起做 |
| YouTube 處理一支影片要多久 | 官方未保證 | 依 #58 輪詢；24 小時是 FocusFlow 的人工介入門檻，不是 YouTube 的服務承諾 |

**未解風險**：

- 舊工作在 `attemptId` 改變後仍可能把一支影片傳完（只會發生在 `sending` 階段被隔離後、管理員重設時舊行程其實仍在傳）；系統會記錄成 `orphanUploads` 並通知，但 YouTube 上會有一支多的影片，需管理員到 YouTube Studio 刪除（#52）。
- 部署時正在傳的影片多半會進入隔離，需要管理員重設；以「部署前確認上傳中為 0」降低機率（#57）。
- 正式站學生在 YouTube 可播放之前看不到影片（#61）。原片播放要等 `/uploads` 加上權限檢查才能開放；在那之前不得在 nginx 開放 `/uploads`，否則原片會變成知道網址就能下載。
- 學生播放器沒有回報播放錯誤，正式環境的嵌入失敗只能靠驗收或使用者回報發現。
