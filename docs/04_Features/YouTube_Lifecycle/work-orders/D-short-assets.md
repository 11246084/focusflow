# 工作說明：YouTube 生命週期 D 塊（短片成品的上傳標記與原片清理）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/yt-d-shorts`，從 `feat/youtube-lifecycle` 切出（已含 A 核心與 C 補回原片）。先讀 repo 根目錄的 `AGENTS.md` 並遵守。

## 先讀

1. `docs/04_Features/YouTube_Lifecycle/decisions.md`：全部決策，特別是 #22、#24、#27～#32，以及「核心服務介面」（A 塊寫的，清理候選與刪除要用它的擴充點，不要另寫一套）。
2. `backend/src/services/shortAssetPublish.service.js`（特別是 `uploadShortAssetToYouTube`、`scheduleUploadOnCreate`、`privatizeRejectedShortAsset`、`publishApprovedShortAsset`、換代時的 `cleanupUploadedFile`）、`models/shortAsset.model.js`、`services/youtubeUpload.service.js`。
3. `.claude/rules/database.md`、`.claude/rules/testing.md`。

## 要做

1. **上傳描述標記**（#29）：短片上傳 YouTube 時，在描述欄末尾加上一行 `(FocusFlow short <成品ID>)`；教師的描述是空的時候就只放這一行。重試和換代重新上傳也要加。
2. **短片納入原片清理**（#28、#30）：用 A 的候選函式擴充點，加入 `kind: 'short_asset'`：
   - 只有**已上架或已封存**、且 YouTube 上傳完成的成品才能清理；被退回、尚未重拍的草稿不清理。
   - 保留期從 YouTube 上傳完成的時間起算；套用和一般影片相同的空間門檻、最短與最長保留期。
   - 預告（`enable`／`upcoming`）與實際刪除必須共用同一份判斷。
   - 刪除前重新確認清理開關（#14）、路徑在 `UPLOAD_DIR` 內、沒有其他成品或影片共用同一檔案。
3. **清理後保留 `filePath`**（#31）：不要把 `filePath` 設成 null，另外寫入 `localCleanupAt`（失敗時寫 `localCleanupError`），schema 要加這兩個欄位。原因：短片程式以 `filePath` 有沒有值來判斷「是不是本功能上傳的成品」，上傳排程、退回轉私人、核准上架三處都靠它。請補測試確認：清理後的成品被退回時仍會轉私人、核准時仍能上架；重新上傳時正確回 `SHORT_ASSET_SOURCE_FILE_MISSING`。
4. 短片**不提供**補回原片（#32），不需要新增介面。

## 測試

用 `node:test` 與專案既有的測試替身寫法；YouTube 呼叫一律注入假的 `fetchImpl`；檔案操作只在測試建立的暫存目錄。至少涵蓋：描述標記（有描述、空描述、重試、換代）；四種狀態（草稿、退回、已上架、已封存）的清理資格；空間與保留期規則；預告與刪除一致；清理後保留 `filePath`、記錄 `localCleanupAt`；清理後退回轉私人、核准上架的行為不變。

worktree 的 `backend/node_modules` 已經裝好。在 `backend/` 執行 `npm.cmd test` 全套，必須通過；有改 OpenAPI 的話再跑 `npm.cmd run docs:lint`。

## Commit 規則

- **小步 commit**：一個可獨立說明的修改一筆（例如：描述標記、schema 欄位、清理候選擴充、刪除與保留 filePath、各自的測試可跟對應功能同一筆），每一筆都要能通過相關測試。不要最後堆成一大筆。
- 訊息沿用 repo 風格，例如 `feat(backend): 短片上傳描述加入 FocusFlow 標記`，用中文說明。
- 作者一律用本機 Git 設定的身分，不要修改；**不要加任何 Co-Authored-By、Generated with 或其他 AI 署名**。
- 只 commit 到 `wip/yt-d-shorts`；**不 push、不合併、不切換其他分支**。

## 禁止

- 不連 VM、MongoDB Atlas、YouTube 或任何外部網路；不刪除測試暫存目錄以外的任何檔案。
- 不改前端；不改管理員 API、通知與短片的恢復排程／隔離判斷（B 塊負責）；不改 A 塊的核心判斷，只能用它匯出的擴充點。
- 不修改 `docs/04_Features/YouTube_Lifecycle/decisions.md` 的已定案內容。

## 完成時回報（寫在最後一則訊息）

分支名、每一筆 commit（hash 與標題）、測試結果（通過／失敗數）、對 A 介面的使用方式、未完成或有疑慮的地方。
