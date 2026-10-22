# 工作說明：YouTube 生命週期 B 塊（管理員 API、隔離收尾與通知）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/yt-b-admin`，從 `feat/youtube-lifecycle` 切出（已含 A 核心與 C 補回原片）。先讀 repo 根目錄的 `AGENTS.md` 並遵守。

## 先讀

1. `docs/04_Features/YouTube_Lifecycle/decisions.md`：全部 33 條決策，特別是 #13、#15、#17～#20、#27、#28、#29，以及「實作切分」的介面草案與「核心服務介面」（A 塊寫的，你要呼叫這些函式，不要重寫它們）。
2. `backend/src/services/youtubeUpload.service.js`、`shortAssetPublish.service.js`、`notification.service.js`、`systemStatus.service.js`、`routes/admin.routes.js`、`controllers/admin.controller.js`、`constants/enums.js`。
3. `.claude/rules/api-design.md`、`.claude/rules/security.md`、`.claude/rules/testing.md`。

## 要做

1. **管理員 API**（全部 admin 限定，走 routes → controllers → services，回應用 `sendSuccess`）：
   - `GET /admin/youtube-lifecycle/settings`、`PATCH /admin/youtube-lifecycle/settings`（body `{ key, enabled }`；環境不允許時回 409 並新增錯誤碼）
   - `GET /admin/youtube-lifecycle/cleanup-preview?scope=enable|upcoming`
   - `POST /admin/youtube-lifecycle/recovery/run`
   - `GET /admin/youtube-quarantine`
   - `POST /admin/youtube-quarantine/{videos|short-assets}/:id/lookup|apply|reset`
   回應格式必須完全符合下方「回應格式」，前端已照這個格式寫好。
2. **隔離收尾**（#17、#18），影片與短片兩種都要：
   - lookup：憑證有讀取權限時（沿用 `hasPrivacyCapableScope` 的判斷），用 YouTube Data API 讀自家頻道的上傳清單（channels.list `mine=true` → uploads playlist → playlistItems.list），比對描述欄：影片是 `Uploaded by FocusFlow (video <id>)`，短片是 `(FocusFlow short <id>)`（短片的標記由 D 塊加在上傳時）。只回傳結果，不修改資料。沒有權限時回 `searchable: false`。
   - apply：先呼叫 YouTube（videos.list）確認影片存在且屬於自家頻道，才標成已上傳並切換播放欄位（影片比照上傳成功時寫入的欄位；短片比照 `uploadShortAssetToYouTube` 成功時的欄位與後續上架判斷）。
   - reset：重設為可重試（retrySafe=true、attemptCount=0、nextRetryAt=now）。
   - 只有被隔離的項目（失敗且 retrySafe=false）可以操作，否則回 409。
3. **短片納入恢復排程與隔離判斷**（#28）：讓 A 的恢復排程也處理短片——可安全重試的失敗依退避重試，卡在上傳中超過時限的隔離。請重用 A 匯出的介面擴充，不要另寫一套排程。
4. **通知**（#20）：新增通知來源 `youtube_upload_needs_review`（影片或短片被隔離時通知所有啟用中的 admin，同一項目同一次失敗只通知一次，用 dedupeKey）與 `youtube_upload_resolved`（apply 或 reset 後通知上傳者 `uploadedBy`，沒有時通知課程教師；內容為「已上傳完成」或「已重新排入上傳」）。前端已依這兩個字串導向頁面。
5. **系統狀態**：`systemStatus.service.js` 加上待處理數量與 7 天內將到期刪除數量，供管理員總覽顯示。
6. **文件同步**：`backend/docs/openapi.yaml`（`tests/docs.routes.test.js` 要通過）、`.claude/rules/api-design.md` 錯誤碼表。

## 回應格式（皆包在 `{ success, data }`）

- settings：`{ switches: [{ key: 'upload'|'recovery'|'cleanup', envAllowed, runtimeEnabled /* null=未設定 */, effective, reason /* 'env_disabled'|'runtime_disabled'|'default_off'|null */ }], history: [{ key, from, to, changedBy: { id, name, email }, changedAt }], runtime: { recoveryIntervalMs, cleanupMinFreeGb, cleanupMinAgeDays, cleanupMaxAgeDays, freeSpaceGb, lastRecoveryAt } }`
- cleanup-preview：`{ scope, count, totalBytes, items: [{ kind: 'video'|'short_asset', id, title, courseTitle, sizeBytes, eligibleAt, reason: 'max_age'|'low_space' }] }`
- recovery/run：`{ recovered, quarantined, skipped }`
- quarantine 清單：`{ items: [{ kind, id, title, courseId, courseTitle, uploadedBy: { id, name }, failedAt, error, attemptCount }] }`
- lookup：`{ searchable, matches: [{ youtubeVideoId, title, publishedAt, privacyStatus }] }`
- apply：`{ kind, id, status: 'uploaded' }`；reset：`{ kind, id, status: 'failed', retrySafe: true, attemptCount: 0 }`

A 的服務回傳格式若和上面不同，在 controller／service 層轉換成上面的格式；無法轉換時停下來，在最後回報裡說明。

## 測試

用 `node:test` 與專案既有的測試替身寫法；YouTube 呼叫一律注入假的 `fetchImpl`。至少涵蓋：非 admin 403；每個 API 成功路徑；環境不允許時切換 409；lookup 有／無權限、比對影片與短片標記；apply 驗證失敗（不存在、不是自家頻道）不改資料；非隔離項目 409；通知只發一次、處理後通知教師；短片進入恢復排程與隔離。

worktree 的 `backend/node_modules` 已經裝好。在 `backend/` 執行 `npm.cmd test` 全套與 `npm.cmd run docs:lint`，都必須通過。

## Commit 規則

- **小步 commit**：一個可獨立說明的修改一筆（例如：settings API、預告與立即恢復 API、隔離清單與 lookup、apply 與 reset、短片恢復排程、通知、系統狀態、OpenAPI 與錯誤碼文件），每一筆都要能通過相關測試。不要最後堆成一大筆。
- 訊息沿用 repo 風格，例如 `feat(backend): 新增 YouTube 隔離項目查詢 API`，用中文說明。
- 作者一律用本機 Git 設定的身分，不要修改；**不要加任何 Co-Authored-By、Generated with 或其他 AI 署名**。
- 只 commit 到 `wip/yt-b-admin`；**不 push、不合併、不切換其他分支**。

## 禁止

- 不連 VM、MongoDB Atlas、YouTube 或任何外部網路；不刪除測試暫存目錄以外的任何檔案。
- 不改前端（`frontend/`）、不改 A 塊排程與清理的核心判斷（只能用它匯出的介面擴充）、不改 D 塊負責的短片上傳描述標記與短片清理。
- 不修改 `docs/04_Features/YouTube_Lifecycle/decisions.md` 的已定案內容。

## 完成時回報（寫在最後一則訊息）

分支名、每一筆 commit（hash 與標題）、測試與 docs:lint 結果（通過／失敗數）、新增的錯誤碼與通知來源、和回應格式不一致的地方、未完成或有疑慮的地方。
