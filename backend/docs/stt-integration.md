# STT 整合流程

STT 是把語音轉成文字的處理程序；這份文件說明它與後端的交接方式，方便追蹤上傳後的處理結果。請依下表查找程式入口，安裝與獨立操作見 [STT 使用說明](../../STT_Whisper/README.md)，功能狀態見[目前狀態](../../docs/current-status.md)。

| 入口 | 呼叫與資料交接 |
|---|---|
| 上傳與排程 | [影片路由](../src/routes/video.routes.js)提供單片、YouTube 網址及批次入口；[影片服務](../src/services/video.service.js)讓本機單片透過[佇列](../src/services/videoProcessingQueue.service.js)啟動 `src/main.py`。[批次服務](../src/services/videoBatch.service.js)依 `VIDEO_BATCH_PIPELINE_ENABLED` 選擇單片排程或[批次程序](../src/services/videoBatchProcessing.service.js)呼叫 `src/batch_main.py`。 |
| 程序設定與輸出 | 單片與批次服務傳入影片識別碼、資料庫及回報設定，優先使用 STT 目錄的 Python 虛擬環境。[單片入口](../../STT_Whisper/src/main.py)與[批次入口](../../STT_Whisper/src/batch_main.py)串接處理；[執行紀錄](../../STT_Whisper/src/job_manager.py)用 `run_id` 區分每次執行，[上傳工具](../../STT_Whisper/src/mongodb_uploader.py)負責資料寫入。 |
| 回報與恢復 | [內部路由](../src/routes/internal-video.routes.js)接收開始、完成或失敗通知，須通過[共用密鑰檢查](../src/middleware/internalProcessingAuth.middleware.js)；[通知處理](../src/services/videoProcessing.service.js)更新結果。[批次對帳](../src/services/videoBatchReconciliation.service.js)核對資料庫與處理紀錄，再決定恢復方式。 |

影片處理狀態由[通知處理](../src/services/videoProcessing.service.js)強制轉換；狀態機是限制處理步驟如何前進的規則，非法轉換回 `409 VIDEO_PROCESSING_TRANSITION_INVALID`：

| 操作 | 前置狀態 | 目標狀態 |
|---|---|---|
| 重試 | `failed` | `queued` |
| 開始通知 | `queued` | `processing` |
| 完成通知 | `processing` | `completed` |
| 失敗通知 | `queued` 或 `processing` | `failed` |

例：教師上傳兩支影片 → `POST /api/v1/courses/:courseId/video-batches` 回傳 `batchId` → 依設定排程 → 處理程序回報結果 → `GET /api/v1/video-batches/:batchId` 取得各片結果。舊交接僅供追溯：[2026/05 快照](handoff-stt-pipeline-integration.md)。
