# Q-0 共用資料契約

Q-A（上傳可靠性）、Q-B（就緒判定與隱私）、Q-C（受保護播放與儲存保護）共用影片與短片的上傳狀態；Q-A 與 Q-C 可平行，Q-B 等 Q-A，實際開始仍依工單前提及使用者授權。這份文件定下欄位、狀態轉換、向後相容規則與修改責任，**2026-10-26 經使用者核可為正式契約**（核可條件見 §8）；實作中需要新增或改名欄位，先改本文件並經使用者核可。決策與理由見 [decisions.md](decisions.md)（#35～#64），工作切分見 [工作說明](work-orders/Q-quota-playback-plan.md)。

建立日期：2026-10-26；介面核對：2026-10-27。既有欄位與函式以 `dev` @ `5f60c12`（已合併 F0～F2，修復提交 `b76046e`）為準；實作範圍與驗證結果見[目前狀態](../../current-status.md)。

**標示**：**既有**＝`dev` 已有；**F2**＝F0～F2 修復加入，現已合併至 `dev`；**新增**＝本契約新增（已核可，實作後才有）。

## 1. 原則

1. 只新增欄位，不改名、不刪除、不改既有值的意思；新欄位都有預設值，舊資料不做批次遷移。
2. 每個欄位只有一個寫入的塊；其他塊只讀，需要改時呼叫寫入塊匯出的函式。
3. `youtubeUpload` 的進度寫入一律帶 F2 的 `attemptOwnerQuery`（`status: uploading` 且 `attemptId` 相符），不符就放棄。
4. 上傳網址（`session.url`）不得出現在任何 API 回應、通知或 log。
5. 頻繁更新的狀態（閘門、容量預約）不寫進 `RuntimeSetting.history`，`history` 只留給管理員操作。
6. **媒體傳送邊界**：以 `phase: sending` 的條件寫入成功為界（#57）。只有拿到這次寫入成功結果的工作才可以送影片資料；邊界之前的工作可重新排程，已跨越或結果不明的一律隔離，不建立新的工作階段。
7. 問答、FAQ 快取、LINE 回應與 `bridgeScope` 比對使用的 `sourceUrl`／`videoUrl` 原值不變；只有影片 API 回給前端的播放欄位經 `resolvePlaybackSource` 轉換（#62）。

## 2. 影片 `Video`

### 2.1 `youtubeUpload` 子文件

| 欄位 | 值 | 預設 | 標示 | 寫入 | 讀取 | 決策 |
|---|---|---|---|---|---|---|
| `status` | `uploading`、`uploaded`、`failed`，**新增 `waiting`** | 整個子文件 `null` | 既有＋新增 | Q-A | 全部 | #51 |
| `error`、`uploadedAt`、`attemptCount`、`lastAttemptAt`、`failedAt`、`retrySafe`、`nextRetryAt` | 同現行 | 同現行 | 既有 | Q-A | 全部 | #2、#34 |
| `localCleanupAt`、`localCleanupError`、`localSourceRestoredAt` | 同現行 | `null` | 既有 | 清理、補回原片 | Q-B、Q-C | #22～#24 |
| `attemptId` | 字串 | `null` | F2 | Q-A（沿用 F2） | Q-A、Q-D | #52、#53 |
| `localSourceVersion` | 字串 | `null` | F2 | 來源操作、補回原片、清理（F2） | 來源與清理條件寫入 | F2 |
| `heartbeatAt` | Mongo 伺服器時間 | `null` | F2 | 上傳 claim 與同一 attempt 的續寫 | 恢復隔離 | FR04 |
| `cleanupIntent` | `{ id, phase, storageKey, file }`；此處 phase 為清理的 `claimed`／`deleting`／`repairable`／`recovering` | `null` | F2 | 清理佔用、接管與收尾 | 來源／狀態寫入的排他條件 | FR02、FR05 |
| `cleanupClaimedAt` | Mongo 伺服器時間 | `null` | F2 | 清理 claim／接管 | 過期恢復 | FR02、FR05 |
| `waitReason` | `api_quota`、`channel_limit`、`gate_busy` | `null` | 新增 | Q-A | Q-D、Q-E | #51 |
| `queuedAt` | 日期，首次排入上傳的時間 | `null`（舊資料排序在最前） | 新增 | Q-A | Q-A | #45 |
| `phase` | `claimed`、`session_saved`、`sending` | `null` | 新增 | Q-A | Q-A、Q-D | #57 |
| `session` | `{ url, fileSize, createdAt }`，`url` 在 schema 設 `select: false` | `null` | 新增 | Q-A | Q-A | #41 |
| `orphanUploads` | `[{ youtubeVideoId, attemptId, detectedAt }]`，只追加 | `[]` | 新增 | Q-A | Q-D | #52 |
| `privacyStatus` | YouTube 讀回的值或 `null` | `null` | 新增 | Q-B | Q-B、Q-D、Q-E | #56 |
| `remoteState` | `processing`、`ready`、`blocked` | `null` | 新增 | Q-B | Q-C、Q-D、Q-E、清理 | #58 |
| `blockedReason` | 例如 `rejected:length`、`privacy_not_unlisted`、`processing_timeout` | `null` | 新增 | Q-B | Q-D、Q-E | #58 |
| `readyAt` | 日期，通過就緒判定的時間 | `null` | 新增 | Q-B | 清理 | #58、#61 |
| `lastCheckAt`、`lastCheckError` | 最近一次查 YouTube 的時間與錯誤 | `null` | 新增 | Q-B | Q-D | #58 |
| `privacyIncidents` | `[{ detectedAt, observed, action, result, actor }]`，只追加 | `[]` | 新增 | Q-B | Q-D | #60 |

**與 F2 實作的對應**（`dev` @ `5f60c12`，2026-10-27 核對）：

核對來源：[所有權與 claim 函式](../../../backend/src/services/youtubeWorkOwnership.service.js)、[Video schema](../../../backend/src/models/video.model.js)、[ShortAsset schema](../../../backend/src/models/shortAsset.model.js)、[清理接管](../../../backend/src/services/localSourceCleanup.service.js)、[開關設定](../../../backend/src/services/youtubeLifecycleSettings.service.js)、[刪課待辦](../../../backend/src/services/courseDeletionJobs.service.js)。

- F2 在影片與短片的 `youtubeUpload` 加了 `attemptId`、`localSourceVersion`、`heartbeatAt`、`cleanupIntent`、`cleanupClaimedAt`（預設 `null`），本契約沿用，不改名。Video 的整份 youtubeUpload 可為 null，ShortAsset 預設為子文件；舊資料的缺欄位與明確 null 依 `observedField`／`observedFields` 比對，不能任意互換。
- F2 的 `uploadClaimQuery` 只接受兩種來源狀態：初次（`status: null`）與重試（`failed`＋`retrySafe: true`＋未達上限＋已到時間），並比對觀察到的 `filePath`、`status`、`retrySafe`、`attemptCount`、`lastAttemptAt`、`attemptId`、`nextRetryAt`、`generationVersion`。**Q-A 要新增第三種來源：`waiting` 且 `nextRetryAt` 已到**，並把 `waitReason`、`phase` 加入觀察欄位；不另寫領取函式。
- 正式 claim 使用 `uploadClaimUpdate(item, fields)`：子文件 null／缺省時回傳更新管線，以 `uploadStateUpdate` 建整份子文件並用 `$$NOW` 寫 heartbeat；已有子文件時回傳 `$set`＋`$currentDate`。Q-A 在傳入 fields 加上 `youtubeUpload.phase: claimed` 與 `youtubeUpload.queuedAt`，不能以舊版單獨 `$set: uploadStateUpdate(...)` 取代而遺失 heartbeat 或覆蓋清理資料。
- F2 的 `attemptOwnerQuery` 條件是 `status: uploading`＋`attemptId`＋觀察到的 `filePath`、`generationVersion`；Q-A 的每一步進度寫入都用它，另加 `phase` 條件。接手（§5.1）用「`attemptId` 等於觀察值且 `phase` 為 `claimed` 或 `session_saved`」的條件寫入。
- `tryAcquireWork(keys)` 只提供本行程快速拒絕；跨 Backend 的工作權來自既有 claim、attempt CAS、cleanup intent 與備份歸屬，不能只靠 Set。`youtube_upload_gate` 是 Q-A 將新增的全站建立 session 閘門，不能取代這些既有保護。
- `keepUploadAlive(model, owner)` 已存在：每 15 秒依相同 owner 續寫 heartbeat，失去 owner 或 DB 失敗會 abort；恢復的原子更新須沿用 `expiredUploadHeartbeat()`（Mongo 時間比對 120 秒或缺省），不能以「不在本行程」認定另一 Backend 已死亡。Q-A 的 15 分鐘階段恢復也須保留此守衛及來源／代數觀察條件；#57 不新增行程存活紀錄，不表示移除 F2 已有的 attempt heartbeat。
- `uploadClaimQuery` 已包含 `NO_CLEANUP_INTENT`。新增 waiting、phase 或來源／審核寫入不得解除此排他條件；清理接管需先換 owner 再查看檔案，不能從舊快照取消 intent。`cleanupIntent.phase` 與 Q-A 的 `youtubeUpload.phase` 是不同欄位。
- 成功保存或套用備份 ID 前，沿用 `reserveYouTubeBackup(youtubeVideoId, kind, item, { session? })` 的 `youtubebackups` 原子歸屬。Video 綁內容 ID，ShortAsset 另綁 generation；舊 attempt 的 orphan 紀錄不能覆寫正式歸屬或自行釋放預留。課程刪除使用 transaction 與 `coursedeletionjobs`，Q 的暫停／就緒流程不得繞過其 intent 與失敗恢復協定。

### 2.2 影片本身

| 欄位 | 說明 | 標示 | 寫入 | 讀取 |
|---|---|---|---|---|
| `videoSource`、`videoUrl`、`sourceUrl` | 播放來源；Q-B 合併後只在 `remoteState: ready` 時改成 YouTube | 既有 | 上傳成功（Q-A 前）→ Q-B 合併後改由就緒判定 | 影片 API、Q-C |
| `filePath`、`fileHash`、`youtubeVideoId`、`deletedAt`、`processing.status` | 同現行 | 既有 | 同現行 | 全部 |
| `localPlayback` | `{ compatible: true/false/null, container, videoCodec, audioCodec, moovFirst, probedAt }`；`null` 代表未檢查 | 新增 | Q-C | Q-C、Q-E |

## 3. 短片成品 `ShortAsset`

- `youtubeUpload` 的等待、進度與孤兒欄位與影片**同名同義**（`waitReason`、`queuedAt`、`phase`、`session`、`orphanUploads`），寫入者同為 Q-A。F2 的 attempt、來源版本、heartbeat 與清理 intent／時間欄位也同名沿用，不重建第二套。
- 隱私讀回寫入既有的頂層 `youtubePrivacyStatus`（Q-B），不另加 `youtubeUpload.privacyStatus`。
- `remoteState`、`blockedReason`、`readyAt`、`lastCheckAt`、`lastCheckError`、`privacyIncidents` 放在 `youtubeUpload` 下，寫入者 Q-B。
- 既有的 `youtubeAvailability` 與新增的 `remoteState` 並存，用途與寫入責任分開，互不覆寫：

| 欄位 | 用途 | 寫入 | 一致性規則 |
|---|---|---|---|
| `youtubeUpload.remoteState` | 上架與清理的判斷：要 `ready` 才上架到學生牆、才可清理（#58） | Q-B | 只依 #58 的條件變更；不讀 `youtubeAvailability` |
| `youtubeAvailability`（`pending`、`playable`、`unavailable`、`unknown`） | 既有短片同步排程的播放可用性，供顯示與同步 | 短片同步排程（既有） | 保留原意思；Q-B 不寫它。兩者不一致時（例如 `ready` 但 `unavailable`），管理員頁標示並以下一輪 #58 查詢結果為準，不自動互相修正 |

- 短片沒有本機播放，不使用 `localPlayback`。

## 4. `RuntimeSetting` 文件

沿用既有 model（一個 `key` 一份文件，`value` 為物件）。

| `key` | `value` | 標示 | 寫入 | 讀取 |
|---|---|---|---|---|
| `youtubeLifecycle.upload`、`youtubeLifecycle.recovery`、`youtubeLifecycle.cleanup` | 既有兩層開關；公開 switch key 仍為 `upload`、`recovery`、`cleanup` | 既有 | 管理員 | 全部 |
| `privacy_guard` | 兩層開關第四個 key，預設關閉 | 新增 | 管理員（Q-B 加入清單） | Q-B、Q-D |
| `youtube_upload_pause` | `{ apiQuota: { since, until } 或 null, channelLimit: { since, until } 或 null, consecutiveBlockedRounds, lastPauseSuccessCount, probe: { startedAt, by } 或 null, log: [最多 50 筆] }` | 新增 | Q-A（試傳由 Q-D 呼叫 Q-A 的函式） | Q-D、Q-E、`/health` |
| `youtube_upload_gate` | `{ ownerToken, leaseUntil }` | 新增 | Q-A | Q-A、`/health` |
| `upload_storage:<主機>:<UPLOAD_DIR 的 realpath>:<裝置編號>` | `{ version, reservations: [{ token, bytes, expiresAt }] }` | 新增 | Q-C | Q-C、Q-D |

第三輪先前草擬的 `backend_instances`（行程存活紀錄）因 #57 改回保守方案而**不新增**。

既有 `heartbeatAt` 是單筆上傳 attempt 的續寫，不是 `backend_instances`，必須保留。`privacy_guard` 為待實作的新開關識別；Q-B 擴充時須分清公開 switch key 與資料庫 settingKey，不得更名既有三個持久 key。

## 5. 狀態轉換

### 5.1 `youtubeUpload.status`（影片與短片相同）

| 從 | 條件 | 到 | 寫入 |
|---|---|---|---|
| 無（`null`） | 處理完成後領取（F2 `uploadClaimQuery`） | `uploading`（`phase: claimed`） | Q-A |
| `uploading` | 上傳成功 | `uploaded`（Q-B 合併後另寫 `remoteState: processing`） | Q-A、Q-B |
| `uploading` | 送出內容前碰到 #35 的①②，或閘門忙碌 | `waiting` | Q-A |
| `uploading` | 送出內容前的其他失敗 | `failed`，`retrySafe: true` | Q-A |
| `uploading` | 送出內容後失敗，或卡住後查詢結果不是 `201` | `failed`，`retrySafe: false`（隔離） | Q-A |
| `uploading` | 卡住後查詢結果為 `201`，且通過 #18 | `uploaded` | Q-A |
| `uploading` 且 `phase` 為 `claimed` 或 `session_saved`（尚未跨越媒體傳送邊界），超過 15 分鐘且不在本行程 | 以「`attemptId` 等於觀察值且 `phase` 未變」的條件寫入換新 `attemptId` | `failed`，`retrySafe: true`（舊工作的 `sending` 寫入必定失敗，不會送內容） | Q-A |
| `uploading` 且 `phase: sending`（已跨越邊界），或沒有 `phase` 的舊資料，超過 15 分鐘且不在本行程 | 依 #41 查詢一次 | `201` → `uploaded`；其他 → 隔離；不建立新的工作階段 | Q-A |
| `waiting` | `nextRetryAt` 已到且暫停已解除 | `uploading` | Q-A |
| `failed`（可重試、未達上限、已到時間） | 恢復排程或教師重試 | `uploading` | Q-A |
| `failed`（隔離或達上限） | 管理員「重設」或「確認套用」 | `failed`＋`retrySafe: true`、次數歸零；或 `uploaded` | 既有隔離收尾 |

### 5.2 `phase`（只在 `uploading` 內）

`claimed` → `session_saved`（上傳網址已保存）→ `sending`（寫入成功後才送內容）。每一步都以 `attemptOwnerQuery` 條件寫入；舊資料沒有 `phase` 時，沿用現行隔離規則及過期 heartbeat 守衛。§5.1 的「超過 15 分鐘且不在本行程」僅為候選條件，接手或隔離仍須在原子寫入核對 heartbeat，不能誤判另一 Backend 的活躍工作。

### 5.3 `remoteState`（Q-B）

| 從 | 條件 | 到 |
|---|---|---|
| `null` | 上傳成功 | `processing` |
| `processing` | `uploadStatus: processed`、可嵌入、隱私合格 | `ready`（寫 `readyAt`，切換播放來源） |
| `processing` | `failed`、`rejected`、`deleted`、隱私不合格、24 小時仍 `uploaded`（FocusFlow 自訂門檻） | `blocked` |
| `processing` | 查詢失敗 | 不變，只寫 `lastCheckError` |
| `ready` | 每日檢查不合格 | `blocked`；原片還在就切回原片 |
| `blocked` | 管理員處理後重新檢查合格 | `ready` |
| `null` 且已 `uploaded`（舊資料） | — | 播放維持 YouTube；清理前先查一次再寫入 |

### 5.4 播放來源（Q-C 的 `resolvePlaybackSource`）

| 情況 | 回傳 `type` |
|---|---|
| 影片已刪除或使用者無權限 | 不回傳（403／404） |
| `remoteState: ready`，或舊資料 `videoSource: youtube` 且 `remoteState: null` | `youtube` |
| 原片存在、`localPlayback.compatible` 不是 `false`、`LOCAL_PLAYBACK_ENABLED` 開啟 | `local`（播放端點） |
| 其他 | `unavailable`（顯示「影片準備中，可先提問」） |

Q-B 合併前，`ready` 的判斷以「`videoSource` 是否為 YouTube」代替。

### 5.5 容量預約與暫存檔（Q-C）

預約：建立 → 有收到資料時每 10 分鐘續約 → 上傳完成或失敗時釋放；2 小時未續約自動失效。檔案先寫到 `UPLOAD_DIR/.incoming/`，成功才搬到正式位置（同一個磁碟內改名）。排程只刪除同時符合以下條件的檔案：以 `realpath` 確認位於 `.incoming/` 內、超過 3 小時、不屬於任何有效預約、不在本行程進行中的上傳；任一項無法確認就不刪並記錄異常。正式位置的原片不在此範圍。

## 6. 向後相容

- **舊資料**：缺少的新欄位一律視為預設值；`status: uploading` 但沒有 `phase` 的舊資料沿用現行隔離規則；`queuedAt` 為 `null` 的舊資料排在最前面。
- **API 回應**：只新增欄位，不刪不改名。`videoUrl`、`sourceUrl` 欄位名稱不變；本機播放時值改成播放端點的相對網址（例如 `/api/v1/videos/<id>/source`），不再是 `/uploads/...`。現行學生頁遇到不是 `/uploads/` 開頭的網址會直接使用，所以舊前端配新後端仍能播放。
- **退回舊版**：舊程式會忽略新欄位與新的 `RuntimeSetting` key，但舊程式不認得 `waiting`，這些影片不會被撈到。退回程序（Q-A 提供工具、Q-F 寫進上線紀錄，執行前需使用者授權，因為會寫入正式資料庫）：
  1. 部署舊版**之前**，以 `npm run youtube:release-waiting` 預覽（預設只列出，不寫入）所有 `waiting` 的影片與短片數量。
  2. 經授權後加 `-- --write` 執行：把 `waiting` 改為 `failed`、`retrySafe: true`、`nextRetryAt` 設為現在、清空 `waitReason`，不改 `attemptCount`；工具輸出改了幾筆。
  3. 驗證：再跑一次預覽，`waiting` 為 0；管理員頁不再顯示等待中。
  4. 部署舊版。舊版的恢復排程會依原規則重試；若額度仍未恢復，會照舊進入「已達重試上限」（#34），由管理員之後重設。
  `phase`、`session` 等新增欄位舊版會忽略；本退回方案以已含 F0～F2 的版本為最低基準，保留 heartbeat、cleanup intent 與持久備份協定，不支援與更舊且不遵守協定的 binary 混跑。`status: uploading` 仍須先確認 heartbeat 過期才隔離。
- **短片**：新增欄位不影響短片牆查詢（仍以 `status: published` 與 `publishedAt` 為準）。

## 7. 修改責任

| 塊 | 只能寫入 | 只讀 | 不得修改 |
|---|---|---|---|
| Q-A | `youtubeUpload` 的 `status`、等待、進度、`session`、`orphanUploads`；`youtube_upload_pause`、`youtube_upload_gate` | 開關、`remoteState` | 就緒與隱私欄位、`localPlayback`、播放來源規則、容量預約 |
| Q-B | 就緒與隱私欄位、短片 `youtubePrivacyStatus`、播放來源切換、清理條件、`privacy_guard` 開關清單 | 上傳狀態、`localPlayback` | 上傳進度與暫停、容量預約 |
| Q-C | `localPlayback`、播放端點、`resolvePlaybackSource`、容量預約、`.incoming/` 清理 | 上傳狀態、`remoteState` | 上傳流程、就緒判定 |
| Q-D | 不寫模型欄位；只呼叫 Q-A、Q-B、Q-C 匯出的函式 | 全部 | 模型與判斷規則 |
| Q-E | 不寫資料 | API 回應 | 後端 |

`resolvePlaybackSource` 的規則表（§5.4）由 Q-C 實作，Q-B 合併時只改「`ready` 的判斷來源」那一列。

## 8. 核可紀錄（2026-10-26）

使用者核可以下五項，並附條件：

1. **欄位名稱**：核可；F 合併前再核對一次 F2 的 schema、`attemptId`、`uploadClaimQuery`、`attemptOwnerQuery` 與 §2.1 的對應說明一致，不一致先改本文件。
2. **短片狀態並存**：核可；用途、寫入責任與一致性規則見 §3 的表格。
3. **`.incoming/` 自動清理**：核可；只刪除 §5.5 列出的條件全部成立的過期半成品，無法確認就不刪並記錄異常。本項不包含正式位置的原片，也不代表已授權正式部署。
4. **`LOCAL_PLAYBACK_ENABLED`**：核可預設關閉；nginx、授權播放與學生播放器驗收通過後才開啟。
5. **退回方案**：核可；依 §6 的四步程序執行，工具由 Q-A 提供。

### privacy_guard 的內部儲存表示

第四個新開關使用 `key: privacy_guard`，`value` 為 `{ enabled, guard }`；`enabled` 預設 false，讀取相容初版 boolean。`guard` 保存自動隱私操作的 ownerToken、leaseUntil、最近一小時 updates 與 quotaUntil，用同一文件 value CAS 原子保存。管理員切換只修改 enabled 並保留 guard；頻繁的協調更新不寫 history。既有三個開關的 boolean value 與持久 key 不變；這是 #60 租約、限流與暫停的內部表示，不新增產品狀態。
