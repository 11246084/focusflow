# 後端功能開關

功能開關控制某段程式是否執行，env 是程序啟動時讀取的環境設定；這份文件整理開關來源與重啟條件，避免混淆腳本功能、學生短片牆及影像備援的行為。請依下表查找設定，功能狀態見[目前狀態](../../docs/current-status.md)；表格描述程式行為，不代表部署環境的實際值。

| 開關／控制項 | 定義位置 | env 或資料庫 | 修改後是否重啟 |
|---|---|---|---|
| `SHORT_SCRIPT_AUTOMATION_ENABLED`：腳本介面與成品上傳排程 | [環境設定](../src/config/env.js)、[腳本路由](../src/routes/short-script.routes.js) | env | 重啟後端 |
| `YOUTUBE_UPLOAD_ENABLED`：影片及短影片上傳 | [環境設定](../src/config/env.js)、[上傳檢查](../src/services/youtubeUpload.service.js) | env | 重啟後端 |
| `SHORTS_SYNC_INTERVAL_MS`：同步週期，`0` 停用排程 | [環境設定](../src/config/env.js)、[同步服務](../src/services/shortsSync.service.js) | env | 重啟後端 |
| `QA_VISUAL_RETRIEVAL_ENABLED`：影像與文字並行查詢 | [環境設定](../src/config/env.js)、[問答服務](../src/services/qa.service.js) | env | 重啟後端 |
| `QA_VISUAL_MATCH_LIMIT`／`QA_VISUAL_MIN_SCORE`：影像數量與分數門檻 | [環境設定](../src/config/env.js) | env；調整參數 | 重啟後端 |
| `ENABLE_GEMINI_VIDEO_EMBEDDING`：允許產生影像搜尋向量（一串用來比較內容的數字） | [處理設定](../../STT_Whisper/src/config.py) | 處理程序的 env | 下次啟動處理程序讀取 |
| `--upload`：將影像向量寫入資料庫 | [影像處理入口](../../STT_Whisper/src/video_multimodal_pipeline.py) | 指令參數 | 每次執行指定 |
| `ShortAsset.status`、審核結果、YouTube 可播放狀態 | [模型](../src/models/shortAsset.model.js)、[學生清單查詢](../src/services/shortAsset.service.js) | 資料庫；逐支影片控制 | 不需重啟，下次查詢反映 |

- **關閉腳本功能，不會關閉學生短片牆。** [學生介面](../src/routes/youtube.routes.js)仍依修課與影片發布條件提供清單。
- **`QA_VISUAL_RETRIEVAL_ENABLED=false` 時，文字查無結果仍會改走影像備援查詢。** 這是刻意設計，目的是避免文字查不到時完全沒有回答；找到影像時提供可檢視的來源提示，不把沒有逐字稿的畫面說成完整文字答案。依據：[查詢與回覆](../src/services/qa.service.js)。
- 流程例：關閉並行查詢＋提問「投影片流程圖在哪裡？」→ 文字查無結果 → 嘗試影像查詢 → 有命中則回覆片段提示與時間位置；仍無命中則回覆查無依據。
