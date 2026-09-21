---
name: ooad-uml-diagramming
description: 以物件導向系統分析與設計（OOAD）方法，為系統手冊選擇、繪製與審查 UML 圖表。涵蓋需求／分析／設計／實作／測試五個模型，以及循序圖、類別圖、物件圖、套件圖、元件圖、狀態機圖等 UML 2.x 圖種的 PlantUML／Mermaid 製圖、追溯、版本與 artifact-chain 驗證。當任務涉及「畫 UML」「畫循序圖／類別圖／物件圖／套件圖」「系統手冊第 5～9 章圖表」「use case 怎麼寫」「這張圖該不該畫」「圖畫得對不對」時使用。
---

# OOAD / UML 系統手冊製圖

## 適用範圍

本 skill 負責：**選圖 → 製圖 → 配套說明骨架 → 審查**。

不負責：撰寫章節全文、決定系統架構本身、需求訪談、測試執行。

產出一律視為**草稿**（`status: draft`），定稿需人工確認。

> Codex 或其他 agent 可直接讀取本目錄下的同一份檔案，規則與路徑一致。

---

## 規則標記法（必讀）

每條規則標 `[適用範圍:強制程度]`。兩軸正交。

**適用範圍** — 這條規則是誰的規定：

| 標記 | 意義 | 可否整層移除 |
|---|---|---|
| `UML` | UML 2.x 規格本身。違反代表圖是錯的 | 否 |
| `OOAD` | OOAD 方法論共識 | 否（但允許記錄學派選擇） |
| `DOC` | 技術文件寫作通則，與 UML 無關 | 否 |
| `NTUB` | 北商《115 年系統手冊規範》大學部（物件導向）的限制 | **是**（換學校／換場景） |
| `FF` | FocusFlow 專案慣例 | **是**（換專案） |

**強制程度** — 違反了會怎樣：

| 標記 | 意義 | Review 處置 |
|---|---|---|
| `MUST` | 硬性規則 | 不通過，必須修正 |
| `SHOULD` | 建議 | 可偏離，須在圖說或 commit 說明理由 |
| `SHOULD-NOT` | 不建議 | 同 `SHOULD`，方向相反 |
| `MAY` | 允許但不建議，缺少不構成缺陷 | 不檢查 |
| `HEURISTIC` | 判斷輔助 | **不得單獨作為 review fail 的理由** |

只寫適用範圍而不寫強制程度（例如 `[FF]`）者為**說明性內容**，不是規則，不納入 review。

`[DOC:MUST]` **禁止**以 `HEURISTIC` 規則否決一張圖。heuristic 只能產生提示，格式為「這張圖可能⋯⋯，若確認無誤請在圖說說明」。

---

## 工作流程

```
Step 1  建立繪圖 brief → 問題、讀者、階段、範圍、證據、狀態與輸出版本
Step 2  選圖          → 兩段式：先查章節契約，再走自由決策樹
Step 3  該不該畫      → 跑 checklists/pre-draw.md
Step 4  製圖          → 選 PlantUML／Mermaid 工作母稿；需要時再以 diagram-design 製作衍生呈現物
Step 5  配套文字      → 產出「用途 + 判讀」骨架；互動圖另產編號步驟
Step 6  審查          → 語法、渲染、目視、語意、追溯與 artifact chain
```

Step 1 必須先完成 `references/diagram-brief.md`。一張圖原則上只回答一個設計問題；若同時包含多個問題，先拆圖或在 brief 中記錄無法拆分的理由。

### Step 2：兩段式選圖（結構性規則）

```
Step 2-0  這張圖是否在系統手冊脈絡中？
          ├─ 是 → 查 references/local/ntub-chapter-contract.md
          │        ├─ 該章節有「指定」圖 → 直接採用，不得以 heuristic 否決
          │        │                        （heuristic 只能影響拆圖粒度）
          │        ├─ 該章節有「延伸」圖 → 依價值判斷是否採用
          │        └─ 該章節未指定       → 進入 Step 2-1
          └─ 否 → 進入 Step 2-1
```

**Step 2-1　自由決策樹**（僅在章節契約未指定時使用）

> 樹中所有「不畫圖，寫文字」的分支均為 `[DOC:HEURISTIC]`，**只能提示，不能否決**。
> 在章節契約已指定該圖時一律不適用。

```
你要表達的是什麼？

├─ 系統對外提供什麼價值、邊界在哪
│   └─ 使用個案圖（Use Case Diagram）
│       ※ 先跑 references/use-case-boundary.md 的排除規則
│
├─ 一段流程怎麼走
│   ├─ 有分支／並行／跨多個參與者 → 活動圖（Activity Diagram）
│   └─ 線性無分支 → 不畫圖，寫編號步驟
│
├─ 哪些物件互相傳什麼訊息
│   ├─ 系統視為黑箱（需求層）→ 系統循序圖（System Sequence Diagram）[OOAD:MAY]
│   ├─ 內部物件協作，重時間順序 → 循序圖（Sequence Diagram）
│   ├─ 內部物件協作，重連結結構 → 通訊圖（Communication Diagram）
│   └─ 協作物件少於三個 → 不畫圖，寫文字
│
├─ 單一個體在生命週期中的狀態變化
│   └─ 狀態機圖（State Machine Diagram）
│       ※ 若在描述「使用者操作步驟」→ 那是活動圖或畫面移轉圖
│
├─ 有哪些概念／類別，彼此什麼關係
│   ├─ 問題領域概念，不含系統責任 → 領域模型（Domain Model）[OOAD:SHOULD]
│   ├─ 系統責任層級 → 分析類別圖（Analysis Class Diagram）
│   ├─ 程式類別層級 → 設計類別圖（Design Class Diagram）
│   └─ 資料儲存結構 → 非 UML，走資料庫章節
│
├─ 程式碼怎麼分群、誰依賴誰 → 套件圖（Package Diagram）
├─ 可獨立替換的單元與介面契約 → 元件圖（Component Diagram）
│                                ※ 畫不出介面即退回套件圖
├─ 東西跑在哪些節點上
│   ├─ artifact 與節點對應 → 佈署圖（Deployment Diagram）
│   └─ 網路路徑、連接埠、代理 → 非 UML 拓撲圖
│
└─ 以上皆非 → 先回答「這張圖回答什麼問題」。答不出來就不畫。
```

---

## 硬性規則（MUST 全集）

### 通則

1. `[OOAD:MUST]` 每張圖產出前必須能回答「它屬哪個 OOAD 階段、回答什麼問題」。答不出來不畫。
2. `[DOC:MUST]` 每張圖檔頭必須有完整宣告區塊（`ooad-phase`、`chapter`、`realizes`、`source`、`verified`、`status`、`implemented`、`ai-assisted`）。格式見 `references/traceability.md`。
3. `[DOC:MUST]` 每張圖必須有配套的「用途 + 判讀」文字；互動圖必須另有編號步驟說明。
4. `[DOC:MUST]` 未實作或未驗證的內容出現在圖上時必須標示狀態，不得以圖示暗示已完成。
5. `[DOC:MUST]` 非 UML 圖必須明確標示，不得計入 UML 圖或混入 UML 段落。
6. `[DOC:MUST]` 歷屆手冊、初評舊圖、舊會議紀錄**不得**作為現況證據。

### 使用個案邊界

7. `[UML:MUST]` 被設計的系統（System under Design）**不得**在自己的使用個案圖中作為行為者。
8. `[UML:MAY]` 外部系統**可以**作為行為者（次要／支援行為者）。
9. `[OOAD:MUST]` 純內部技術流程（排程、內部 webhook、佇列消費、快取失效、批次處理）**不得**寫成使用個案；改以功能性需求條目登錄，並由循序圖／活動圖／狀態機圖承接，追溯不得中斷。

### 分析 vs 設計防顛倒

10. `[OOAD:MUST]` 分析類別圖不得出現**實作洩漏的強證據**：技術性 stereotype、技術後綴類別名、框架／語言／資料庫型別、儲存與持久化細節、具體技術產物命名。
    （型別標註、可見性、方法簽章是 `[OOAD:HEURISTIC]` 弱訊號，**單獨不構成 FAIL**）
11. `[OOAD:MUST]` 設計類別圖必須呈現**超越純領域概念的具體軟體設計責任**，並能說明分析責任如何落實到設計。這是語意要求，**不要求任何特定記法存在**。
    （型別、方法簽章、可見性、導航方向、介面、技術類別、拆分／合併、設計模式皆為 `[OOAD:HEURISTIC]` 設計層證據，**不得為通過規則而強迫製造**）
12. `[OOAD:MUST]` 分析／設計兩圖類別集合完全相同且僅差方法列時，必須文字說明原因，否則不通過。
13. `[OOAD:MUST]` 資料庫綱要不得以類別圖呈現並標示為類別圖。
14. `[DOC:MUST]` `diagram-design` 只能作為選用的視覺呈現／匯入／匯出層，不得取代 PlantUML／Mermaid 工作母稿、實作證據、追溯鏈或 UML 語意審查；任何合併、折疊、拆圖或省略都必須記入 fidelity ledger。
14. `[NTUB:MUST]` **章節位置即層級宣告**：放在 5-4 的圖一律套分析層檢查，放在 6-2 的圖一律套設計層檢查。

> 完整判別器（訊號表 A–H）見 `references/analysis-vs-design.md`。

### 圖種記法

15. `[UML:MUST]` 元件圖必須標示提供／需求介面；畫不出介面即退回改用套件圖。
16. `[UML:MUST]` 狀態機圖必須針對單一 classifier；每個轉換必須有可辨識的觸發（事件／訊號／時間／completion）。
17. `[UML:MUST]` 類別圖關聯必須標多重性；設計層另標導航方向。

### 術語

18. `[DOC:MUST]` 「時序圖」一詞**僅指** Timing Diagram。Sequence Diagram 一律稱「循序圖」。
19. `[NTUB:MUST]` 術語首次出現用 `繁體中文（English Name）`，其後使用 preferred term。preferred：**佈署圖**（alias：部署圖）。
20. `[NTUB:MUST]` 章節標題沿用官方用字；圖說與內文使用 UML 正式名稱。對照見 `references/terminology.md`。

### NTUB 規範

21. `[NTUB:MUST]` 官方**指定**的圖不得被 heuristic 判定為「不用畫」。heuristic 僅能影響拆圖粒度與合併策略。
22. `[NTUB:MUST]` 官方以「甚至」標示者為**延伸**（`SHOULD`），不得升為 `MUST`。
23. `[NTUB:MUST]` 圖說置於圖**下方**、表題置於表**上方**；格式 `圖{章}-{節}-{序} {名稱}`（空格分隔、無冒號）。
24. `[NTUB:MUST]` AI 參與製圖時必須**可追溯地揭露**，並能彙整至第 14 章 AI 使用表。**紀錄粒度（一圖一筆或按工作範圍合併）由專案決定**，本 skill 不規定。

### Artifact chain

25. `[DOC:MUST]` 圖源（`.puml`／`.mmd`）→ 圖檔 → 圖號 → 正文引用 → 圖目錄五個落點必須一致；八項檢查見 `references/artifact-chain.md`。

---

## 反模式速查

| # | 反模式 | 偵測訊號 |
|---|---|---|
| 1 | 分析類別圖混入實作細節 | `: String`、`+`／`-`、`<<Service>>`、`*Repository` |
| 2 | 設計類別圖停在領域概念 | 無型別、無方法簽章、與分析圖類別集合相同 |
| 3 | 資料庫綱要冒充類別圖 | 一類別對一集合、只有欄位無行為、出現 `_id` / `createdAt` |
| 4 | 系統自己當 Actor | 使用個案圖中出現本系統名稱的 actor |
| 5 | 內部流程寫成 use case | UC 名稱是技術動作（「呼叫向量檢索」「消費佇列」） |
| 6 | 套件圖當流程圖 | 套件名稱是動詞片語而非目錄／命名空間名 |
| 7 | 畫面流程冒充狀態機 | 成對出現「X」與「修改 X」狀態機；狀態名是畫面名 |
| 8 | 圖沒有配套文字 | 整節只有圖說，無「用途 + 判讀」段落 |

> 完整型錄與處置見 `references/antipatterns.md`（review 階段載入）。

---

## References 載入路由

| 情境 | 載入 |
|---|---|
| 開始任何製圖或重繪 | `references/diagram-brief.md` |
| 判斷階段／模型歸屬 | `references/ooad-lifecycle.md` |
| 查圖種用途、建議程度、誤用 | `references/diagram-catalog.md` |
| **系統手冊任何章節的製圖** | `references/local/ntub-chapter-contract.md`（**最高優先**） |
| 排版、圖表號、字型、AI 揭露 | `references/local/ntub-format-rules.md` |
| 畫 5-4 或 6-2 的類別圖／物件圖 | `references/analysis-vs-design.md` |
| 畫使用個案圖、判斷是否為 use case | `references/use-case-boundary.md` |
| 術語、preferred / alias | `references/terminology.md` |
| 編號體系、事實來源、追溯鏈 | `references/traceability.md` |
| 檔名、圖號、正文引用、圖目錄一致性 | `references/artifact-chain.md` |
| 選擇 PlantUML／Mermaid／renderer | `references/source-format-selection.md` |
| 用 diagram-design 重繪、匯入或匯出 | `references/editorial-rendering.md` + 已安裝的 `diagram-design` skill |
| 循序圖／通訊圖 | `references/diagram-guides/interaction-diagrams.md` |
| 類別圖／物件圖 | `references/diagram-guides/class-object-diagrams.md` |
| 活動圖／狀態機圖 | `references/diagram-guides/behavior-diagrams.md` |
| 套件圖／元件圖／佈署圖 | `references/diagram-guides/implementation-structure-diagrams.md` |
| 寫 PlantUML | `references/plantuml-conventions.md` + `templates/*.puml` |
| 寫 Mermaid | `references/mermaid-conventions.md` + `templates/mermaid/` |
| 審查階段 | `checklists/review.md` + `references/antipatterns.md` |
| FocusFlow 專案路徑與現況 | `references/local/focusflow-conventions.md` |

### 交付物

Create／Modify 模式至少交付：完成的 diagram brief、版本化圖源（`.puml` 或 `.mmd`）、實際匯出的圖檔、正文整合（若在範圍內），以及依 `checklists/review.md` 得出的驗證結果。只做了文字檢查時不得宣稱「已渲染」或「視覺驗證通過」。

### 規則的單一來源

同一條規則會出現在四個地方，但**只有一處是權威來源**。修改規則時改權威來源，其餘同步。

| 出現位置 | 角色 |
|---|---|
| `SKILL.md` 硬性規則 | 摘要，供路由與快速判斷 |
| `references/*.md` | **權威來源**，規則的完整定義與理由 |
| `references/antipatterns.md` | 偵測訊號與處置 |
| `checklists/review.md` | 執行清單，引用而非重述 |

---

## Open issues（不阻塞使用，但影響交付）

1. **文字圖源的地位**：官方最終交付要求 Visual Paradigm 的 VPP／VPD 檔。本 skill 把 PlantUML／Mermaid 視為**工作母稿**而非 VPP／VPD 等價物。待指導老師確認可接受的最終格式。
2. **需求編號體系**：`FR-ID` / `NFR-ID` 的編號規則與對 UC 的基數尚未定案；`realizes` 欄位先以專案現行編號填寫。
3. **非 UML 圖的製圖工具**：可優先評估 `diagram-design`，但仍須依章節契約與圖種語意決定，不能把視覺模板當成分析方法。
4. **是否允許反向工程產圖**：暫定分析層（5-4）禁止，設計層與實作層允許但須在 `source` 標註。

見 `references/local/focusflow-conventions.md` 的 open issues 一節。
