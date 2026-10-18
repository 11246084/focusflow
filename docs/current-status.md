# FocusFlow 目前狀態

這份文件集中記錄各模組的進度，避免不同文件各寫一份。請先看狀態與依據，再由團隊填寫負責人及待決項目；後端技術說明見[技術索引](../backend/docs/current-state.md)。

**狀態定義：**「規劃中」指方案研究；「實作中」指仍在補功能；「已實作」只代表本段範圍的程式接線完成，不代表驗收通過，尚未查證的部分另列「○○未驗證」；「已驗收」需指定環境與驗收證據。本次僅查閱程式及歷史紀錄，未啟動專案、執行測試或連線外部服務；日期為最後查閱日期，驗收日期另列。

## 各模組

**帳號、課程與管理功能｜已實作。** 範圍含登入、修課、通知、頭貼、統計及問題回報；依據：[路由入口](../backend/src/routes/index.js)、[帳號介面](../backend/src/routes/auth.routes.js)、[課程權限](../backend/src/services/courseAccess.service.js)。最後驗證：2026-10-14；負責人：＿＿（待填）。

**網頁操作｜已實作。** 範圍含角色頁面、課程影片、問答與上傳操作的後端呼叫；依據：[應用程式入口](../frontend/focus-flow/src/App.jsx)、[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)、[上傳頁](../frontend/focus-flow/src/pages/TeacherUpload.jsx)。瀏覽器操作結果 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**文字問答與多輪對話｜已實作。** 含課程範圍檢查、來源引用、常見問題快取及對話紀錄；快取是保留可重用回答以減少重複計算。依據：[問答服務](../backend/src/services/qa.service.js)、[對話服務](../backend/src/services/conversation.service.js)；回答品質與外部模型 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**LINE 綁定與問答｜已實作。** 含訊息驗簽、帳號綁定與問答接線；依據：[LINE 介面](../backend/src/routes/line.routes.js)、[訊息處理](../backend/src/services/line.service.js)。實際收送訊息 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**單支影片與語音轉文字｜已實作。** 後端啟動處理程序，產生逐字稿、切段與搜尋向量，再接收完成或失敗通知；向量是用來比較內容相似度的一串數字。依據：[影片服務](../backend/src/services/video.service.js)、[處理入口](../STT_Whisper/src/main.py)、[回報處理](../backend/src/services/videoProcessing.service.js)；真實影片完整流程 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**YouTube 上傳｜已實作。** [上傳服務](../backend/src/services/youtubeUpload.service.js)由[影片完成通知](../backend/src/services/videoProcessing.service.js)排程，受功能開關與憑證條件控制；目前部署環境的上傳結果未驗證。最後驗證：2026-10-15；負責人：＿＿（待填）。

**YouTube 恢復／清理｜實作中。** 依 2026-10-15 團隊決定與上傳分開追蹤。[恢復與清理程式](../backend/src/services/youtubeUpload.service.js)有獨立開關；清理須同時符合處理完成、YouTube 上傳完成、來源位於允許目錄且無其他影片共用，實際環境的恢復與清理未驗證。最後驗證：2026-10-15；負責人：＿＿（待填）。

**多影片批次｜已實作。** [批次服務](../backend/src/services/videoBatchProcessing.service.js)與[批次入口](../STT_Whisper/src/batch_main.py)串接排程、重試及恢復；真實語音模型、向量產生與部署的完整流程未驗證。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生短影片瀏覽｜已實作。** [短影片頁](../frontend/focus-flow/src/pages/StudentShortsWall.jsx)串接[學生介面](../backend/src/routes/youtube.routes.js)。較新紀錄：[2026-09-29 後端整體回歸](../backend/docs/implementation-log.md)（原文為工作分支紀錄，非正式環境驗收）；直接相關的[縮圖測試](../backend/tests/shorts.routes.test.js)於 2026-09-27 加入（Git `d8360fc`，未記載單項執行結果）。最近播放驗收仍為 2026-08-13（限當時環境），未找到更新的播放驗收。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片腳本｜已實作；上架未驗證。** [腳本介面](../backend/src/routes/short-script.routes.js)串接選題、生成、成品上傳與審核；[發布服務](../backend/src/services/shortAssetPublish.service.js)處理 YouTube 上傳與審核後提供學生瀏覽。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片自動產片｜規劃中。** 新方向原型位於 [short_render/](../short_render/)（原片剪輯加程式動畫，不使用教授端生成模型），尚未接入前後端。依據：[指令入口](../short_render/bin/short-render.js)與 2026-10-15 團隊決定。最後驗證：2026-10-15；負責人：＿＿（待填）。

**分層檢索與向量發布｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。分層檢索是先找較大段落，再找可引用的小片段；[檢索服務](../backend/src/services/hierarchicalRetrieval.service.js)、[資料檢查](../backend/src/services/hierarchicalDataReadiness.service.js)與[發布入口](../STT_Whisper/src/publish_parent_embeddings.py)有對應程式，不據此判定可啟用。最後驗證：2026-10-15；負責人：＿＿（待填）。

**影像補充引用｜已實作；實際資料覆蓋未驗證。** [問答服務](../backend/src/services/qa.service.js)串接影像查詢與來源引用，但仍需另查課程影片是否有可用影像資料。最後驗證：2026-10-15；負責人：＿＿（待填）。

**教育開放資料推薦｜已實作。** [推薦服務](../backend/src/services/openDataExtension.service.js)與[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)以關鍵字推薦延伸影片；真實清單匯入、部署及推薦品質 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**資料庫交付工具｜已實作；真實資料還原未驗證。** [匯出與還原服務](../backend/src/services/databaseDeliverable.service.js)有對應程式；舊文的記憶體模擬測試不代表實際資料庫還原成功。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生試用與部署｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。[部署設定](../.github/workflows/deploy.yml)只能證明部署步驟存在；歷史開放試用不等於本次驗收，需補目前環境與驗收紀錄。最後驗證：2026-10-15；負責人：＿＿（待填）。

## 歷史查證索引（保留原日期，未重新驗證）

以下是舊文記載的結果，不作為上述模組的本次驗收證據；舊數字不再列為現況。

- 2026-05-23／07-10／07-24／08-02：資料庫數量、向量索引及欄位分布的歷史查詢；完整數字保留於下述 Git 版本。
- 2026-07-26：帳號、通知與頭貼的隔離測試；2026-08-02：YouTube 上傳與刪除後轉私人影片的外部測試，均為舊文紀錄。
- <a id="2026-08-13-多影片批次整合與隔離重啟驗收"></a>2026-08-13：短影片播放驗收；批次隔離測試為「兩支影片 → 一支完成、一支失敗，重啟後保留結果」，另一教師讀取回 403；2026-08-14：單項重試與前端批次契約補強。未涵蓋真實語音模型或部署。
- 2026-08-09／08-13：分層檢索的本機契約與資料檢查紀錄，未能證明目前共用資料庫可用；2026-08-30：[後端第一階段本機測試](04_Features/Student_Pilot_Backend/evidence/2026-08-30_phase1-implementation-results.md)，不等同正式驗收。
- 2026-08-24：[問答品質評測](04_Features/QA_Evaluation/reports/2026-08-24-評測結果.md)；2026-09-10：[憑證申請](10_Operations/deployment/2026-09-10_Lets_Encrypt憑證申請紀錄.md)；2026-09-21／09-23：[開放試用與外部檢查](10_Operations/deployment/2026-09_開放學生試用紀錄.md)。2026-09-24 使用量只代表當時樣本。
- 2026-09-29：舊文記載影像資料尚未綁定課程影片；2026-10-03：推薦功能僅本機實作；2026-10-07：資料庫交付工具僅模擬測試；2026-10-14：本機產片工具紀錄，未宣稱系統串接或部署。

完整舊文（含其餘測試日期、原始數字與會議紀錄）保留在 Git 版本 `9140f9ec58beff5cc21cb97486bc4864f6898eec`，不另建一份狀態文件。查閱例：在 repo 根目錄輸入 `git show 9140f9e:docs/current-status.md` → 顯示整理前原文；把路徑換成 `backend/docs/current-state.md` 可查後端舊文。歷史文字與目前程式有差異時，以程式及新查證為準。
