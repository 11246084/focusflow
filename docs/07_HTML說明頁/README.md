# HTML 說明頁

這個資料夾放給人看的 HTML 說明頁，用情境、例子和圖說明一件工作要解決什麼問題、怎樣算成功、怎麼和 AI 一起做。給 AI 讀的設計與規格仍在各功能的 `decisions.md`、`HANDOFF.md`。

## 怎麼打開

GitHub 網頁不會顯示 HTML 的畫面。請先 `git pull`，再用以下任一方式打開：

- 在檔案總管雙擊 `.html` 檔，用瀏覽器開啟。
- 在 VS Code 的檔案清單對檔案按右鍵，選「在檔案總管中顯示」，再雙擊。

## 說明頁清單

| 說明頁 | 給誰 | 對應功能 |
|---|---|---|
| [多模態檢索.html](多模態檢索.html) | 庭語 | [多模態檢索、章節與影片升級](../04_Features/Multimodal_Retrieval/HANDOFF.md) |
| [LINE綁定.html](LINE綁定.html) | 百陶 | [LINE 學習入口與帳號綁定](../04_Features/LINE_Binding/HANDOFF.md) |

## 維護規則

- 每份說明頁是單一檔案，不連外部網址，離線也能打開。
- 設計依據以該功能的 `decisions.md` 為準；定案、選用的方案或結果改變時，AI 在同一批 commit 先更新 `decisions.md`，再更新說明頁與頁尾的更新日期（[AGENTS.md](../../AGENTS.md)「回報與文件」）。
- 新增說明頁時，在上表加一列，並在 [docs/README.md](../README.md) 登記。
