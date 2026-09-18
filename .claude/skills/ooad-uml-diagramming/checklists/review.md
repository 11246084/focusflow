# 五層審查清單

> 依序執行，**前一層不過不進下一層**。
> `[DOC:MUST]` **禁止**以 `HEURISTIC` 規則作為 fail 的理由。

## 輸出格式

```
【圖6-1-3 網頁問答循序圖】

第1層 語法    ✅
第2層 語意    ❌ FAIL
  - [UML:MUST] 缺少 autonumber（plantuml-conventions.md 必要元素）
第3層 結構    —（未執行）
第4層 追溯    —（未執行）
第5層 可讀性  —（未執行）

處置：補上 autonumber 後重跑第 2 層。
```

- `MUST` 命中 → **FAIL**，附規則標記與處置
- `SHOULD` / `SHOULD-NOT` 命中 → **WARNING**，要求說明理由或修正
- `HEURISTIC` 命中 → **提示**，格式：`提示：這張圖可能〔訊號〕。若確認無誤，請在圖說說明。`

---

## 第 1 層　語法

- [ ] `plantuml -checkonly` 通過（或等效的渲染測試）

任一失敗 → FAIL，不進第 2 層。

---

## 第 2 層　語意（UML 記法正確性）

### 通用

- [ ] `[DOC:MUST]` 檔頭宣告區塊完整（`ooad-phase` / `chapter` / `realizes` / `source` / `verified` / `status` / `implemented` / `ai-assisted`）
- [ ] `[DOC:MUST]` `title` 存在
- [ ] `[FF:MUST]` `!include` 共用樣式，且未自訂 `skinparam`

### 依圖種（見 `references/plantuml-conventions.md` 必要元素表）

- [ ] `[UML:MUST]` 使用個案圖：有系統邊界框；actor 在框外
- [ ] `[UML:MUST]` 使用個案圖：無 actor 是本系統的模組／服務／資料庫／佇列（反模式 B1）
- [ ] `[UML:MUST]` 活動圖：有 `start` / `stop`
- [ ] `[UML:MUST]` 循序圖：有 `autonumber`；`participant` 顯式宣告
- [ ] `[UML:MUST]` 類別圖：關聯標多重性；設計層另標導航方向
- [ ] `[UML:MUST]` 狀態機圖：有 `[*]`；每個轉換標 `事件 [守衛] / 動作`
- [ ] `[UML:MUST]` 狀態機圖：只針對單一 classifier（反模式 D2）
- [ ] `[UML:MUST]` 套件圖：依賴箭頭有方向
- [ ] `[UML:MUST]` 元件圖：有提供／需求介面（反模式 C2）
- [ ] `[UML:MUST]` 佈署圖：節點內有 artifact；連線標協定（反模式 C4）

---

## 第 3 層　結構（模型層級與內容正確性）

### 分析／設計防顛倒（僅類別圖與物件圖）

載入 `references/analysis-vs-design.md`，依 `chapter` 欄位決定層級：

- [ ] `[NTUB:MUST]` 判別器 F：以章節位置決定套用哪組檢查
- [ ] `[OOAD:MUST]` 判別器 A-1（分析層強證據）：無技術 stereotype、無技術後綴類別名、無框架／語言／資料庫型別、無儲存細節、無具體技術產物命名
- [ ] `[OOAD:HEURISTIC]` 判別器 A-2（分析層弱訊號）：型別／可見性／方法簽章 → **僅提示，不 FAIL**
- [ ] `[OOAD:SHOULD]` 判別器 A-3：三項弱訊號全數出現且型別為具體語言型別 → WARNING
- [ ] `[OOAD:MUST]` 判別器 B-1（設計層責任）：圖與配套文字能說明「分析責任由誰承擔、以什麼方式承擔」。**語意要求，不檢查特定記法是否存在**
- [ ] `[OOAD:HEURISTIC]` 判別器 B-2（設計層證據）：型別／方法簽章／可見性／導航方向／介面／技術類別／拆分合併／設計模式 → **僅提示，不 FAIL，任一項皆非必要**，且**不得要求作者為通過規則而製造**
- [ ] `[OOAD:MUST]` 判別器 C：若兩圖類別集合完全相同，已有文字說明
- [ ] `[OOAD:MUST]` 判別器 D：非資料庫綱要冒充（六項訊號未命中三項以上）
- [ ] `[OOAD:SHOULD]` 判別器 E：設計類別已標來源分析類別或「技術新增」
- [ ] `[OOAD:MUST]` 判別器 G、H：物件圖層級正確、與同章類別圖一致

### 使用個案邊界（僅使用個案圖）

載入 `references/use-case-boundary.md`：

- [ ] `[OOAD:MUST]` 無 UC 名稱為純技術動作（反模式 B2）
- [ ] `[OOAD:SHOULD-NOT]` 無「時間」「排程器」actor
- [ ] `[UML:MUST]` `include` / `extend` 未當流程順序箭頭
- [ ] `[OOAD:MUST]` 被排除的內部流程已登錄為 `FR-xx` 且有設計圖承接

### 內容一致性

- [ ] `[OOAD:MUST]` 圖中元素在對應章節文字或清單中存在
- [ ] `[OOAD:MUST]` 循序圖每條生命線可對映到元件清單的一個元件（反模式 D4）
- [ ] `[OOAD:MUST]` 狀態機圖標註了對應的設計類別
- [ ] `[DOC:MUST]` `implemented` 為 `partial` / `planned` 時，圖上已標示

### 章節契約（系統手冊脈絡）

載入 `references/local/ntub-chapter-contract.md`：

- [ ] `[NTUB:MUST]` 該章節的官方**指定**圖皆已存在
- [ ] `[NTUB:MUST]` 未把官方「甚至」延伸圖當成必要
- [ ] `[NTUB:MUST]` 6-1 未同時畫循序圖與通訊圖表達同一流程
- [ ] `[NTUB:MUST]` 該章節的「禁止出現」項目皆未出現

---

## 第 4 層　追溯與 artifact chain

載入 `references/traceability.md` 與 `references/artifact-chain.md`：

### 追溯

- [ ] `[OOAD:MUST]` `realizes` 有值且指向存在的編號（斷鏈檢查）
- [ ] `[OOAD:MUST]` 孤兒圖檢查：這張圖有 `UC-ID` 或 `FR-ID` 指向
- [ ] `[OOAD:MUST]` 孤兒需求檢查：本章涉及的需求皆有圖或元件涵蓋
- [ ] `[DOC:MUST]` `source` 非歷屆手冊、初評舊圖或舊會議紀錄

### Artifact chain 七項

- [ ] `.puml` 檔名 ↔ 匯出圖檔名稱一致
- [ ] `.puml` 的 `title` ↔ 圖說名稱一致
- [ ] 圖說編號 ↔ 檔名編號一致
- [ ] 正文存在至少一處引用
- [ ] 圖目錄存在對應列且名稱一致
- [ ] 無孤兒圖檔（圖存在但正文未引用）
- [ ] 無孤兒目錄列（目錄有列但圖不存在）

### NTUB 格式

- [ ] `[NTUB:MUST]` 圖說置於圖**下方**，格式 `圖{章}-{節}-{序} {名稱}`（空格、無冒號）
- [ ] `[NTUB:MUST]` 表題置於表**上方**
- [ ] `[NTUB:MUST]` AI 參與情形可追溯（檔頭 `ai-assisted` 已填），且足以彙整至 AI 使用表
- [ ] `[FF:SHOULD]` AI 使用表的紀錄粒度與專案既定做法一致（一圖一筆或按工作範圍合併，本 skill 不規定）

---

## 第 5 層　可讀性與配套文字

- [ ] `[DOC:MUST]` 圖前後有「用途 + 判讀」文字
- [ ] `[DOC:MUST]` 互動圖（循序圖／通訊圖）有編號步驟說明
- [ ] `[DOC:MUST]` 非 UML 圖已明確標示
- [ ] `[DOC:MUST]` 無模板指示句殘留（「需註明⋯⋯」「說明⋯⋯」而無實際內容，反模式 E2）
- [ ] `[DOC:SHOULD]` A4 尺寸下可辨識
- [ ] `[DOC:SHOULD]` 若已拆圖，總覽圖與細部圖互相引用圖號
- [ ] `[FF:SHOULD]` 循序圖／通訊圖未涵蓋多個獨立觸發情境（見 `references/local/focusflow-conventions.md` 的「循序圖拆圖粒度」）；若涵蓋多個，已於圖說說明拆分理由
- [ ] `[UML:MUST]` 術語使用 preferred term；「時序圖」未被用於 Sequence Diagram

---

## 提示層（不影響通過與否）

載入 `references/antipatterns.md` 的 F 區，逐項掃描後輸出提示：

- 章節圖數量偏高
- 設計類別數少於分析類別數
- B/C/E 三類失衡
- `verified` 逾三個月且 `source` 為程式碼
- 單圖元素超過 20 個
- 循序圖涵蓋多個獨立觸發情境（反模式 D9）
- 循序圖協作物件少於三個（**章節契約指定時不適用**）
- 多張活動圖結構雷同（**章節契約指定時不適用**）

輸出格式固定為：
> 提示：〔訊號描述〕。若確認無誤，請在圖說說明。

---

## 批次審查

一次審多張圖時：

1. 先對每張圖跑第 1～3 層
2. 第 4 層的 artifact chain 七項與孤兒檢查**以整個章節為單位**執行一次
3. 最後統一輸出提示層
4. 產出彙總：FAIL 幾張、WARNING 幾張、提示幾則
