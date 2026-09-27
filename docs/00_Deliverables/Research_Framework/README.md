# FocusFlow 研究架構圖

本資料夾將繪圖程式、可直接使用的圖稿，以及製作紀錄分開保存。目前建議審閱 **v2.0**；v1.0 保留作為第一版紀錄。

## 快速入口

- [v2.0 第三章用 PNG](results/v2-0/focusflow-research-framework-v2-0.png)
- [v2.0 可編輯 SVG](results/v2-0/focusflow-research-framework-v2-0.svg)
- [v2.0 單圖 PDF](results/v2-0/focusflow-research-framework-v2-0.pdf)
- [v2.0 A4 圖文排版預覽 PDF](results/v2-0/chapter03-placement-v2-0.pdf)
- [v2.0 製作、來源與使用說明](records/v2-0/README-v2-0.md)
- [v1.0 第一版紀錄](records/v1-0/README-v1-0.md)

## 資料夾結構

```text
Research_Framework/
├─ README.md
├─ source/                  # 實作用程式碼
│  ├─ v1-0/
│  └─ v2-0/
├─ results/                 # 可開啟、插入手冊或交付的圖稿
│  ├─ v1-0/                # SVG、PNG、PDF、HTML
│  └─ v2-0/                # SVG、PNG、PDF、HTML
└─ records/                 # 製作與驗證紀錄
   ├─ v1-0/                # README、manifest、validation
   └─ v2-0/                # README、manifest、validation、插入說明
```

`results/` 僅放實際會檢視或加入手冊的檔案。來源清單、雜湊、驗證結果及第三章插入備註集中在 `records/`。

## 版本狀態

| 版本 | 用途 | 狀態 |
|---|---|---|
| v1.0 | 第一版直式 Step 流程圖 | 保留作設計紀錄 |
| v2.0 | 系統手冊第三章核心流程說明圖 | 建議審閱版本，尚未寫入手冊正文 |

## 重建與驗證

在 repository 根目錄執行：

```powershell
node docs/00_Deliverables/Research_Framework/source/v1-0/build-research-framework-v1-0.mjs
node docs/00_Deliverables/Research_Framework/source/v1-0/verify-research-framework-v1-0.mjs

node docs/00_Deliverables/Research_Framework/source/v2-0/build-research-framework-v2-0.mjs
node docs/00_Deliverables/Research_Framework/source/v2-0/verify-research-framework-v2-0.mjs
```

產生程式重建 `results/` 內的 SVG、HTML，以及 `records/` 內的 manifest。PNG／PDF 是以本機瀏覽器從相同 SVG 匯出的衍生結果，詳細方法見各版本 README。
