# 後端功能開關

功能開關控制某段程式是否執行，env 是程序啟動時讀取的環境設定；這份文件整理開關來源與重啟條件，避免混淆腳本功能、學生短片牆及影像備援的行為。請依下表查找設定，功能狀態見[目前狀態](../../docs/current-status.md)；表格描述程式行為，不代表部署環境的實際值。

| 開關／控制項 | 定義位置 | env 或資料庫 | 修改後是否重啟 |
|---|---|---|---|
| `SHORT_SCRIPT_AUTOMATION_ENABLED`：腳本介面與成品上傳排程 | [環境設定](../src/config/env.js)、[腳本路由](../src/routes/short-script.routes.js) | env | 重啟後端 |
| `YOUTUBE_UPLOAD_ENABLED`：影片及短影片上傳 | [環境設定](../src/config/env.js)、[上傳檢查](../src/services/youtubeUpload.service.js) | 兩層：env 總開關＋資料庫執行期開關 | env 需重啟；執行期開關下一次檢查生效 |
| `YOUTUBE_UPLOAD_RECOVERY_ENABLED`：定期重試可安全重試的上傳、隔離卡住的上傳 | [環境設定](../src/config/env.js)、[上傳服務](../src/services/youtubeUpload.service.js) | 兩層：env 總開關＋資料庫執行期開關 | env 需重啟；執行期開關下一輪生效 |
| `YOUTUBE_UPLOAD_CLEANUP_ENABLED`：定期清理已上傳 YouTube 的原片（含已上架或已封存的短片成品） | [環境設定](../src/config/env.js)、[清理服務](../src/services/youtubeLifecycle.service.js)、[短片清理](../src/services/shortAssetCleanup.service.js) | 兩層：env 總開關＋資料庫執行期開關；未設定視為關閉 | env 需重啟；執行期開關在每次刪檔前檢查 |
| `YOUTUBE_UPLOAD_RECOVERY_INTERVAL_MS`／`YOUTUBE_UPLOAD_CLEANUP_INTERVAL_MS`：排程間隔，`0` 只在開機跑 | [環境設定](../src/config/env.js) | env；調整參數 | 重啟後端 |
| `YOUTUBE_UPLOAD_CLEANUP_MAX_AGE_DAYS`／`MIN_FREE_GB`／`MIN_AGE_DAYS`：清理的保留期與空間門檻 | [環境設定](../src/config/env.js)、[清理服務](../src/services/youtubeLifecycle.service.js) | env；調整參數 | 重啟後端 |
| `SHORTS_SYNC_INTERVAL_MS`：同步週期，`0` 停用排程 | [環境設定](../src/config/env.js)、[同步服務](../src/services/shortsSync.service.js) | env | 重啟後端 |
| `QA_VISUAL_RETRIEVAL_ENABLED`：影像與文字並行查詢 | [環境設定](../src/config/env.js)、[問答服務](../src/services/qa.service.js) | env | 重啟後端 |
| `QA_VISUAL_MATCH_LIMIT`／`QA_VISUAL_MIN_SCORE`：影像數量與分數門檻 | [環境設定](../src/config/env.js) | env；調整參數 | 重啟後端 |
| `ENABLE_GEMINI_VIDEO_EMBEDDING`：允許產生影像搜尋向量（一串用來比較內容的數字） | [處理設定](../../STT_Whisper/src/config.py) | 處理程序的 env | 下次啟動處理程序讀取 |
| `--upload`：將影像向量寫入資料庫 | [影像處理入口](../../STT_Whisper/src/video_multimodal_pipeline.py) | 指令參數 | 每次執行指定 |
| `ShortAsset.status`、審核結果、YouTube 可播放狀態 | [模型](../src/models/shortAsset.model.js)、[學生清單查詢](../src/services/shortAsset.service.js) | 資料庫；逐支影片控制 | 不需重啟，下次查詢反映 |

- **YouTube 上傳、恢復、清理是兩層開關，兩層都開才生效。** 環境變數決定這個環境允不允許；管理員在允許範圍內切換，存在資料庫 `runtimesettings`，每次使用前直接讀取、不快取。資料庫還沒有設定時，上傳與恢復跟隨環境變數，清理視為關閉。實際生效值與原因看 `/health` 的 `runtime.youtubeUpload.switches`。規則依據：[設計決策](../../docs/04_Features/YouTube_Lifecycle/decisions.md) #9～#16。
- 流程例：`YOUTUBE_UPLOAD_CLEANUP_ENABLED=true` ＋資料庫沒有清理設定 → `switches.cleanup.reason` 為 `default_off`，排程不刪任何檔案 → 管理員啟用後，下一輪排程依保留期與空間刪除。
- **關閉開關不會中斷進行中的工作。** 正在上傳的影片會傳完；恢復與清理排程在每輪開始前檢查，清理另在每次刪檔前再檢查一次。
- **關閉腳本功能，不會關閉學生短片牆。** [學生介面](../src/routes/youtube.routes.js)仍依修課與影片發布條件提供清單。
- **`QA_VISUAL_RETRIEVAL_ENABLED=false` 時，文字查無結果仍會改走影像備援查詢。** 這是刻意設計，目的是避免文字查不到時完全沒有回答；找到影像時提供可檢視的來源提示，不把沒有逐字稿的畫面說成完整文字答案。依據：[查詢與回覆](../src/services/qa.service.js)。
- 流程例：關閉並行查詢＋提問「投影片流程圖在哪裡？」→ 文字查無結果 → 嘗試影像查詢 → 有命中則回覆片段提示與時間位置；仍無命中則回覆查無依據。
