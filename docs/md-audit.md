# 文件盤點（2026-10-13 快照）

這份盤點用來找出過時或重複的文件，避免讀者把舊說明當成目前功能。請依下表分階段整理，功能進度以[目前狀態](current-status.md)為唯一正本，也就是只在這一份文件維護。依據為 `dev` 分支 `e0e749b` 的程式與文件；本次未執行功能測試，外部服務與正式環境一律 **⚠️ 未驗證**。

| 分類／階段 | 文件 | 處理方向與依據 |
|---|---|---|
| 先前已封存 | [程式碼理解筆記](90_Archive/learning-reports/backend-understanding-code-2026-05/README.md) | 保留筆記與圖檔；原 Git 更新為 2026/05/06，詳見封存說明。本次不再搬移。 |
| 封存／1 | [Short 前端交接](../backend/docs/handoff-shorts-frontend-done.md) | Short 是教學短影片；依據為[學生頁面](../frontend/focus-flow/src/pages/StudentShortsWall.jsx)的 `apiFetch`。原方案已移至 `docs/90_Archive/backend/handoff-shorts-frontend-plan.md`，現行引用改連完成交接。 |
| 更新／2 | [根 README](../README.md) | Node.js 18+ 不符合[套件鎖定檔](../frontend/focus-flow/package-lock.json)中的 Vite 8.0.5 要求：`^20.19.0` 或 `>=22.12.0`。 |
| 更新／2 | [Pipeline README](../STT_Whisper/README.md) | Pipeline 是把影片依序轉成逐字稿與向量的處理流程。「尚未實作 Resume／Retry」與[入口程式](../STT_Whisper/src/main.py)的接續執行參數矛盾；修正後保留操作說明。 |
| 更新／2 | [Frontend README](../frontend/focus-flow/README.md) | 舊單支影片追蹤說明需對齊[上傳頁面](../frontend/focus-flow/src/pages/TeacherUpload.jsx)的多檔批次、`batchId` 與重試操作。 |
| 更新／2 | [Backend 已知問題](../backend/docs/handoff-known-issues.md) | 「YouTube 自動上傳未實作」已不符[上傳服務](../backend/src/services/youtubeUpload.service.js)與[處理接線](../backend/src/services/videoProcessing.service.js)。將進度改連正本，保留適用的技術限制。 |
| 更新／2 | [Backend 文件索引](../backend/docs/README.md)、[技術現況](../backend/docs/current-state.md) | 舊方案的引用與「尚未修改前端」說明需改指完成交接；依據同 Short 前端項目。技術現況只留技術細節，進度連正本。 |
| 合併／2 | [目前狀態](current-status.md) | 新舊說法需合併，例如 Leaf（可引用的小片段）索引仍被描述為 snake_case（底線命名），但[索引程式](../database/tools/setup/init_indexes.js)已用 `videoId`／`chunkId`。各模組補驗證日期、依據與負責人；不沿用舊數字。 |
| 更新／2 | [功能總表](30_Features/README.md) | 進度改連正本。Adaptive GenUI（依問題調整回答介面的方案）文件在本 checkout 未找到，維持 **⚠️ 未驗證**，不加入功能總表。 |
| 準備／3 | [STT 整合交接](../backend/docs/handoff-stt-pipeline-integration.md) | STT 是語音轉文字。舊文仍把自動上傳列為未完成；依上述上傳服務與目前操作文件補整合入口，原檔標為「2026/05 交接快照」，先不搬移。 |
| 準備／3 | [Gate Review](20_Architecture/hierarchical-retrieval/Phase2-2_Hierarchical_Retrieval_Gate_Review.md) | Gate 是控制是否使用階層檢索的開關。「沒有指定範圍或背景比較模式」已不符[控制服務](../backend/src/services/hierarchicalRollout.service.js)。保留 2026/08/09 審查日期，整理仍適用的阻擋條件；不得寫 Gate 已可開啟。 |
| 準備／3 | [資料庫（DB）交接](../database/docs/db-handoff-current.txt) | 舊文的頭像檔名與課程或影片搜尋說明，不符[User](../backend/src/models/user.model.js)、[Avatar](../backend/src/models/avatar.model.js)及[搜尋範圍服務](../backend/src/services/bridgeScope.service.js)。不改數字、不搬移，改列 DB 負責人的實查清單。 |
| 排除：待確認 | [Short_Video](30_Features/Short_Video/README.md)、[系統手冊](00_Deliverables/System_Manual/README.md)、[繳交清單](00_Deliverables/Submission/README.md) | 模板是否使用、手冊哪份是現行母稿、是否已繳交皆 **⚠️ 未驗證**；本次不處理。 |
| 排除：保留 | [短腳本自動化](30_Features/Short_Script_Automation/README.md)、[學生試用](30_Features/Student_Pilot_Backend/README.md)、[QA 評測](30_Features/QA_Evaluation/README.md) | QA 是學生提問與系統回答。這些文件保留需求、驗收條件與證據；不由程式存在推定驗收完成，不整包封存。 |
| 排除：保留 | [Backend 待辦](../backend/docs/todo.md)、[實作紀錄](../backend/docs/implementation-log.md)、[會議](50_Meetings/README.md)、[歷史稽核](reports/2026-09-24_project-gap-audit.md) | 仍有待辦或具日期的歷史證據；本次不處理，不把歷史測試數字寫成目前結果。 |
| 規則檢查／4 | [文件維護 skill](../.agents/skills/docs-maintainer/SKILL.md) | skill 是代理執行工作時參考的操作規範。比對狀態正本、README 用途與新增 md 檔規則，只列衝突原文及修改建議，不修改 skill。 |

整理例子：舊 Short 方案與現行引用 → 封存原方案、改連完成交接 → 功能狀態只在 `current-status.md` 維護。階段 0 保存盤點、階段 1 整理 Short 方案；其他項目待後續階段，[AGENTS](../AGENTS.md)的文件規則於階段 4 處理。
