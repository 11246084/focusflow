# PlantUML 製圖慣例

> `[FF:MUST]` 除另有標記者外。
> **PlantUML 目前為工作母稿，非最終交付格式**（見 SKILL.md open issues 1）。

## 為什麼用 PlantUML

可版控、可 diff、可由 agent 生成、可自動檢查。這些性質是本 skill 的 review 自動化前提。

若最終交付須改用其他工具，`.puml` 仍作為設計與審查的母稿，並另行產出交付格式。

## 檔案配置

```
{diagrams}/
├── _style.puml              # 共用樣式，所有圖 !include
├── chapter05/
│   ├── 圖5-2-1-<名稱>-v1-0.puml
│   └── 圖5-3-1-<名稱>-v1-0.puml
├── chapter06/
└── chapter07/
```

`[FF:MUST]` 新增或重繪檔名使用 `圖{章}-{節}-{序}-{名稱}-vX-x.puml`；版本必須在建立新檔前依 `local/focusflow-conventions.md` 判定。

## 每個檔案的固定骨架

```plantuml
@startuml
' ============================================
' ooad-phase:   <階段>
' chapter:      <章-節>
' realizes:     <UC-xx / FR-xx>
' source:       <來源>（<類型>）
' verified:     <YYYY-MM-DD>
' status:       draft
' implemented:  yes | partial | planned
' ai-assisted:  <no | yes / 工具 / 範圍>
' ============================================
!include ../_style.puml

title <圖名，須與檔名中的名稱一致>

' ... 圖本體 ...

@enduml
```

`[DOC:MUST]` 宣告區塊與 `title` 缺一不可。
`[FF:MUST]` 單一圖**不得**自訂 `skinparam`；樣式一律改 `_style.puml`。

> **關於 `!include ../_style.puml`**：此路徑假設專案配置為 `{diagrams}/_style.puml`
> 與 `{diagrams}/chapter{NN}/*.puml`。本 skill 的 `templates/` 目錄內 `_style.puml`
> 是同層檔案，因此**範本無法在 templates 目錄原地渲染**。使用方式是先把範本複製到
> `{diagrams}/chapter{NN}/`、把 `_style.puml` 複製到 `{diagrams}/`，再開始編輯。

## 各圖種必要元素

`[UML:MUST]` 缺少即 review 第 2 層不通過。

| 圖種 | 必要元素 |
|---|---|
| 全部 | `title`、檔頭宣告區塊 |
| 使用個案圖 | 系統邊界框（`rectangle` 或 `package`）；actor 在框外 |
| 活動圖 | `start` / `stop`；分支用 `if/else`；多角色用 `\|swimlane\|` |
| 循序圖 | `autonumber`；`participant` 顯式宣告並給別名 |
| 通訊圖 | 訊息編號（`1:`、`1.1:`）表達順序 |
| 類別圖 | 關聯標多重性；設計層另標導航方向（`-->`） |
| 物件圖 | 實例命名 `名稱 : 類別`；槽位給值 |
| 狀態機圖 | `[*]` 起始；每個轉換標 `事件 [守衛] / 動作` |
| 套件圖 | 依賴箭頭有方向（`..>`） |
| 元件圖 | 提供／需求介面（`()` 與 `-(0-`） |
| 佈署圖 | `node` / `database` 等節點；節點內的 artifact；節點間連線標協定 |

## 寫法慣例

`[FF:SHOULD]`

| 項目 | 慣例 |
|---|---|
| 語言 | 圖內文字用繁體中文；類別名、方法名、端點沿用程式碼原文 |
| 別名 | `participant "課程服務" as CourseService`，別名用程式碼識別字 |
| 註解 | 設計決策用 `note`，不寫在圖外 |
| 方向 | 循序圖由左至右依呼叫深度排列 participant |
| 分組 | 使用 `box` / `package` 表達子系統歸屬 |
| 未實作 | 以 `note` 標示 `(planned)`，或用不同 stereotype |

## 版面

`[DOC:SHOULD]` 單圖須在 A4 尺寸下可辨識。超出時**拆圖**，不縮小字級。

`[DOC:HEURISTIC]` 單圖元素超過約 20 個，或分組超過 7±2 時，考慮拆圖。僅提示，不退圖。

### 拆圖策略

| 圖種 | 建議拆法 | 拆後如何維持整體感 |
|---|---|---|
| 使用個案圖 | 依行為者或子系統 | 加一張總覽圖，細部圖互指 |
| 循序圖 | 依使用個案（一 UC 一圖） | 以使用個案實現宣告串起 |
| 類別圖 | 依子領域 | 加一張總覽圖只畫類別與關聯，細部圖補屬性與方法 |
| 狀態機圖 | 依 classifier（一類別一圖） | 於設計類別圖標示哪些類別有狀態機 |
| 集合關聯圖 | 依領域分組 | 加一張總覽圖 |

`[DOC:MUST]` 拆圖後，總覽圖與細部圖必須互相引用圖號。

## 字型

`_style.puml` 集中設定。預設 `Microsoft JhengHei`（繁中顯示穩定）。

`[FF:SHOULD]` 若需與內文字型一致，改為 `DFKai-SB`（標楷體）；改一處即可全域生效。

## 匯出

`[FF:SHOULD]`

- 格式與解析度依最終排版需求決定（見 open issue 3）
- `.puml` 為版控母稿；匯出圖檔與 `.puml` 同名
- 匯出後必須重跑 `artifact-chain.md` 的八項檢查
- 真實渲染與 source contract 檢查是兩個不同 gate；兩者都要通過
- 匯出後須開啟圖片目視檢查，不能只以 process exit code 判斷可讀性

```bash
# 匯出單一檔案（需本機有 plantuml）
plantuml -tpng -o ../../images "diagrams/chapter06/圖6-1-3-網頁問答循序圖-v1-0.puml"

# 僅檢查語法，不產圖
plantuml -checkonly "diagrams/chapter06/圖6-1-3-網頁問答循序圖-v1-0.puml"

# 檢查檔頭、檔名／title、版本、PNG、正文與圖目錄鏈結
python .claude/skills/ooad-uml-diagramming/scripts/validate_diagram_artifacts.py \
  --diagram-dir docs/00_Deliverables/System_Manual/diagrams/chapter06 \
  --image-dir docs/00_Deliverables/System_Manual/images \
  --chapter docs/00_Deliverables/System_Manual/chapters/06_設計模型.md \
  --toc docs/00_Deliverables/System_Manual/圖表目錄.md \
  --require-version
```

`[DOC:MUST]` review 第 1 層包含 PlantUML 語法／渲染通過與匯出圖檔目視檢查；Python 驗證器不能取代 PlantUML renderer。
