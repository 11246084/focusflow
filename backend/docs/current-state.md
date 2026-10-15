# 後端技術索引

這份文件說明後端的資料流與程式入口，方便查找實作。進度、驗證日期與負責人統一見[目前狀態](../../docs/current-status.md)；請沿下列連結閱讀需要的技術細節。

| 主題 | 技術說明與依據 |
|---|---|
| 請求處理 | API 是前端呼叫後端的介面；請求依序經過路由、控制器、服務與資料模型。[路由入口](../src/routes/index.js)列出各介面；[OpenAPI](openapi.yaml)是可供工具讀取的介面規格。[規格測試](../tests/docs.routes.test.js)比對路徑與方法，不能替代回應內容驗證。 |
| 身分與課程權限 | [帳號介面](../src/routes/auth.routes.js)處理登入與個人資料；[課程權限服務](../src/services/courseAccess.service.js)檢查學生有效修課與課程發布條件。[查詢範圍](../src/services/bridgeScope.service.js)以允許的影片識別碼限制文字片段，空範圍不可放行。 |
| 問答與對話 | [問答服務](../src/services/qa.service.js)檢查權限、搜尋片段、生成答案並保留來源；[對話服務](../src/services/conversation.service.js)管理多輪訊息。[快取](../src/services/faqCache.service.js)保存可重用答案；[提問限制](../src/services/askLimits.service.js)集中管理字數與次數。 |
| 影片處理 | [影片服務](../src/services/video.service.js)啟動語音轉文字程序，[完成通知處理](../src/services/videoProcessing.service.js)保存結果並排程 YouTube 上傳。[批次服務](../src/services/videoBatchProcessing.service.js)搭配[紀錄對帳](../src/services/videoBatchReconciliation.service.js)處理多支影片與程序重啟。 |
| YouTube 與短影片 | [上傳服務](../src/services/youtubeUpload.service.js)包含上傳、重試及來源檔清理條件；[學生短影片介面](../src/routes/youtube.routes.js)與[教師腳本介面](../src/routes/short-script.routes.js)分開處理瀏覽與產製操作。 |
| 資料欄位 | [文字片段模型](../src/models/videoSegment.model.js)使用 `videoId/chunkId`；[影像片段模型](../src/models/videoSegmentVideo.model.js)使用 `video_id/clip_id`，不可混用。[索引腳本](../../database/tools/setup/init_indexes.js)對文字片段使用 `videoId/chunkId`；腳本存在不代表資料庫已套用。 |
| 分層與影像查詢 | [分層服務](../src/services/hierarchicalRetrieval.service.js)先找大段落再找引用片段；[資料檢查](../src/services/hierarchicalDataReadiness.service.js)核對資料版本與搜尋條件。[影像查詢分支](../src/services/qa.service.js)補充引用，不把無文字說明的畫面當成生成答案的依據。 |
| 推薦、頭貼與交付 | [推薦服務](../src/services/openDataExtension.service.js)以關鍵字比對延伸影片，不加入答案生成內容；[頭貼模型](../src/models/avatar.model.js)儲存圖片；[資料庫交付服務](../src/services/databaseDeliverable.service.js)負責匯出與還原檢查。 |
| 設定與服務診斷 | 功能開關是控制是否執行某項功能的設定，定義見[環境設定](../src/config/env.js)。[健康檢查介面](../src/routes/health.routes.js)與[管理員服務診斷](../src/services/systemStatus.service.js)提供設定及最近錯誤資訊，不保證外部服務當下可用；部署環境須另行查證。 |

**流程例：**學生提交「課程 A 的重點？」→ 檢查課程存取權 → 搜尋允許的影片片段 → 回傳答案與來源；沒有可回答資料時回覆無法找到依據。處理邏輯見[問答服務](../src/services/qa.service.js)。

## 功能開關

功能開關控制某段程式是否執行；env 是程序啟動時讀取的環境設定。下表描述程式行為，不代表部署環境的實際值。

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

歷史測試、資料庫快照與部署查證統一從[目前狀態的歷史索引](../../docs/current-status.md#歷史查證索引保留原日期未重新驗證)追查，這裡不另列功能完成度或舊測試數字。
