# FocusFlow 文件總覽

多模態本機展示的操作見 [Demo README](../backend/scripts/multimodal-demo/README.md)，提交與驗證紀錄見 [進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。

多模態資料查證見 [唯讀診斷工具](../backend/scripts/multimodal-diagnostics/README.md)與 [2026-11-10 Atlas 查證報告](04_Features/Multimodal_Retrieval/evidence/2026-11-10-atlas-diagnostics.md)。

多模態第二階段使用方式見 [Gemini／Atlas adapters](04_Features/Multimodal_Retrieval/phase2-adapters.md)，驗證依據見 [2026-11-10 第二階段紀錄](04_Features/Multimodal_Retrieval/evidence/2026-11-10-phase2.md)。

真實 Gemini 小樣本的授權清單、執行指令與無付費預演見 [2026-11-10 執行前檢查](04_Features/Multimodal_Retrieval/evidence/2026-11-10-preflight.md)。

授權後的 12 筆真實結果、相似度、排名與費用核對見 [2026-11-10 真實小樣本](04_Features/Multimodal_Retrieval/evidence/2026-11-10-live-sample.md)。

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
├─ 07_HTML說明頁/      給人看的 HTML 說明頁（用瀏覽器打開）；README 是清單
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
| [03 競賽](03_競賽/README.md) | 各場送件版、修訂稿、評審意見與空白表格；[InnoServe 鈦坦敏捷特別獎決賽準備](03_競賽/2026_資訊應用服務創新競賽/決賽準備_鈦坦敏捷開發特別獎.md)、[敏捷開發簡報工作資料夾](03_競賽/2026_資訊應用服務創新競賽/敏捷開發簡報/01_資料分析/08_簡報策略建議.md) |
| [04 Features](04_Features/README.md) | 功能規格與驗收證據，含[分層檢索](04_Features/Hierarchical_Retrieval/README.md)、[YouTube 恢復與清理](04_Features/YouTube_Lifecycle/decisions.md)、[系統設定](04_Features/System_Settings/decisions.md)、[recut 教師體驗評估素材](04_Features/Short_Video/evidence/README.md)、[自研方法與比較實驗](04_Features/Research_Methods/自研方法與比較實驗.md) |
| [05 圖庫](05_圖庫/README.md) | 架構、研究架構、Logo、手冊各章圖號與原始碼 |
| [06 會議紀錄](06_會議紀錄/README.md) | 教授與組內會議原文 |
| [07 HTML說明頁](07_HTML說明頁/README.md) | 給人看的任務說明頁：[多模態檢索](07_HTML說明頁/多模態檢索.html)、[LINE 綁定](07_HTML說明頁/LINE綁定.html) |
| [10 Operations](10_Operations/README.md) | 開發、維運、[部署排錯](10_Operations/deployment/部署與連線排錯.md)、[VM 資安檢查](10_Operations/deployment/2026-10-23_VM資安檢查報告.md)與[資料庫交付](10_Operations/database-delivery.md) |
| [90 Archive](90_Archive/README.md) | 快照、重整紀錄、被取代方案與歷史原件 |
| [目前狀態](current-status.md) | 唯一功能狀態正本 |
| [重要決策](decision-log.md) | 決策原因與影響 |
| [文件分類待遷移清單](md-audit.md) | 交件後分工與整理工作 |
| [本次重整規格](90_Archive/docs-reorganization/docs-restructure-plan-2026-10-18.md) | 搬移對照與驗證要求，保留原文 |

複評回放：[2026-10-22 報告與 QA 整理](01_系統手冊/審查與修訂/2026-10-22_複評回放/報告與QA整理.md)、[評審問答](01_系統手冊/審查與修訂/2026-10-22_複評回放/評審問答.md)、[時間戳逐字稿](01_系統手冊/審查與修訂/2026-10-22_複評回放/時間戳逐字稿.md)、[後續處理總表](01_系統手冊/審查與修訂/2026-10-22_複評回放/後續處理總表.md)。

## 文件責任

YouTube Q 整合：[2026-10-29 本機驗收證據](04_Features/YouTube_Lifecycle/evidence/2026-10-29_q-integration.md)、[部署與退回程序](10_Operations/deployment/部署與連線排錯.md#youtube-q-原片暫存播放與部署順序)、[後端文件入口](../backend/docs/README.md)。
recut 後端接手：[RC1 資料、狀態機與背景工作](../backend/docs/recut-foundation.md)（集合、句子格式、RC2／RC3／RC8 介面）；本機變更紀錄沿用 [implementation-log](../backend/docs/implementation-log.md)。

recut 原片處理：[連續視窗、音量與切句規則](../backend/docs/recut-source.md)。

recut 選段：[指示文字、驗證與共用呼叫介面](../backend/docs/recut-selection.md)。

recut 工程交付：[離線互動報告](07_HTML說明頁/Recut工程交付報告.html)。

recut 教師審閱：[RC8 API、草稿與 RC4／RC9 接手](../backend/docs/recut-review.md)；[前端串接交接草稿](../backend/docs/recut-integration-handoff.md)。

recut 同意與撤回：[RC10 條款、範圍與持久重試設計](../backend/docs/recut-consent.md)（交付候選整合中）。

YouTube 第三輪定案規格：[共用資料契約 Q-0](04_Features/YouTube_Lifecycle/shared-data-contract.md)、[Q-A～Q-F 工作說明](04_Features/YouTube_Lifecycle/work-orders/Q-quota-playback-plan.md)、[額度與上傳可靠性研究](04_Features/YouTube_Lifecycle/quota-upload-research.md)、[原片暫存播放研究](04_Features/YouTube_Lifecycle/local-playback-research.md)。

YouTube F3／F4：[2026-10-27 修復與隔離驗證](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f3-f4-fixes.md)，記錄 R07、R10～R12 的來源重新處理、總覽與並行稽核證據。

設計討論入口：[recut 預覽與選段說明](04_Features/Short_Video/decisions.md)、[httpOnly cookie 登入](04_Features/HttpOnly_Cookie/decisions.md)、[Jev 問題守門與 LINE 分類](04_Features/Jev_Judgment/decisions.md)、[LINE 帳號綁定](04_Features/LINE_Binding/decisions.md)（[開發接手說明](04_Features/LINE_Binding/HANDOFF.md)）、[學生端播放介面與章節](04_Features/Student_Player_UX/decisions.md)、[多模態檢索](04_Features/Multimodal_Retrieval/decisions.md)（[開發接手說明](04_Features/Multimodal_Retrieval/HANDOFF.md)、[參考文獻](04_Features/Multimodal_Retrieval/references.md)）、[教育開放資料補強](04_Features/Open_Data/decisions.md)、[recut 產製設計](04_Features/Short_Video/recut-design-decisions.md)（[chunk 版本契約](04_Features/Short_Video/chunk-version-contract.md)）、[教師短影片腳本與成品上傳流程](04_Features/Short_Script_Automation/decisions.md)。各文件的「目前這一輪待答題目」保留問題、建議答案與理由，供逐題討論。

recut 畫面重做：[設計方案與自評](04_Features/Short_Video/evidence/2026-10-21_recut-teacher-ux/design-review.md)，保留技能使用、視覺取捨與實際檢查證據。

YouTube 恢復與清理：[2026-10-26 F0～F2 獨立審查](04_Features/YouTube_Lifecycle/evidence/2026-10-26_f0-f2-review.md)，記錄交錯重現、共享資料庫限制、舊資料相容性與測試辨識力。

YouTube 審查修復：[2026-10-27 FR01～FR06 修復與複驗交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_fr01-fr06-fixes.md)，記錄修改、跨行程回歸與修正前對照結果。

YouTube 再複驗修復：[2026-10-27 NR01／NR02 修復交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_nr01-nr02-fixes.md)，記錄過期清理接管、課程刪除交易、持久外部工作與故障回歸。

YouTube 收尾複驗：[2026-10-27 F0～F2 最終審查與驗證](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f0-f2-final-review.md)，記錄阻斷問題判定、外部待辦期限修復及最終驗收證據。

根目錄 [README](../README.md) 負責啟動導覽，[PROJECT](../PROJECT.md) 負責產品範圍，[ARCHITECTURE](../ARCHITECTURE.md) 負責穩定架構，[AGENTS](../AGENTS.md) 負責代理工作入口。技術細節仍由 [Backend](../backend/docs/)、[Pipeline](../STT_Whisper/README.md)、[Database](../database/README.md) 維護。進度與狀態只寫在狀態正本；歷史原文與會議紀錄不改內文。

新增或整理文件時，依[文件類型與寫法](../.claude/skills/docs-maintainer/references/doc-types.md)決定放哪裡、怎麼寫。

大檔與舊版存在雲端「學校專題」：ESG 投稿見[永續研討會 ESG 投稿](03_競賽/2026_永續研討會ESG投稿/README.md)，初評時期的架構圖與簡介 PDF 見[圖庫說明](05_圖庫/README.md)。

組員任務的進度與回報：[多模態](04_Features/Multimodal_Retrieval/HANDOFF.md)與 [LINE 綁定](04_Features/LINE_Binding/HANDOFF.md)的 agent 在各自的 `evidence/` 寫 `進度.md`（每次 commit 後更新）與 `<日期>_回報.md`、`<日期>_retrieval-comparison/report.md` 等驗收紀錄，登記於此，不必逐檔新增。
