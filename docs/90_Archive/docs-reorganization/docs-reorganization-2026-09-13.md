# FocusFlow docs 重整完成報告

開始日期：2026-09-13；完成核對日期：2026-09-14（Asia/Taipei）。目標專案：`C:/Users/User/Documents/GitHub/focusflow`。

## 已完成

- 原 279 個檔案全部保留，277 個搬移，2 個維持根目錄。移除 56 個搬空後的舊目錄，沒有刪除文件。
- 新增 100 個檔案（含 56 張原稿圖片、2 份規範原件及 Markdown），docs 現有 379 個檔案。
- 18 組 SHA-256 完全相同的文件，保留主要版本，21 個額外副本移至 duplicates。
- 新增七節系統簡介、15 章手冊、圖表目錄、來源索引與 TODO；重用初評原稿，不將舊快照寫成目前驗收。
- 新增功能狀態總表，記錄規格、開發階段、證據層級、缺口與來源日期。
- 更新相關文件、評測與診斷腳本的固定路徑。未 commit／push，Git index 未變更。

## 最後審核採用的調整

沿用已確認的八個主分類。共用架構圖集中於 20_Architecture，手冊用連結引用；手冊 images 保留原 DOCX 內嵌圖像。source-documents 存本次引用原件，舊草稿與完全相同副本另歸檔。QA Evaluation 是持續性工作，不強迫寫成已完成產品功能。原始 JSON／CSV／題庫與二進位檔原樣保存，文件路徑與導航允許更新；過期、Proposed、待驗收等原有狀態不因搬移改變。

依 docs-maintainer 的單一文件責任與最小修改原則執行。二技／五專範例只保留為外部歷史資料；此次手冊依四技部適用的大學部物件導向規範。

## 驗證結果

| 項目 | 結果 |
|---|---|
| 原始檔案完整性 | 279／279 可追溯；252 份內容未變，27 份只有路徑／導覽調整 |
| 原始證據與原件 | 160 份受保護原始資料／二進位／副本檢查全部通過，實際逐份檢查而非抽樣 |
| 本地 Markdown／圖片目標 | 648 個受檢連結目標全部可解析；不含 duplicates 中保留原樣的連結，未驗證外部網站及段落錨點 |
| 評測／診斷靜態路徑 | 7 項通過；3 份腳本 node --check 通過，未呼叫實際問答／Atlas |
| 交付 Markdown | 23 份文件的 fence 結構與 60 個表格的欄數一致性檢查通過；未作最終 Word／PDF 視覺驗收 |
| Backend | SMTP 隔離後 811／811 通過（94 suites）；原始環境 810／811，詳下述限制 |
| Frontend tests | 57／57 通過 |
| Frontend lint | 通過 |
| Frontend build | 通過；保留 bundle >500 kB 警告 |
| git diff --check | 已追蹤檔案的差異檢查通過；新增交付文件另作上述 Markdown 結構檢查 |

後端回歸說明：原始 npm test 與後續 JUnit 定位兩輪皆為 810／811，唯一失敗是既有 password-reset.routes.test.js 的「未設定寄信帳號時回 503 PASSWORD_RESET_UNAVAILABLE」案例，實際回 200。該案例清除 transport mock 後，寄信服務仍會讀取本機 SMTP 設定；相關測試、mailer 與 env 載入邏輯未由本次修改。前兩輪可能觸發實際 SMTP 寄信流程，未確認信件是否送達。最後一輪以工作目錄內的 Node preload，在測試程序啟動時將 SMTP_USER、SMTP_PASS、MAIL_FROM 設為空值，再執行原本 node --test --experimental-test-isolation=none --test-concurrency=1；811／811 通過，0 skipped，191.47 秒。未修改專案 .env 或測試原碼。建議另案修正測試 harness 的 SMTP 隔離，避免開發機設定影響測試或造成寄信副作用；本次不擴大修改業務／測試邏輯。

本次為文件重整與本機驗證，未進行 VM／Atlas／Gemini／LINE／YouTube 正式驗收。既有功能證據日期保留，未以本輪回歸結果取代專案正式 Gate。

## 各章資料來源與尚缺內容

| 章節 | 已有內容與來源 | 待補／核對 |
|---|---|---|
| [01 前言](../00_Deliverables/System_Manual/chapters/01_前言.md) | 原稿第1章：背景、動機、目的、預期成果 | 市場與競品數據重新查證、實際使用研究 |
| [02 營運計畫](../00_Deliverables/System_Manual/chapters/02_營運計畫.md) | 原稿第2章：可行性、商業模式、STP、SWOT／TOWS | 成本、CSR／營運決議與效益證據 |
| [03 系統規格](../00_Deliverables/System_Manual/chapters/03_系統規格.md) | 原稿第3章＋[ARCHITECTURE](../../ARCHITECTURE.md) | 最新軟硬體、CASE／UML 工具及相容性實測 |
| [04 時程與分工](../00_Deliverables/System_Manual/chapters/04_專案時程與組織分工.md) | 原稿第4章、[會議](../50_Meetings/README.md)、[歷史圖表](../20_Architecture/system-diagrams) | 兩學期時程、中文姓名／學號 GitHub 紀錄、貢獻度確認 |
| [05 需求模型](../00_Deliverables/System_Manual/chapters/05_需求模型.md) | 原稿第5章＋[學生試用規格](../30_Features/Student_Pilot_Backend/specs/2026-09_Student_Pilot_Backend_Spec.md) | 功能／非功能需求、Use Case／Activity／Analysis Class 對齊 |
| [06 設計模型](../00_Deliverables/System_Manual/chapters/06_設計模型.md) | 原稿第6章＋[架構設計](../../ARCHITECTURE.md) | 新版循序／通訊、設計類別／物件圖 |
| [07 實作模型](../00_Deliverables/System_Manual/chapters/07_實作模型.md) | 原稿第7章＋[部署](../40_Operations/deployment) | 佈署、套件、元件、狀態機與現行實作對齊 |
| [08 資料庫設計](../00_Deliverables/System_Manual/chapters/08_資料庫設計.md) | 原稿第8章＋[資料庫入口](../20_Architecture/database/README.md) | 最新欄位、Meta data、關係／限制及 indexes |
| [09 程式](../00_Deliverables/System_Manual/chapters/09_程式.md) | 原稿缺本章；依目前程式入口、OpenAPI 與架構補摘要 | 精選程式片段、規格及依賴版本 |
| [10 測試模型](../00_Deliverables/System_Manual/chapters/10_測試模型.md) | 原稿缺本章；[QA 評測](../30_Features/QA_Evaluation/README.md)及各功能 evidence | 需求—案例對照、正式 final、簽核與重測 |
| [11 操作手冊](../00_Deliverables/System_Manual/chapters/11_操作手冊.md) | 原稿缺本章；[啟動說明](../../README.md)、[維運](../40_Operations/README.md) | 安裝／還原實測、告警與責任人 |
| [12 使用手冊](../00_Deliverables/System_Manual/chapters/12_使用手冊.md) | 原稿第12章及 [第12章使用畫面](../00_Deliverables/System_Manual/source-documents/FocusFlow_第12章使用畫面.docx) | 新版角色畫面、畫面移轉與錯誤操作 |
| [13 感想](../00_Deliverables/System_Manual/chapters/13_感想.md) | 原稿缺本章；保留組員本人 TODO | 本人經驗、反思與團隊建議 |
| [14 參考資料](../00_Deliverables/System_Manual/chapters/14_參考資料.md) | 原稿第14章；本次 AI 使用揭露見手冊索引 | 網址、作者／日期、引用序號核對 |
| [15 附錄](../00_Deliverables/System_Manual/chapters/15_附錄.md) | 原稿附錄：會議、問卷、發表、評審意見 | 初／複評逐項修正與證據回覆 |


系統簡介來源：[來源對照表](../00_Deliverables/System_Overview/README.md)。兩份規範使用本機 `Documents/學校/畢業專題/專題公告` 的同名原件；舊 DOC 在工作目錄轉成 DOCX 供讀取，保存到專案的是原 .doc。

## 建議人工補充順序

1. 確認四技部最新交件公告；封面／組員資料、兩頁簡介與複評 50 頁要求，以及圖片形式的版面設定。
2. 更新需求編號、UML、資料庫欄位與索引、實作模型；檢查原稿合併表格與圖表重號。
3. 補兩學期完整甘特圖、分工、具中文姓名與學號的 GitHub 紀錄、總計 100% 的貢獻度。
4. 補第9章精選程式、第10章需求—測試矩陣與正式驗收證據、第11章安裝／還原實測。
5. 換新版角色操作截圖，補畫面移轉及錯誤情境；由組員本人撰寫感想。
6. 核對參考資料、市場與競品資料、AI 工具使用揭露、初評／複評意見逐條修正。
7. 向老師確認 MongoDB 對應的資料庫交付格式、UML VPP／VPD 與安裝包；本次不產生空白 MDF／LDF。

## 完整新目錄樹

```text
docs/  # FocusFlow 文件庫
├─ 00_Deliverables/  # 四技部正式交付、競賽與 ESG 投稿
│  ├─ Contest/
│  │  ├─ 115年_專題成果參與校外競賽暨投稿研討會認列申請表.docx
│  │  ├─ 2026全國大專校院智慧創新暨跨域整合創作競賽系統需求書.docx
│  │  └─ 2026年全國大專校院智慧創新暨跨域整合創作競賽企劃書.docx
│  ├─ ESG/
│  │  ├─ 2026ESG_V2.docx
│  │  ├─ 2026永續發展管理研討會論文全文投稿格式_1150311.docx
│  │  ├─ 2026永續研討會_論文初稿.docx
│  │  ├─ 2026永續研討會_論文初稿V4.docx
│  │  ├─ WASN2022.docx
│  │  ├─ Zty_畢業專題-ESG投稿.7z
│  │  ├─ 教學影片 AI 問答系統.pdf
│  │  ├─ 教學影片 AI 問答系統.pptx
│  │  └─ 教學影片 AI 問答系統V2_初評最終版.pptx
│  ├─ System_Manual/  # 四技部物件導向手冊，15 章
│  │  ├─ chapters/  # 每章獨立 Markdown
│  │  │  ├─ 01_前言.md
│  │  │  ├─ 02_營運計畫.md
│  │  │  ├─ 03_系統規格.md
│  │  │  ├─ 04_專案時程與組織分工.md
│  │  │  ├─ 05_需求模型.md
│  │  │  ├─ 06_設計模型.md
│  │  │  ├─ 07_實作模型.md
│  │  │  ├─ 08_資料庫設計.md
│  │  │  ├─ 09_程式.md
│  │  │  ├─ 10_測試模型.md
│  │  │  ├─ 11_操作手冊.md
│  │  │  ├─ 12_使用手冊.md
│  │  │  ├─ 13_感想.md
│  │  │  ├─ 14_參考資料.md
│  │  │  └─ 15_附錄.md
│  │  ├─ images/  # 原稿圖像／手冊專用畫面
│  │  │  ├─ initial-review-image10.png
│  │  │  ├─ initial-review-image11.jpg
│  │  │  ├─ initial-review-image12.png
│  │  │  ├─ initial-review-image13.png
│  │  │  ├─ initial-review-image14.png
│  │  │  ├─ initial-review-image15.png
│  │  │  ├─ initial-review-image16.png
│  │  │  ├─ initial-review-image17.png
│  │  │  ├─ initial-review-image18.png
│  │  │  ├─ initial-review-image19.png
│  │  │  ├─ initial-review-image2.png
│  │  │  ├─ initial-review-image20.png
│  │  │  ├─ initial-review-image21.png
│  │  │  ├─ initial-review-image22.png
│  │  │  ├─ initial-review-image23.png
│  │  │  ├─ initial-review-image24.png
│  │  │  ├─ initial-review-image25.png
│  │  │  ├─ initial-review-image26.png
│  │  │  ├─ initial-review-image27.png
│  │  │  ├─ initial-review-image28.png
│  │  │  ├─ initial-review-image29.png
│  │  │  ├─ initial-review-image3.png
│  │  │  ├─ initial-review-image30.png
│  │  │  ├─ initial-review-image31.png
│  │  │  ├─ initial-review-image32.png
│  │  │  ├─ initial-review-image33.png
│  │  │  ├─ initial-review-image34.png
│  │  │  ├─ initial-review-image35.png
│  │  │  ├─ initial-review-image36.png
│  │  │  ├─ initial-review-image37.png
│  │  │  ├─ initial-review-image38.png
│  │  │  ├─ initial-review-image39.png
│  │  │  ├─ initial-review-image4.png
│  │  │  ├─ initial-review-image40.png
│  │  │  ├─ initial-review-image41.png
│  │  │  ├─ initial-review-image42.png
│  │  │  ├─ initial-review-image43.png
│  │  │  ├─ initial-review-image44.png
│  │  │  ├─ initial-review-image45.png
│  │  │  ├─ initial-review-image46.png
│  │  │  ├─ initial-review-image47.png
│  │  │  ├─ initial-review-image48.png
│  │  │  ├─ initial-review-image49.png
│  │  │  ├─ initial-review-image5.png
│  │  │  ├─ initial-review-image50.png
│  │  │  ├─ initial-review-image51.png
│  │  │  ├─ initial-review-image52.png
│  │  │  ├─ initial-review-image53.png
│  │  │  ├─ initial-review-image54.png
│  │  │  ├─ initial-review-image55.png
│  │  │  ├─ initial-review-image56.png
│  │  │  ├─ initial-review-image58.jpg
│  │  │  ├─ initial-review-image6.emf
│  │  │  ├─ initial-review-image7.png
│  │  │  ├─ initial-review-image8.png
│  │  │  └─ initial-review-image9.png
│  │  ├─ source-documents/  # 校方規範及既有原件
│  │  │  ├─ 115年_系統手冊規範.doc
│  │  │  ├─ FocusFlow_第12章使用畫面.docx
│  │  │  ├─ README.md  # 總索引與文件責任
│  │  │  ├─ 四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf
│  │  │  └─ 專題手冊_初評最終版.docx
│  │  ├─ README.md  # 總索引與文件責任
│  │  └─ 圖表目錄.md
│  ├─ System_Overview/  # 七節系統簡介
│  │  ├─ images/  # 原稿圖像／手冊專用畫面
│  │  │  └─ README.md  # 總索引與文件責任
│  │  ├─ source-documents/  # 校方規範及既有原件
│  │  │  ├─ 115年_系統簡介規範.docx
│  │  │  ├─ README.md  # 總索引與文件責任
│  │  │  ├─ 四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx
│  │  │  └─ 四技第115413組-FocusFlow AI-系統簡介_初評最終版.pdf
│  │  ├─ FocusFlow_系統簡介.md
│  │  └─ README.md  # 總索引與文件責任
│  └─ README.md  # 總索引與文件責任
├─ 10_Project_History/  # 有日期的專案快照與本次搬移紀錄
│  ├─ snapshots/
│  │  └─ project-progress-summary-2026-07-31.md
│  ├─ docs-reorganization-2026-09-13.md
│  └─ README.md  # 總索引與文件責任
├─ 20_Architecture/  # 架構圖、資料庫與階層檢索契約
│  ├─ database/
│  │  ├─ archive/  # 被新版取代的歷史版本
│  │  │  └─ MongoDB_契約定版_v1_已過期.md
│  │  └─ README.md  # 總索引與文件責任
│  ├─ hierarchical-retrieval/
│  │  ├─ Phase2-2_Hierarchical_Retrieval_Gate_Review.md
│  │  ├─ Phase2-2_Hierarchy_Data_Contract_v1.md
│  │  ├─ Phase2-2_Limited_Hierarchical_Rollout_Plan.md
│  │  ├─ Phase2-2_Limited_Rollout_Control_Implementation.md
│  │  ├─ Phase2-2_Step10_E2E_Test_Plan.md
│  │  ├─ Phase2-2_Step9_Leaf_chunkId_Index_Report.md
│  │  └─ README.md  # 總索引與文件責任
│  ├─ system-diagrams/
│  │  ├─ legacy/
│  │  │  ├─ architecture/
│  │  │  │  ├─ AI學習系統架構圖 .html
│  │  │  │  ├─ mongodb_schema_design_0331.svg
│  │  │  │  ├─ role_flow_diagram.svg
│  │  │  │  └─ system_architecture_by_role.svg
│  │  │  ├─ manual/
│  │  │  │  ├─ Archive/
│  │  │  │  │  └─ 甘特圖.xlsx
│  │  │  │  └─ 初評文件資料/
│  │  │  │     └─ Archive/
│  │  │  │        └─ 甘特圖/
│  │  │  │           └─ 四週分工甘特.html
│  │  │  └─ overview/
│  │  │     ├─ AI學習系統架構圖.html
│  │  │     ├─ FocusFlow_SystemArch_v1.png
│  │  │     ├─ MongoDB 六大集合設計.svg
│  │  │     ├─ mongodb-erd-2026-05-03.png
│  │  │     ├─ Reward_Flow_v1.png
│  │  │     ├─ 三種角色的操作流程.svg
│  │  │     ├─ 整體系統架構(以角色分層).svg
│  │  │     └─ 系統架構圖(claude).html
│  │  ├─ README.md  # 總索引與文件責任
│  │  ├─ 系統架構圖文件用_v1_0508.png
│  │  ├─ 系統架構圖文件用_v2_0519.png
│  │  ├─ 系統架構圖詳細版_v1_0508.png
│  │  ├─ 系統架構圖詳細版_v1.2_0508.png
│  │  └─ 系統架構圖詳細版_v2_0519.png
│  └─ README.md  # 總索引與文件責任
├─ 30_Features/  # 功能規劃至完成的文件；README 為狀態總表
│  ├─ QA_Evaluation/
│  │  ├─ archive/  # 被新版取代的歷史版本
│  │  │  └─ README.md  # 總索引與文件責任
│  │  ├─ datasets/  # 題庫與評分輸入
│  │  │  ├─ FocusFlow_QA評測_AI入門基礎課_v1.xlsx
│  │  │  └─ question-bank.json
│  │  ├─ reports/  # 人工整理評測報告
│  │  │  ├─ 2026-08-24-評測結果.md
│  │  │  └─ 2026-09-03-第二輪評測結果.md
│  │  ├─ runs/  # 各次評測原始結果
│  │  │  ├─ 2026-08-24T12-55-33-516Z/
│  │  │  │  ├─ results.csv
│  │  │  │  └─ results.json
│  │  │  ├─ 2026-08-24T13-00-40-654Z/
│  │  │  │  ├─ results.csv
│  │  │  │  └─ results.json
│  │  │  └─ 2026-09-03T10-20-49-416Z/
│  │  │     ├─ results.csv
│  │  │     └─ results.json
│  │  └─ README.md  # 總索引與文件責任
│  ├─ Short_Script_Automation/
│  │  ├─ archive/  # 被新版取代的歷史版本
│  │  │  └─ README.md  # 總索引與文件責任
│  │  ├─ evidence/  # 具日期的原始驗收證據
│  │  │  ├─ 2026-09-04_p01-threshold-calibration.md
│  │  │  ├─ 2026-09-04_real-llm-generation-trial.md
│  │  │  ├─ 2026-09-04_sample2-ai-course.md
│  │  │  ├─ 2026-09-04_sp1-acceptance.md
│  │  │  └─ 2026-09-04_sp2-acceptance.md
│  │  ├─ specs/  # 功能規格
│  │  │  └─ 2026-09_Short_Script_Automation_Spec.md
│  │  ├─ work-orders/  # 施工單
│  │  │  └─ 2026-09-03_short-script-automation-work-order_v0.1-draft.md
│  │  └─ README.md  # 總索引與文件責任
│  ├─ Short_Video/
│  │  ├─ archive/  # 被新版取代的歷史版本
│  │  │  └─ README.md  # 總索引與文件責任
│  │  ├─ evidence/  # 具日期的原始驗收證據
│  │  │  └─ README.md  # 總索引與文件責任
│  │  ├─ examples/
│  │  │  ├─ teacher-avatar-track/
│  │  │  │  ├─ 4ish_腳本V4_大語言模型是什麼.md
│  │  │  │  └─ 4ish_腳本V5_OpenCV與YOLO的差異.md
│  │  │  ├─ 01-ai-ambient-cards.md
│  │  │  ├─ 02-teacher-piece-to-camera.md
│  │  │  ├─ 03-seamless-loop.md
│  │  │  ├─ 04-question-and-answer.md
│  │  │  ├─ 05-handwriting-whiteboard.md
│  │  │  ├─ 06-lecture-recut.md
│  │  │  ├─ 07-wrong-vs-right.md
│  │  │  ├─ 08-object-demo.md
│  │  │  ├─ 09-three-points-kinetic.md
│  │  │  ├─ 10-teacher-avatar-metaphor.md
│  │  │  └─ README.md  # 總索引與文件責任
│  │  ├─ specs/  # 功能規格
│  │  │  ├─ Phase2_Short_Video_Production_Spec_v1.md
│  │  │  ├─ Short_Video_Key_Points_v1.md
│  │  │  ├─ Short_Video_Script_Example_v1.md
│  │  │  ├─ Short_Video_Teacher_Token_Script_v1.md
│  │  │  └─ Short_Video_Test_Script_v1.md
│  │  └─ README.md  # 總索引與文件責任
│  ├─ Student_Pilot_Backend/
│  │  ├─ archive/  # 被新版取代的歷史版本
│  │  │  └─ README.md  # 總索引與文件責任
│  │  ├─ evidence/  # 具日期的原始驗收證據
│  │  │  ├─ 2026-08-30_phase1-implementation-results.md
│  │  │  ├─ 2026-09-01_baseline_flag-snapshot.json
│  │  │  ├─ 2026-09-01_baseline_manual-review.md
│  │  │  ├─ 2026-09-01_baseline_questions.json
│  │  │  ├─ 2026-09-01_baseline_questions.md
│  │  │  ├─ 2026-09-01_baseline_raw-results.json
│  │  │  ├─ 2026-09-01_wo13-enrollment-revoke-after.json
│  │  │  ├─ 2026-09-01_wo13-enrollment-revoke-before.json
│  │  │  ├─ 2026-09-04_phase3-freeze-regression_questions.json
│  │  │  ├─ 2026-09-04_phase3-freeze-regression_questions.md
│  │  │  ├─ 2026-09-08_g2-atlas-contract-inventory.json
│  │  │  ├─ 2026-09-08_wo26-conversation-turn-distribution.json
│  │  │  ├─ 2026-09-09_g8-public-smoke.json
│  │  │  ├─ 2026-09-09_student-poc-localhost-e2e.json
│  │  │  ├─ 2026-09-09_wo15-local-regression.json
│  │  │  └─ evidence_README.md
│  │  ├─ specs/  # 功能規格
│  │  │  └─ 2026-09_Student_Pilot_Backend_Spec.md
│  │  ├─ work-orders/  # 施工單
│  │  │  ├─ 2026-08-27_spec-v1.0-work-order.md
│  │  │  └─ work-order_README.md
│  │  └─ README.md  # 總索引與文件責任
│  └─ README.md  # 總索引與文件責任
├─ 40_Operations/  # 開發、工具設定、部署及維運
│  ├─ deployment/
│  │  └─ 2026-09-10_Lets_Encrypt憑證申請紀錄.md
│  ├─ ai-code-understanding-guide.md
│  ├─ MCP_SETUP.md
│  └─ README.md  # 總索引與文件責任
├─ 50_Meetings/  # 教授與組內會議
│  ├─ 教授會議/
│  │  ├─ 01_2026-01-22_教授會議_讀書彙報(寒假_1th).md
│  │  ├─ 02_2026-01-27_教授會議_讀書彙報(寒假_2th).md
│  │  ├─ 03_2026-02-03_教授會議_讀書彙報(寒假_3th).md
│  │  ├─ 04_2026-02-10_教授會議_讀書彙報(寒假_4th).md
│  │  ├─ 05_2026-02-24_教授會議_讀書彙報(過年後_1th).md
│  │  ├─ 06_2026-03-03_教授會議_開學後_1th.md
│  │  ├─ 07_2026-03-10_教授會議_確定題目_2th.md
│  │  ├─ 08_2026-03-24_教授會議_AI協作流程討論.md
│  │  ├─ 09_2026-03-31_教授會議_數位學習證明與MVP規劃.md
│  │  ├─ 10_2026-04-07_教授會議_系統實作進度匯報與技術架構優化.md
│  │  ├─ 11_2026-04-21_教授會議_Phase1進度匯報與展示規劃.md
│  │  ├─ 12_2026-05-05_教授會議_計畫書優化與架構圖討論.md
│  │  ├─ 13_2026-05-12_教授會議_計畫書各章節修訂.md
│  │  ├─ 14_2026-05-19_教授會議_簡報架構與競賽規劃.md
│  │  ├─ 15_2026-06-02_教授會議_進度匯報.md
│  │  ├─ 16_2026-06-09_教授會議_第一階簡報練習.md
│  │  ├─ 17_2026-06-16_教授會議_初評檢討.md
│  │  ├─ 18_2026-07-07_教授會議_Phase2規劃與上線部署討論.md
│  │  ├─ 19_2026-07-14_教授會議_營運效益分析與各組進度報告.md
│  │  ├─ 20_2026-07-28_教授會議_各組進度報告與競賽組別討論.md
│  │  ├─ 21_2026-08-04_教授會議_多層檢索進度與短影片生成方向調整.md
│  │  ├─ 22_2026-08-11_教授會議_QA評測策略與短影片生成規劃.md
│  │  └─ 23_2026-08-18_教授會議_系統上線與短影片審核規劃.md
│  ├─ 組內會議/
│  │  ├─ 01_2025-07-13_組內會議_專題方向決策.md
│  │  ├─ 02_2025-09-11_組內會議_專題主題討論.md
│  │  ├─ 03_2025-09-25_組內會議_專題方向腦力激盪.md
│  │  ├─ 04_2026-01-22_組內會議_寒假規劃1.md
│  │  ├─ 05_2026-02-01_組內會議_寒假規劃2.md
│  │  ├─ 06_2026-03-07_組內會議_討論專題題目(衣服與短影音).md
│  │  ├─ 07_2026-03-11_組內會議_AI專案與ESG投稿初版討論.md
│  │  ├─ 08_2026-03-24_組內會議_寵物模組提案.md
│  │  ├─ 09_2026-03-24_組內會議_專題方向討論.md
│  │  ├─ 10_2026-03-24_組內會議_Codex使用報告.md
│  │  ├─ 11_2026-03-31_組內會議_系統架構與開發分工.md
│  │  ├─ 12_2026-04-05_組內會議_LineBot與後端討論.md
│  │  ├─ 13_2026-04-05_組內會議_0405進度討論.md
│  │  ├─ 14_2026-04-28_組內會議_0428進度討論.md
│  │  └─ 15_2026-07-21_組內會議_任務分工與通知功能規劃.md
│  ├─ 00_2026-XX-XX_會議類型_簡短主題.md
│  └─ README.md  # 總索引與文件責任
├─ 60_Brand/  # Logo 與視覺素材
│  ├─ logo/
│  │  ├─ svg/
│  │  │  ├─ lockup-color.svg
│  │  │  ├─ lockup-white.svg
│  │  │  ├─ mark-amber-mono.svg
│  │  │  ├─ mark-color.svg
│  │  │  ├─ mark-ink-mono.svg
│  │  │  ├─ mark-teal-mono.svg
│  │  │  ├─ mark-white-mono.svg
│  │  │  ├─ mark-white.svg
│  │  │  ├─ wordmark-color.svg
│  │  │  └─ wordmark-white.svg
│  │  ├─ Focus_Flow_Logos.pptx
│  │  ├─ index.html
│  │  ├─ lockup-color.png
│  │  ├─ lockup-ink-mono.png
│  │  ├─ lockup-teal-mono.png
│  │  ├─ lockup-white.png
│  │  ├─ mark-amber-mono.png
│  │  ├─ mark-color.png
│  │  ├─ mark-ink-mono.png
│  │  ├─ mark-teal-mono.png
│  │  ├─ mark-white-mono.png
│  │  ├─ mark-white.png
│  │  ├─ wordmark-color.png
│  │  ├─ wordmark-ink-mono.png
│  │  ├─ wordmark-teal-mono.png
│  │  └─ wordmark-white.png
│  └─ README.md  # 總索引與文件責任
├─ 90_Archive/  # 歷史資料及未刪除的完全相同副本
│  ├─ chat-history/
│  │  ├─ doc/
│  │  │  └─ Game of Learning Systems_0324.docx
│  │  ├─ Json/
│  │  │  ├─ focusflow_youtube_stt_debug_record_2026-05-06.json
│  │  │  └─ 一鍵導入歷史紀錄.json
│  │  └─ pdf/
│  │     ├─ Gemini Multimodal Embedding.pdf
│  │     ├─ STT_correction_process.pdf
│  │     ├─ turning_points.pdf
│  │     └─ 四周甘特圖_0331.html
│  ├─ duplicates/  # 21 個額外副本；原內容保留
│  │  ├─ 00_System_Manual/
│  │  │  └─ 初評文件資料/
│  │  │     ├─ Archive/
│  │  │     │  ├─ 作業流程圖/
│  │  │     │  │  └─ 三種角色的操作流程.svg
│  │  │     │  ├─ 專題系統架構圖/
│  │  │     │  │  ├─ AI學習系統架構圖.html
│  │  │     │  │  ├─ FocusFlow_SystemArch_v1.png
│  │  │     │  │  ├─ 整體系統架構(以角色分層).svg
│  │  │     │  │  └─ 系統架構圖(claude).html
│  │  │     │  └─ 資料庫規劃/
│  │  │     │     ├─ MongoDB 六大集合設計.svg
│  │  │     │     └─ mongodb-erd-2026-05-03.png
│  │  │     ├─ docx/
│  │  │     │  ├─ 系統手冊/
│  │  │     │  │  ├─ 專題手冊_草稿.docx
│  │  │     │  │  ├─ 專題手冊_草稿v3.docx
│  │  │     │  │  ├─ 專題手冊_草稿v4.docx
│  │  │     │  │  └─ 專題手冊_草稿v5.docx
│  │  │     │  └─ 系統簡介/
│  │  │     │     ├─ 四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx
│  │  │     │     └─ 專題簡介_草稿.docx
│  │  │     ├─ pdf/
│  │  │     │  ├─ 四技第115413組-FocusFlow AI-系統手冊_v1.pdf
│  │  │     │  └─ 四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf
│  │  │     └─ 參考專題文件/
│  │  │        ├─ 專題推薦參考文件/
│  │  │        │  ├─ 四技 第114406組-IS Capt. AI智慧資安管理平台-系統手冊.pdf
│  │  │        │  └─ 四技第114414組-動起來「揪」對了-系統手冊 .pdf
│  │  │        └─ 四技第114414組-動起來揪對了-系統手冊範例.pdf
│  │  ├─ 02_System_Architecture_Diagram/
│  │  │  └─ Archive/
│  │  │     └─ System_Arch_v2.html
│  │  ├─ README.md  # 總索引與文件責任
│  │  ├─ Short_Video_Teacher_Token_Script_v1.md
│  │  └─ Short_Video_Test_Script_v1.md
│  ├─ external-examples/
│  │  ├─ 114_二技四技_專題手冊參考資料/
│  │  │  ├─ 二技114參考文件/
│  │  │  │  ├─ 二技第 114201 組-DreamEcho AI-系統手冊.pdf
│  │  │  │  ├─ 二技第114202組-HopOn Taipei App-系統手冊.pdf
│  │  │  │  ├─ 二技第114203組-課程助理-系統手冊.pdf
│  │  │  │  ├─ 二技第114204組-Gaia Bloom-系統手冊.pdf
│  │  │  │  ├─ 二技第114205組-味你而煮-系統手冊.pdf
│  │  │  │  ├─ 二技第114206組-InterviewerAI-系統手冊.pdf
│  │  │  │  ├─ 二技第114207組-日記之森-系統手冊.pdf
│  │  │  │  └─ 二技第114208組-RMS車輛管理系統-系統手冊.pdf
│  │  │  └─ 四技114參考文件/
│  │  │     ├─ 四技 第114406組-IS Capt. AI智慧資安管理平台-系統手冊.pdf
│  │  │     ├─ 四技第114401組-PingPro桌訓系統-系統手冊.pdf
│  │  │     ├─ 四技第114402組-AI底家-系統手冊.pdf
│  │  │     ├─ 四技第114403 組-欸！愛多益-系統手冊.pdf
│  │  │     ├─ 四技第114404組-PawDay-系統手冊.pdf
│  │  │     ├─ 四技第114405組-AI幣市通-系統手冊.pdf
│  │  │     ├─ 四技第114407組-MEI食不打烊-系統手冊.pdf
│  │  │     ├─ 四技第114408組-E筆勾銷-系統手冊.pdf
│  │  │     ├─ 四技第114409組-會議寶-系統手冊.pdf
│  │  │     ├─ 四技第114410組-Dr.W 傷口管家-系統手冊.pdf
│  │  │     ├─ 四技第114411組-SignNest手語小窩-系統手冊.pdf
│  │  │     ├─ 四技第114412組-智慧餐廳推薦系統-系統手冊.pdf
│  │  │     ├─ 四技第114413組-鯨落whalefall-系統手冊.pdf
│  │  │     └─ 四技第114414組-動起來「揪」對了-系統手冊 .pdf
│  │  ├─ 專題推薦參考文件/
│  │  │  ├─ 114年_系統手冊_大學範例_智慧社區圖書共享與管理平台.doc
│  │  │  ├─ 二技第 113207 組-Nice巴底-系統手冊.pdf
│  │  │  ├─ 五專第113505組-遊然自得-系統手冊.pdf
│  │  │  ├─ 五專第113506組-SilverEase-系統手冊.pdf
│  │  │  ├─ 五專第114502組-怪怪走開，護您安全-系統手冊 - 最終版.pdf
│  │  │  ├─ 五專第114510組-智能校事專家-系統手冊.pdf
│  │  │  └─ 四技第113402組-租中自有黃金屋-系統手冊.pdf
│  │  ├─ 鄭喬尹/
│  │  │  ├─ 另一組簡略架構圖-1.jpg
│  │  │  ├─ 另一組簡略架構圖-2.jpg
│  │  │  ├─ 另一組詳細架構圖-1.jpg
│  │  │  └─ 另一組詳細架構圖-2.jpg
│  │  ├─ 五專第110503組-TeleBerry-系統手冊.pdf
│  │  ├─ 四技第113402組-租中自有黃金屋-簡報-2.pdf
│  │  └─ 四技第115414組-救「舊」我的書-系統手冊.pdf
│  ├─ frontend-progress/
│  │  ├─ 0407前端進度.pdf
│  │  ├─ 0411前端進度.pdf
│  │  ├─ 0413前端進度整理.pdf
│  │  └─ 0423前端進度.pdf
│  ├─ learning-reports/
│  │  ├─ Week1/
│  │  │  ├─ 4ISH_KerasReports_Week1.pdf
│  │  │  ├─ 940_KerasReports_Week1.pdf
│  │  │  ├─ Hao_KerasReports_Week1.pdf
│  │  │  └─ Zty_KerasReports_Week1.pdf
│  │  ├─ Week2/
│  │  │  ├─ 4ISH_KerasReports_Week2.pdf
│  │  │  ├─ 940_KerasReports_Week2.pdf
│  │  │  ├─ Hao_KerasReports_Week2.pdf
│  │  │  └─ zty_專題學習進度檢核報告Week3 (1).pdf
│  │  ├─ Week3/
│  │  │  ├─ 4ISH_KerasReports_Week3.pdf
│  │  │  ├─ 940_KerasReports_Week3.pdf
│  │  │  ├─ Hao_KerasReports_Week3.pdf
│  │  │  └─ zty_專題學習進度檢核報告Week3 (2).pdf
│  │  ├─ 文件檔/
│  │  │  ├─ 【Zty】0129第三次Meeting-文字資料的深度學習 (10).md
│  │  │  ├─ 【Zty】0129第三次Meeting-文字資料的深度學習 (11).md
│  │  │  ├─ 【Zty】0129第三次Meeting-文字資料的深度學習 (6).md
│  │  │  ├─ 【Zty】0129第三次Meeting-文字資料的深度學習 (7).md
│  │  │  ├─ 【Zty】0129第三次Meeting-文字資料的深度學習 (8).md
│  │  │  ├─ 【Zty】0129第三次Meeting-文字資料的深度學習 (9).md
│  │  │  ├─ 940_深度學習4-3(迴歸).pdf
│  │  │  └─ 940_深度學習9.pdf
│  │  └─ 程式檔/
│  │     ├─ 【zty】電影評論-實作 (1).ipynb
│  │     ├─ 【zty】電影評論-實作 (2).ipynb
│  │     ├─ 【zty】電影評論-實作 (3).ipynb
│  │     ├─ 【zty】電影評論-實作 (4).ipynb
│  │     ├─ 【zty】電影評論-實作 (5).ipynb
│  │     ├─ 940_2_CNN分類IMDB.ipynb
│  │     ├─ 940_3_RNN分類IMDB.ipynb
│  │     ├─ 940_4_LSTM分類IMDB.ipynb
│  │     ├─ 940_深度學習4-3(迴歸).ipynb
│  │     ├─ 940_深度學習CH09_PART01.ipynb
│  │     ├─ 940_深度學習CH09_PART02.ipynb
│  │     └─ 940_深度學習CH09_PART03.ipynb
│  ├─ manual-drafts/
│  │  ├─ Archive/
│  │  │  ├─ 專題手冊_草稿.docx
│  │  │  ├─ 專題手冊_草稿v3.docx
│  │  │  ├─ 專題手冊_草稿v4.docx
│  │  │  ├─ 專題手冊_草稿v5.docx
│  │  │  └─ 專題簡介_草稿.docx
│  │  └─ 初評文件資料/
│  │     └─ pdf/
│  │        ├─ 專題手冊_草稿.pdf
│  │        └─ 專題簡介_草稿.pdf
│  ├─ retired-features/
│  │  └─ README.md  # 總索引與文件責任
│  └─ README.md  # 總索引與文件責任
├─ current-status.md  # 目前功能、風險與下一步
├─ decision-log.md  # 重要決策及原因
└─ README.md  # 總索引與文件責任
```

## 新增清單

- `docs/00_Deliverables/README.md`
- `docs/00_Deliverables/System_Manual/chapters/01_前言.md`
- `docs/00_Deliverables/System_Manual/chapters/02_營運計畫.md`
- `docs/00_Deliverables/System_Manual/chapters/03_系統規格.md`
- `docs/00_Deliverables/System_Manual/chapters/04_專案時程與組織分工.md`
- `docs/00_Deliverables/System_Manual/chapters/05_需求模型.md`
- `docs/00_Deliverables/System_Manual/chapters/06_設計模型.md`
- `docs/00_Deliverables/System_Manual/chapters/07_實作模型.md`
- `docs/00_Deliverables/System_Manual/chapters/08_資料庫設計.md`
- `docs/00_Deliverables/System_Manual/chapters/09_程式.md`
- `docs/00_Deliverables/System_Manual/chapters/10_測試模型.md`
- `docs/00_Deliverables/System_Manual/chapters/11_操作手冊.md`
- `docs/00_Deliverables/System_Manual/chapters/12_使用手冊.md`
- `docs/00_Deliverables/System_Manual/chapters/13_感想.md`
- `docs/00_Deliverables/System_Manual/chapters/14_參考資料.md`
- `docs/00_Deliverables/System_Manual/chapters/15_附錄.md`
- `docs/00_Deliverables/System_Manual/images/initial-review-image10.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image11.jpg`
- `docs/00_Deliverables/System_Manual/images/initial-review-image12.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image13.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image14.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image15.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image16.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image17.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image18.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image19.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image2.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image20.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image21.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image22.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image23.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image24.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image25.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image26.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image27.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image28.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image29.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image3.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image30.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image31.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image32.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image33.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image34.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image35.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image36.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image37.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image38.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image39.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image4.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image40.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image41.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image42.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image43.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image44.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image45.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image46.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image47.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image48.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image49.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image5.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image50.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image51.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image52.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image53.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image54.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image55.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image56.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image58.jpg`
- `docs/00_Deliverables/System_Manual/images/initial-review-image6.emf`
- `docs/00_Deliverables/System_Manual/images/initial-review-image7.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image8.png`
- `docs/00_Deliverables/System_Manual/images/initial-review-image9.png`
- `docs/00_Deliverables/System_Manual/README.md`
- `docs/00_Deliverables/System_Manual/source-documents/115年_系統手冊規範.doc`
- `docs/00_Deliverables/System_Manual/source-documents/README.md`
- `docs/00_Deliverables/System_Manual/圖表目錄.md`
- `docs/00_Deliverables/System_Overview/FocusFlow_系統簡介.md`
- `docs/00_Deliverables/System_Overview/images/README.md`
- `docs/00_Deliverables/System_Overview/README.md`
- `docs/00_Deliverables/System_Overview/source-documents/115年_系統簡介規範.docx`
- `docs/00_Deliverables/System_Overview/source-documents/README.md`
- `docs/10_Project_History/docs-reorganization-2026-09-13.md`
- `docs/10_Project_History/README.md`
- `docs/20_Architecture/database/README.md`
- `docs/20_Architecture/hierarchical-retrieval/README.md`
- `docs/20_Architecture/README.md`
- `docs/20_Architecture/system-diagrams/README.md`
- `docs/30_Features/QA_Evaluation/archive/README.md`
- `docs/30_Features/README.md`
- `docs/30_Features/Short_Script_Automation/archive/README.md`
- `docs/30_Features/Short_Video/archive/README.md`
- `docs/30_Features/Short_Video/evidence/README.md`
- `docs/30_Features/Short_Video/README.md`
- `docs/30_Features/Student_Pilot_Backend/archive/README.md`
- `docs/40_Operations/README.md`
- `docs/60_Brand/README.md`
- `docs/90_Archive/duplicates/README.md`
- `docs/90_Archive/README.md`
- `docs/90_Archive/retired-features/README.md`
- `docs/README.md`

## docs 外的必要路徑同步

以下原檔只更新文件引用、來源註解或評測輸入／輸出路徑（根 README 另補文件導航），業務邏輯未改動。

- `AGENTS.md`
- `ARCHITECTURE.md`
- `CLAUDE.md`
- `PROJECT.md`
- `README.md`
- `STT_Whisper/README.md`
- `backend/.env.example`
- `backend/README.md`
- `backend/docs/README.md`
- `backend/docs/current-state.md`
- `backend/docs/handoff-shorts-frontend-done.md`
- `backend/docs/handoff-shorts-frontend-plan.md`
- `backend/docs/handoffs/2026-07-24-auth-notifications-avatar-frontend-handoff.md`
- `backend/docs/handoffs/2026-09-07-phase4b-shortasset-review-frontend-handoff.md`
- `backend/docs/todo.md`
- `backend/package.json`
- `backend/scripts/db/README.md`
- `backend/scripts/qa-eval/runQaEval.js`
- `backend/src/data/studentPilotRetrievalGroundTruth.js`
- `backend/src/models/videoSegmentParent.model.js`
- `backend/src/scripts/phase3a_q04_diagnostic.js`
- `backend/src/scripts/phase3c_round6_per_facet_quota_diagnostic.js`
- `database/docs/db-handoff-current.txt`
- `database/study/mongodb-學習筆記.md`
- `database/tools/setup/init_collections.js`
- `frontend/focus-flow/src/services/shortScript.js`
- `frontend/focus-flow/src/services/shortScriptTemplate.js`

## 全部搬移清單

下表 SHA-256 為搬移前檔案內容；歷史原路徑是追溯識別，不是現行連結。重複副本對照見 [duplicates 索引](../90_Archive/duplicates/README.md)。

| 原路徑 | 新路徑 | 搬移前 SHA-256 |
|---|---|---|
| `docs/00_System_Manual/Archive/專題手冊_草稿.docx` | `docs/90_Archive/manual-drafts/Archive/專題手冊_草稿.docx` | `3735f9478256ee77b315f8e1fef558d4f32c2d955955965b910a4ccc7c18cd59` |
| `docs/00_System_Manual/Archive/專題手冊_草稿v3.docx` | `docs/90_Archive/manual-drafts/Archive/專題手冊_草稿v3.docx` | `91d4f8cdf5b2281f67203ffaa432354551ce08712dc51a2ac430e28af3c3ab52` |
| `docs/00_System_Manual/Archive/專題手冊_草稿v4.docx` | `docs/90_Archive/manual-drafts/Archive/專題手冊_草稿v4.docx` | `a11e30c1a70acd1e2797268353122045e7307d43602da5c29ab15c28c7d2450b` |
| `docs/00_System_Manual/Archive/專題手冊_草稿v5.docx` | `docs/90_Archive/manual-drafts/Archive/專題手冊_草稿v5.docx` | `dad1bd5ca4c1974ed5130c50afee21df0ebd5835d4d13701f2d532d84e595a2a` |
| `docs/00_System_Manual/Archive/專題簡介_草稿.docx` | `docs/90_Archive/manual-drafts/Archive/專題簡介_草稿.docx` | `04290b3c7d9d0b08f67fc4c27f3e126f614e69cf505770fbb852c42ee658aef7` |
| `docs/00_System_Manual/Archive/甘特圖.xlsx` | `docs/20_Architecture/system-diagrams/legacy/manual/Archive/甘特圖.xlsx` | `1972ccc371d6f7358e8138b299feae0ba3f347070cd1f495fa2928fcf95b2f9a` |
| `docs/00_System_Manual/初評文件資料/Archive/作業流程圖/三種角色的操作流程.svg` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/Archive/作業流程圖/三種角色的操作流程.svg` | `f35c439047aecda6cbcdeb8971654f53b98f9812c4e50c7c7344ce231ed06b50` |
| `docs/00_System_Manual/初評文件資料/Archive/專題系統架構圖/AI學習系統架構圖.html` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/Archive/專題系統架構圖/AI學習系統架構圖.html` | `a5042e287fd90629ccf8eb8d8b46cf29307c3b2f38483e83b8ae87684786b256` |
| `docs/00_System_Manual/初評文件資料/Archive/專題系統架構圖/FocusFlow_SystemArch_v1.png` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/Archive/專題系統架構圖/FocusFlow_SystemArch_v1.png` | `d0f1b576dffc58a5671de4dae52d9d6e9a18773a1bd4af39d6cd57fb0a9137e0` |
| `docs/00_System_Manual/初評文件資料/Archive/專題系統架構圖/整體系統架構(以角色分層).svg` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/Archive/專題系統架構圖/整體系統架構(以角色分層).svg` | `a981f88e5a6a67fad2029ccecb0a605909e8b205455855b1ce184e3d07217872` |
| `docs/00_System_Manual/初評文件資料/Archive/專題系統架構圖/系統架構圖(claude).html` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/Archive/專題系統架構圖/系統架構圖(claude).html` | `f5b08599a6fcddbd0d9656116c3380f06764dfff029fc7a65522b72d544e36e2` |
| `docs/00_System_Manual/初評文件資料/Archive/甘特圖/四週分工甘特.html` | `docs/20_Architecture/system-diagrams/legacy/manual/初評文件資料/Archive/甘特圖/四週分工甘特.html` | `e2656db01c0908c6375115f8437ac8ab491e9ec8f7ba2f86ccd4317331e9de32` |
| `docs/00_System_Manual/初評文件資料/Archive/資料庫規劃/MongoDB 六大集合設計.svg` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/Archive/資料庫規劃/MongoDB 六大集合設計.svg` | `e6e2228499811417252ef8a4338767b660ed195e0a1a6b064d04aa61ebc63c34` |
| `docs/00_System_Manual/初評文件資料/Archive/資料庫規劃/mongodb-erd-2026-05-03.png` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/Archive/資料庫規劃/mongodb-erd-2026-05-03.png` | `7c8da52daeb57226b9dcfa16699dda08380d8bc9a17b2c47c78bb59aa2f30f86` |
| `docs/00_System_Manual/初評文件資料/docx/115年_專題成果參與校外競賽暨投稿研討會認列申請表.docx` | `docs/00_Deliverables/Contest/115年_專題成果參與校外競賽暨投稿研討會認列申請表.docx` | `b5072b54e2fd0cc726ba5040bf3123930f8ee2c4e35c07ec5f310c18e81369a7` |
| `docs/00_System_Manual/初評文件資料/docx/FocusFlow_第12章使用畫面.docx` | `docs/00_Deliverables/System_Manual/source-documents/FocusFlow_第12章使用畫面.docx` | `3b6443ebcb5dba9ac47f3ad240501a16eb1eeb49aba948796a690446b46d19e9` |
| `docs/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_初評最終版.docx` | `docs/00_Deliverables/System_Manual/source-documents/專題手冊_初評最終版.docx` | `ee9be1cdd7acb8df5957b66e8c2213579f33ff4ed044a8a6b8379dd868118f35` |
| `docs/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿.docx` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿.docx` | `3735f9478256ee77b315f8e1fef558d4f32c2d955955965b910a4ccc7c18cd59` |
| `docs/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿v3.docx` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿v3.docx` | `91d4f8cdf5b2281f67203ffaa432354551ce08712dc51a2ac430e28af3c3ab52` |
| `docs/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿v4.docx` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿v4.docx` | `a11e30c1a70acd1e2797268353122045e7307d43602da5c29ab15c28c7d2450b` |
| `docs/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿v5.docx` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/docx/系統手冊/專題手冊_草稿v5.docx` | `dad1bd5ca4c1974ed5130c50afee21df0ebd5835d4d13701f2d532d84e595a2a` |
| `docs/00_System_Manual/初評文件資料/docx/系統簡介/四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/docx/系統簡介/四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx` | `f3a899ab40ff19076b89ad4fc7ae3fd35a8cd4694e65303b6f47029889c5d90d` |
| `docs/00_System_Manual/初評文件資料/docx/系統簡介/專題簡介_草稿.docx` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/docx/系統簡介/專題簡介_草稿.docx` | `04290b3c7d9d0b08f67fc4c27f3e126f614e69cf505770fbb852c42ee658aef7` |
| `docs/00_System_Manual/初評文件資料/pdf/四技第115413組-FocusFlow AI-系統手冊_v1.pdf` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/pdf/四技第115413組-FocusFlow AI-系統手冊_v1.pdf` | `7e4fd9dbe8f4f0d20618caefd26e1cc00b9a0dc8c629cafdd5f6e0c9a592826b` |
| `docs/00_System_Manual/初評文件資料/pdf/四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/pdf/四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf` | `7e4fd9dbe8f4f0d20618caefd26e1cc00b9a0dc8c629cafdd5f6e0c9a592826b` |
| `docs/00_System_Manual/初評文件資料/pdf/四技第115413組-FocusFlow AI-系統簡介_初評最終版.pdf` | `docs/00_Deliverables/System_Overview/source-documents/四技第115413組-FocusFlow AI-系統簡介_初評最終版.pdf` | `010f733f159efab9183ce469a60ee3d377c5edf8ba4849e68b666771600dfa95` |
| `docs/00_System_Manual/初評文件資料/pdf/專題手冊_草稿.pdf` | `docs/90_Archive/manual-drafts/初評文件資料/pdf/專題手冊_草稿.pdf` | `fe0c93492fac934dac9b59ef01193b2cca730f704f206d3df9159a9209640a7f` |
| `docs/00_System_Manual/初評文件資料/pdf/專題簡介_草稿.pdf` | `docs/90_Archive/manual-drafts/初評文件資料/pdf/專題簡介_草稿.pdf` | `219b13ed00bd6b982aa18cbfb62416d7393dbe3fde8310794dd3dbebc51e1139` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第 114201 組-DreamEcho AI-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第 114201 組-DreamEcho AI-系統手冊.pdf` | `ed619dc1ad9964b9556de29aae93361130045699b8f06d37c3310475f1b359eb` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114202組-HopOn Taipei App-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114202組-HopOn Taipei App-系統手冊.pdf` | `fc71f6a838581fc6a8eb52c30fbee159b4b821dbd79a89deb64d2cfc5ef36b05` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114203組-課程助理-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114203組-課程助理-系統手冊.pdf` | `2f85bd139564fd7133b2092bc870f78e4f84e3136e046c367bc38695f2059cf8` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114204組-Gaia Bloom-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114204組-Gaia Bloom-系統手冊.pdf` | `ae2691957f8ab689626530a4622e97984e728b96c27ebf4443031b186fc937b7` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114205組-味你而煮-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114205組-味你而煮-系統手冊.pdf` | `91853a75c80b94989963448ed9f9a2ca4110cdabd26190aa982ac1f37d9c3157` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114206組-InterviewerAI-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114206組-InterviewerAI-系統手冊.pdf` | `9951a73b8ecd486365398c12feceb2c09395b2c5fa2b808a7bd973c351ed0ebe` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114207組-日記之森-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114207組-日記之森-系統手冊.pdf` | `efeeafb19fa5aef47f7961c0ba2b9fb4201196dd8f89fb48f620f305cc654490` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114208組-RMS車輛管理系統-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/二技114參考文件/二技第114208組-RMS車輛管理系統-系統手冊.pdf` | `8644c0af5f8808ebd936f3106195d496d6a013e82f383309142e25c7a7c1bf3b` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技 第114406組-IS Capt. AI智慧資安管理平台-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技 第114406組-IS Capt. AI智慧資安管理平台-系統手冊.pdf` | `5ab764a49abbc21eb2785e65ae62e06dbd0790f6125b1dd846258b8cc8cdbb87` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114401組-PingPro桌訓系統-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114401組-PingPro桌訓系統-系統手冊.pdf` | `4abc706cd55a5585c6cca613c883647b0217346b58598a56b63de4cdce7bc14b` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114402組-AI底家-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114402組-AI底家-系統手冊.pdf` | `1ec65383ddd82b6b0090e8d2289f5fa55bc1728634a09478e63afa8e99e251ca` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114403 組-欸！愛多益-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114403 組-欸！愛多益-系統手冊.pdf` | `06c9d1a7a62842118bed7b19f28b87d69b9b1e32ee71517cda73281770db9db9` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114404組-PawDay-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114404組-PawDay-系統手冊.pdf` | `d8f6baaca6e95c1fefd3f582a92e8ad16607c2aaaffc0d1362240d41ae679f7a` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114405組-AI幣市通-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114405組-AI幣市通-系統手冊.pdf` | `6a421d84cfc6434c8944bec270ce8c5929e8c00f4907f6ffdf3688ac93164fda` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114407組-MEI食不打烊-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114407組-MEI食不打烊-系統手冊.pdf` | `710b160fa85176774cb6f2d7d2a2a611602e92f03ce2efc91080dc3c2c2900d9` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114408組-E筆勾銷-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114408組-E筆勾銷-系統手冊.pdf` | `79f1e92de3403f3d5edf0ee0e9a71cc68bedda1a43ea6217a11b78c3ec3205aa` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114409組-會議寶-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114409組-會議寶-系統手冊.pdf` | `ce85312509983e66cefaf4ce6b4bac48f0edcc89165141d80b70f8505e02cec4` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114410組-Dr.W 傷口管家-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114410組-Dr.W 傷口管家-系統手冊.pdf` | `7b24f66376f716d87e6b40fbaf83dc287f63d51351a1d759ba33382eafb48584` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114411組-SignNest手語小窩-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114411組-SignNest手語小窩-系統手冊.pdf` | `dc31415ae83d75b5900595f9dbcf337cd919b0806302d3c5ba43e6476b31bfa6` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114412組-智慧餐廳推薦系統-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114412組-智慧餐廳推薦系統-系統手冊.pdf` | `af1319443cbc4ae927a9c0a3267b581e89ba0b569b0a8165a67e622ec4ef24c3` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114413組-鯨落whalefall-系統手冊.pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114413組-鯨落whalefall-系統手冊.pdf` | `b0fe5237e699eed7704bcaa6797e301e1892f14b4ef6bd36cca4b34d8351e4b4` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114414組-動起來「揪」對了-系統手冊 .pdf` | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114414組-動起來「揪」對了-系統手冊 .pdf` | `de92814c094d1c68f752b0e53048526295f78a1841cc98280a540f162c286f22` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/五專第110503組-TeleBerry-系統手冊.pdf` | `docs/90_Archive/external-examples/五專第110503組-TeleBerry-系統手冊.pdf` | `d7b31328347348c4ecc6e83f6dfbf2b605192e8ca54db4c3d2ac525a62784fc2` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/四技第113402組-租中自有黃金屋-簡報-2.pdf` | `docs/90_Archive/external-examples/四技第113402組-租中自有黃金屋-簡報-2.pdf` | `7edfdb6c6950024795cc715b29b4f33ed315acfa0aab816cbe6d04cbaf5bbf95` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/四技第114414組-動起來揪對了-系統手冊範例.pdf` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/參考專題文件/四技第114414組-動起來揪對了-系統手冊範例.pdf` | `de92814c094d1c68f752b0e53048526295f78a1841cc98280a540f162c286f22` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/四技第115414組-救「舊」我的書-系統手冊.pdf` | `docs/90_Archive/external-examples/四技第115414組-救「舊」我的書-系統手冊.pdf` | `1b533a1ada65ba2b02fc84edc2a91c9b9af38cad8ba9d436f5f773d249299c18` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/114年_系統手冊_大學範例_智慧社區圖書共享與管理平台.doc` | `docs/90_Archive/external-examples/專題推薦參考文件/114年_系統手冊_大學範例_智慧社區圖書共享與管理平台.doc` | `814a927d4d56ca3219e3164ea84a13679d349ce4dc914de4cc62dbeecfff6f51` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/二技第 113207 組-Nice巴底-系統手冊.pdf` | `docs/90_Archive/external-examples/專題推薦參考文件/二技第 113207 組-Nice巴底-系統手冊.pdf` | `9e006a70f12ff8611881455b9ef84ede34a93d78980f6458d5fe236a140bf59c` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/五專第113505組-遊然自得-系統手冊.pdf` | `docs/90_Archive/external-examples/專題推薦參考文件/五專第113505組-遊然自得-系統手冊.pdf` | `25c982160ece56a36ceb4e9c6f56f117b5d6be8f97c0480b30cdb40fb8eb63fc` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/五專第113506組-SilverEase-系統手冊.pdf` | `docs/90_Archive/external-examples/專題推薦參考文件/五專第113506組-SilverEase-系統手冊.pdf` | `af535c85ecca0eacd06f351f5b6ed76e79d89e53e07bc3ed45666b9be2a3c901` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/五專第114502組-怪怪走開，護您安全-系統手冊 - 最終版.pdf` | `docs/90_Archive/external-examples/專題推薦參考文件/五專第114502組-怪怪走開，護您安全-系統手冊 - 最終版.pdf` | `25b6c56c07f4e3833a6e485c08a526dc404e48a556a858b11470a552eedbca2f` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/五專第114510組-智能校事專家-系統手冊.pdf` | `docs/90_Archive/external-examples/專題推薦參考文件/五專第114510組-智能校事專家-系統手冊.pdf` | `bcbbea8f43a635afda862591bd501ce62c4493766e95ff38dfaefa03347c9942` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/四技 第114406組-IS Capt. AI智慧資安管理平台-系統手冊.pdf` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/四技 第114406組-IS Capt. AI智慧資安管理平台-系統手冊.pdf` | `5ab764a49abbc21eb2785e65ae62e06dbd0790f6125b1dd846258b8cc8cdbb87` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/四技第113402組-租中自有黃金屋-系統手冊.pdf` | `docs/90_Archive/external-examples/專題推薦參考文件/四技第113402組-租中自有黃金屋-系統手冊.pdf` | `e75e205eb71b5bfad14426c0c04246fa5ca2c722ceb37e4f481826d0091cd16d` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/四技第114414組-動起來「揪」對了-系統手冊 .pdf` | `docs/90_Archive/duplicates/00_System_Manual/初評文件資料/參考專題文件/專題推薦參考文件/四技第114414組-動起來「揪」對了-系統手冊 .pdf` | `de92814c094d1c68f752b0e53048526295f78a1841cc98280a540f162c286f22` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/鄭喬尹/另一組簡略架構圖-1.jpg` | `docs/90_Archive/external-examples/鄭喬尹/另一組簡略架構圖-1.jpg` | `226d37cd71addeb1880fec4b89ad491efaeb5b9cf220eb092e006c6797c7c687` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/鄭喬尹/另一組簡略架構圖-2.jpg` | `docs/90_Archive/external-examples/鄭喬尹/另一組簡略架構圖-2.jpg` | `c52efae46c04e94ef2eb7d15ad9a14ead5e60e793db6d8ddac988d4c3e526458` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/鄭喬尹/另一組詳細架構圖-1.jpg` | `docs/90_Archive/external-examples/鄭喬尹/另一組詳細架構圖-1.jpg` | `0916510bdfa8e3424b60dd1c885eea47f72fabe7bd1f3f8c149d375c37f08d80` |
| `docs/00_System_Manual/初評文件資料/參考專題文件/鄭喬尹/另一組詳細架構圖-2.jpg` | `docs/90_Archive/external-examples/鄭喬尹/另一組詳細架構圖-2.jpg` | `91d461ff6558915a75268ceb8e62f2390ca0316b0bd633341f3d015c682aeb8b` |
| `docs/00_System_Manual/四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf` | `docs/00_Deliverables/System_Manual/source-documents/四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf` | `7e4fd9dbe8f4f0d20618caefd26e1cc00b9a0dc8c629cafdd5f6e0c9a592826b` |
| `docs/00_System_Manual/四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx` | `docs/00_Deliverables/System_Overview/source-documents/四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx` | `f3a899ab40ff19076b89ad4fc7ae3fd35a8cd4694e65303b6f47029889c5d90d` |
| `docs/01_System_Overview/Archive/AI學習系統架構圖.html` | `docs/20_Architecture/system-diagrams/legacy/overview/AI學習系統架構圖.html` | `a5042e287fd90629ccf8eb8d8b46cf29307c3b2f38483e83b8ae87684786b256` |
| `docs/01_System_Overview/Archive/FocusFlow_SystemArch_v1.png` | `docs/20_Architecture/system-diagrams/legacy/overview/FocusFlow_SystemArch_v1.png` | `d0f1b576dffc58a5671de4dae52d9d6e9a18773a1bd4af39d6cd57fb0a9137e0` |
| `docs/01_System_Overview/Archive/MongoDB 六大集合設計.svg` | `docs/20_Architecture/system-diagrams/legacy/overview/MongoDB 六大集合設計.svg` | `e6e2228499811417252ef8a4338767b660ed195e0a1a6b064d04aa61ebc63c34` |
| `docs/01_System_Overview/Archive/Reward_Flow_v1.png` | `docs/20_Architecture/system-diagrams/legacy/overview/Reward_Flow_v1.png` | `f23d5deb92971062323971d6182aa5bbcab8c348f872ec85985275899dc84c75` |
| `docs/01_System_Overview/Archive/mongodb-erd-2026-05-03.png` | `docs/20_Architecture/system-diagrams/legacy/overview/mongodb-erd-2026-05-03.png` | `7c8da52daeb57226b9dcfa16699dda08380d8bc9a17b2c47c78bb59aa2f30f86` |
| `docs/01_System_Overview/Archive/三種角色的操作流程.svg` | `docs/20_Architecture/system-diagrams/legacy/overview/三種角色的操作流程.svg` | `f35c439047aecda6cbcdeb8971654f53b98f9812c4e50c7c7344ce231ed06b50` |
| `docs/01_System_Overview/Archive/整體系統架構(以角色分層).svg` | `docs/20_Architecture/system-diagrams/legacy/overview/整體系統架構(以角色分層).svg` | `a981f88e5a6a67fad2029ccecb0a605909e8b205455855b1ce184e3d07217872` |
| `docs/01_System_Overview/Archive/系統架構圖(claude).html` | `docs/20_Architecture/system-diagrams/legacy/overview/系統架構圖(claude).html` | `f5b08599a6fcddbd0d9656116c3380f06764dfff029fc7a65522b72d544e36e2` |
| `docs/02_System_Architecture_Diagram/Archive/AI學習系統架構圖 .html` | `docs/20_Architecture/system-diagrams/legacy/architecture/AI學習系統架構圖 .html` | `3a744b668138a8db797af2cc248ca66e6e66b38f5407596c89cd7d2b8561b2f0` |
| `docs/02_System_Architecture_Diagram/Archive/System_Arch_v2.html` | `docs/90_Archive/duplicates/02_System_Architecture_Diagram/Archive/System_Arch_v2.html` | `f5b08599a6fcddbd0d9656116c3380f06764dfff029fc7a65522b72d544e36e2` |
| `docs/02_System_Architecture_Diagram/Archive/mongodb_schema_design_0331.svg` | `docs/20_Architecture/system-diagrams/legacy/architecture/mongodb_schema_design_0331.svg` | `cb1bf5f2abc8f4de005d9794840002cfe6048104dfb5fd74bf61f8b5ee551733` |
| `docs/02_System_Architecture_Diagram/Archive/role_flow_diagram.svg` | `docs/20_Architecture/system-diagrams/legacy/architecture/role_flow_diagram.svg` | `7746baeef6eb1c7fb795c0fa4156162dc2a0fee4bc6ac056f8c391dbeb2c226f` |
| `docs/02_System_Architecture_Diagram/Archive/system_architecture_by_role.svg` | `docs/20_Architecture/system-diagrams/legacy/architecture/system_architecture_by_role.svg` | `d836fec3a1c0f4f3b9f33e522364adf5c1b118a9939fe33191a93ea09f0e7a0a` |
| `docs/02_System_Architecture_Diagram/系統架構圖/系統架構圖文件用_v1_0508.png` | `docs/20_Architecture/system-diagrams/系統架構圖文件用_v1_0508.png` | `973193e0593d49fd884d821f3c3c323c4145a593c9b8342ad6076e72bd757987` |
| `docs/02_System_Architecture_Diagram/系統架構圖/系統架構圖文件用_v2_0519.png` | `docs/20_Architecture/system-diagrams/系統架構圖文件用_v2_0519.png` | `02c8af9d579ecf1c3c88839ceec655c105b11d25d9c33a1b431a8868f40803cf` |
| `docs/02_System_Architecture_Diagram/系統架構圖/系統架構圖詳細版_v1.2_0508.png` | `docs/20_Architecture/system-diagrams/系統架構圖詳細版_v1.2_0508.png` | `efef8022e683dc9bdf1726eb7e11e8ecdc6e4407262ceaabe14563bca4894d6c` |
| `docs/02_System_Architecture_Diagram/系統架構圖/系統架構圖詳細版_v1_0508.png` | `docs/20_Architecture/system-diagrams/系統架構圖詳細版_v1_0508.png` | `7c6af023e79638e8884da1f3e068a4a1dd84a6c668b4f07f07d74df121336265` |
| `docs/02_System_Architecture_Diagram/系統架構圖/系統架構圖詳細版_v2_0519.png` | `docs/20_Architecture/system-diagrams/系統架構圖詳細版_v2_0519.png` | `ce53d4afc5a30ba6b426a8759945a537e1a06359ee2bb02a898447644d69b046` |
| `docs/03_Chat_summary/Json/focusflow_youtube_stt_debug_record_2026-05-06.json` | `docs/90_Archive/chat-history/Json/focusflow_youtube_stt_debug_record_2026-05-06.json` | `51906c44b851a63ba77a1f6a02f8f69fe517addd0239437ca7cfaad1c315901f` |
| `docs/03_Chat_summary/Json/一鍵導入歷史紀錄.json` | `docs/90_Archive/chat-history/Json/一鍵導入歷史紀錄.json` | `a2e60291228fc14d818709ac6df83b0602c10990731c6894d0ab5f434e804028` |
| `docs/03_Chat_summary/doc/Game of Learning Systems_0324.docx` | `docs/90_Archive/chat-history/doc/Game of Learning Systems_0324.docx` | `3dc6c5c11f92d5d8e5a48598b651874d091319af5913c20d8b359aefec424d6d` |
| `docs/03_Chat_summary/pdf/Gemini Multimodal Embedding.pdf` | `docs/90_Archive/chat-history/pdf/Gemini Multimodal Embedding.pdf` | `01e3a161241c45717034132d4f741164c0015da273725359609de03e119346e0` |
| `docs/03_Chat_summary/pdf/STT_correction_process.pdf` | `docs/90_Archive/chat-history/pdf/STT_correction_process.pdf` | `8e24073729c037e3f3982f1576a4cb1961e585086ee3b1e1171921c0dc732694` |
| `docs/03_Chat_summary/pdf/turning_points.pdf` | `docs/90_Archive/chat-history/pdf/turning_points.pdf` | `2224cb02cac425e46dc7a5fa3c68d34bc612dd34b289fb99d6d770e231b9a2be` |
| `docs/03_Chat_summary/pdf/四周甘特圖_0331.html` | `docs/90_Archive/chat-history/pdf/四周甘特圖_0331.html` | `7d185be2524aaa3a3d642deff99826103c2729fde58c3670c661cc5aa41058e9` |
| `docs/04_Frontend_Progress/0407前端進度.pdf` | `docs/90_Archive/frontend-progress/0407前端進度.pdf` | `7ce64761dadd1616e2626ac897334debf0996402b2e9c6a030d97d4489eb7203` |
| `docs/04_Frontend_Progress/0411前端進度.pdf` | `docs/90_Archive/frontend-progress/0411前端進度.pdf` | `e5fa0f669b7328bb6713c9195a57d5f327b7b7f164a2957c2367728d87b4f8b0` |
| `docs/04_Frontend_Progress/0413前端進度整理.pdf` | `docs/90_Archive/frontend-progress/0413前端進度整理.pdf` | `15cd2691e7bc82fc108a4fe7f3fee8d2ec53ff2de4dd3d7ae4d681696b2c0df0` |
| `docs/04_Frontend_Progress/0423前端進度.pdf` | `docs/90_Archive/frontend-progress/0423前端進度.pdf` | `33a4c6f1179ea4c6a8132ac85299333e68ea96ae2b81b5d5272a43e8e56c62f6` |
| `docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` | `docs/20_Architecture/database/archive/MongoDB_契約定版_v1_已過期.md` | `fab023e8676022c39dca745153eb117482aad170a749d66b5a86a5d438d8376b` |
| `docs/06_LOGO/Focus_Flow_Logos.pptx` | `docs/60_Brand/logo/Focus_Flow_Logos.pptx` | `ba5fd4a312c5d24861d07612ccb633c84f62baa0ef83000299af2b3a0dd70d2a` |
| `docs/06_LOGO/index.html` | `docs/60_Brand/logo/index.html` | `fbe94d13e520c019edc8585aca095b45e1f1c2b851c039315b513a12aac243ad` |
| `docs/06_LOGO/lockup-color.png` | `docs/60_Brand/logo/lockup-color.png` | `c70b8af604cdb3ddc855246920d52f9fee0116b150deafea6f7dfe1124d91d19` |
| `docs/06_LOGO/lockup-ink-mono.png` | `docs/60_Brand/logo/lockup-ink-mono.png` | `874aef0da3b015a695d8536f97573b07e609c821658c25567e7567403afaef18` |
| `docs/06_LOGO/lockup-teal-mono.png` | `docs/60_Brand/logo/lockup-teal-mono.png` | `5c74192bbdd479246dd4babcaa8521b5bed9789f41d25e5f7ac13e32fcb36c7d` |
| `docs/06_LOGO/lockup-white.png` | `docs/60_Brand/logo/lockup-white.png` | `310d102aa38eb5985060b1b16b30aaa870c72fe463f8d6b53e11174d07fda872` |
| `docs/06_LOGO/mark-amber-mono.png` | `docs/60_Brand/logo/mark-amber-mono.png` | `59b763e5ed25c049716b35fa7246b8353d38ba4252ff46c984472c47b939e631` |
| `docs/06_LOGO/mark-color.png` | `docs/60_Brand/logo/mark-color.png` | `8627ff33c2625f27b1d70ba443665d0b3b7e7fd12e48a64f7c99f8a1522406d8` |
| `docs/06_LOGO/mark-ink-mono.png` | `docs/60_Brand/logo/mark-ink-mono.png` | `604fe94fd168400cf4cb1791133ce18392d6f3f5d923d4542729c90d1f4a60c6` |
| `docs/06_LOGO/mark-teal-mono.png` | `docs/60_Brand/logo/mark-teal-mono.png` | `bcb3d3e71733c7ac5e83743a834911dc2efe2a3e2cde3a6d696945dacff2c8c7` |
| `docs/06_LOGO/mark-white-mono.png` | `docs/60_Brand/logo/mark-white-mono.png` | `a1a9c5e10c5a8faa768c034137a979865cd7bf50b210374348cf9fb3b34a918e` |
| `docs/06_LOGO/mark-white.png` | `docs/60_Brand/logo/mark-white.png` | `0d651fe940479b783453880d417f8c4bfd142e0c72086ea377431e028bb3bfc7` |
| `docs/06_LOGO/svg/lockup-color.svg` | `docs/60_Brand/logo/svg/lockup-color.svg` | `5467adf7ca319c1bca24899c7fc9e2d7f99ef8e984a9ea9f03a72036d9656dbe` |
| `docs/06_LOGO/svg/lockup-white.svg` | `docs/60_Brand/logo/svg/lockup-white.svg` | `223f801c517128dcb77026a8e8fcb865dc56ec502765d2cdfd10fd2256163d72` |
| `docs/06_LOGO/svg/mark-amber-mono.svg` | `docs/60_Brand/logo/svg/mark-amber-mono.svg` | `c44a6475d18190ec665ecd1d958c7f1444dda41b96c093c4ea9f2acb7e44433c` |
| `docs/06_LOGO/svg/mark-color.svg` | `docs/60_Brand/logo/svg/mark-color.svg` | `27ad14b37e53251c8d1a59fd6d1c7cd7a9f7f4604d0ea022c0467e2cd342dc67` |
| `docs/06_LOGO/svg/mark-ink-mono.svg` | `docs/60_Brand/logo/svg/mark-ink-mono.svg` | `715ac25cadd0d600953cf512bd22a24a9954fc1f92f692dd7d49e96374ae84e8` |
| `docs/06_LOGO/svg/mark-teal-mono.svg` | `docs/60_Brand/logo/svg/mark-teal-mono.svg` | `c7e00c540e72504db3b1c055f7c0417c9613529c133ab8b654496ac8876362ce` |
| `docs/06_LOGO/svg/mark-white-mono.svg` | `docs/60_Brand/logo/svg/mark-white-mono.svg` | `75efcf49c92ec099fb6f4498f56444da47117b30960617fab61ca37e6077c203` |
| `docs/06_LOGO/svg/mark-white.svg` | `docs/60_Brand/logo/svg/mark-white.svg` | `3d6f8e4e4c582d2e68b45ec88efac9bbe960d24b4d84d6c0db32022475cca83c` |
| `docs/06_LOGO/svg/wordmark-color.svg` | `docs/60_Brand/logo/svg/wordmark-color.svg` | `b693a73045f0d6941bde403d408782791a7e72381b204b132cacd843984bb968` |
| `docs/06_LOGO/svg/wordmark-white.svg` | `docs/60_Brand/logo/svg/wordmark-white.svg` | `233f0e82a63518b78b6ee03c7501c9cadb3718fc1d04877208594a1e89d15766` |
| `docs/06_LOGO/wordmark-color.png` | `docs/60_Brand/logo/wordmark-color.png` | `082c48b0a48f5abbde55ccb1b015c570b81c61016b44e9d93d5b4e2ee12881c6` |
| `docs/06_LOGO/wordmark-ink-mono.png` | `docs/60_Brand/logo/wordmark-ink-mono.png` | `7377e62298a8abb7e697646ce3ab7596e7593efd9bcb92b1e4216f516f651c2b` |
| `docs/06_LOGO/wordmark-teal-mono.png` | `docs/60_Brand/logo/wordmark-teal-mono.png` | `5e9a08e4886ede0846f16148099d0a23f515996806c93ac6bb69a9f8a51b0376` |
| `docs/06_LOGO/wordmark-white.png` | `docs/60_Brand/logo/wordmark-white.png` | `aa07b6c528bb5442c5f7d9dedb71410dfc29052c23470fb7cf533ce4a50e51c8` |
| `docs/2026-09_Short_Script_Automation/2026-09_Short_Script_Automation_Spec.md` | `docs/30_Features/Short_Script_Automation/specs/2026-09_Short_Script_Automation_Spec.md` | `15e89933c94d2ea7b55fe9a00bcc6be831f866d4abecc48d6fe7bfd12ff12a8d` |
| `docs/2026-09_Short_Script_Automation/README.md` | `docs/30_Features/Short_Script_Automation/README.md` | `4a26c4768529d99b226707f284fec959468276cc34582c14e284b50ec9b787c0` |
| `docs/2026-09_Short_Script_Automation/evidence/2026-09-04_p01-threshold-calibration.md` | `docs/30_Features/Short_Script_Automation/evidence/2026-09-04_p01-threshold-calibration.md` | `0bbb1553243d363377a3827767c1ca8e1b6b1ae03b8e83680bcb44e8fa3c15ff` |
| `docs/2026-09_Short_Script_Automation/evidence/2026-09-04_real-llm-generation-trial.md` | `docs/30_Features/Short_Script_Automation/evidence/2026-09-04_real-llm-generation-trial.md` | `21f2ddba86dcb8a5df8805f6c81cbd4bfc77b376e2e07816c87c6a1c9b82bde0` |
| `docs/2026-09_Short_Script_Automation/evidence/2026-09-04_sample2-ai-course.md` | `docs/30_Features/Short_Script_Automation/evidence/2026-09-04_sample2-ai-course.md` | `4e5b31f738d84e3fc1098b49a3695bf059c8fc33099df2ff612dd22caf89a399` |
| `docs/2026-09_Short_Script_Automation/evidence/2026-09-04_sp1-acceptance.md` | `docs/30_Features/Short_Script_Automation/evidence/2026-09-04_sp1-acceptance.md` | `5e64d130698527e1bdbaede7475a73abe57a92d98f68d97617dac116fe77c815` |
| `docs/2026-09_Short_Script_Automation/evidence/2026-09-04_sp2-acceptance.md` | `docs/30_Features/Short_Script_Automation/evidence/2026-09-04_sp2-acceptance.md` | `fe5fb628a209c6ef38c37cf67db811c632c9c289b0962b6e65b385e92df93104` |
| `docs/2026-09_Short_Script_Automation/work-orders/2026-09-03_short-script-automation-work-order_v0.1-draft.md` | `docs/30_Features/Short_Script_Automation/work-orders/2026-09-03_short-script-automation-work-order_v0.1-draft.md` | `2d6d2146dd01e0922b5c1e1c9f06c7ff13a2cc92fe460f9b41b76d47693c1e47` |
| `docs/2026-09_Student_Pilot_Backend/2026-09_Student_Pilot_Backend_Spec.md` | `docs/30_Features/Student_Pilot_Backend/specs/2026-09_Student_Pilot_Backend_Spec.md` | `f383ad1ac38c230db3a74f92c398f1810705aa825d60758183cddf15b95c09e2` |
| `docs/2026-09_Student_Pilot_Backend/README.md` | `docs/30_Features/Student_Pilot_Backend/README.md` | `d0db75e557899b8355884665c872527b07c0854930adad21c78b2943a4c7efed` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-08-30_phase1-implementation-results.md` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-08-30_phase1-implementation-results.md` | `8158acda578c530d7e69404a9ce45599f3e66c8ed760b7b160b602342a770af6` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_flag-snapshot.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-01_baseline_flag-snapshot.json` | `01713d8d3a55487521576678407da9dad649e6792f43b0aeb2f35559fc5a8386` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_manual-review.md` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-01_baseline_manual-review.md` | `57abda282eff2578f8b0f3467495e573067766a563ac737af4218c846cf41d3a` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_questions.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-01_baseline_questions.json` | `fbdba428d12b3ed217783e679a86a627391585e75ad0d31d3beb5fe742cbafbf` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_questions.md` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-01_baseline_questions.md` | `0c1a34dde45b0c463c680c629898ca72149d98c062a24f0db3927021be8ef24b` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_baseline_raw-results.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-01_baseline_raw-results.json` | `f4a05eabfa6ff86587bb62d16320de0ef6b648c14644567c8f7018b357d9f480` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_wo13-enrollment-revoke-after.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-01_wo13-enrollment-revoke-after.json` | `000d3176bdc71c3d69c8713e32dbedc5238c98f2f84f4a564404fd39045c0f69` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-01_wo13-enrollment-revoke-before.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-01_wo13-enrollment-revoke-before.json` | `22b4923e9645d38261d7fc2a7a7e13e7b7b26046bdf5dac3054f0f86496b2956` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-04_phase3-freeze-regression_questions.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-04_phase3-freeze-regression_questions.json` | `fc608616cc7c875f4c9d1fea0028cdd27a81e89ea1efa33097ae16a0a07ac734` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-04_phase3-freeze-regression_questions.md` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-04_phase3-freeze-regression_questions.md` | `8e4e0288e449bac7b9a7f4f82ef4a8ae3b53cd499399f7da2e083132ba846cd2` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-08_g2-atlas-contract-inventory.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-08_g2-atlas-contract-inventory.json` | `61b76c7bf1dff22f0e4922bb5faee492eb692ff0562b9f9756082cfddb3724db` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-08_wo26-conversation-turn-distribution.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-08_wo26-conversation-turn-distribution.json` | `872b4c531b85d1aff0129b8b1876522684956452f5fa9eb65b86089f2c7531ab` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-09_g8-public-smoke.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-09_g8-public-smoke.json` | `b42d8956c7e403266e98d2848ae0bc8c0a034fcbf2df4cfd2168832fe6cbf6f1` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-09_student-poc-localhost-e2e.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-09_student-poc-localhost-e2e.json` | `7649c755356ae9683b36d5f45afb64e818e4b6286796795833661d4dbb076317` |
| `docs/2026-09_Student_Pilot_Backend/evidence/2026-09-09_wo15-local-regression.json` | `docs/30_Features/Student_Pilot_Backend/evidence/2026-09-09_wo15-local-regression.json` | `28283020d55c86c1e693a6b521d4177c95070aefeaf31d97637c214778fb9141` |
| `docs/2026-09_Student_Pilot_Backend/evidence/evidence_README.md` | `docs/30_Features/Student_Pilot_Backend/evidence/evidence_README.md` | `51ff89226762ee38404b3c64c80ab44e51c8f06953d253bad5b3e483f5431f4e` |
| `docs/2026-09_Student_Pilot_Backend/work-orders/2026-08-27_spec-v1.0-work-order.md` | `docs/30_Features/Student_Pilot_Backend/work-orders/2026-08-27_spec-v1.0-work-order.md` | `35919196e5e7ef6293e1648ef51a8ed783e4fd9a8cbe8297b75ab2e971e1d747` |
| `docs/2026-09_Student_Pilot_Backend/work-orders/work-order_README.md` | `docs/30_Features/Student_Pilot_Backend/work-orders/work-order_README.md` | `c9b18472a18e086168c60aa50f7586235d930c62af02c307abb5829a038e08ba` |
| `docs/Contest/2026全國大專校院智慧創新暨跨域整合創作競賽系統需求書.docx` | `docs/00_Deliverables/Contest/2026全國大專校院智慧創新暨跨域整合創作競賽系統需求書.docx` | `480fab83143c1d24e4280e2e781d141216d6987f8b0f38b1f9ba97a0286aaca1` |
| `docs/Contest/2026年全國大專校院智慧創新暨跨域整合創作競賽企劃書.docx` | `docs/00_Deliverables/Contest/2026年全國大專校院智慧創新暨跨域整合創作競賽企劃書.docx` | `33a9839b1fcf991a5d5e527fa45227ba3fdd613ef31e89123ed60f947176f939` |
| `docs/ESG/2026ESG_V2.docx` | `docs/00_Deliverables/ESG/2026ESG_V2.docx` | `41d79afc14bd5311b5d44195a9d948aeaf4a13acb8772e9f18445e57cac8737e` |
| `docs/ESG/2026永續發展管理研討會論文全文投稿格式_1150311.docx` | `docs/00_Deliverables/ESG/2026永續發展管理研討會論文全文投稿格式_1150311.docx` | `56d24efe46880420756a1de62aa0d9c1f0830f08e145998451db0765f763e348` |
| `docs/ESG/2026永續研討會_論文初稿.docx` | `docs/00_Deliverables/ESG/2026永續研討會_論文初稿.docx` | `71c1803524e9c751923ffb64c6db184d3ad5472af7c6127109066191e6f23f07` |
| `docs/ESG/2026永續研討會_論文初稿V4.docx` | `docs/00_Deliverables/ESG/2026永續研討會_論文初稿V4.docx` | `b5116328a09aa3442871010da328e0c55c8aba93d1b52accfafaee78cf7f390d` |
| `docs/ESG/WASN2022.docx` | `docs/00_Deliverables/ESG/WASN2022.docx` | `d1695e688fbffa2f093b2d5bdea105353d0c93ec5e439628da2f80e9151940ff` |
| `docs/ESG/Zty_畢業專題-ESG投稿.7z` | `docs/00_Deliverables/ESG/Zty_畢業專題-ESG投稿.7z` | `78adac96388eab877a216320303832873339c1568b632eb28a4d957e269f70bf` |
| `docs/ESG/教學影片 AI 問答系統.pdf` | `docs/00_Deliverables/ESG/教學影片 AI 問答系統.pdf` | `4fd56bf312f12e9871e8dac6c88b9a08434e811fdc5d7675c3e8252efd927a76` |
| `docs/ESG/教學影片 AI 問答系統.pptx` | `docs/00_Deliverables/ESG/教學影片 AI 問答系統.pptx` | `d4790e96de56eb2715997651ee57dc50ffc1d6899e706bfb40d60bf39dc95b9e` |
| `docs/ESG/教學影片 AI 問答系統V2_初評最終版.pptx` | `docs/00_Deliverables/ESG/教學影片 AI 問答系統V2_初評最終版.pptx` | `ac257beb900b12c595405a4d4d058c130f5249d76094eabccfc3c9324f0e5a66` |
| `docs/Keras_Learning_Reports/Week1/4ISH_KerasReports_Week1.pdf` | `docs/90_Archive/learning-reports/Week1/4ISH_KerasReports_Week1.pdf` | `65834d03b1f05b77ef982b4bf19a8ad7905d7a14ad81b1a1d70836a9c6094d9e` |
| `docs/Keras_Learning_Reports/Week1/940_KerasReports_Week1.pdf` | `docs/90_Archive/learning-reports/Week1/940_KerasReports_Week1.pdf` | `d5bc4180f5cb527ae50bcc4f403cd4d6379c4f2177773ec0af850350dd1d62c8` |
| `docs/Keras_Learning_Reports/Week1/Hao_KerasReports_Week1.pdf` | `docs/90_Archive/learning-reports/Week1/Hao_KerasReports_Week1.pdf` | `46907e4ea8adcc20a31dc80fe257ebd2a347fa7c0bbd7fcd2f8a6c8f6800ff65` |
| `docs/Keras_Learning_Reports/Week1/Zty_KerasReports_Week1.pdf` | `docs/90_Archive/learning-reports/Week1/Zty_KerasReports_Week1.pdf` | `134bcf1928b5957ff8c09ba071c7e8a61f4ac09d47c8f4c7c09f981e073ac86f` |
| `docs/Keras_Learning_Reports/Week2/4ISH_KerasReports_Week2.pdf` | `docs/90_Archive/learning-reports/Week2/4ISH_KerasReports_Week2.pdf` | `410ce821c1ba5bb879dab48b9eac37dae198a25eacc85b85bc8530ceb6d64ba1` |
| `docs/Keras_Learning_Reports/Week2/940_KerasReports_Week2.pdf` | `docs/90_Archive/learning-reports/Week2/940_KerasReports_Week2.pdf` | `eeef1c0a04f4f304d5e7d7978bc4afe8fb7a19cbda628c67ffd1c8a158fa1a74` |
| `docs/Keras_Learning_Reports/Week2/Hao_KerasReports_Week2.pdf` | `docs/90_Archive/learning-reports/Week2/Hao_KerasReports_Week2.pdf` | `d81e36fa195ee4103fcecd64ab89ff9cb5b2f36ecb207e01e3f05e3098cb56ba` |
| `docs/Keras_Learning_Reports/Week2/zty_專題學習進度檢核報告Week3 (1).pdf` | `docs/90_Archive/learning-reports/Week2/zty_專題學習進度檢核報告Week3 (1).pdf` | `67ea67265733f4874b20a119024b17a0bdad45f49a2957642164ce4102fadcd1` |
| `docs/Keras_Learning_Reports/Week3/4ISH_KerasReports_Week3.pdf` | `docs/90_Archive/learning-reports/Week3/4ISH_KerasReports_Week3.pdf` | `7f011593f1a0d3f4ca09f02f2dacdceea4cc8cfefcb3a3603b12744a11de04cb` |
| `docs/Keras_Learning_Reports/Week3/940_KerasReports_Week3.pdf` | `docs/90_Archive/learning-reports/Week3/940_KerasReports_Week3.pdf` | `e6a99521ba472032391ce642346a449035032e672340266e73c33393c4a3443b` |
| `docs/Keras_Learning_Reports/Week3/Hao_KerasReports_Week3.pdf` | `docs/90_Archive/learning-reports/Week3/Hao_KerasReports_Week3.pdf` | `7e6d430ee194f908af0809f9af5f8170d9cea2929e43dd129e188e0a241e864c` |
| `docs/Keras_Learning_Reports/Week3/zty_專題學習進度檢核報告Week3 (2).pdf` | `docs/90_Archive/learning-reports/Week3/zty_專題學習進度檢核報告Week3 (2).pdf` | `6725c84462c60d4a9d014c7d68778dbc81531ad04f59343a22229fc9328fed7a` |
| `docs/Keras_Learning_Reports/文件檔/940_深度學習4-3(迴歸).pdf` | `docs/90_Archive/learning-reports/文件檔/940_深度學習4-3(迴歸).pdf` | `9836cc176327fb4199361d4bec547a1264545b2a8a36befec0748ec20b042df0` |
| `docs/Keras_Learning_Reports/文件檔/940_深度學習9.pdf` | `docs/90_Archive/learning-reports/文件檔/940_深度學習9.pdf` | `1b1c1520562a82d552665aa843aa49eda298ca9926a5b7ec557d8dc442aaebf2` |
| `docs/Keras_Learning_Reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (10).md` | `docs/90_Archive/learning-reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (10).md` | `dbf15d88fe055c1810b12c91f8837543afdf01fcbd73b23c5bbeecf7ec2cc82b` |
| `docs/Keras_Learning_Reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (11).md` | `docs/90_Archive/learning-reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (11).md` | `43479c573acee5385f715d502ba40c02dffe45002060a84438aa829d8af2d527` |
| `docs/Keras_Learning_Reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (6).md` | `docs/90_Archive/learning-reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (6).md` | `8c7451ffa3baf038d2696577b8e2e05279bd653bfb9b6994dc7468818e730f3f` |
| `docs/Keras_Learning_Reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (7).md` | `docs/90_Archive/learning-reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (7).md` | `1bf489a58bfa64fb80ab5d63478d8f0ae361bd414aeebbed91cd9ff51f9a6356` |
| `docs/Keras_Learning_Reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (8).md` | `docs/90_Archive/learning-reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (8).md` | `fbe749e0267b8b520f060932af0de3818f0330259808757fa3548df018321662` |
| `docs/Keras_Learning_Reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (9).md` | `docs/90_Archive/learning-reports/文件檔/【Zty】0129第三次Meeting-文字資料的深度學習 (9).md` | `151a0b2cd660de677cdbe094530fa90059040df40e4845c21f299715f0035f59` |
| `docs/Keras_Learning_Reports/程式檔/940_2_CNN分類IMDB.ipynb` | `docs/90_Archive/learning-reports/程式檔/940_2_CNN分類IMDB.ipynb` | `272ee582808725fd1ddc6134f6408c15512916ce9788bb99fc9508a51cca4e15` |
| `docs/Keras_Learning_Reports/程式檔/940_3_RNN分類IMDB.ipynb` | `docs/90_Archive/learning-reports/程式檔/940_3_RNN分類IMDB.ipynb` | `75db794a09a625a106c0fd89aeaf8f92a36efe0abb0a12a4f78828d9ae079c64` |
| `docs/Keras_Learning_Reports/程式檔/940_4_LSTM分類IMDB.ipynb` | `docs/90_Archive/learning-reports/程式檔/940_4_LSTM分類IMDB.ipynb` | `1d3362b079236a9ca7162511474cc311c24d8013168479adb9a91bd33995ffec` |
| `docs/Keras_Learning_Reports/程式檔/940_深度學習4-3(迴歸).ipynb` | `docs/90_Archive/learning-reports/程式檔/940_深度學習4-3(迴歸).ipynb` | `3421717ce5fb9be965fbf21fd06a5573ca844bc47cb8437c9cb423b02e589676` |
| `docs/Keras_Learning_Reports/程式檔/940_深度學習CH09_PART01.ipynb` | `docs/90_Archive/learning-reports/程式檔/940_深度學習CH09_PART01.ipynb` | `c33dc26cd77527aecf44b63a435d31ef09cd7b3531024138314cbb63e8cb66aa` |
| `docs/Keras_Learning_Reports/程式檔/940_深度學習CH09_PART02.ipynb` | `docs/90_Archive/learning-reports/程式檔/940_深度學習CH09_PART02.ipynb` | `2f91807cdcbb52759ab1825bda671cfbb68fe1e2b46a17a06a1ee2a26d0cafc9` |
| `docs/Keras_Learning_Reports/程式檔/940_深度學習CH09_PART03.ipynb` | `docs/90_Archive/learning-reports/程式檔/940_深度學習CH09_PART03.ipynb` | `f3ab2d76622838f7549073e5d6fca958e54a9a89ccfeaad84596662895796e6f` |
| `docs/Keras_Learning_Reports/程式檔/【zty】電影評論-實作 (1).ipynb` | `docs/90_Archive/learning-reports/程式檔/【zty】電影評論-實作 (1).ipynb` | `1f3a765be795d7ad13d37850b364ee8002390bfc1da2018e7e9864097f63e06d` |
| `docs/Keras_Learning_Reports/程式檔/【zty】電影評論-實作 (2).ipynb` | `docs/90_Archive/learning-reports/程式檔/【zty】電影評論-實作 (2).ipynb` | `52deebf93fa6069b36e5f0be34c6e5d8b373aafb93c5190939a2ea1baf825c30` |
| `docs/Keras_Learning_Reports/程式檔/【zty】電影評論-實作 (3).ipynb` | `docs/90_Archive/learning-reports/程式檔/【zty】電影評論-實作 (3).ipynb` | `e7c7fdd26cb5b2d8a4aa82e7fce0999a2aaf614475d50d23ededd5a842338178` |
| `docs/Keras_Learning_Reports/程式檔/【zty】電影評論-實作 (4).ipynb` | `docs/90_Archive/learning-reports/程式檔/【zty】電影評論-實作 (4).ipynb` | `1cdbaebb8c573e479b39d8ba5efd2cf45d1dcf01ea1408125943648a722db5b6` |
| `docs/Keras_Learning_Reports/程式檔/【zty】電影評論-實作 (5).ipynb` | `docs/90_Archive/learning-reports/程式檔/【zty】電影評論-實作 (5).ipynb` | `8a7eced91cb8ab319716f1d744d292a9ee840713266471a8890a90c094c751f5` |
| `docs/MCP_SETUP.md` | `docs/40_Operations/MCP_SETUP.md` | `37a7d0376dd275b38710471ac0cbbcbf90306a22183d6c80a5e6df3bee200cb1` |
| `docs/Phase2-2_Hierarchical_Retrieval_Gate_Review.md` | `docs/20_Architecture/hierarchical-retrieval/Phase2-2_Hierarchical_Retrieval_Gate_Review.md` | `00fb9b22397046cfbea1729235cfdfda41ae7b99d963a57fb930dac1b0826af0` |
| `docs/Phase2-2_Hierarchy_Data_Contract_v1.md` | `docs/20_Architecture/hierarchical-retrieval/Phase2-2_Hierarchy_Data_Contract_v1.md` | `0f62803a3d9152fb88ae1a868fa1b49933670acaca0b6b3a306e20c6cfffe490` |
| `docs/Phase2-2_Limited_Hierarchical_Rollout_Plan.md` | `docs/20_Architecture/hierarchical-retrieval/Phase2-2_Limited_Hierarchical_Rollout_Plan.md` | `2f9a0e3e785dbb147a93f65daec7313d2372072598346faa5600155eb68bb125` |
| `docs/Phase2-2_Limited_Rollout_Control_Implementation.md` | `docs/20_Architecture/hierarchical-retrieval/Phase2-2_Limited_Rollout_Control_Implementation.md` | `cbd06605cf712c7e57ba07962a816072dcd699974cc87632890e8822655063ff` |
| `docs/Phase2-2_Step10_E2E_Test_Plan.md` | `docs/20_Architecture/hierarchical-retrieval/Phase2-2_Step10_E2E_Test_Plan.md` | `bb990f1bd807727268c2d6121e5ce72fc0381969d5bf38335a3fd762d835a664` |
| `docs/Phase2-2_Step9_Leaf_chunkId_Index_Report.md` | `docs/20_Architecture/hierarchical-retrieval/Phase2-2_Step9_Leaf_chunkId_Index_Report.md` | `bdb3edf91d1c58ba095614297aed161b3f051f54b2285e35958d771c46b00099` |
| `docs/Short_Video_Teacher_Token_Script_v1.md` | `docs/90_Archive/duplicates/Short_Video_Teacher_Token_Script_v1.md` | `526022df61676b2f0cdb2e3fb518f2b8c21a6bab682817a977e4db647167ee8d` |
| `docs/Short_Video_Test_Script_v1.md` | `docs/90_Archive/duplicates/Short_Video_Test_Script_v1.md` | `9300db140ce8ec313979858bbee18088179cf28047f0c2b51280ade6c7e76e2a` |
| `docs/ai-code-understanding-guide.md` | `docs/40_Operations/ai-code-understanding-guide.md` | `ae3db94f92840f049444a44d3ed3c9ae67a457af0005a6abd610958e37939239` |
| `docs/deploy/2026-09-10_Lets_Encrypt憑證申請紀錄.md` | `docs/40_Operations/deployment/2026-09-10_Lets_Encrypt憑證申請紀錄.md` | `580dae92b97f5e87d375dc06862dae92f311f92dc1802d120e0ca80749f80d23` |
| `docs/meeting-notes/00_2026-XX-XX_會議類型_簡短主題.md` | `docs/50_Meetings/00_2026-XX-XX_會議類型_簡短主題.md` | `467c67d0b08d5a73f25661f2c1c88f805cb146ffffab8a4899ec588629c2b4b5` |
| `docs/meeting-notes/README.md` | `docs/50_Meetings/README.md` | `7881f455f3fd63851ab9fe60d2ff478736a7b4706f0cece6ae2cd021ef9ffc82` |
| `docs/meeting-notes/教授會議/01_2026-01-22_教授會議_讀書彙報(寒假_1th).md` | `docs/50_Meetings/教授會議/01_2026-01-22_教授會議_讀書彙報(寒假_1th).md` | `eb6f30d80f3697bae813231d58462935d67745674376f0034ab7eff077b9ae3e` |
| `docs/meeting-notes/教授會議/02_2026-01-27_教授會議_讀書彙報(寒假_2th).md` | `docs/50_Meetings/教授會議/02_2026-01-27_教授會議_讀書彙報(寒假_2th).md` | `1d688d3e17d59475d09f1a5ad91f91ddb58382ebd3f1e250898a21dd8f392ac2` |
| `docs/meeting-notes/教授會議/03_2026-02-03_教授會議_讀書彙報(寒假_3th).md` | `docs/50_Meetings/教授會議/03_2026-02-03_教授會議_讀書彙報(寒假_3th).md` | `c9d6c576002b210a50f3e358b1948a4a2260a56660021b87d94c3235bc32c900` |
| `docs/meeting-notes/教授會議/04_2026-02-10_教授會議_讀書彙報(寒假_4th).md` | `docs/50_Meetings/教授會議/04_2026-02-10_教授會議_讀書彙報(寒假_4th).md` | `45a20a90888ef8c963d6546bf4d8f96e931858446ac9b67caf0ef5bc9ca245fe` |
| `docs/meeting-notes/教授會議/05_2026-02-24_教授會議_讀書彙報(過年後_1th).md` | `docs/50_Meetings/教授會議/05_2026-02-24_教授會議_讀書彙報(過年後_1th).md` | `07d9c3acfaf5a6ca3a47eaa5da83391fdcf44551c998058c42913391b5ed33f1` |
| `docs/meeting-notes/教授會議/06_2026-03-03_教授會議_開學後_1th.md` | `docs/50_Meetings/教授會議/06_2026-03-03_教授會議_開學後_1th.md` | `0cbb41618a1abe0609e5a94588a34b0460a3d2388e44fa35b65be960cd74c784` |
| `docs/meeting-notes/教授會議/07_2026-03-10_教授會議_確定題目_2th.md` | `docs/50_Meetings/教授會議/07_2026-03-10_教授會議_確定題目_2th.md` | `bd5d0d6afa437f3c2f460181af9f122a2026ece9f31971b12ecfa7bbe63256cb` |
| `docs/meeting-notes/教授會議/08_2026-03-24_教授會議_AI協作流程討論.md` | `docs/50_Meetings/教授會議/08_2026-03-24_教授會議_AI協作流程討論.md` | `712fa4c16be2eb968436ea305d4e3f0979a7f8940d44295f11098a03cd9597b0` |
| `docs/meeting-notes/教授會議/09_2026-03-31_教授會議_數位學習證明與MVP規劃.md` | `docs/50_Meetings/教授會議/09_2026-03-31_教授會議_數位學習證明與MVP規劃.md` | `2c75dfe79ee4245d631647d438ac5ca32607a9d6107ba8286b636e8efd4a10bf` |
| `docs/meeting-notes/教授會議/10_2026-04-07_教授會議_系統實作進度匯報與技術架構優化.md` | `docs/50_Meetings/教授會議/10_2026-04-07_教授會議_系統實作進度匯報與技術架構優化.md` | `f4589a4f1a2fe57f05386052ba4cc6862b89cf8167526596447ab0813b4e030f` |
| `docs/meeting-notes/教授會議/11_2026-04-21_教授會議_Phase1進度匯報與展示規劃.md` | `docs/50_Meetings/教授會議/11_2026-04-21_教授會議_Phase1進度匯報與展示規劃.md` | `c483ff78ad1415f966f87750697e33e49da895dedca24530912e83ff48631650` |
| `docs/meeting-notes/教授會議/12_2026-05-05_教授會議_計畫書優化與架構圖討論.md` | `docs/50_Meetings/教授會議/12_2026-05-05_教授會議_計畫書優化與架構圖討論.md` | `34e32049582658a6f873036d2f46dd2320c59794e761a7e2f606bc5b9a140f83` |
| `docs/meeting-notes/教授會議/13_2026-05-12_教授會議_計畫書各章節修訂.md` | `docs/50_Meetings/教授會議/13_2026-05-12_教授會議_計畫書各章節修訂.md` | `8c571078dcb87edff5651cf8bec525de8049ed2a7c1bc2e739853b1ffced568a` |
| `docs/meeting-notes/教授會議/14_2026-05-19_教授會議_簡報架構與競賽規劃.md` | `docs/50_Meetings/教授會議/14_2026-05-19_教授會議_簡報架構與競賽規劃.md` | `169ea9427647d8921c80998b59e51b4d54be8b99a8f771b335b9376cb562ce2f` |
| `docs/meeting-notes/教授會議/15_2026-06-02_教授會議_進度匯報.md` | `docs/50_Meetings/教授會議/15_2026-06-02_教授會議_進度匯報.md` | `7bd9c07c2802647d6add215db7d09c6540a2be61c01edebc735c12af4173938f` |
| `docs/meeting-notes/教授會議/16_2026-06-09_教授會議_第一階簡報練習.md` | `docs/50_Meetings/教授會議/16_2026-06-09_教授會議_第一階簡報練習.md` | `f25911d2e5d97b0f4f6364fa1c3c1c0f19a02e052af9f3c376448c03da316218` |
| `docs/meeting-notes/教授會議/17_2026-06-16_教授會議_初評檢討.md` | `docs/50_Meetings/教授會議/17_2026-06-16_教授會議_初評檢討.md` | `c2d3593ced69d8c1a279554c69068a5e210a4b85b5ddfae81ecc871d03100098` |
| `docs/meeting-notes/教授會議/18_2026-07-07_教授會議_Phase2規劃與上線部署討論.md` | `docs/50_Meetings/教授會議/18_2026-07-07_教授會議_Phase2規劃與上線部署討論.md` | `75dc21d44e4f8b72433cdfada25d49d85e4578b63c04d7bea049e6cdb3a02476` |
| `docs/meeting-notes/教授會議/19_2026-07-14_教授會議_營運效益分析與各組進度報告.md` | `docs/50_Meetings/教授會議/19_2026-07-14_教授會議_營運效益分析與各組進度報告.md` | `7c7c46256fb2b6dee9f7bf0883a6e421de37a0d5d1ab640f4117fd722f411195` |
| `docs/meeting-notes/教授會議/20_2026-07-28_教授會議_各組進度報告與競賽組別討論.md` | `docs/50_Meetings/教授會議/20_2026-07-28_教授會議_各組進度報告與競賽組別討論.md` | `d47568d80197491b8b6f9fad788e6b046a372f09f584323484616c4a6a6c90e4` |
| `docs/meeting-notes/教授會議/21_2026-08-04_教授會議_多層檢索進度與短影片生成方向調整.md` | `docs/50_Meetings/教授會議/21_2026-08-04_教授會議_多層檢索進度與短影片生成方向調整.md` | `48e5505a3874ee7b1f2f585ff7f082f43b8843a6f4acb3a5c89d015f44ad4140` |
| `docs/meeting-notes/教授會議/22_2026-08-11_教授會議_QA評測策略與短影片生成規劃.md` | `docs/50_Meetings/教授會議/22_2026-08-11_教授會議_QA評測策略與短影片生成規劃.md` | `99cf1f7e8a3d7a4259c48346a44f599fa49b30171722424d232c9ff95b447234` |
| `docs/meeting-notes/教授會議/23_2026-08-18_教授會議_系統上線與短影片審核規劃.md` | `docs/50_Meetings/教授會議/23_2026-08-18_教授會議_系統上線與短影片審核規劃.md` | `2a39425122351fa44b233c11efc372543394599c7f5a8e5fdfd9d308e021811f` |
| `docs/meeting-notes/組內會議/01_2025-07-13_組內會議_專題方向決策.md` | `docs/50_Meetings/組內會議/01_2025-07-13_組內會議_專題方向決策.md` | `7e1833ed2d9d5b2fa00b45f156696705ef81689f40473cfdc50dcb816803f1d6` |
| `docs/meeting-notes/組內會議/02_2025-09-11_組內會議_專題主題討論.md` | `docs/50_Meetings/組內會議/02_2025-09-11_組內會議_專題主題討論.md` | `f058bdbb8b3d983e59fcb7ce0eaec5500eb6e8bb0fa56db2547ae8a42993eeae` |
| `docs/meeting-notes/組內會議/03_2025-09-25_組內會議_專題方向腦力激盪.md` | `docs/50_Meetings/組內會議/03_2025-09-25_組內會議_專題方向腦力激盪.md` | `05c16c7b06efbafc5b7b37b3c46f603bf4159c96612f8b5aeec288b81fb84d19` |
| `docs/meeting-notes/組內會議/04_2026-01-22_組內會議_寒假規劃1.md` | `docs/50_Meetings/組內會議/04_2026-01-22_組內會議_寒假規劃1.md` | `463dfef3447f3da3b49af9ee0ca763f4f66756f7ad8ef3758114ada21e84bac6` |
| `docs/meeting-notes/組內會議/05_2026-02-01_組內會議_寒假規劃2.md` | `docs/50_Meetings/組內會議/05_2026-02-01_組內會議_寒假規劃2.md` | `72ac8ecd1a9f4ba4b09811d43ce222bcf68528811accb04a73f70fa60096c8a5` |
| `docs/meeting-notes/組內會議/06_2026-03-07_組內會議_討論專題題目(衣服與短影音).md` | `docs/50_Meetings/組內會議/06_2026-03-07_組內會議_討論專題題目(衣服與短影音).md` | `939272a4f0057a709a43955a7072e467757c1c6f88b4ee2f974737a1035455ca` |
| `docs/meeting-notes/組內會議/07_2026-03-11_組內會議_AI專案與ESG投稿初版討論.md` | `docs/50_Meetings/組內會議/07_2026-03-11_組內會議_AI專案與ESG投稿初版討論.md` | `5bba62035c519377b0b10edf15960c211f2b238db4e720b892fdcff40a014b9f` |
| `docs/meeting-notes/組內會議/08_2026-03-24_組內會議_寵物模組提案.md` | `docs/50_Meetings/組內會議/08_2026-03-24_組內會議_寵物模組提案.md` | `4a46520ae8769d9638d7ae615980bc284d9c9d84b52dcf8bbe3391baee078bd0` |
| `docs/meeting-notes/組內會議/09_2026-03-24_組內會議_專題方向討論.md` | `docs/50_Meetings/組內會議/09_2026-03-24_組內會議_專題方向討論.md` | `f118ac0149331e337e1871c47134c562e311873530f2e86f135b2c28991d9ae3` |
| `docs/meeting-notes/組內會議/10_2026-03-24_組內會議_Codex使用報告.md` | `docs/50_Meetings/組內會議/10_2026-03-24_組內會議_Codex使用報告.md` | `da533ed2de88bd7070bc1fe57fb69cb4505d363f32422f0b38bea63cc9e6d91d` |
| `docs/meeting-notes/組內會議/11_2026-03-31_組內會議_系統架構與開發分工.md` | `docs/50_Meetings/組內會議/11_2026-03-31_組內會議_系統架構與開發分工.md` | `d8c6d36d1aef4b5ee2a3ead21a2d1ed312b1139ecab5f511664d0fc9b20d503d` |
| `docs/meeting-notes/組內會議/12_2026-04-05_組內會議_LineBot與後端討論.md` | `docs/50_Meetings/組內會議/12_2026-04-05_組內會議_LineBot與後端討論.md` | `58417c758fe42daa2466ccabbf0c1189480097813a43cd8daa7d3cfe551e481c` |
| `docs/meeting-notes/組內會議/13_2026-04-05_組內會議_0405進度討論.md` | `docs/50_Meetings/組內會議/13_2026-04-05_組內會議_0405進度討論.md` | `f0701423370eb78d72d6c58b2fe9d32d39df72c8f966a99d273eb54f35b51e39` |
| `docs/meeting-notes/組內會議/14_2026-04-28_組內會議_0428進度討論.md` | `docs/50_Meetings/組內會議/14_2026-04-28_組內會議_0428進度討論.md` | `39766bd728265f7bd46faf7b41d3b5aa144e0c22590a0b963166e9618e6b925b` |
| `docs/meeting-notes/組內會議/15_2026-07-21_組內會議_任務分工與通知功能規劃.md` | `docs/50_Meetings/組內會議/15_2026-07-21_組內會議_任務分工與通知功能規劃.md` | `1b24dfdcc0bcfdaaa31687d0ada7f840e64065a0061d0fccfadcf2631322fb53` |
| `docs/project-progress-summary-2026-07-31.md` | `docs/10_Project_History/snapshots/project-progress-summary-2026-07-31.md` | `86585c38cce3b2788ab7d0ccf5efdcd4611673dc5582c753a7187da5d3353db0` |
| `docs/qa-eval/2026-08-24-評測結果.md` | `docs/30_Features/QA_Evaluation/reports/2026-08-24-評測結果.md` | `f4c6cf7e7f1238e987e0e87b58383d1ad752a2cd9961629f59306b749950e364` |
| `docs/qa-eval/2026-09-03-第二輪評測結果.md` | `docs/30_Features/QA_Evaluation/reports/2026-09-03-第二輪評測結果.md` | `d3f41e5eb5dfc31c557913130374c320e76824bf3d9e3ce37c2b6188e9a17014` |
| `docs/qa-eval/FocusFlow_QA評測_AI入門基礎課_v1.xlsx` | `docs/30_Features/QA_Evaluation/datasets/FocusFlow_QA評測_AI入門基礎課_v1.xlsx` | `745268ccc4eda39e0fd6b1659b24b340610ffe8e2c4ad450f5386797f823ef95` |
| `docs/qa-eval/README.md` | `docs/30_Features/QA_Evaluation/README.md` | `f23ec93d8131d3528c2179cb6e0c8578281a10aa9b257720cd46545f90a5eb1f` |
| `docs/qa-eval/question-bank.json` | `docs/30_Features/QA_Evaluation/datasets/question-bank.json` | `6ffe234cdbffd68d3a705240a74845d26aa45814b3d035a7b2ab7b518a5f52c3` |
| `docs/qa-eval/runs/2026-08-24T12-55-33-516Z/results.csv` | `docs/30_Features/QA_Evaluation/runs/2026-08-24T12-55-33-516Z/results.csv` | `60b881560dacaf85b5952e2c59e9a17f7471a8b64c0da4a228144d6c0d09b9f7` |
| `docs/qa-eval/runs/2026-08-24T12-55-33-516Z/results.json` | `docs/30_Features/QA_Evaluation/runs/2026-08-24T12-55-33-516Z/results.json` | `88e5c550999fa240ce56e393f69cc8f6e79150aa466f6bbe3884b1eeb66215ee` |
| `docs/qa-eval/runs/2026-08-24T13-00-40-654Z/results.csv` | `docs/30_Features/QA_Evaluation/runs/2026-08-24T13-00-40-654Z/results.csv` | `422200c8630fdc407eecde691d6129827df16d4d23682633491d618702091cf4` |
| `docs/qa-eval/runs/2026-08-24T13-00-40-654Z/results.json` | `docs/30_Features/QA_Evaluation/runs/2026-08-24T13-00-40-654Z/results.json` | `7ce3b645a6647e5ac1ad6db0fa6e9a2f4cb1142021b9af1db96583c0c531b52c` |
| `docs/qa-eval/runs/2026-09-03T10-20-49-416Z/results.csv` | `docs/30_Features/QA_Evaluation/runs/2026-09-03T10-20-49-416Z/results.csv` | `4aa09af0523d0827257e8f1ba5a3bcd4f6a80f59d86e9ea58a06a87c76c8f825` |
| `docs/qa-eval/runs/2026-09-03T10-20-49-416Z/results.json` | `docs/30_Features/QA_Evaluation/runs/2026-09-03T10-20-49-416Z/results.json` | `51976a445d336ce9dc08205284dfecd7448ae2061b2853e91f3cb339aef442e6` |
| `docs/short-video-examples/01-ai-ambient-cards.md` | `docs/30_Features/Short_Video/examples/01-ai-ambient-cards.md` | `f7024eb5aadcf5a99fba0a9d95ab2c662b9299e9289aad0c7c8af9221592bb48` |
| `docs/short-video-examples/02-teacher-piece-to-camera.md` | `docs/30_Features/Short_Video/examples/02-teacher-piece-to-camera.md` | `fd13edd3c5c878dd1338287b831415863be2fd3fd03773c12d47286d84b5ef51` |
| `docs/short-video-examples/03-seamless-loop.md` | `docs/30_Features/Short_Video/examples/03-seamless-loop.md` | `c7ffa15205c48c1a5a85acc84248ff52359ea3c6cd4ab407cd7ebbfe8498dd4d` |
| `docs/short-video-examples/04-question-and-answer.md` | `docs/30_Features/Short_Video/examples/04-question-and-answer.md` | `f3ca5d1051949bee3d5fbaa2ec1496ce2091a3cd39feecec82f6bb8b55d58465` |
| `docs/short-video-examples/05-handwriting-whiteboard.md` | `docs/30_Features/Short_Video/examples/05-handwriting-whiteboard.md` | `3cb28e91e2cab0643a814f071029f79849c91041f396f966f1f5a3fb130f9cf2` |
| `docs/short-video-examples/06-lecture-recut.md` | `docs/30_Features/Short_Video/examples/06-lecture-recut.md` | `8330e9dee785a2751891201dcaeac6f807b8dc49275201a5210228c1a2bffab9` |
| `docs/short-video-examples/07-wrong-vs-right.md` | `docs/30_Features/Short_Video/examples/07-wrong-vs-right.md` | `8d61ddc216d3c2f543a1dfce955f59a265a3443e276d6b8c4935eec57683f78c` |
| `docs/short-video-examples/08-object-demo.md` | `docs/30_Features/Short_Video/examples/08-object-demo.md` | `d553deb1a76e9e03c893c1dcd150de82c67f6e8f84d42ee1c76041e825ed4809` |
| `docs/short-video-examples/09-three-points-kinetic.md` | `docs/30_Features/Short_Video/examples/09-three-points-kinetic.md` | `5df545301913b0ce3243a6ea8744afab641e930d1d547740eef21d7c318b44ba` |
| `docs/short-video-examples/10-teacher-avatar-metaphor.md` | `docs/30_Features/Short_Video/examples/10-teacher-avatar-metaphor.md` | `7d657eeaf8c35484087b46749b5ba31a92dbf93a66f4fc191a8541fc05487e64` |
| `docs/short-video-examples/Phase2_Short_Video_Production_Spec_v1.md` | `docs/30_Features/Short_Video/specs/Phase2_Short_Video_Production_Spec_v1.md` | `facb69071e2ea14826f50a2da302b087757ea674328ef55e58d3a5ee3caa4a8a` |
| `docs/short-video-examples/README.md` | `docs/30_Features/Short_Video/examples/README.md` | `88407168f5bf81cce573e93c7e8cb30b06b5720bf9d83931be3c5d89957df97a` |
| `docs/short-video-examples/Short_Video_Key_Points_v1.md` | `docs/30_Features/Short_Video/specs/Short_Video_Key_Points_v1.md` | `3d9b37904609105f15c58a6f989935e4ef3a4e0e2fb217d83aed0c71f5ebfb33` |
| `docs/short-video-examples/Short_Video_Script_Example_v1.md` | `docs/30_Features/Short_Video/specs/Short_Video_Script_Example_v1.md` | `9b51647a594f7d04b06c01d7812b6bed7c52db206b3b4eeec857218f6a0d2a58` |
| `docs/short-video-examples/Short_Video_Teacher_Token_Script_v1.md` | `docs/30_Features/Short_Video/specs/Short_Video_Teacher_Token_Script_v1.md` | `526022df61676b2f0cdb2e3fb518f2b8c21a6bab682817a977e4db647167ee8d` |
| `docs/short-video-examples/Short_Video_Test_Script_v1.md` | `docs/30_Features/Short_Video/specs/Short_Video_Test_Script_v1.md` | `9300db140ce8ec313979858bbee18088179cf28047f0c2b51280ade6c7e76e2a` |
| `docs/short-video-examples/teacher-avatar-track/4ish_腳本V4_大語言模型是什麼.md` | `docs/30_Features/Short_Video/examples/teacher-avatar-track/4ish_腳本V4_大語言模型是什麼.md` | `80b95ceb441c2a5fc5909b656e29155a821192ed1073c5da79822d257bba4240` |
| `docs/short-video-examples/teacher-avatar-track/4ish_腳本V5_OpenCV與YOLO的差異.md` | `docs/30_Features/Short_Video/examples/teacher-avatar-track/4ish_腳本V5_OpenCV與YOLO的差異.md` | `eb5f8938f56c4a74bf129fb47f63f3fc787884a37c96cf323a0bed323c702683` |
