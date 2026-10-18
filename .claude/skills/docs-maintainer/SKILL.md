---
name: docs-maintainer
description: 維護 FocusFlow 的 README、agent 入口、架構與進度文件；用於文件分工、去重、更新與搬移。系統手冊章節及 UML 改用 project-documentation。
---

# 專案文件維護

這份操作指引協助維護 FocusFlow 文件，避免重複記錄與規則漂移。請先讀 [AGENTS.md](../../../AGENTS.md)，再依任務選讀目標文件、直接引用及程式／Git 證據；只有全面盤點才跨文件掃描。

| 內容 | 主要位置 |
|---|---|
| README 用途 | 依[文件寫作規則](references/writing-style.md) |
| 跨 agent 工作邊界、按需索引 | AGENTS.md |
| Claude 專屬操作 | CLAUDE.md、.claude/rules |
| 產品背景、目標、角色與範圍 | PROJECT.md |
| 穩定架構、資料流、契約與 legacy 邊界 | ARCHITECTURE.md |
| 狀態與技術文件分工 | 依[文件寫作規則](references/writing-style.md) |
| 重要決策與理由 | docs/decision-log.md（若存在） |

- 使用者只要求盤點／建議時只回報；要求修改時完成授權範圍內修改及驗證。分階段回報與停止時點，依 [AGENTS.md 的工作邊界](../../../AGENTS.md#工作邊界)。
- 判斷內容屬於哪一類文件、該放哪裡與怎麼寫時，讀 [references/doc-types.md](references/doc-types.md)。
- 新增文件與方案封存，依[文件寫作規則](references/writing-style.md)。
- 文件用語、段落、範例與長度，依[文件寫作規則](references/writing-style.md)。
- 保留既有 Git 異動。優先局部改寫、搬移到主要位置並連結，避免同步多份全文。
- 以目前程式、測試、runtime 與相關 diff 支持現況；標明歷史快照及尚未查證的內容，不靠舊簡報推定完成。
- 按需檢查受影響連結、命令、路徑、日期與 git diff --check；純文件維護不自動執行整套功能測試。
- 繁體中文簡要回報改了什麼、驗證及未解問題。不要把本 skill 變成文件本體。

操作例：收到功能開關文件修改需求 → 閱讀 AGENTS.md 與直接相關證據 → 修改文件、檢查連結並依授權階段回報。
