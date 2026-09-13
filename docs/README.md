# FocusFlow 文件總覽

整理日期：2026-09-13。此目錄依文件用途管理；學校交付採四技部／大學部物件導向規範。

| 入口 | 用途 |
|---|---|
| [目前狀態](current-status.md) | 跨服務可用範圍、風險與下一步 |
| [功能狀態總表](30_Features/README.md) | 功能階段、驗收證據與缺口 |
| [重要決策](decision-log.md) | 決策原因與影響，保留歷史時間點 |
| [正式交付](00_Deliverables/README.md) | 系統簡介、分章手冊、競賽及 ESG 投稿 |
| [專案歷史](10_Project_History/README.md) | 有日期的專案快照 |
| [架構資料](20_Architecture/README.md) | 架構圖、資料庫及階層檢索設計 |
| [開發與維運](40_Operations/README.md) | 開發工具、部署與憑證文件 |
| [會議紀錄](50_Meetings/README.md) | 教授會議與組內會議 |
| [視覺識別](60_Brand/README.md) | Logo 與各格式素材 |
| [歷史歸檔](90_Archive/README.md) | 草稿、學習紀錄、外部範例及相同副本 |
| [本次搬移與新增紀錄](10_Project_History/docs-reorganization-2026-09-13.md) | 原路徑、新路徑、雜湊及檢查結果 |

## 文件責任

- 專案根目錄 [README](../README.md) 負責啟動與導覽、[PROJECT](../PROJECT.md) 負責產品範圍、[ARCHITECTURE](../ARCHITECTURE.md) 負責穩定架構、[AGENTS](../AGENTS.md) 負責代理工作入口。
- 各服務文件仍由服務目錄維護，例如 [backend/docs](../backend/docs/)、[Pipeline README](../STT_Whisper/README.md)、[Database README](../database/README.md)。這裡引用它們，不建立第二份 API／資料庫真相。
- 功能完成後留在原功能資料夾；只有被取代版本歸入功能內 `archive/`，已下線功能才移至 `90_Archive/retired-features/`。
- 共用架構圖放在 `20_Architecture/system-diagrams/`，各章以相對連結引用。手冊 `images/` 只放從原稿擷取的圖與手冊專用畫面。
- `source-documents/` 保留本次引用的原件／初評交付；草稿放 `90_Archive/manual-drafts/`。原始驗收 JSON、CSV、題庫及二進位原件保留內容。
- 更新狀態須附日期與證據。2026-09-13 是本次整理日期，不是全部功能重新測試的日期。

先讀目前狀態，再看功能總表，最後進入所需的交付、架構、規格或維運文件。
