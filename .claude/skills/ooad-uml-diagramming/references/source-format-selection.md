# 圖源格式與 renderer 選擇

PlantUML 與 Mermaid 都是允許的工作母稿。先選「最能忠實表達模型、能在目前環境驗證、且不破壞既有 artifact chain」的格式，不設專案級唯一預設。

## 決策順序

1. 使用者明確指定格式時遵從，除非該格式無法表達要求的正式 UML 語意；此時說明限制並提出替代。
2. 修改既有圖時沿用原格式；不得只因 agent 偏好批次轉換。
3. 新圖依圖種、文件平台、renderer 可用性與團隊維護成本選擇。
4. 同一組總覽／細部圖或同一章大量同型圖，`[DOC:SHOULD]` 使用一致格式與樣式。

## 適用性

| 條件 | 較合適格式 |
|---|---|
| Markdown／GitHub 內需直接維護；循序、類別、狀態或流程圖 | Mermaid |
| 嚴格使用個案、物件、套件、元件、佈署、通訊等 UML 記法 | PlantUML |
| 已有 `_style.puml`、include、PlantUML 範本或既有章節鏈 | PlantUML |
| 文件平台原生 Mermaid 且不要求 VPP／VPD | Mermaid |
| 兩者都可完整表達 | 以既有一致性與可重現 renderer 決定，不以個人偏好決定 |

Mermaid `flowchart`／`subgraph` 可以表達模組關係，但不自動等同 UML 套件圖、元件圖或佈署圖。若使用 Mermaid 模擬而缺少正式 UML 記法，圖說要標成「關係圖／架構圖」；正式 UML 契約仍優先使用能表達相應元素的格式。

## Renderer 與 MCP

- renderer／MCP 只負責驗證與匯出，不能取代目前程式碼證據、diagram brief 或 OOAD review。
- 若圖源含私有類別、端點或架構資訊，優先使用本機 renderer 或本機 MCP。
- 使用 `kroki.io`、Mermaid.ink、Vercel MCP 等遠端服務時，視同把完整圖源送到第三方；必須先確認內容可外傳。
- MCP 產出的 URL 或 base64 不是 artifact chain 終點；仍要保存版本化圖源與同名 PNG／SVG。
- 無 MCP 時可使用 PlantUML CLI、Mermaid CLI；有 MCP 時仍須記錄實際 backend 與驗證結果。

## 一致性規則

- PlantUML 使用 `.puml`；Mermaid 使用 `.mmd`。不要只靠 Markdown code fence 當唯一母稿。
- 檔名一律 `圖{章}-{節}-{序}-{名稱}-vX-x.<ext>`。
- 同一圖號只能有一個 active source；轉換格式屬版本變更，舊 source 移入 archive。
- 顯示名稱不含版本：PlantUML 使用 `title`，Mermaid 使用 YAML frontmatter `title`。
