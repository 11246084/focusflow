# 後端技術限制與交接注意事項

這份文件說明操作後端時要注意的資料與環境限制，避免把舊快照當成現況。請依相關程式確認行為；進度與驗收日期只看[目前狀態](../../docs/current-status.md)。

| 主題 | 限制與處理方式 | 程式依據 |
|---|---|---|
| 資料庫與索引 | 索引是加速查詢的資料結構；初始化腳本存在，不代表共用資料庫已套用。資料量、索引與目前使用的向量版本須實查，不沿用舊數字。 | [初始化索引](../../database/tools/setup/init_indexes.js)、[資料相容性檢查](../src/services/hierarchicalDataReadiness.service.js) |
| 課程搜尋範圍 | 文字片段的 `videoId` 必須命中允許影片的識別碼；無權限或無資料不能靠切換搜尋模式解決。 | [範圍檢查](../src/services/bridgeScope.service.js)、[問答服務](../src/services/qa.service.js) |
| 模型與資料契約 | 契約指雙方約定的資料格式；模型名稱相同仍需比對向量維度、資料版本與生成方式，不能直接混用新舊向量。 | [向量契約](../../STT_Whisper/src/embedding_contract.py)、[資料檢查](../src/services/hierarchicalDataReadiness.service.js) |
| 影片所有權與欄位 | 只含處理資訊的影片不等於可播放影片；文字片段與影像片段的欄位命名不同，匯入前要核對模型。 | [影片呈現](../src/services/bridgeScope.service.js)、[文字模型](../src/models/videoSegment.model.js)、[影像模型](../src/models/videoSegmentVideo.model.js) |
| YouTube 與本機檔案 | [上傳服務](../src/services/youtubeUpload.service.js)由[完成通知](../src/services/videoProcessing.service.js)排程；清理原片有開關、完成狀態、路徑及共用檔案檢查，不可整批清空 uploads。YouTube 的 unlisted 是知道連結即可觀看，課程權限不能阻止轉貼連結。 | [上傳與清理](../src/services/youtubeUpload.service.js)、[短片發布](../src/services/shortAssetPublish.service.js) |
| 影像回覆 | 沒有逐字稿的影像命中只提供來源提示；並行查詢開關關閉時仍保留文字查無結果的影像備援，詳見[功能開關](current-state.md#功能開關)。 | [查詢與回覆](../src/services/qa.service.js) |
| LINE 與部署設定 | LINE 回報網址、憑證及環境設定要對照實際部署；健康檢查或歷史成功紀錄不能保證外部服務當下可用。 | [LINE 路由](../src/routes/line.routes.js)、[診斷服務](../src/services/runtimeDiagnostics.service.js) |
| 操作寫入範圍 | 啟動後端、示範資料與上傳工具可能寫入資料庫；先核對目標。需要模擬或隔離驗證時，依[測試規則](../../.claude/rules/testing.md)選擇工具。 | [資料庫連線](../src/config/database.js)、[上傳工具](../../STT_Whisper/src/mongodb_uploader.py) |

例：影片處理完成但 YouTube 上傳失敗 → 檢查上傳錯誤與憑證 → 依重試條件處理；不能直接刪除仍供播放的本機原片。

舊資料庫數字與歷史處置不是操作指令。需追查原文時，在 repo 根目錄執行 `git show 9140f9e:backend/docs/handoff-known-issues.md` → 顯示整理前版本；目前狀態仍回到[唯一正本](../../docs/current-status.md)。
