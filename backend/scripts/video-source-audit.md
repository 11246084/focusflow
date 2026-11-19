# VM 原始影片唯讀排查

本工具蒐集執行中後端的環境來源、原片路徑、清理紀錄及儲存掛載，供團隊判斷影片消失原因。先在 VM 依下列命令執行，再依證據判讀；報告不會自動宣判刪檔原因。

## 執行前

- 在 VM 的同一份後端 checkout 執行，使用後端程序的作業系統帳號。需要 Linux `/proc`、Node.js 22.23.4 以上的 22 版或 24.22.1 以上的 24 版、既有 backend `node_modules`（mongodb、dotenv），以及 `git`、`findmnt`、`df`。不需要啟動後端、安裝新套件或連線 YouTube。
- 本工具只呼叫檔案讀取、系統查詢與 MongoDB `find`／`findOne`，不載入 Mongoose models、應用程式、排程或清理服務，不建立 collection／index。連線會產生一般資料庫存取日誌；本機重導向會建立報告檔。
- 執行前取得本次交付的 commit。正式 checkout 的 `git pull` 仍需依部署授權與凍結規定，由維運人員操作；不要為了下載腳本重啟服務。若不能更新正式 checkout，請先由維運人員安排工具放置位置（工具目前要求位於目標 backend/scripts）。
- 報告排除 URI、憑證、YouTube session、標題、字稿與原始 log；仍包含內部路徑、影片 ID、時間與掛載資訊。只交給排查團隊，勿提交 Git 或貼公開 issue。

## 直接執行

```sh
cd /opt/focusflow
node -v
umask 077
node backend/scripts/video-source-audit.cjs \
  --log-file /home/focusflow/.pm2/logs/focusflow-backend-error.log \
  > /tmp/focusflow-video-audit.json
echo $?
cat /tmp/focusflow-video-audit.json
```

成功回傳 0；資料庫或選填日誌檢查失敗回傳 2，JSON 仍保留其他證據；參數、程序權限或環境錯誤回傳 1。省略 `--pid` 時會自動執行 `pm2 pid focusflow-backend` 取得目前後端 PID（有多個 PID 時請逐一以 `--pid` 指定）。PID 必須為此 backend checkout 的 Node 後端（`cwd` 或 `cmdline` 指向此 `backend`），若程序自其他目錄（例如 `/home/focusflow`）啟動，報告會同時記錄 `processCwd` 並一併檢查相對 `processCwd` 的路徑。不要直接輸出 `pm2 jlist`、`/proc/PID/environ` 或 `.env`，其中可能有機密。

只查一支影片及指定日誌範例（替換 ID、PID 與實際日誌位置）：

```sh
node backend/scripts/video-source-audit.cjs --pid 12345 \
  --video-id 69fb55edb52433fda32db4e8 --limit 1000 \
  --log-file /home/focusflow/.pm2/logs/focusflow-backend-error.log \
  > /tmp/focusflow-video-audit-one.json
```

不指定影片時依 `_id` 排序讀最多 1,000 筆，`--limit` 可設 1～10,000；`truncated=true` 表示報告不完整，請改查事故影片 ID。查無資料會得到空陣列，不代表整個資料庫沒有影片。預設查詢包含有 deletedAt 的文件，以保留事故線索；不列出 shortassets，本工具針對原始影片。

## 依資訊層級判讀

| 證據 | 能確認的內容 | 不能直接推論的內容 |
|---|---|---|
| configuration 的 value／source | `/proc` 初始環境優先，其次目前 `.env`，最後目前 checkout 的預設值 | `.env` 在程序啟動後被改過時，不能宣稱這是記憶體中的實際設定 |
| cleanupSetting、history 的 from／to／changedAt | 當次 DB 開關與保留的變更時間 | 歷史最多 50 筆；沒有紀錄不代表從未啟用 |
| cleanupEffectiveReconstructed | 依上述來源與 DB boolean 重建的清理開關 | 不是呼叫執行中程序取得的即時設定；DB 查詢失敗則不提供此值 |
| localCleanupAt、cleanupIntent | 應用程式曾記錄清理完成或清理工作階段 | 不能單靠欄位確定是哪個程序刪除或排除人工改動 |
| filePath、resolvedPath、local | 依目前程式以 backend 為基準解析路徑，檔案是否存在、實體位置與 inode | `ENOENT` 只能證明該路徑缺檔；權限錯誤會是 exists=null |
| storage.mount／disk | 當次掛載來源、檔案系統與剩餘空間 | 不能推定事故當下磁碟空間或歷史掛載狀態 |
| youtubeUpload、youtubeVideoId | DB 記錄的上傳／遠端狀態 | 沒有向 YouTube 查驗當下可播放性或備份完整性 |
| log.matchingLineCounts | 指定 log 最後最多 8 MiB 的固定關鍵字計數 | 零次不代表沒有清理；目前程式未保證每次成功清理均有文字 log |

保留期限與空間規則值來自目前 [env.js](../src/config/env.js)；是否為有效候選還涉及 processing、遠端 ready、引用、工作鎖及恢復狀態。本工具不呼叫候選服務，以免間接進入具副作用的流程，因此不將到期影片標成「已刪除」。

## 深入核對與交接

1. 先記下事故影片 ID、最後見到原片時間與發現時間（註明時區）。比較 `localCleanupAt`、設定 history、影片 `updatedAt`，建立時間線；`localCleanupAt` 也可能來自清理工作修復缺檔後的紀錄，不必然等於實際 unlink 時間。
2. 對不同 PID 分別蒐證。`sameProcessAtEnd=false` 表示蒐證期間程序已替換，請重新執行；同時核對目前 checkout 的 gitHead 與部署時間，避免把磁碟新版程式當成正在執行的版本。
3. 若 `filePath` 有值但缺檔，先用報告中的掛載位置核對預期磁碟是否仍掛載，再由維運人員在明確的舊上傳目錄／備份目錄搜尋同名檔案。工具不掃描全磁碟、不讀影片內容，也不自動掛載或還原。
4. 由有權限成員在 VM 內檢閱事故時段的 PM2 stdout、stderr 與輪替檔，對照影片 ID／cleanup 時間。選填 log 參數可對不同輪替檔重跑計數；完整 log 不隨報告匯出。若既有 auditd、備份或儲存平台有歷史紀錄，再核對 unlink、掛載及快照事件；工具不安裝或啟用稽核服務。
5. 交接 JSON、執行命令（勿含憑證）、exit code、事故時間範圍及缺少的證據。將結論標為「程式存在刪檔路徑」「DB 有清理紀錄」「已有事件證據支持刪檔原因」其中適當層級；不要混用。

本工具不改清理開關、不還原影片、不下載 YouTube、不修改 Atlas。若確認有持續刪檔風險，另行授權停止清理並修正原片留存政策；當次 runtime 查證結果與進度統一記在 [current-status](../../docs/current-status.md)。
