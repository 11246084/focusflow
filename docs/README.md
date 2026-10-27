# FocusFlow 文件總覽

這裡依用途收錄學校公告、交付文件、功能規格與圖檔，讓常用內容最多點兩層就能找到。請先查[目前狀態](current-status.md)，再從下表進入需要的文件；歷史快照只供追溯。

## 資料夾架構

編號 `0x` 是常開的資料夾，`10` 以上較少用，`90` 是歷史。學校與評審相關用中文命名，開發用及程式會讀寫的資料夾用英文。

```text
docs/
├─ 00_學校公告/        繳交清單（README）＋學校發的規範、表單
├─ 01_系統手冊/
│   ├─ chapters/       15 章 Markdown 母稿（改手冊只改這裡）
│   ├─ output/         交件用 PDF
│   ├─ tools/          建置程式、版型範本（templates/）、版面報告（layout/）
│   └─ 審查與修訂/     初評建議、評審提問、各章修改說明
├─ 02_系統簡介/        簡介母稿、output/、tools/
├─ 03_競賽/            每場比賽一個資料夾：送件版/、修訂稿/、評審意見/、官方空白表格/
├─ 04_Features/        每個功能一個資料夾，常見子資料夾：specs/ 規格、work-orders/ 工單、evidence/ 證據
├─ 05_圖庫/            所有圖檔；README 是圖目錄
│   ├─ 架構圖/         手冊、簡介、競賽共用的系統架構圖（含 Archify 互動版）
│   ├─ 研究架構圖/
│   ├─ Logo/
│   └─ 系統手冊/       只有手冊用的圖，依章節 ch01～ch15 放，成品與原始碼同資料夾
├─ 06_會議紀錄/        教授會議/、組內會議/、會議範本
├─ 10_Operations/      部署紀錄、MCP 設定、資料庫交付說明
└─ 90_Archive/         snapshots/ 快照、docs-reorganization/ 整理紀錄、superseded/ 被取代方案、
                       chat-history/、learning-reports/、external-examples/ 參考手冊
```

例：要改第 5 章的使用個案圖 → 到 `05_圖庫/系統手冊/ch05/` 改原始碼並重新產圖 → 在 `01_系統手冊/tools/` 執行建置，`output/` 的 PDF 隨之更新。

## 文件入口

| 入口 | 用途 |
|---|---|
| [00 學校公告](00_學校公告/README.md) | 繳交清單、期限、官方規範與空白表單 |
| [01 系統手冊](01_系統手冊/README.md) | 15 章 Markdown、交件成品、建置工具及審查修訂 |
| [02 系統簡介](02_系統簡介/README.md) | 七節簡介、Word／PDF 與建置方式 |
| [03 競賽](03_競賽/README.md) | 各場送件版、修訂稿、評審意見與空白表格；[InnoServe 鈦坦敏捷特別獎決賽準備](03_競賽/2026_資訊應用服務創新競賽/決賽準備_鈦坦敏捷開發特別獎.md) |
| [04 Features](04_Features/README.md) | 功能規格與驗收證據，含[分層檢索](04_Features/Hierarchical_Retrieval/README.md)、[YouTube 恢復與清理](04_Features/YouTube_Lifecycle/decisions.md)、[系統設定](04_Features/System_Settings/decisions.md)、[recut 教師體驗評估素材](04_Features/Short_Video/evidence/README.md)、[自研方法與比較實驗](04_Features/Research_Methods/自研方法與比較實驗.md) |
| [05 圖庫](05_圖庫/README.md) | 架構、研究架構、Logo、手冊各章圖號與原始碼 |
| [06 會議紀錄](06_會議紀錄/README.md) | 教授與組內會議原文 |
| [10 Operations](10_Operations/README.md) | 開發、維運、[部署排錯](10_Operations/deployment/部署與連線排錯.md)、[VM 資安檢查](10_Operations/deployment/2026-10-23_VM資安檢查報告.md)與[資料庫交付](10_Operations/database-delivery.md) |
| [90 Archive](90_Archive/README.md) | 快照、重整紀錄、被取代方案與歷史原件 |
| [目前狀態](current-status.md) | 唯一功能狀態正本 |
| [重要決策](decision-log.md) | 決策原因與影響 |
| [文件分類待遷移清單](md-audit.md) | 交件後分工與整理工作 |
| [本次重整規格](90_Archive/docs-reorganization/docs-restructure-plan-2026-10-18.md) | 搬移對照與驗證要求，保留原文 |

複評回放：[2026-10-22 報告與 QA 整理](01_系統手冊/審查與修訂/2026-10-22_複評回放/報告與QA整理.md)、[評審問答](01_系統手冊/審查與修訂/2026-10-22_複評回放/評審問答.md)、[時間戳逐字稿](01_系統手冊/審查與修訂/2026-10-22_複評回放/時間戳逐字稿.md)、[後續處理總表](01_系統手冊/審查與修訂/2026-10-22_複評回放/後續處理總表.md)。

## 文件責任

YouTube 第三輪定案規格：[共用資料契約 Q-0](04_Features/YouTube_Lifecycle/shared-data-contract.md)、[Q-A～Q-F 工作說明](04_Features/YouTube_Lifecycle/work-orders/Q-quota-playback-plan.md)、[額度與上傳可靠性研究](04_Features/YouTube_Lifecycle/quota-upload-research.md)、[原片暫存播放研究](04_Features/YouTube_Lifecycle/local-playback-research.md)。

設計討論入口：[recut 預覽與選段說明](04_Features/Short_Video/decisions.md)、[httpOnly cookie 登入](04_Features/HttpOnly_Cookie/decisions.md)、[Jev 問題守門與 LINE 分類](04_Features/Jev_Judgment/decisions.md)、[LINE 帳號綁定](04_Features/LINE_Binding/decisions.md)、[學生端播放介面與章節](04_Features/Student_Player_UX/decisions.md)、[多模態檢索](04_Features/Multimodal_Retrieval/decisions.md)（[參考文獻](04_Features/Multimodal_Retrieval/references.md)）、[教育開放資料補強](04_Features/Open_Data/decisions.md)、[recut 產製設計](04_Features/Short_Video/recut-design-decisions.md)、[教師短影片腳本與成品上傳流程](04_Features/Short_Script_Automation/decisions.md)。各文件的「目前這一輪待答題目」保留問題、建議答案與理由，供逐題討論。

recut 畫面重做：[設計方案與自評](04_Features/Short_Video/evidence/2026-10-21_recut-teacher-ux/design-review.md)，保留技能使用、視覺取捨與實際檢查證據。

YouTube 恢復與清理：[2026-10-26 F0～F2 獨立審查](04_Features/YouTube_Lifecycle/evidence/2026-10-26_f0-f2-review.md)，記錄交錯重現、共享資料庫限制、舊資料相容性與測試辨識力。

YouTube 審查修復：[2026-10-27 FR01～FR06 修復與複驗交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_fr01-fr06-fixes.md)，記錄修改、跨行程回歸與修正前對照結果。

YouTube 再複驗修復：[2026-10-27 NR01／NR02 修復交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_nr01-nr02-fixes.md)，記錄過期清理接管、課程刪除交易、持久外部工作與故障回歸。

YouTube 收尾複驗：[2026-10-27 F0～F2 最終審查與驗證](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f0-f2-final-review.md)，記錄阻斷問題判定、外部待辦期限修復及最終驗收證據。

根目錄 [README](../README.md) 負責啟動導覽，[PROJECT](../PROJECT.md) 負責產品範圍，[ARCHITECTURE](../ARCHITECTURE.md) 負責穩定架構，[AGENTS](../AGENTS.md) 負責代理工作入口。技術細節仍由 [Backend](../backend/docs/)、[Pipeline](../STT_Whisper/README.md)、[Database](../database/README.md) 維護。進度與狀態只寫在狀態正本；歷史原文與會議紀錄不改內文。

新增或整理文件時，依[文件類型與寫法](../.claude/skills/docs-maintainer/references/doc-types.md)決定放哪裡、怎麼寫。

大檔與舊版存在雲端「學校專題」：ESG 投稿見[永續研討會 ESG 投稿](03_競賽/2026_永續研討會ESG投稿/README.md)，初評時期的架構圖與簡介 PDF 見[圖庫說明](05_圖庫/README.md)。
