# 選圖：僅在需要選擇或重評圖種時讀取

以下路徑相對本 references 目錄。

### Step 2：兩段式選圖（結構性規則）

```
Step 2-0  這張圖是否在系統手冊脈絡中？
          ├─ 是 → 查 local/ntub-chapter-contract.md
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
│       ※ 先跑 use-case-boundary.md 的排除規則
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
