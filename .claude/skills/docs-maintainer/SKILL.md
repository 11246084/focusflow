# docs-maintainer

## 目的

本 skill 用於維護本 repo 的專案文檔系統，確保文檔：

- 精簡且可維護
- 適合高密度 AI agent 協作
- 保持清楚分層
- 降低重複內容
- 將穩定知識與動態知識分離
- 有助於長期記憶而非一次性 prompt 堆疊

本 skill 不負責取代專案文檔本體，而是負責：
- 盤點
- 對齊
- 去重
- 搬移
- 更新
- 回報

---

## 本 repo 文檔分工原則

### 1. README.md
用途：快速上手、專案簡介、啟動方式、導覽入口

適合放：
- 專案一句話介紹
- MVP 簡介
- 基本啟動方式
- 主要文檔連結

不適合放：
- 詳細 agent 規則
- 技術架構細節
- 長篇進度紀錄

### 2. CLAUDE.md
用途：Claude Code 的主規則與工作方式

適合放：
- Claude Code 進 repo 後應如何工作
- 修改前應先閱讀哪些文件
- 修改與回報規則
- 測試與驗證要求
- `.claude/rules/` 的入口

不適合放：
- 大量專案背景敘述
- 詳細架構說明
- 高頻變動的進度資訊

### 3. AGENTS.md
用途：通用 coding agent 的短版入口索引

適合放：
- 本 repo 的 agent 文件入口
- 指向 `CLAUDE.md`、`PROJECT.md`、`ARCHITECTURE.md`、`docs/current-status.md`
- 簡短說明 repo 的文檔結構

不適合放：
- 第二份完整的 CLAUDE.md
- 詳細規則全文
- 詳細技術架構

### 4. PROJECT.md
用途：專案背景、目標、MVP 範圍、模組概覽

適合放：
- FocusFlow 是什麼
- MVP 要解決什麼問題
- 子系統概覽
- 角色與主要功能模組
- 高層 API 概覽

不適合放：
- middleware / service 細節
- 複雜資料契約細節
- 高頻更新進度

### 5. ARCHITECTURE.md
用途：技術架構、資料流、系統契約、legacy 差異

適合放：
- 系統分層與模組關係
- 前後端 / AI pipeline / DB 互動
- 資料流
- processing lifecycle
- 正式 schema / contract 與過渡狀態

不適合放：
- 重複的專案背景
- 高頻更新的任務進度

### 6. docs/current-status.md
用途：動態進度、可 demo 範圍、缺口、下一步

適合放：
- 已完成 / 部分完成 / 未完成
- 已知風險
- 目前可 demo 流程
- 下一步優先順序
- 近期重點決策摘要

不適合放：
- 長期穩定的規則
- 重複的專案總覽
- 大量架構說明

### 7. docs/decision-log.md（若存在）
用途：記錄重要決策與原因

適合放：
- 為何採用某種架構或過渡方案
- 為何暫時保留 legacy 結構
- 為何某功能延期或降級

不適合放：
- 每日進度
- 重複的架構全文

---

## 本 skill 的工作時機

當使用者提出以下需求時，應考慮啟用本 skill：

- 更新專案文檔
- 整理 README / CLAUDE / AGENTS / PROJECT / ARCHITECTURE
- 幫我去重文檔
- 幫我盤點文檔結構
- 幫我建立 current-status
- 幫我整理長期記憶文檔
- 幫我把這次進度寫進文檔
- 幫我判斷內容應該放在哪份文件

---

## 執行流程

### 第一步：先盤點，不急著改
先閱讀與任務相關的文件，至少包含：

- README.md
- CLAUDE.md
- AGENTS.md
- PROJECT.md
- ARCHITECTURE.md
- docs/current-status.md（若存在）
- docs/decision-log.md（若存在）

先判斷：

1. 本次需求屬於哪一類？
   - 專案背景
   - agent 規則
   - 技術架構
   - 動態進度
   - 決策紀錄
   - 快速上手 / README

2. 應修改哪一份文件？
3. 是否有內容重複？
4. 是否有內容其實應搬到別的文件？

### 第二步：維持單一主要責任
每份文件只應有一個主要責任。
若內容明顯跨界，優先：
- 搬移
- 精簡
- 改寫連結導向

不要讓不同文件大段重講同一件事。

### 第三步：穩定知識與動態知識分離
如果內容屬於低頻變動：
- 放在 `CLAUDE.md` / `PROJECT.md` / `ARCHITECTURE.md`

如果內容屬於高頻變動：
- 放在 `docs/current-status.md`
- 需要時放在 `docs/decision-log.md`

### 第四步：最小變動優先
優先：
- 重用既有內容
- 局部搬移
- 精簡重複段落
- 補上文件間連結

避免：
- 一次重寫全部文檔
- 在沒有必要時新增太多文件
- 讓 `AGENTS.md` 重新膨脹成第二份 `CLAUDE.md`

### 第五步：完成後回報
完成後應清楚說明：
- 修改了哪些文件
- 新增了哪些文件
- 哪些內容從哪裡搬到哪裡
- 每份文件的新定位
- 哪些文件適合高頻更新
- 哪些文件應維持低頻更新

---

## 文檔維護判斷規則

### 遇到以下內容時，應優先放進 `docs/current-status.md`
- 目前 repo 真實進度
- 現在能 demo 什麼
- 目前缺口
- 下一步優先順序
- 暫時方案
- 本週 / 本輪重點

### 遇到以下內容時，應優先放進 `PROJECT.md`
- 專案目標
- MVP 範圍
- 模組概覽
- 使用者角色
- 高層系統能力

### 遇到以下內容時，應優先放進 `ARCHITECTURE.md`
- 資料流
- service / module 關係
- DB 契約
- lifecycle
- integration 邏輯
- legacy 與正式模型差異

### 遇到以下內容時，應優先放進 `CLAUDE.md`
- Claude Code 工作規則
- 修改前必做事項
- 測試與驗證要求
- 回報格式
- 規則檔入口

### 遇到以下內容時，應優先放進 `AGENTS.md`
- 導覽資訊
- 文件入口
- 簡短 repo 說明

---

## 輸出風格

- 使用繁體中文
- 精簡、專業、可執行
- 優先提出明確修改建議
- 不要寫成抽象原則大全
- 不要在多份文件中重複貼同樣段落

---

## 成功標準

當本 skill 執行完成時，應達到：

1. repo 文檔結構更清楚
2. 文件邊界更明確
3. 穩定知識與動態知識分離
4. agent 可以更快理解 repo
5. 未來維護成本下降
6. 文檔不再因重複內容而同步困難

---

## 觸發範例

### 一般文檔維護
- 使用 docs-maintainer 幫我整理目前 repo 的文檔結構
- 用 docs-maintainer 幫我檢查 CLAUDE.md 和 AGENTS.md 有沒有重複
- 請依照 docs-maintainer 更新專案文檔
- 用 docs-maintainer 幫我判斷這段內容應該放在哪份文件

### 建 current-status
- 用 docs-maintainer 幫我建立 docs/current-status.md
- 請依照 docs-maintainer 把目前 repo 進度整理到 current-status
- 用 docs-maintainer 幫我把這次後端進度更新進文檔

### 做文檔收斂
- 使用 docs-maintainer，以最小變動方式精簡 AGENTS.md
- 使用 docs-maintainer，幫我把 PROJECT.md 和 ARCHITECTURE.md 的邊界切清楚
- 依照 docs-maintainer，把穩定知識和動態知識分離
