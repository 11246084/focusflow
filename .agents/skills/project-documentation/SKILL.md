---
name: project-documentation
description: 規劃、製作或審查 FocusFlow 系統手冊章節與 UML。一般 README 與進度文件使用 docs-maintainer。
---

# 系統手冊

依當次交付範圍討論、規劃、製作或審查。盤點時指出可沿用、需修正與缺少的素材；實作敘述須有當前程式、schema、測試或 runtime 證據。

- 北商手冊依[學校公告](../../../docs/00_學校公告/)、[章節契約](../../../.claude/skills/ooad-uml-diagramming/references/local/ntub-chapter-contract.md)與[專案慣例](../../../.claude/skills/ooad-uml-diagramming/references/local/focusflow-conventions.md)。公告與整理版有出入時以公告為準，說明差異。
- 章文在[手冊章節](../../../docs/01_系統手冊/chapters/)。各章圖源與成品見[圖目錄](../../../docs/05_圖庫/README.md)，共用樣式及工具在 [_shared](../../../docs/05_圖庫/系統手冊/_shared/)。
- 製作及審查 UML 時遵循[共用 OOAD/UML 規範](../../../.claude/skills/ooad-uml-diagramming/SKILL.md)。驗收涵蓋章文、圖源、實際渲染與目視檢查、圖號圖說、正文引用及圖目錄的一致性。標明草稿、未驗證項目與人工驗收結果。

只有選用 `diagram-design` 時才從 repo 根目錄檢查工具：

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/project-documentation/scripts/bootstrap-diagram-design.ps1 -Mode Check
```

取得安裝授權後，才使用同一腳本的 `-Mode InstallCodex`。PlantUML 或 Mermaid 直接使用該圖所需的 renderer。
