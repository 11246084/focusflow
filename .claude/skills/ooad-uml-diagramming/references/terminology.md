# 術語對照

`[NTUB:MUST]` 格式一律 `繁體中文（English Name）`。首次出現標英文，其後只用中文 preferred term。

`[DOC:MUST]` 每個概念**只允許一個 preferred term**。alias 可以理解，但不得產出。

## UML 圖種

| Preferred term | English | Alias（可理解，不產出） | 禁用 |
|---|---|---|---|
| **佈署圖** | Deployment Diagram | 部署圖 | — |
| **循序圖** | Sequence Diagram | 順序圖、序列圖 | **時序圖** |
| **時序圖** | Timing Diagram | 時間圖 | — |
| **狀態機圖** | State Machine Diagram | 狀態圖、狀態機 | — |
| **使用個案圖** | Use Case Diagram | 用例圖、使用案例圖、用況圖 | — |
| **活動圖** | Activity Diagram | 活動流程圖 | — |
| **類別圖** | Class Diagram | 類圖 | — |
| **物件圖** | Object Diagram | 對象圖、實例圖 | — |
| **套件圖** | Package Diagram | 包圖 | — |
| **元件圖** | Component Diagram | 構件圖、組件圖 | — |
| **通訊圖** | Communication Diagram | 協作圖、合作圖 | — |
| **互動概觀圖** | Interaction Overview Diagram | 交互概覽圖 | — |
| **複合結構圖** | Composite Structure Diagram | 組合結構圖 | — |
| **輪廓圖** | Profile Diagram | 剖面圖、設定檔圖 | — |

### 「時序圖」的唯一用法

`[DOC:MUST]` 「時序圖」**僅指** Timing Diagram。

中國大陸慣例常把 Sequence Diagram 譯為「時序圖」，本手冊**不採用**。Sequence Diagram
一律稱「循序圖」。若在既有文件中看到「時序圖」而上下文明顯在講物件訊息往返，視為誤譯，
應改為「循序圖」。

## OOAD 模型與 artifacts

| Preferred term | English | Alias |
|---|---|---|
| **物件導向系統分析與設計** | Object-Oriented Analysis and Design, OOAD | 物件導向分析與設計 |
| **領域模型** | Domain Model | 網域模型、問題領域模型 |
| **分析類別圖** | Analysis Class Diagram | — |
| **分析物件圖** | Analysis Object Diagram | — |
| **設計類別圖** | Design Class Diagram | — |
| **設計物件圖** | Design Object Diagram | — |
| **邊界／控制／實體** | Boundary / Control / Entity | B/C/E |
| **強健性圖** | Robustness Diagram | 健壯性圖、穩健圖 |
| **類別-責任-協作卡** | Class-Responsibility-Collaboration Card, CRC Card | CRC 卡 |
| **使用個案實現** | Use-Case Realization | 用例實現 |
| **使用個案描述** | Use Case Description | 用例描述 |
| **系統循序圖** | System Sequence Diagram, SSD | — |
| **行為者** | Actor | 參與者、角色 |
| **詞彙表** | Glossary | 名詞表 |

## 五個模型

| Preferred term | English |
|---|---|
| **需求模型** | Requirement Model |
| **分析模型** | Analysis Model |
| **設計模型** | Design Model |
| **實作模型** | Implementation Model |
| **測試模型** | Test Model |

## 非 UML 圖

| Preferred term | English | 備註 |
|---|---|---|
| **系統架構圖** | System Architecture Diagram | 非 UML，須標示 |
| **實體關聯圖** | Entity-Relationship Diagram, ERD | 非 UML，須標示 |
| **集合關聯圖** | Collection Relationship Diagram | 非 UML，文件型資料庫用 |
| **執行環境拓撲圖** | Runtime Topology Diagram | 非 UML，須標示 |
| **畫面移轉圖** | Screen Transition Diagram | 非 UML，須標示 |
| **甘特圖** | Gantt Chart | 非 UML |

---

## 官方用字 vs UML 正式名稱

`[NTUB:MUST]` **章節標題**沿用官方規範用字；`[UML:MUST]` **圖說與內文**使用 UML 正式名稱。

| 章節 | 官方規範用字 | 圖說與內文使用 |
|---|---|---|
| 6-1 | 循序圖（Sequential diagram） | 循序圖（Sequence Diagram） |
| 6-1 | 通訊圖（Communication diagram） | 通訊圖（Communication Diagram） |
| 7-1 | 佈署圖（Deployment diagram） | 佈署圖（Deployment Diagram） |
| 7-4 | 狀態機（State machine） | 狀態機圖（State Machine Diagram） |
| 7-4 | 時序圖（Timing diagram） | 時序圖（Timing Diagram） |
| 5-3 | 活動圖（Activity diagram） | 活動圖（Activity Diagram） |
| 5-4 | 分析類別圖（Analysis class diagram） | 分析類別圖（Analysis Class Diagram） |
| 6-2 | 設計類別圖（Design class diagram） | 設計類別圖（Design Class Diagram） |

官方在部分處使用 `Sequential diagram`（UML 正式為 `Sequence Diagram`）與「狀態機」
（未加「圖」）。章節標題必須與規範一致以符合大綱要求，內文則使用正確名稱。

---

## 領域名詞

`[FF:SHOULD]` 專案領域名詞以專案詞彙表為唯一來源。同一概念不得在不同章節出現不同譯法。

繪圖時遇到未收錄的領域名詞：先查專案詞彙表；查無則沿用程式碼或 schema 中的既有命名，
並在圖說標註「此名詞尚未收錄於詞彙表」。**不得自行創造新譯名**。
