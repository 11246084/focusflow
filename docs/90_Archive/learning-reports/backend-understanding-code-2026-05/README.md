# 後端程式碼理解筆記（歷史封存）

- 封存日期：2026-10-13，經使用者確認不再作為現行學習入口。
- 原位置：`backend/UnderstandingCode/`。
- 最後可查的 Git 更新：2026-05-06（台灣時間），commit `498b990`；此紀錄只涵蓋原本納入 Git 的 `data-model-diagram.md`，其餘本地檔案的最後內容更新日期待確認。
- 資料模型圖內標示的最後同步日期：2026-05-05。

本包是學習計畫、個人筆記與自我驗收練習，部分內容已與目前程式不同。保留原文供追溯，不作目前 schema、架構、功能進度或驗收完成的依據；未勾選項目也不代表產品開發缺口。

## 保留內容與 Git 範圍

| 檔案 | 內容 | 保存方式 |
|---|---|---|
| [data-model-diagram.md](data-model-diagram.md) | Mermaid ER 圖、欄位關聯與圖檔維護說明 | 延續原有 Git 追蹤範圍 |
| `TODO.md` | 三階段程式碼理解計畫 | 原本被 Git 忽略的本地筆記 |
| `services-tech-stack.md` | 三大服務、套件、環境變數與啟動方式 | 原本被 Git 忽略的本地筆記 |
| `setup-log.md` | 啟動、登入與 QA 排錯心得 | 原本被 Git 忽略的本地筆記 |
| `data-model.md` | 資料模型提示題與已填寫答案 | 原本被 Git 忽略的本地筆記 |
| `architecture-notes.md` | 服務互動、QA 流程與 Pipeline 架構草稿 | 原本被 Git 忽略的本地筆記 |
| `phase1-summary.md` | 尚未填寫的自我驗收表 | 原本被 Git 忽略的本地筆記 |
| `data-model.drawio` | 可編輯資料模型圖 | 原本被 Git 忽略的本地圖檔 |

搬移時保留全部 8 個原檔並逐一核對 SHA-256；僅修正 `data-model-diagram.md` 搬移後的兩個程式檔案相對連結，未改寫歷史敘述或完成狀態。本目錄的 `.gitignore` 維持原本 7 個本地檔案不納入 Git 的邊界；其他 checkout 不一定有這些本地檔案。

## 目前文件入口

- [架構與資料流](../../../../ARCHITECTURE.md)
- [後端目前狀態](../../../../backend/docs/current-state.md)
- [AI 程式碼理解指南](../../../40_Operations/ai-code-understanding-guide.md)
- [歷史歸檔索引](../../README.md)
