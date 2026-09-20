# Artifact chain：圖源 → 圖檔 → 圖號 → 正文引用 → 圖目錄

> `[DOC:MUST]` + `[NTUB:MUST]`。每張圖以 `圖{章}-{節}-{序}` 為唯一識別。

## 六個落點

| # | 落點 | 規格 | 範例 |
|---|---|---|---|
| 1 | 圖源檔名 | `{diagrams}/chapter{NN}/圖{章}-{節}-{序}-{名稱}-vX-x.puml` 或 `.mmd` | `chapter06/圖6-1-3-網頁問答循序圖-v1-0.mmd` |
| 2 | 圖源顯示名稱 | PlantUML `title`／Mermaid frontmatter `title` 必須等於 `{名稱}` | `title: 網頁問答循序圖` |
| 3 | 匯出圖檔 | 與 active 圖源**同名同序號同版本**，僅副檔名不同 | `圖6-1-3-網頁問答循序圖-v1-0.png` |
| 4 | 正文圖說 | 置於圖**下方**，格式 `圖{章}-{節}-{序} {名稱}` | `圖6-1-3 網頁問答循序圖` |
| 5 | 正文引用 | 至少一處「⋯⋯如圖{章}-{節}-{序}所示」 | `流程如圖6-1-3所示。` |
| 6 | 圖目錄 | 一列，名稱與圖說一致，含頁碼 | `圖6-1-3　網頁問答循序圖 …… 28` |

**格式要點**（`[NTUB:MUST]`）：

- 圖號與名稱之間為**空格**，**無冒號、無句點分隔**
- 檔名中的分隔用 `-`（檔案系統友善），圖說中用空格
- 表格同理，但**表題置於表上方**
- 改版檔名採 `-vX-x` 後綴：`圖3-1-1-系統架構圖-v1-1.png`
- 版本後綴屬檔案識別，不屬於圖的顯示名稱；圖源與匯出圖檔須使用相同後綴，正文連結須指向版本化檔名，但顯示 title、圖說與圖目錄名稱維持不含後綴。版本判定與遞增規則由專案慣例定義。
- 同一圖號只能有一個 active 圖源；`.puml` 與 `.mmd` 並存視為重複，除非其中一個已移入 archive。

## 八項一致性檢查

`[DOC:MUST]` 納入 review 第 4 層。

| # | 檢查 | 失敗徵狀 |
|---|---|---|
| 1 | 圖源檔名 ↔ 匯出圖檔名稱一致 | 改了 source 沒重新匯出，或匯出後改名 |
| 2 | 圖源顯示名稱 ↔ 圖說名稱一致 | 圖內標題與正文圖說不同名 |
| 3 | 圖說編號 ↔ 檔名編號一致 | 章節調整後圖號沒同步 |
| 4 | 正文存在至少一處引用 | 圖插在那裡但正文從未提及 |
| 5 | 圖目錄存在對應列且名稱一致 | 新增圖忘了更新圖目錄 |
| 6 | **無孤兒圖檔** | 圖檔存在但正文從未引用 |
| 7 | **無孤兒目錄列** | 目錄有列但圖不存在 |
| 8 | **版本後綴一致** | 重繪圖仍無版本、圖源／圖檔版本不同，或正文仍指向舊版本 |

## 可執行的檢查方式

以下指令假設專案的圖存放於 `diagrams/`、圖檔於 `images/`、章節 Markdown 於 `chapters/`。
實際路徑見 `local/focusflow-conventions.md`。

優先使用 skill 內建的跨平台檢查器。它支援 `.puml` 與 `.mmd`，檢查檔頭、版本化檔名、顯示 title、同名匯出圖檔、正文圖檔路徑／圖說／引用，以及圖目錄名稱／版本；它**不取代**所選 renderer 的真實渲染與圖片目視檢查。

```powershell
python .claude/skills/ooad-uml-diagramming/scripts/validate_diagram_artifacts.py `
  --diagram-dir docs/00_Deliverables/System_Manual/diagrams/chapter06 `
  --image-dir docs/00_Deliverables/System_Manual/images `
  --chapter docs/00_Deliverables/System_Manual/chapters/06_設計模型.md `
  --toc docs/00_Deliverables/System_Manual/圖表目錄.md `
  --require-version
```

下列 POSIX shell 指令只作無 Python 時的局部 fallback；版本後綴必須先移除再比對顯示名稱：

```bash
# 1+3. PlantUML 檔名與 title 是否一致（Mermaid 請用 Python 檢查器）
for f in $(find diagrams -name "*.puml"); do
  base=$(basename "$f" .puml)
  name="${base#*-*-*-}"                       # 去掉 圖X-Y-Z- 前綴
  name=$(printf '%s' "$name" | sed -E 's/-v[0-9]+-[0-9]+$//')
  grep -q "^title $name$" "$f" || echo "title 不符: $f"
done

# 2. 每個 PlantUML source 是否有對應圖檔
for f in $(find diagrams -name "*.puml"); do
  base=$(basename "$f" .puml)
  ls images/"$base".* >/dev/null 2>&1 || echo "缺匯出圖檔: $base"
done

# 4+6. 孤兒圖檔：圖檔存在但正文未引用
for img in images/圖*; do
  id=$(basename "$img" | grep -o '^圖[0-9]*-[0-9]*-[0-9]*')
  grep -rq "$id" chapters/ || echo "孤兒圖檔: $id"
done

# 5+7. 圖目錄與實際圖檔雙向比對
grep -o '^| 圖[0-9]*-[0-9]*-[0-9]*' 圖表目錄.md | sed 's/^| //' | sort -u > /tmp/toc.txt
ls images/圖* | grep -o '圖[0-9]*-[0-9]*-[0-9]*' | sort -u > /tmp/files.txt
diff /tmp/toc.txt /tmp/files.txt
```

## 新增一張圖的完整動作

`[DOC:MUST]` 缺任一步視為未完成：

1. 決定圖號 `圖{章}-{節}-{序}`（同節內從 1 起編，不跨節連號）
2. 建立 `.puml` 或 `.mmd`，填妥檔頭宣告區塊（見 `traceability.md`）
3. PlantUML `title` 或 Mermaid frontmatter `title` 設為圖名
4. 匯出圖檔，同名
5. 在章節 Markdown 插入圖、圖說（圖下方）
6. 在正文加入至少一處「如圖⋯⋯所示」
7. 在圖目錄新增一列
8. 若為 AI 協助產出，於檔頭填妥 `ai-assisted` 使其可追溯；是否另立一筆 AI 使用表紀錄，
   依專案決定的粒度處理（`[NTUB:MUST]` 揭露可追溯；`[FF:SHOULD]` 粒度由專案決定）

## 刪除或重編號

`[DOC:MUST]` 刪除一張圖時，六個落點必須同步移除。重編號時，同節後續圖號須連動調整，
並重跑八項一致性檢查。

`[DOC:SHOULD]` 章節結構調整前先執行一次完整檢查，取得基準；調整後再執行一次，比對差異。
