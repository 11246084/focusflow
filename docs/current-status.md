# FocusFlow 目前狀態

這份文件集中記錄各模組的進度，避免不同文件各寫一份。請先看狀態與依據，再由團隊填寫負責人及待決項目；後端技術說明見[技術索引](../backend/docs/current-state.md)。

**狀態定義：**「規劃中」指方案研究；「實作中」指仍在補功能；「已實作」只代表本段範圍的程式接線完成，不代表驗收通過，尚未查證的部分另列「○○未驗證」；「已驗收」需指定環境與驗收證據。各模組的執行與驗證範圍以該段記錄為準；日期為最後查閱或驗證日期，正式驗收日期另列。

## 各模組

**httpOnly cookie 認證｜已部署；2026-10-25 正式環境驗收通過。** 2026-10-25 13:13 部署到正式站（`main` = `d3de1ef`），部署探測與瀏覽器驗收通過，過程、Atlas 寫入與 VM 設定見[上線紀錄](10_Operations/deployment/2026-10-25_httpOnly_cookie認證上線紀錄.md)；正式站未測 step-up 與信任裝置，nginx 未轉送 `/uploads` 為既有問題。2026-10-24～25 已接上後端、前端及 deploy.yml，依[決策第 1～25 項](04_Features/HttpOnly_Cookie/decisions.md)完成獨立逐條審查及修正後複核。已修正 pending／忘記密碼重寄與猜碼次數的競態、admin 驗證失敗稽核、OpenAPI 描述及登入恢復重試按鈕遮擋。2026-10-25 依使用者補充定案完成升權撤銷：學生／教師實際升為 admin 時，同次更新角色與版本、撤銷全部憑證；重新登入並通過信箱兩段式驗證，才取得 12 小時新 session。原 admin 僅編輯姓名不撤銷，session 刪除故障也不放行舊憑證。原審查 findings 已全部處理，本輪完整後端測試通過。

| 驗證範圍 | 結果（本機 2026-10-24～25；正式環境另註日期） |
|---|---|
| Backend | 全套 1,154／1,154 通過；OpenAPI lint 通過，docs route 11 項通過。含 CSRF、Node fetch 分流、資料庫故障拒絕、撤銷、升權重登／MFA／12 小時效期與 GET 例外盤點 |
| 隔離 Mongo | 11／11 通過：索引重跑與衝突、真實 TTL、80 次並行簽發、單次驗證消耗、重寄計數與競態、原子版本遞增、最後一位 admin 保護，以及學生／教師升 admin 的舊憑證撤銷與新 12 小時 session；未連 Atlas |
| Frontend／workflow | 116／116、lint、相對 API 設定的 build 通過；deploy.yml 的 YAML、3 段 Node、21 段 Bash 語法通過；相同 dist 掃描通過（29 檔），在服務重啟前執行。原有非相對 API 環境設定會被 build guard 拒絕；未改本機 .env |
| 本機 Chromium＋Vite proxy | cookie 屬性、同來源 Network、重新整理、登入登出、全裝置登出、多分頁換帳號、admin 兩段式驗證與信任裝置、首次登入、註冊信箱驗證、step-up、影片上傳與 /uploads 讀取、頭像、回饋附件、跨來源表單 403、網路故障後重試通過；2026-10-25 另驗證升權後目標舊登入遭拒、畫面清除、操作人維持登入，目標重新 MFA 後取得 12 小時 cookie。使用記憶體資料與假寄信，影片只驗證上傳／讀取，未做 STT |
| 原有腳本 | runQaEval 用 mock／template 跑 1 題、0 錯誤；verifyShortsDeployment 經 fetch 登入通過，允許空 feed 且不查 YouTube；未呼叫付費服務 |
| 正式環境（2026-10-25） | 第 15 項第 6 層通過：真實寄信、admin 首次登入與兩段式驗證、教師與學生首次登入、cookie 屬性、同來源 Network、多分頁與全裝置登出、頭像與回饋附件、LINE 內建瀏覽器與 Email 連結進站恢復登入、部署探測（舊 JWT 拒收、登出即失效）。step-up 與信任裝置未在正式站測 |

**帳號、課程與管理功能｜已實作。** 範圍含登入、修課、通知、頭貼、統計及問題回報；依據：[路由入口](../backend/src/routes/index.js)、[帳號介面](../backend/src/routes/auth.routes.js)、[課程權限](../backend/src/services/courseAccess.service.js)。最後驗證：2026-10-14；負責人：＿＿（待填）。

**網頁操作｜已實作。** 範圍含角色頁面、課程影片、問答與上傳操作的後端呼叫；依據：[應用程式入口](../frontend/focus-flow/src/App.jsx)、[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)、[上傳頁](../frontend/focus-flow/src/pages/TeacherUpload.jsx)。瀏覽器操作結果 ⚠️ 未驗證。**已知問題（待修）**：2026-10-25 正式站發現首頁（未登入的介紹頁，`App.jsx`）在視窗較窄時跑版，例如桌機開著 DevTools、可視寬度約 900px：介紹卡片的「立即開始」按鈕被卡片底部切到，左側圖塊與統計卡片互相重疊；需另排時間修正並檢查手機寬度。最後驗證：2026-10-14；負責人：＿＿（待填）。

**文字問答與多輪對話｜已實作。** 含課程範圍檢查、來源引用、常見問題快取及對話紀錄；快取是保留可重用回答以減少重複計算。依據：[問答服務](../backend/src/services/qa.service.js)、[對話服務](../backend/src/services/conversation.service.js)；回答品質與外部模型 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**LINE 綁定與問答｜已實作。** 含訊息驗簽、帳號綁定與問答接線；依據：[LINE 介面](../backend/src/routes/line.routes.js)、[訊息處理](../backend/src/services/line.service.js)。實際收送訊息 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**單支影片與語音轉文字｜已實作。** 後端啟動處理程序，產生逐字稿、切段與搜尋向量，再接收完成或失敗通知；向量是用來比較內容相似度的一串數字。依據：[影片服務](../backend/src/services/video.service.js)、[處理入口](../STT_Whisper/src/main.py)、[回報處理](../backend/src/services/videoProcessing.service.js)；真實影片完整流程 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**YouTube 上傳｜已實作。** [上傳服務](../backend/src/services/youtubeUpload.service.js)由[影片完成通知](../backend/src/services/videoProcessing.service.js)排程，受功能開關與憑證條件控制。2026-10-22 部署後正式站憑證檢查為 `ok`、權限含 `youtube.force-ssl`（見[上線紀錄](10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)）；經新版程式實際上傳的結果未驗證，延後到團隊下次上傳課程影片時確認。最後驗證：2026-10-22；負責人：＿＿（待填）。

**YouTube 恢復／清理｜已部署；恢復已開啟，清理未開啟。** 依[設計決策](04_Features/YouTube_Lifecycle/decisions.md)實作兩層開關、定期[恢復排程](../backend/src/services/youtubeUpload.service.js)、依空間與保留期的[原片清理](../backend/src/services/youtubeLifecycle.service.js)與刪除預告、管理員[隔離收尾](../backend/src/services/youtubeQuarantine.service.js)（含已達重試上限的項目）、補回原片，短片成品一併納入；管理員操作在「YouTube 上傳管理」頁。2026-10-22 合併 `main` 部署到正式站（本機 Backend 1123、Frontend 107 項測試通過），恢復排程每 5 分鐘執行、管理員頁開關與待處理清單正常；清理的環境變數維持不允許，依決策 #33 於 2026-11-09～11-13 開啟。實際失敗後的自動恢復、清理刪檔與短片流程在正式站未驗證，過程見[上線紀錄](10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)。最後驗證：2026-10-22；負責人：＿＿（待填）。

2026-10-27 收尾複驗（分支 `fix/youtube-lifecycle-review`，本機提交／未合併／未部署）：**F0～F2 可結案，FR01～FR06 PASS；沒有未解決的已知 P1／P2 程式合併阻礙，建議進入 Commit／Merge 整合。** 已確認 NR01 P1 的 intent 接管／刪檔收尾，以及 NR02 P2 的課程刪除交易／持久外部待辦；本輪另重現並修正外部請求無回應會卡住排程的 P2，加入含回應本文的 30 秒期限。最終 Backend 全套 **1199／1199**、隔離 Mongo **62／62**、`docs:lint` 與 `git diff --check` 通過；真實 120 秒租約 **58／58**、standalone 拒絕 **1／1** 沿用未受本輪修改影響的證據，沒有重跑同樣的長測試。判定是本輪程式審查與隔離驗證，不宣稱另一位未參與修復的獨立審查者或正式環境驗收；詳見[最終報告](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f0-f2-final-review.md)。前輪 [FR 修復](04_Features/YouTube_Lifecycle/evidence/2026-10-27_fr01-fr06-fixes.md)與 [NR 交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_nr01-nr02-fixes.md)保留歷史結果。部署前仍需確認交易能力、所有 writer 升級與原有啟用門檻。沒有實作 Q-A～Q-F、F3／F4，未連 Atlas、VM 或真實 YouTube，未 Push、Merge 或部署。

2026-10-27 本機整合：使用者授權提交 F0～F2 修復與證據。合併前發現本機 `dev` 與修復分支已分歧（`dev` 獨有 8 個 commit，修復分支提交前獨有 3 個），無法 fast-forward；依使用者停止條件保留本機提交並暫停合併，不自行 rebase 或建立非 fast-forward merge。主工作目錄的第三輪 7 份規格與其他未提交檔案均不切換、不提交、不覆蓋。

2026-10-27 後續整合：F0～F2 已以 `5f60c12` 本機合併至 dev，前段「未合併／快轉受阻」保留當時記錄。本次將第三輪 YouTube 決策 #35～#64、Q-0 共用契約及 Q-A～Q-F 工單依主題提交並整合；#51～#64 定案原文完整保留，契約已對齊現行 claim update、attempt heartbeat、cleanup intent、持久備份與交易式刪課。這是純文件整合，沒有開始 F3／F4 或 Q-A～Q-F；F3／F4 仍為後續 Q 開始前的既定門檻，實作與正式環境操作均須另行授權。多模態、開放資料及競賽文件另作本機提交，沒有混入此次 dev 文件整合。

以下保留 2026-10-26 初次實作的歷史測試記錄，不作 FR01～FR06 已結案的依據：

| 問題 | 修改入口 | 測試證據與限制 |
|---|---|---|
| F0 快照／憑證 | [harness](../backend/tests/helpers/backendTestHarness.js)、[quarantine fixture](../backend/tests/youtube-quarantine.service.test.js) | backend 全套 1158／1158；fixture 補強後直接回歸 28／28。Date／ObjectId／Buffer、雙向隔離、主別名與 fetch 失敗還原均有案例 |
| R01、R02 | [實體檔辨識](../backend/src/utils/localVideoSource.js)、[共同清理判斷](../backend/src/services/localSourceCleanup.service.js) | [清理安全測試](../backend/tests/youtube-cleanup-safety.service.test.js)：跨集合／草稿／處理中引用、相對與絕對路徑、hard link、根外、Windows junction 與 Linux 容器 symlink；未讀 VM |
| R08、R09 | [清理排程](../backend/src/services/youtubeLifecycle.service.js)、[短片清理](../backend/src/services/shortAssetCleanup.service.js) | 同上測試與既有 lifecycle：逐檔讀空間、失敗後補選、刪檔前停用／設定失敗、保留期／補回重算、影片與短片 DB 收尾恢復；F1 全套 1171／1171，最後細修另跑相關 67／67 |
| R03 | [來源所有權](../backend/src/services/youtubeWorkOwnership.service.js)、[補回／既有重處理](../backend/src/services/video.service.js) | [F2 競態測試](../backend/tests/youtube-work-ownership.service.test.js)與[補回路由](../backend/tests/video-source-restore.routes.test.js)：同步取得輪次鎖、候選後路徑／時間／狀態／代數改變、真正補回後拒絕舊候選、最後設定等待中阻止審核／封存回復改草稿，另以真實 Mongo 驗證 |
| R04、R05 | [影片上傳](../backend/src/services/youtubeUpload.service.js)、[短片上傳](../backend/src/services/shortAssetPublish.service.js)、[短片恢復](../backend/src/services/shortAssetRecovery.service.js) | F2 競態：A／B 候選與教師重試交錯、unsafe／退避／上限、所有開始入口共用排他權、舊 attempt 拒絕回寫、DB 失敗不送 bytes、上傳後回寫失敗不再重傳、上傳中仍可審核且封存後不重新上架；YouTube 全為 mock |
| R06 | [隔離套用](../backend/src/services/youtubeQuarantine.service.js)、[共同備份檢查](../backend/src/services/youtubeWorkOwnership.service.js) | Video／Video 與 Video／ShortAsset 同 ID 競爭、驗證與回寫失敗釋放、歷史重複備份拒刪；採工單允許的單一 writer 限制，不是跨行程 DB 唯一性，詳見[實作約束](04_Features/YouTube_Lifecycle/decisions.md#f-工單的實作約束2026-10-26) |

2026-10-26 F2 整合：backend 全套 1199／1199、Windows 與 Linux 容器清理／所有權各 41／41、隔離 Mongo 14／14 通過（未載入記憶體 harness；明確 loopback URI、隨機 DB、成功與失敗移除 DB；另驗證 null／缺欄位初次上傳、略過上傳及重啟遺留 token 隔離）。測試只處理自建暫存檔，沒有連 Atlas、VM 或真實 YouTube；未執行 STT／FFmpeg、前端／瀏覽器及決策 #33 的正式驗收。

2026-10-27 F3／F4 修復（`fix/youtube-lifecycle-f3-f4`，基於 dev `b35c121`；未提交、未合併、未部署）：R07 已加入 completed 影片補回後的明確重新處理，沿用 F0～F2 原子來源所有權，保留 Video／YouTube ID、播放與保留期；R10～R12 已修正總覽有效開關、雙來源 7 天預告清單與並行 history。Backend **1208／1208**、隔離 Mongo **68／68**、Frontend **118／118**、真實元件瀏覽器（假 API）**8／8**，lint、build、OpenAPI lint、文件連結與 `git diff --check` 通過。未發現已知 P1／P2；程式與本機驗證達可提交候選標準，依既有 F 工單仍須獨立 diff 複驗後整合。本輪沒有驗證真實 STT／FFmpeg、YouTube、Atlas、VM 或正式清理，沒有實作 Q-A～Q-F；第三輪 #51～#64 與 Q-0／Q 工單完整保留。詳見[修復與驗證交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f3-f4-fixes.md)。

**多影片批次｜已實作。** [批次服務](../backend/src/services/videoBatchProcessing.service.js)與[批次入口](../STT_Whisper/src/batch_main.py)串接排程、重試及恢復；真實語音模型、向量產生與部署的完整流程未驗證。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生短影片瀏覽｜已實作。** [短影片頁](../frontend/focus-flow/src/pages/StudentShortsWall.jsx)串接[學生介面](../backend/src/routes/youtube.routes.js)。較新紀錄：[2026-09-29 後端整體回歸](../backend/docs/implementation-log.md)（原文為工作分支紀錄，非正式環境驗收）；直接相關的[縮圖測試](../backend/tests/shorts.routes.test.js)於 2026-09-27 加入（Git `d8360fc`，未記載單項執行結果）。最近播放驗收仍為 2026-08-13（限當時環境），未找到更新的播放驗收。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片腳本｜已實作；上架未驗證。** [腳本介面](../backend/src/routes/short-script.routes.js)串接選題、生成、成品上傳與審核；[發布服務](../backend/src/services/shortAssetPublish.service.js)處理 YouTube 上傳與審核後提供學生瀏覽。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片自動產片｜規劃中。** 新方向原型位於 [short_render/](../short_render/)（原片剪輯加程式動畫，不使用教授端生成模型），尚未接入前後端。依據：[指令入口](../short_render/bin/short-render.js)與 2026-10-15 團隊決定。最後驗證：2026-10-15；負責人：＿＿（待填）。

**分層檢索與向量發布｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。分層檢索是先找較大段落，再找可引用的小片段；[檢索服務](../backend/src/services/hierarchicalRetrieval.service.js)、[資料檢查](../backend/src/services/hierarchicalDataReadiness.service.js)與[發布入口](../STT_Whisper/src/publish_parent_embeddings.py)有對應程式，不據此判定可啟用。最後驗證：2026-10-15；負責人：＿＿（待填）。

**影像補充引用｜已實作；實際資料覆蓋未驗證。** [問答服務](../backend/src/services/qa.service.js)串接影像查詢與來源引用，但仍需另查課程影片是否有可用影像資料。最後驗證：2026-10-15；負責人：＿＿（待填）。

**教育開放資料推薦｜已實作。** [推薦服務](../backend/src/services/openDataExtension.service.js)與[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)以關鍵字推薦延伸影片。程式已隨 2026-10-22 部署上線，但正式站 `OPEN_DATA_EXTENSION_ENABLED` 未開、未匯入清單；真實清單匯入與推薦品質 ⚠️ 未驗證。最後驗證：2026-10-22；負責人：＿＿（待填）。

**資料庫交付工具｜已實作；真實資料還原未驗證。** [匯出與還原服務](../backend/src/services/databaseDeliverable.service.js)有對應程式；舊文的記憶體模擬測試不代表實際資料庫還原成功。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生試用與部署｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。[部署設定](../.github/workflows/deploy.yml)只能證明部署步驟存在；歷史開放試用不等於本次驗收，需補目前環境與驗收紀錄。2026-10-23 VM 資安更新完成：Rocky Linux 9.8、Node.js 22.23.4、nginx 安全修補與 ngrok 更新，重開機後 `/health`、nginx 代理與 LINE 問答實測正常；語音轉文字流程更新後未實測，見[檢查報告](10_Operations/deployment/2026-10-23_VM資安檢查報告.md)。最後驗證：2026-10-23；負責人：＿＿（待填）。

## 歷史查證索引（保留原日期，未重新驗證）

以下是舊文記載的結果，不作為上述模組的本次驗收證據；舊數字不再列為現況。

- 2026-05-23／07-10／07-24／08-02：資料庫數量、向量索引及欄位分布的歷史查詢；完整數字保留於下述 Git 版本。
- 2026-07-26：帳號、通知與頭貼的隔離測試；2026-08-02：YouTube 上傳與刪除後轉私人影片的外部測試，均為舊文紀錄。
- <a id="2026-08-13-多影片批次整合與隔離重啟驗收"></a>2026-08-13：短影片播放驗收；批次隔離測試為「兩支影片 → 一支完成、一支失敗，重啟後保留結果」，另一教師讀取回 403；2026-08-14：單項重試與前端批次契約補強。未涵蓋真實語音模型或部署。
- 2026-08-09／08-13：分層檢索的本機契約與資料檢查紀錄，未能證明目前共用資料庫可用；2026-08-30：[後端第一階段本機測試](04_Features/Student_Pilot_Backend/evidence/2026-08-30_phase1-implementation-results.md)，不等同正式驗收。
- 2026-08-24：[問答品質評測](04_Features/QA_Evaluation/reports/2026-08-24-評測結果.md)；2026-09-10：[憑證申請](10_Operations/deployment/2026-09-10_Lets_Encrypt憑證申請紀錄.md)；2026-09-21／09-23：[開放試用與外部檢查](10_Operations/deployment/2026-09_開放學生試用紀錄.md)。2026-09-24 使用量只代表當時樣本。
- 2026-09-29：舊文記載影像資料尚未綁定課程影片；2026-10-03：推薦功能僅本機實作；2026-10-07：資料庫交付工具僅模擬測試；2026-10-14：本機產片工具紀錄，未宣稱系統串接或部署。

完整舊文（含其餘測試日期、原始數字與會議紀錄）保留在 Git 版本 `9140f9ec58beff5cc21cb97486bc4864f6898eec`，不另建一份狀態文件。查閱例：在 repo 根目錄輸入 `git show 9140f9e:docs/current-status.md` → 顯示整理前原文；把路徑換成 `backend/docs/current-state.md` 可查後端舊文。歷史文字與目前程式有差異時，以程式及新查證為準。
