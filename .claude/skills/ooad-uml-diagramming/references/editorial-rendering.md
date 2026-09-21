# Diagram Design 視覺呈現層

`diagram-design` 是 UML 語意完成後的**選用視覺呈現與匯出層**，不是 UML／OOAD 的真相來源，也不取代 PlantUML、Mermaid、追溯表或 artifact chain。

## 使用時機

- 讀者需要比 PlantUML／Mermaid 預設輸出更清楚的編排、無障礙 SVG、HTML 或高解析 PNG。
- 使用者要求重繪既有 `.drawio`、`.mmd` 或 Excalidraw 圖。
- 系統手冊、簡報或網頁需要一致的 FocusFlow 視覺語言。

僅需快速維護、審查或正式格式仍要求 VPP／VPD 時，不必強制增加 HTML 衍生圖。

## 權責邊界

1. 先依本 skill 完成 diagram brief、選圖、語意與實作證據核對。
2. `.puml` 或 `.mmd` 是可維護的工作母稿；`diagram-design` 產出的 `.html`／`.svg`／`.png` 是衍生呈現物。
3. 不得因視覺預算而刪除會改變 UML 語意的 lifeline、message、guard、multiplicity、visibility、relationship、package boundary 或 implementation-status 註記。
4. 若為符合版面而合併、折疊或拆圖，必須附 fidelity ledger，逐項記錄保留、合併、折疊與未呈現內容。
5. 未完成或僅規劃中的功能仍須沿用原圖的狀態標示，不得因重繪而看起來已完成。

## 建議輸出設定

- 系統手冊：`print-a4-landscape` 或 `doc-wide`。
- 細節：UML 正式交付預設 `faithful`；只有另有概覽圖時才可用 `balanced`。
- 讀者：技術審查用 `engineer`，組員與教師共同閱讀用 `mixed`。
- 格式：保留自包含 HTML；需要嵌入手冊時再依明確要求匯出 PNG／SVG。

## 執行順序

1. 先執行唯讀檢查：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .agents/skills/project-documentation/scripts/bootstrap-diagram-design.ps1 -Mode Check
   ```

   若目前 host 或匯出依賴缺少：本輪需求已明確授權安裝工具時，Codex 執行 `-Mode InstallCodex`、Claude Code 執行 `-Mode InstallClaude`；未獲本輪授權時先說明會修改使用者層級的 plugin／Python 環境並詢問一次。Discuss、Plan、Review 模式不得默默安裝。新安裝的 plugin 可能要重開 Codex task 或 Claude Code 才會出現在 skill 清單。
2. 載入 `diagram-design` skill 及所選圖種 reference；若是匯入，依其 import 規則先擷取語意，不沿用原 renderer 座標。
3. 選用 FocusFlow profile 前先完成該 skill 的 style-guide gate；不得默默使用預設品牌樣式。
4. 產出後執行 `diagram-design` 的 `self_check.py`，並以實際瀏覽器／匯出圖做目視檢查。
5. 再跑本 skill 的語意、追溯與 artifact-chain review。視覺檢查通過不等於 UML 語意通過。

## 版本與路徑

- 衍生檔必須沿用工作母稿的圖號與版本，例如 `圖6-1-6-...-v1-0.html`、`.svg`、`.png`。
- 不覆蓋舊版；舊輸出依專案封存規則移入 archive。
- 章節正文與圖表目錄只指向選定的正式呈現物，避免同一圖號同時引用不同版本。
