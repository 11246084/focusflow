# FocusFlow 研究架構圖

本資料夾將繪圖程式、可直接使用的圖稿，以及製作紀錄分開保存。目前建議審閱 **v3.0**；v1.0、v2.0 保留作為設計紀錄。

## 快速入口

### v3.0（建議審閱）

三張獨立的圖，分別說明追問如何找到教材、教材片段如何變成有來源的回答，以及反覆出現的提問如何變成複習短影音。圖內只保留資料與方法，說明、符號與資料來源寫在搭配說明文件。

| 圖 | PNG | PDF | SVG |
|---|---|---|---|
| 01 學生的追問如何找到相關教材 | [PNG](results/v3-0/01-question-to-evidence-v3-0.png) | [PDF](results/v3-0/01-question-to-evidence-v3-0.pdf) | [SVG](results/v3-0/01-question-to-evidence-v3-0.svg) |
| 02 候選片段如何變成有來源的回答 | [PNG](results/v3-0/02-evidence-to-answer-v3-0.png) | [PDF](results/v3-0/02-evidence-to-answer-v3-0.pdf) | [SVG](results/v3-0/02-evidence-to-answer-v3-0.svg) |
| 03 反覆出現的提問如何變成複習短影音 | [PNG](results/v3-0/03-learning-feedback-v3-0.png) | [PDF](results/v3-0/03-learning-feedback-v3-0.pdf) | [SVG](results/v3-0/03-learning-feedback-v3-0.svg) |

- [系統手冊第三章用文稿](manual-chapter03-v3-0.md)：三張圖與精簡說明文字，可直接放入手冊。圖號暫定為圖3-1-2～3-1-4（接在現有圖3-1-1 之後），插入時依實際位置調整；圖片要複製到 `System_Manual/images/`，並把路徑改為 `../images/…`
- [搭配說明文件](records/v3-0/figure-guide-v3-0.md)：每張圖的完整逐步解讀、符號、程式依據、資料來源與示意／真實的區分
- [截圖原始紀錄](records/v3-0/screenshots/README.md)：原始擷取檔、擷取條件與裁切座標
- [三張圖一覽](results/v3-0/index-v3-0.html)

### 舊版

- [v2.0 製作、來源與使用說明](records/v2-0/README-v2-0.md)
- [v1.0 第一版紀錄](records/v1-0/README-v1-0.md)

## 資料夾結構

```text
Research_Framework/
├─ README.md
├─ manual-chapter03-v3-0.md # 系統手冊第三章用文稿（v3.0 三張圖＋說明）
├─ source/                  # 實作用程式碼
│  ├─ v1-0/
│  ├─ v2-0/
│  └─ v3-0/                # build、render，以及 assets/（圖內使用的截圖素材）
├─ results/                 # 可開啟、插入手冊或交付的圖稿
│  ├─ v1-0/                # SVG、PNG、PDF、HTML
│  ├─ v2-0/                # SVG、PNG、PDF、HTML
│  └─ v3-0/                # 三張圖的 SVG、PNG、PDF、HTML 與一覽頁
└─ records/                 # 製作與驗證紀錄
   ├─ v1-0/                # README、manifest、validation
   ├─ v2-0/                # README、manifest、validation、插入說明
   └─ v3-0/                # 搭配說明文件、manifest、validation、screenshots/（原始擷取檔）
```

`results/` 僅放實際會檢視或加入手冊的檔案。來源清單、雜湊、驗證結果、截圖原始檔及說明文件集中在 `records/`。

## 版本狀態

| 版本 | 用途 | 狀態 |
|---|---|---|
| v1.0 | 第一版直式 Step 流程圖 | 保留作設計紀錄 |
| v2.0 | 系統手冊第三章核心流程說明圖（四區塊） | 保留作設計紀錄 |
| v3.0 | 系統手冊第三章說明圖（三張獨立圖，以正式環境真實紀錄與截圖繪製） | 建議審閱版本，尚未寫入手冊正文 |

## 重建與驗證

在 repository 根目錄執行：

```powershell
node docs/00_Deliverables/Research_Framework/source/v1-0/build-research-framework-v1-0.mjs
node docs/00_Deliverables/Research_Framework/source/v1-0/verify-research-framework-v1-0.mjs

node docs/00_Deliverables/Research_Framework/source/v2-0/build-research-framework-v2-0.mjs
node docs/00_Deliverables/Research_Framework/source/v2-0/verify-research-framework-v2-0.mjs

node docs/00_Deliverables/Research_Framework/source/v3-0/build-v3-0.mjs
```

產生程式重建 `results/` 內的 SVG、HTML，以及 `records/` 內的 manifest。PNG／PDF 是以本機瀏覽器從相同 SVG 匯出的衍生結果：v1.0、v2.0 的方法見各版本 README。

v3.0 的 PNG／PDF 由 `source/v3-0/render-v3-0.js` 匯出。這支腳本要透過 Playwright MCP 的 `browser_run_code_unsafe`（`filename` 參數）執行：它會先檢查每張圖的 XML、文字溢出、重疊與超出邊界，全部通過才匯出 PNG（3 倍解析度）與 PDF（寬 160 mm），並回傳檢查結果，結果要另外寫入 `records/v3-0/validation-v3-0.json`。v3.0 沒有獨立的 verify 腳本；圖內截圖素材的雜湊記在 `manifest-v3-0.json`，輸出檔的雜湊記在 `validation-v3-0.json`。

v3.0 圖中的資料來自 2026-09-27 以唯讀方式查詢的正式環境紀錄。資料或程式日後若有變動，重建前要先重新核對 `records/v3-0/figure-guide-v3-0.md` 列出的紀錄。
