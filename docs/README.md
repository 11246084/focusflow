# FocusFlow 文件總覽

整理日期：2026-09-13。此目錄依文件用途管理；學校交付採四技部／大學部物件導向規範。

## 文件分類（草稿）

這份分類用來決定內容應放在哪裡，避免規則、技術細節與歷史結果混在一起。請先依主要用途選一類，再用下表決定寫法；完整寫作要求見 [AGENTS.md](../AGENTS.md#文件寫作規則)。

| 類型 | 定義與例子 | 寫法 |
|---|---|---|
| ① 給人看 | 安裝與導覽 README、狀態、待辦、交接、架構概覽 | 完整套用寫作規則；先白話說明用途，流程附實例，進度只寫[狀態正本](current-status.md)。 |
| ② AI 指令 | AGENTS、CLAUDE、rules、skills 與 AI 設定 | 只放規則、邊界與流程；專案事實連到①或③，歷史證據連到④。JSON／YAML 等工具設定保留必要欄位與原格式，不塞進度說明。 |
| ③ 技術參考 | API 契約、功能開關、資料模型與整合流程 | 第一段白話說明用途，欄位、型別、參數與行為以精確為先；附程式依據，實作進度連到①。API 是程式互相呼叫的介面，契約是雙方約定的資料格式。 |
| ④ 歷史紀錄 | 封存原件、實作紀錄、會議原文、驗收報告與盤點快照 | 不再修改原文、日期或數字；現行文件用連結追查，不把舊結果當成目前狀態。 |
| ⑤ 交付文件 | `00_Deliverables/` 的手冊、簡介、繳交與競賽資料 | 依對應交付要求與模板撰寫，保留版本與證據來源；交付內容不作功能狀態正本。 |

分類以主要用途判斷：`00_Deliverables/` 歸⑤，封存與歷史原文歸④；其他索引、空白模板與操作文件不因位於紀錄資料夾就當成歷史原文。程式狀態機屬③，功能完成度屬①。例：AI 指令中的「影像查詢如何運作」→ 改連③功能開關說明；「是否已驗收」→ 改連①狀態正本，原始測試結果留④。

## 文件入口

| 入口 | 用途 |
|---|---|
| [目前狀態](current-status.md) | 跨服務可用範圍、風險與下一步 |
| [後端功能開關](../backend/docs/feature-flags.md) | 開關來源、重啟條件與影像備援行為 |
| [STT 整合流程](../backend/docs/stt-integration.md) | 語音轉文字的上傳、排程、回報與恢復入口 |
| [功能狀態總表](30_Features/README.md) | 功能階段、驗收證據與缺口 |
| [重要決策](decision-log.md) | 決策原因與影響，保留歷史時間點 |
| [recut 短影片設計決策](30_Features/Short_Video/recut-design-decisions.md) | 老師原音＋程式動畫短片的已定案設計與待討論問題 |
| [recut 素材開放與排除清單](30_Features/Short_Video/recut-asset-exclusions.md) | AI 能從 Fluent Emoji 挑哪些圖與排除理由 |
| [繳交清單](00_Deliverables/Submission/README.md) | 學校各階段繳交項目、期限、規定檔名與目前狀態 |
| [正式交付](00_Deliverables/README.md) | 系統簡介、分章手冊、資料庫交付、競賽及 ESG 投稿 |
| [2026 產學創新實作競賽文件](00_Deliverables/Contest/2026_全國大專院校產學創新實作競賽/README.md) | D 組報名附件、補件清單與送件操作 |
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
- `source-documents/` 保留本次引用的原件／初評交付；初評前草稿已於 2026-10-18 自 repo 移除，改由雲端「學校專題/02_初評資料/」保存或從 git 歷史取回。原始驗收 JSON、CSV、題庫及二進位原件保留內容。
- 更新狀態須附日期與證據。2026-09-13 是本次整理日期，不是全部功能重新測試的日期。

先讀目前狀態，再看功能總表，最後進入所需的交付、架構、規格或維運文件。
