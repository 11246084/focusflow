# 功能狀態總表

整理日期：2026-09-13。依目前 repository 文件彙整，未於本輪重跑功能驗收；各列連結才是詳細結果來源。

| 功能／工作流 | 開發階段 | 已有證據層級與日期 | 可用／已實作範圍（依來源） | 主要缺口 | 規格與最新紀錄 |
|---|---|---|---|---|---|
| 學生試用版後端 | 實作完成部分項目，驗收中 | 2026-08-30 本機回歸；9 月 baseline／PoC 原始結果 | Phase 1、修課隔離及問答驗收工作 | 正式 final 四類證據未齊；PoC 不等於全部試用驗收 | [規格](Student_Pilot_Backend/specs/2026-09_Student_Pilot_Backend_Spec.md)、[功能入口](Student_Pilot_Backend/README.md)、[證據](Student_Pilot_Backend/evidence/) |
| 短腳本自動生成 | 已有實作，分階段驗收中 | 2026-09-04 SP-1／SP-2 與真實 LLM 試跑紀錄；9/10 README 更新 | 資料／腳本生成與教師端操作；成品上架有實作 | SP-3 live 發布未通過、品質及同意書待定 | [規格](Short_Script_Automation/specs/2026-09_Short_Script_Automation_Spec.md)、[入口與關卡](Short_Script_Automation/README.md) |
| 短影片產製 | 模板及規劃可用，流程驗收待確認 | 腳本／呈現手法與教師分身範例；非完整發布證據 | 十種呈現手法與腳本材料 | 實際產製、審核、上架與可播放的完整證據 | [入口](Short_Video/README.md)、[產製規格](Short_Video/specs/Phase2_Short_Video_Production_Spec_v1.md) |
| QA 評測（持續性工作） | 已有兩輪結果，持續評測 | 2026-08-24、2026-09-03 題庫報告／raw results | 指定 AI 入門課 50 題評測 | 檢索覆蓋弱項、跨資料集與正式驗收 | [方法與題庫](QA_Evaluation/README.md)、[第二輪報告](QA_Evaluation/reports/2026-09-03-第二輪評測結果.md) |
| 階層式檢索 | 已有實作與 rollout 設計，環境資格另驗 | 設計／索引／Gate 文件及歷史結果 | Parent／Leaf 契約與受控檢索 | active generation、index 與 live E2E 不可由文件搬移推定 | [設計入口](../20_Architecture/hierarchical-retrieval/README.md)、[跨服務狀態](../current-status.md) |
| 身分／課程／影片／Web 與 LINE QA／通知等核心功能 | 已有實作，按功能維護與驗收 | 詳見服務文件所列日期；本輪未重驗 | 三角色、課程內容授權、影片處理、問答與引用等 | 各功能正式環境與瀏覽器驗收範圍待逐項核對 | [目前狀態](../current-status.md)、[後端現況](../../backend/docs/current-state.md) |

## 如何維護

- 階段可用「提案中、規格確認、開發中、驗收中、已完成、維護中、暫停、已下線」。已完成須明列完成範圍。
- 證據分別記錄：本機單元／mock、隔離整合、瀏覽器、外部 provider／Atlas、正式環境。各層可獨立通過，不能只用一個綠燈取代。
- 每次狀態變動更新本表、來源日期及功能 README，新增可追溯證據。全站影響再摘要到 `current-status.md`。
- 功能完成後留在原目錄。只有被取代版本進入功能 `archive/`；下線功能進入全域 `retired-features/`。
- 本表涵蓋目前已有的功能文件集與核心能力入口；未逐一建立文件集的功能不假造完成狀態。
