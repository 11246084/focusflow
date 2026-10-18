# docs 資料夾重整規格（2026-10-18）

這份規格記錄 2026-10-18 與使用者討論定案的 `docs/` 新結構，交給 Codex 實作。目標是讓常開的手冊、簡介、競賽、功能規格與圖檔最多點兩層就找到。實作者照「搬移對照」逐步執行，每步更新受影響連結並驗證。

## 工作規則

- 從 `dev` 開分支 `docs/restructure-2026-10`；一個步驟一個 commit；**不要 push**。
- Commit 作者用本機 Git 身分（Weihao），訊息不得有 `Co-Authored-By`、Codex、Claude、GPT 或任何 AI trailer。
- 一律用 `git mv` 搬移以保留歷史；刪除只限本文「刪除」欄明列的項目。
- 歷史原文（`90_Archive/` 內的紀錄、`docs-reorganization-2026-09-13.md`、會議紀錄）**不改內文**；其中失效的連結列入完成回報即可。
- 命名規則：學校／評審相關用中文；開發用與程式會讀寫、在命令列輸入的資料夾用英文（`tools/`、`chapters/`、`output/`）。圖片只被 md 相對路徑引用，所以圖庫用中文。
- 編號規則：`0x` 常開，`10` 以上少開，`90` 歷史。
- 新增或改名的 md 依 AGENTS.md 文件寫作規則，並登記在 `docs/README.md`。

## 新結構

```
docs/
├─ README.md / current-status.md / decision-log.md / md-audit.md（CLAUDE.md 連到其待遷移清單，留在根目錄）
├─ 00_學校公告/            README.md＝繳交清單；學校發的檔案平放
├─ 01_系統手冊/            README.md、output/、chapters/、tools/（含 templates/、layout/）、審查與修訂/
├─ 02_系統簡介/            README.md、FocusFlow_系統簡介.md、output/、tools/
├─ 03_競賽/                README.md（各比賽總表）＋每場比賽一個資料夾：送件版/ 修訂稿/ 評審意見/ 官方空白表格/（有才建）
├─ 04_Features/            README.md、Short_Video/、Short_Script_Automation/、Student_Pilot_Backend/、QA_Evaluation/、Hierarchical_Retrieval/
├─ 05_圖庫/                README.md（圖目錄）、架構圖/、研究架構圖/、Logo/、系統手冊/（_shared/、chNN/）
├─ 06_會議紀錄/
├─ 10_Operations/          含 database-delivery.md
└─ 90_Archive/             snapshots/、docs-reorganization/、superseded/、chat-history/、learning-reports/、external-examples/
```

圖檔規則：兩份以上文件會用的圖依種類放（`架構圖/`、`研究架構圖/`、`Logo/`）；只有手冊用的放 `05_圖庫/系統手冊/chNN/`，成品與原始碼同資料夾。一張圖只有一個家，手冊章節直接以相對路徑引用圖庫，不複製。

## 搬移對照

路徑以 `docs/` 為起點。

### 00_學校公告

| 原位置 | 新位置／處理 |
|---|---|
| `00_Deliverables/Submission/README.md` | `00_學校公告/README.md`（繳交清單；資料庫項目改連 `10_Operations/database-delivery.md`） |
| `00_Deliverables/System_Manual/source-documents/` 的學校檔：`115-1_*`（5 份）、`115年_系統手冊規範.doc`、`115年資訊管理實務專題評審配分比例表-日間部.pdf`、`專題作品電子文件上網授權書_.doc` | `00_學校公告/`（平放） |
| `00_Deliverables/System_Overview/source-documents/115年_系統簡介規範.docx` | `00_學校公告/` |
| `00_Deliverables/Contest/00_共用行政文件/115年_專題成果參與校外競賽暨投稿研討會認列申請表.docx` | **刪除**（5/28 舊版；`115-1_` 9/24 版已搬入 00_學校公告） |

### 01_系統手冊（原 `00_Deliverables/System_Manual/`）

| 原位置 | 新位置／處理 |
|---|---|
| `README.md`、`output/`、`chapters/`、`tools/*` | 同名搬到 `01_系統手冊/`。README 的「圖表與素材」一節改成一行連到 `05_圖庫/README.md`；`build_manual.py` 會讀 README 的「AI 輔助產出說明」，該節格式不可動 |
| `templates/系統手冊版型.docx` | `tools/templates/` |
| `source-documents/專題手冊_初評最終版.docx`（封面 Logo 來源） | `tools/templates/` |
| `review/chapter_pages.json`、`review/table_layout.json` | `tools/layout/` |
| `review/` 其餘檔、`feedback/` 兩檔 | `審查與修訂/` |
| `docs/reports/ch05～ch09-change-note.md`、`reference-gap-ch05-09.md`、`2026-09-29_初評意見修訂說明.md` | `審查與修訂/` |
| `figures/` | `05_圖庫/系統手冊/`（見 05） |
| `圖表目錄.md` | 「圖目錄」改寫成 `05_圖庫/README.md`；「表目錄」**刪除**（Word 由表說自動產生） |
| `圖片盤點與改版待辦.md` | 整檔移到 `90_Archive/docs-reorganization/2026-10-18_手冊圖片盤點.md`；其「命名與保留規則」「第 3 類」「尚缺的操作畫面」摘要寫進 `05_圖庫/README.md` |
| `source-documents/README.md` | 內容併入 `01_系統手冊/README.md` 後**刪除** |

必改的程式路徑：`tools/build_manual.py`（`TEMPLATE`、封面 Logo 來源、`chapter_pages.json`、header 說明中的 `figures/`）、`tools/refresh_manual_word.ps1`（寫出 `chapter_pages.json` 的位置）、`tools/rebuild_manual.ps1`、`tools/artifact.md`；15 章 md 的圖片路徑改為 `../../05_圖庫/系統手冊/chNN/…`。

### 02_系統簡介（原 `00_Deliverables/System_Overview/`）

| 原位置 | 新位置／處理 |
|---|---|
| `README.md`、`FocusFlow_系統簡介.md`、`output/`、`tools/build_overview.py` | 同名搬到 `02_系統簡介/`；檢查 `build_overview.py` 內的路徑 |
| `images/README.md`（佔位） | **刪除** |
| `source-documents/四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx/.pdf` | **雲端項目**（見最後一節），上傳確認前原地不動 |
| `source-documents/README.md` | 雲端項目處理完後**刪除** |

### 03_競賽（原 `00_Deliverables/Contest/`）

比賽資料夾名稱維持原全名。

| 原位置 | 新位置／處理 |
|---|---|
| `README.md` | `03_競賽/README.md`，改寫成總表：比賽、日期、組別、狀態、送件檔連結 |
| `2026_全國大專院校產學創新實作競賽/附件*` | 同資料夾 `送件版/` |
| `…/00_補件與送件檢查.txt` | 內容併入該比賽 `README.md` 後**刪除** |
| `90_Archive/external-examples/2026_全國大專院校產學創新實作競賽_官方空白表格/` | `03_競賽/2026_全國大專院校產學創新實作競賽/官方空白表格/` |
| `2026_臺灣數創大賞/` 計畫書、`feedback/` | `送件版/`、`評審意見/` |
| `2026_資訊應用服務創新競賽/`、`2026_全國智慧創新暨跨域整合創作競賽/` 的檔案 | 各自 `送件版/` |
| `2026_FinTech金融服務校際創意競賽/` 定稿、`revisions/` | `送件版/`、`修訂稿/` |
| （新增） | `2026_永續研討會ESG投稿/README.md`：只寫雲端「學校專題/02_競賽資料/2026永續研討會_論文投稿/」路徑，**不放 Drive 連結**（fork 是 public repo） |
| `00_Deliverables/README.md` 的 ESG 列與其他說明 | 併入 `docs/README.md` 後**刪除** `00_Deliverables/README.md` |

### 04_Features（原 `30_Features/`）

| 原位置 | 新位置／處理 |
|---|---|
| `30_Features/*` | `04_Features/*`，子資料夾名稱與內部結構不變 |
| 四個功能的 `archive/README.md`（只有一句話的佔位） | **刪除** |
| `20_Architecture/hierarchical-retrieval/` | `04_Features/Hierarchical_Retrieval/`：Data Contract、Rollout Plan、Control Implementation、E2E Test Plan → `specs/`；Gate Review、Step9 Index Report → `evidence/`；README 留在功能根目錄。功能總表「分層檢索」列改連這裡 |
| `docs/reports/2026-09-29_影像文字檢索評測題集.json/.md` | `04_Features/QA_Evaluation/datasets/` |
| `docs/reports/2026-09-29_串接錄影畫面事件標註.md` | 先讀內容：屬某功能的驗收或研究證據 → 該功能 `evidence/`；否則 → `90_Archive/snapshots/`。回報時說明判斷 |

### 05_圖庫（新）

| 原位置 | 新位置／處理 |
|---|---|
| `00_Deliverables/System_Manual/figures/`（`_shared/`、`ch01`～`ch15`） | `05_圖庫/系統手冊/`，內部結構不變；只有 `.gitkeep` 的空章節資料夾**刪除** |
| `20_Architecture/system-diagrams/系統架構圖簡報版_v3_0923.png/.html`、`archify/`（全部 8 檔） | `05_圖庫/架構圖/` |
| `20_Architecture/system-diagrams/` 初評時期：`系統架構圖文件用_v1_0508.png`、`_v2_0519.png`、`系統架構圖詳細版_v1_0508.png`、`_v1.2_0508.png`、`_v2_0519.png`、`legacy/` 14 檔 | **雲端項目**，上傳確認前原地不動 |
| `20_Architecture/system-diagrams/README.md` | 併入 `05_圖庫/README.md` 後刪除 |
| `00_Deliverables/Research_Framework/`（全部，含 v1.0、v2.0） | `05_圖庫/研究架構圖/`；v1.0、v2.0 依使用者決定保留 |
| `60_Brand/logo/` | `05_圖庫/Logo/`；`60_Brand/README.md` 併入圖庫 README 後刪除 |

`05_圖庫/README.md` 內容：圖庫用途與規則；圖目錄（依文件、章節列出每張圖的圖號、成品、原始碼連結，手冊引用的共用圖也列在該章下）；待辦（第 3 類待確認來源的圖、尚缺的操作畫面）。

### 06、10、90

| 原位置 | 新位置／處理 |
|---|---|
| `50_Meetings/` | `06_會議紀錄/`，內部不變 |
| `40_Operations/` | `10_Operations/`，內部不變 |
| `00_Deliverables/Database/README.md` | `10_Operations/database-delivery.md` |
| `20_Architecture/database/README.md`、`20_Architecture/README.md` | **刪除**（AGENTS.md 已有相同入口） |
| `20_Architecture/database/archive/MongoDB_契約定版_v1_已過期.md` | `90_Archive/superseded/` |
| `10_Project_History/snapshots/*`、`90_Archive/agent-context-2026-10-10.md`、`docs/reports/2026-09-24_project-gap-audit.md` | `90_Archive/snapshots/` |
| `10_Project_History/docs-reorganization-2026-09-13.md` | `90_Archive/docs-reorganization/`（內文不改） |
| `10_Project_History/README.md` | 併入 `90_Archive/README.md` 後刪除 |
| `90_Archive/backend/handoff-shorts-frontend-plan.md`、`90_Archive/recut-prototype-log-2026-10-14.md` | `90_Archive/superseded/` |
| `90_Archive/retired-features/README.md` | **刪除** |
| 本規格檔 `docs/docs-restructure-plan-2026-10-18.md` | 最後一步移到 `90_Archive/docs-reorganization/` |

完成後 `00_Deliverables/`、`10_Project_History/`、`20_Architecture/`、`30_Features/`、`40_Operations/`、`50_Meetings/`、`60_Brand/`、`reports/` 都不存在（雲端項目暫留的除外）。

## 連結更新範圍

每一步都要修好它弄斷的連結，範圍是整個 repo，不只 `docs/`：`AGENTS.md`、`CLAUDE.md`、`README.md`、`PROJECT.md`、`ARCHITECTURE.md`、`.claude/rules/`、`.claude/skills/`、`.agents/skills/`、`backend/docs/`、`database/`、`STT_Whisper/`、`frontend/focus-flow/`、各 README，以及程式或測試中寫死的 docs 路徑。`.claude/rules/database.md` 提到的過期契約與階層檢索路徑也要更新。

最後改寫 `docs/README.md`：文件入口表改成新結構，修掉「手冊 `images/`」「整理日期 2026-09-13」等過時描述；`90_Archive/README.md` 對照新子資料夾更新。

## 建議步驟（各一個 commit）

0. 搬移前先跑一次 `build_manual.py` 產出基準 DOCX，存到 repo 外的暫存資料夾（不 commit）。
1. 00_學校公告
2. 01_系統手冊內部整理＋程式路徑
3. 05_圖庫：手冊圖搬移、章節圖片路徑、圖庫 README
4. 05_圖庫：架構圖（複評）、研究架構圖、Logo
5. 02_系統簡介
6. 03_競賽
7. 04_Features（含 Hierarchical_Retrieval、QA 題集）
8. 06_會議紀錄、10_Operations、database-delivery
9. 90_Archive 整併、刪除 `reports/` 與佔位檔
10. `docs/README.md` 改寫、本規格移入歸檔

## 驗證

- 全 repo 相對連結與 md 圖片連結檢查：除歷史原文外 0 失效。
- `git grep` 舊路徑字串（`00_Deliverables`、`10_Project_History`、`20_Architecture`、`30_Features`、`40_Operations`、`50_Meetings`、`60_Brand`、`docs/reports`）：只允許出現在歷史原文。
- 手冊：`py_compile` 各 py；重建 DOCX 與步驟 0 的基準比較 `document.xml`、styles、footnotes、headers／footers（忽略 rId、docPr id、自動圖片名稱），130 張圖順序與內容相同；PlantUML `!include` 與 js `require` 的相對路徑都能解析。
- `git diff --check`。
- 不需跑 backend／frontend 測試，除非改到程式或測試中的路徑；改到時跑對應測試。

## 雲端項目（最後處理）

以下檔案先原地不動。實作完成時，在回報中列出「檔名、大小（位元組）→ 雲端資料夾」清單；使用者上傳並回報後，才另開一個 commit 刪除：

| 檔案 | 雲端資料夾 |
|---|---|
| 初評時期架構圖 5 張 PNG、`system-diagrams/legacy/` 14 檔（保留子資料夾結構） | `學校專題/02_初評資料/架構圖/` |
| 系統簡介 `_初評最終版.docx`、`.pdf` | `學校專題/02_初評資料/系統簡介/` |

## 完成回報

列出：每個 commit 的 hash 與內容、刪除清單、`串接錄影畫面事件標註.md` 的歸屬判斷、歷史原文中失效的連結、驗證結果（實際跑過的與沒跑的）、雲端上傳清單。
