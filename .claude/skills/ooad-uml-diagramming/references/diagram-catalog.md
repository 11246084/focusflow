# 圖種總表

> 通用層。「建議程度」為**無章節契約時**的預設值；在系統手冊脈絡中一律以
> `local/ntub-chapter-contract.md` 為準。
>
> 「常見誤用」欄中凡屬「不值得畫」性質的條目（例如活動圖畫線性流程、循序圖協作
> 物件過少），一律是 `[DOC:HEURISTIC]`，**在章節契約已指定該圖時不適用**，且任何
> 情況下都不得單獨作為 review fail 的理由。記法錯誤類的條目則是 `[UML:MUST]`。

## UML 2.x 正式圖種（14 種）

| 繁體中文（English） | OOAD 階段 | 用途 | 預設建議 | 常見誤用 |
|---|---|---|---|---|
| 使用個案圖（Use Case Diagram） | 需求分析 | 界定系統邊界、行為者與價值單元 | Core | 把內部技術流程畫成 use case；`include`／`extend` 當流程箭頭；一張圖塞全部 UC |
| 活動圖（Activity Diagram） | 需求分析／物件分析 | 有分支、並行、多角色的流程；泳道表責任 | Core | 畫線性無分支 CRUD；多模組畫出雷同的圖；當程式流程圖 |
| 循序圖（Sequence Diagram） | 物件設計／需求分析 | 以時間軸呈現物件間訊息往返 | Core | 生命線停在「前端／後端／資料庫」；訊息寫中文動詞而非真實方法；有圖無步驟說明 |
| 通訊圖（Communication Diagram） | 物件設計 | 同循序圖資訊，改以物件連結為主軸 | Conditional | 與循序圖同時畫同一流程，零增量資訊 |
| 狀態機圖（State Machine Diagram） | 物件設計 | 單一 classifier 的狀態、事件、守衛、動作 | Core | 畫畫面流程或表單步驟；轉換不標事件與條件 |
| 類別圖（Class Diagram） | 物件分析／物件設計 | 靜態結構：類別、屬性、操作、關聯、繼承 | Core | 分析／設計混為一談；把資料表畫成類別；關聯不標多重性 |
| 物件圖（Object Diagram） | 物件分析／物件設計 | 某時間點的實例快照 | Conditional | 當類別圖替代品；未說明展示哪個情境 |
| 套件圖（Package Diagram） | 系統設計 | 命名空間分群與依賴方向 | Core | 當流程圖用；依功能流程而非程式結構切分；無依賴箭頭 |
| 元件圖（Component Diagram） | 系統設計 | 可替換單元及其提供／需求介面 | Core | 與套件圖同一張；只畫方塊不畫介面；混入實體主機 |
| 佈署圖（Deployment Diagram） | 系統設計 | 節點、節點上的 artifact、通訊路徑 | Core | 畫成網路拓撲卻不標 artifact；寫死易變環境假設 |
| 時序圖（Timing Diagram） | 物件設計 | 狀態隨精確時間變化 | Rare | 與循序圖混淆（見 `terminology.md`） |
| 互動概觀圖（Interaction Overview Diagram） | 物件設計 | 以活動圖控制流串接多張互動圖 | Optional | 當第二張活動圖用 |
| 複合結構圖（Composite Structure Diagram） | 物件設計 | 類別內部部件與連接埠 | Rare | 內部結構不複雜時硬畫 |
| 輪廓圖（Profile Diagram） | — | 定義 UML 擴充機制 | Rare | 專題手冊幾乎不需要 |

## OOAD 模型與 artifacts（非獨立 UML 圖種）

| 繁體中文（English） | OOAD 階段 | 性質 | 用途 | 預設建議 |
|---|---|---|---|---|
| 領域模型（Domain Model） | 物件分析 | artifact，用類別圖記法 | 問題領域概念與關係，不含系統責任與技術 | `[OOAD:SHOULD]` |
| 分析類別圖（Analysis Class Diagram） | 物件分析 | artifact，用類別圖記法 | 領域模型加上系統責任 | Core |
| 設計類別圖（Design Class Diagram） | 物件設計 | artifact，用類別圖記法 | 程式層級的類別與方法簽章 | Core |
| 邊界／控制／實體（Boundary / Control / Entity） | 物件分析 | stereotype（Jacobson） | 依「對外互動／流程協調／狀態保存」分類責任 | `[OOAD:MAY]` |
| 強健性圖（Robustness Diagram） | 物件分析 | ICONIX 方法 | UC 描述 → 循序圖的橋樑 | `[OOAD:MAY]` |
| CRC 卡（Class-Responsibility-Collaboration Card） | 物件分析 | 卡片技術 | 協作式指派類別責任 | `[OOAD:MAY]` |
| 使用個案實現（Use-Case Realization） | 物件設計 | artifact（UML 協作） | 宣告某 UC 由哪組類別與圖共同實現 | `[OOAD:SHOULD]` |
| 系統循序圖（System Sequence Diagram） | 需求分析 | 循序圖的用法 | 系統視為黑箱，只畫對外輸入與回應 | `[OOAD:MAY]` |
| 詞彙表（Glossary） | 需求分析 | 文字 artifact | 固定領域名詞，所有模型命名的根 | `[OOAD:SHOULD]` |

`[OOAD:MAY]` 的項目**不得**因缺少而退回一張圖。若專案在系統規格章宣告採用 UP／RUP／ICONIX 等方法，B/C/E 與強健性圖才從 `MAY` 升為 `SHOULD` —— 由專案宣告，不由本 skill 強制。

## 非 UML 支援圖（必須另行標示）

| 繁體中文（English） | 階段 | 用途 | 預設建議 |
|---|---|---|---|
| 系統架構圖（System Architecture Diagram） | 系統設計 | 分層／分區的系統全貌，給非技術讀者 | Core |
| 實體關聯圖（Entity-Relationship Diagram, ERD） | 系統設計／實作 | 關聯式資料庫的表、主外鍵、基數 | Conditional |
| 集合關聯圖（Collection Relationship Diagram） | 系統設計／實作 | 文件型資料庫的集合、內嵌／引用關係 | Conditional |
| 執行環境／網路拓撲圖（Runtime / Network Topology Diagram） | 系統設計 | 主機、網段、連接埠、反向代理 | Conditional |
| 畫面移轉圖（Screen Transition Diagram） | — | 畫面與操作之間的移轉 | Conditional |
| 線框圖（Wireframe） | — | 介面設計 | Optional |
| 甘特圖（Gantt Chart）／PERT／CPM | — | 專案時程 | Conditional |
| 商業模式圖（Business Model Canvas） | — | 營運計畫 | Conditional |
| 資料流程圖（Data Flow Diagram, DFD） | — | 結構化分析方法 | **不建議**：與物件導向方法論自相矛盾 |

`[DOC:MUST]` 非 UML 圖在圖說或章節文字中必須標示其性質，不得計入 UML 圖或混入 UML 段落。

## 建議程度的語意

| 級別 | 意義 |
|---|---|
| Core | 一般 OOAD 文件的標準配備 |
| Conditional | 系統具備該特性時才畫（例如有多資料庫、有複雜拓撲） |
| Optional | 有加分，缺少不構成缺陷 |
| Rare | 專題規模幾乎用不到 |

`[OOAD:HEURISTIC]` 這四級是預設值，**不是**退圖依據。在系統手冊脈絡中被 `local/ntub-chapter-contract.md` 覆寫。
