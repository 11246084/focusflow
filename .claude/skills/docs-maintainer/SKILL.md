---
name: docs-maintainer
description: 維護 FocusFlow 的 README、agent 入口、架構與進度文件；用於文件分工、去重、更新與搬移。系統手冊章節及 UML 改用 project-documentation。
---

# 專案文件維護

依任務選讀目標文件、其直接引用及能支持修改的程式／Git 證據。只有全面文件盤點才跨文件掃描，不因更新一段進度就通讀整套文件。

| 內容 | 主要位置 |
|---|---|
| 快速上手、啟動、導覽 | README.md |
| 跨 agent 工作邊界、按需索引 | AGENTS.md |
| Claude 專屬操作 | CLAUDE.md、.claude/rules |
| 產品背景、目標、角色與範圍 | PROJECT.md |
| 穩定架構、資料流、契約與 legacy 邊界 | ARCHITECTURE.md |
| 最新進度、可 demo 範圍、缺口與下一步 | docs/current-status.md；後端細節在 backend/docs/current-state.md |
| 重要決策與理由 | docs/decision-log.md（若存在） |

- 使用者只要求盤點／建議時只回報；要求修改時完成範圍內修改及驗證，不在第一版後固定停下。
- 保留既有 Git 異動。優先局部改寫、搬移到主要位置並連結，避免同步多份全文。
- 以目前程式、測試、runtime 與相關 diff 支持現況；標明歷史快照及尚未查證的內容，不靠舊簡報推定完成。
- 按需檢查受影響連結、命令、路徑、日期與 git diff --check；純文件維護不自動執行整套功能測試。
- 繁體中文簡要回報改了什麼、驗證及未解問題。不要把本 skill 變成文件本體。
