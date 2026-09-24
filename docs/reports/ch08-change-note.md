# 系統手冊第 8 章（資料庫設計）改版說明

- 日期：2026-09-24
- 分支：`doc/ch08`（自 `dev` 分出）
- 範圍：只改 `docs/00_Deliverables/System_Manual/chapters/08_資料庫設計.md`、`diagrams/chapter08/`、`images/` 內第 8 章圖檔。README、圖表目錄、圖片盤點與其他章節未改動。
- 驗證邊界：全部依 repository 程式碼靜態核對，**未連線共享 MongoDB Atlas**，不代表資料庫現況已 live 驗證。

## 一、讀取的來源

| 類別 | 來源 | 用途 |
| --- | --- | --- |
| 規範 | `source-documents/115年_系統手冊規範.doc` | 物件導向大綱第 8 章要求：「8-1 資料庫關聯表：需註明參考關係及限制(Constraints)。8-2 表格及其 Meta data。」 |
| 契約 | `.claude/skills/ooad-uml-diagramming/references/local/ntub-chapter-contract.md`、`diagrams/章5至10_製圖brief_2026-09-19.md` | 第 8 章圖為非 UML 集合關聯圖、不得以類別圖呈現資料庫綱要 |
| 程式（優先） | `backend/src/models/` 21 份 schema、`backend/src/constants/enums.js`、`backend/src/config/{env,database}.js`、`backend/src/scripts/{ensureQuestionsCollection,ensureParentStorage,ensureVideoVectorIndex}.js`、`backend/src/services/{bridgeScope,qa,parentSearchAdapter,parentVectorIndex,videoVectorIndex,video,line,feedback,notification,demoSeed}.service.js`、`database/tools/setup/init_{collections,indexes}.js`、`backend/.env.example`、`backend/package.json` | 欄位、索引、向量索引、橋接契約與建立途徑 |
| 現況文件 | `AGENTS.md`、`CLAUDE.md`、`.claude/rules/database.md`、`backend/docs/current-state.md`、`docs/00_Deliverables/System_Manual/README.md` | 邊界與歷史 Atlas 快照 |
| 初評版 | `source-documents/四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf` 第 51～57 頁 | 保留「8-1 資料庫關聯表」標題、每表「資料檔陳述」、欄位含型別／必填／預設值的表格形式 |
| 參考手冊 | `docs/90_Archive/external-examples/114_二技四技_專題手冊參考資料/四技114參考文件/四技第114414組-動起來「揪」對了-系統手冊 .pdf` 第 52～57 頁 | 只參考結構：關聯圖方框內列出欄位、每表一張欄位表。未複製內容 |
| 參考手冊 | `docs/90_Archive/external-examples/四技第115414組-救「舊」我的書-系統手冊.pdf` | **repo 內此檔只有 5 頁**（該組第 9 章參考資料與 AI 使用紀錄摘錄），沒有第 8 章，無法參考其資料庫章節 |

## 二、改了什麼與原因

### 文字修訂

| 項目 | 修改內容 | 原因 |
| --- | --- | --- |
| 章節標題 | 「8-1 資料庫關聯圖」改為「8-1 資料庫關聯表」 | 對齊系上規範物件導向大綱與初評版用詞；關聯圖放在 8-1 內 |
| 驗證邊界 | 章首新增資料來源與「程式宣告的目標契約，非 Atlas 現況」說明 | 無法連 Atlas，避免被讀成 live 狀態 |
| 集合數 | 19 → **21**，新增 DB-20 `feedbacks`、DB-21 `feedbackattachments`（欄位表、參照關係、索引） | 草稿遺漏 2026-09 新增的問題回報功能 model |
| `courses.deletedAt`、`videos.deletedAt` | 由「非空即視為已刪除，資料保留供稽核」改為「保留欄位；目前採實體刪除，service 不寫入」 | `course.service.js` 與 `video.service.js` 皆用 `deleteOne`，全 repo 無寫入 `deletedAt` 的程式 |
| `users.lineConversationHistory` | 「保留最近數則」改為 `MAX_CONVERSATION_TURNS × 2`（預設 8 則），切換課程時清空 | `line.service.js` 的 `getBoundedLineConversationHistory` |
| `users.lineConversationState` | 補註 schema 無 `enum`，service 用 `idle`／`awaiting_course_selection` | `line.service.js` 的 `LINE_CONVERSATION_STATES` |
| 參照關係表（表8-1-2） | 補 `users.activeCourseId`、`enrollments.assignedBy／revokedBy`、`enrollments.watchedVideoIds[]`（註明未宣告 `ref`）、`videos.uploadedBy`、`courses.videoIds[]` 與 `videos.courseId` 分列（一支影片可掛多門課程）、Leaf `courseId`、Parent → Video／Course、視覺片段命名規則對應、feedback 兩條；補一段「快照而非參照」說明 | 對照 schema 逐欄核對後的缺漏 |
| QA 橋接契約 | 從 DB-05 的附註升為 8-1 獨立小節，新增圖8-1-6 與表8-1-4（影片／片段識別鍵對照），寫明三種收集條件、只放 `String(videos._id)`、atlas／memory 差異、Parent 過濾條件、視覺引用只在文字無命中時執行 | `bridgeScope.service.js`、`qa.service.js`、`parentSearchAdapter.service.js` |
| 各集合欄位表 | 每表加「資料檔陳述」行（沿用初評版格式），補集合名稱來源與 timestamps；多處補 `trim`、索引方向、API 層限制（附件數、檔案大小、批次上限）與 legacy 標註 | 初評版格式可保留；對齊程式碼 |
| `line_bind_tokens` | 補權杖為 32 bytes 隨機 64 字元、效期 10 分鐘、TTL 刪除時間延遲說明 | `line.service.js` |
| 索引 | 新增表8-2-23「schema 宣告的一般索引總表」，列出全部 21 個集合的索引鍵、選項與用途 | 草稿只在段落中舉例 |
| 向量索引 | 表8-2-24 改寫：三個索引的名稱設定來源、維度、相似度、filter 欄位與建立方式；指出 `text_embedding_index` 在 backend 沒有建立腳本、`QA_ATLAS_VECTOR_INDEX_NAME` 程式預設為空字串 | 草稿把 Parent 索引名稱寫成「由環境變數指定」、文字與視覺維度寫成「依模型而定」，與程式不符（程式定義 3072、預設名稱 `parent_embedding_index`） |
| 建立途徑 | 新增表8-2-25（autoIndex、各 ensure 腳本、mongosh 初始化腳本、demoSeed）與表8-2-26（`init_indexes.js` 與 schema 的 4 項索引差異） | 草稿稱「索引隨應用啟動時建立」，未說明其他途徑與差異 |
| 相容性 | 新增「資料契約與相容性說明」7 點（混合集合、跨型別橋接、命名邊界、legacy、保留未使用欄位、schema 演進、MDF／LDF 交付形式待確認） | 任務要求 |
| 待查證 | 新增表8-2-28「待 live Atlas 唯讀查證項目」 | 任務要求 |

### 圖表處理

**原因。** 原圖8-1-1（v3-0）有以下問題：缺 `feedbacks`、`feedbackattachments`；註解說「箭頭由被參照方指向參照方」，但 `questions → usage_logs`、`notifications ⇢ videos`、`notifications ⇢ shortscripts`、`videos ⇢ shortassets` 方向相反；`videos → video_segments_video` 標為「pipeline video_id」，實際是由檔名等欄位擷取 `video_N`；`video_segments_parent → video_segments_text` 標 `1 : 1..*`，但一個 Leaf 可否被多個 Parent 共用取決於 Pipeline 設定；約 35 條連線交錯，且一條線穿過「營運與內容產出」群組標籤；方框只有集合名稱，看不出欄位與限制。

**處理。** 依任務建議拆圖：圖8-1-1 升版為分組總覽，細部關聯拆成四張 ER 風格的集合關聯圖（方框列出 PK／ref／UK／IDX／TTL／vector 欄位，以鴉爪符號表示基數），另新增一張 QA 橋接契約圖。六張圖都註明「非 UML」。

| 圖號 | PNG 檔名（`images/`） | 原始檔（`diagrams/chapter08/`） | 版本 | 狀態 |
| --- | --- | --- | --- | --- |
| 圖8-1-1 | `圖8-1-1-MongoDB核心集合關聯圖-v4-0.png` | `圖8-1-1-MongoDB核心集合關聯圖-v4-0.puml` | v4-0 | 重繪（取代 v3-0） |
| 圖8-1-2 | `圖8-1-2-帳號課程與問題回報集合關聯圖-v1-0.png` | 同名 `.puml` | v1-0 | 新增 |
| 圖8-1-3 | `圖8-1-3-影片與知識片段集合關聯圖-v1-0.png` | 同名 `.puml` | v1-0 | 新增 |
| 圖8-1-4 | `圖8-1-4-問答對話與使用紀錄集合關聯圖-v1-0.png` | 同名 `.puml` | v1-0 | 新增 |
| 圖8-1-5 | `圖8-1-5-通知與短影音集合關聯圖-v1-0.png` | 同名 `.puml` | v1-0 | 新增 |
| 圖8-1-6 | `圖8-1-6-QA課程範圍橋接契約圖-v1-0.png` | 同名 `.puml` | v1-0 | 新增 |

- 被取代的 `images/圖8-1-1-MongoDB核心集合關聯圖-v3-0.png` 以 `git mv` 移至 `images/archive/chapter08-before-20260924/`，未刪除。
- `diagrams/chapter08/` 的 v2-0、v3-0 `.puml` 原始檔保留原位作為歷史（沿用第 7 章等目錄保留舊版原始檔的慣例）。
- 六張圖皆 `!include ../_style.puml`，未另寫 skinparam；灰底方框使用單一元素的行內顏色。
- 每張 PNG 產出後皆以圖片檢視確認：文字未截斷、無重疊、內容與章節文字及 schema 一致。檢視後做過兩輪修正：(1) 圖8-1-2～8-1-5 由左右排列改為上下排列（圖8-1-3 原 3214×1326 px，印在 A4 直式時字高約 1.3 mm，改後為 2553×1453）；(2) 圖8-1-6 的編號順序、Parent 過濾條件（`courseId` **或** `videoId`）與視覺引用觸發條件依程式更正。
- 圖檔 `realizes` 欄以第 5 章實際需求編號填寫。

## 三、安裝的環境與指令

| 工具 | 版本 | 安裝指令 | 用途 |
| --- | --- | --- | --- |
| OpenJDK | 21.0.10（環境原有） | — | 執行 PlantUML |
| Graphviz | 2.42.2-9ubuntu0.1（`dot -V` 顯示 2.43.0） | `apt-get install -y graphviz fonts-noto-cjk` | PlantUML 版面配置 |
| Noto CJK 字型 | 1:20230817+repack1-3 | 同上 | 中文字型；`_style.puml` 指定的 Microsoft JhengHei 在 Linux 不存在，由 Java 字型 fallback 使用 Noto CJK |
| PlantUML | 1.2025.4（jar SHA-256 前 16 碼 `26518e14a3a04100`） | `curl -sSL -o /opt/plantuml/plantuml.jar https://github.com/plantuml/plantuml/releases/download/v1.2025.4/plantuml-1.2025.4.jar` | 產圖 |
| PyMuPDF | 1.28.2 | `pip install pymupdf` | 讀 PDF 文字與把頁面轉成圖片檢視（`poppler-utils` 的 apt 套件 404，Read 工具無法直接渲染 PDF 頁面） |
| olefile | 0.47 | `pip install olefile` | 讀取規範 `.doc` 文字（LibreOffice 無法載入該檔） |

產圖指令（需 UTF-8 locale，否則 PlantUML 讀不到中文檔名，回報 `No diagram found`）：

```bash
cd docs/00_Deliverables/System_Manual/diagrams/chapter08
export LANG=C.UTF-8 LC_ALL=C.UTF-8
java -Dsun.jnu.encoding=UTF-8 -jar /opt/plantuml/plantuml.jar -tpng -charset UTF-8 -o ../../images \
  圖8-1-1-*v4-0.puml 圖8-1-[2-6]-*.puml
```

注意：本環境以 Noto CJK 渲染，與團隊在 Windows 以 Microsoft JhengHei 渲染的其他章節圖片字型外觀略有差異；若要全冊字型一致，可在 Windows 上以同一指令重新輸出。

## 四、未能產出的圖及原因

無。任務要求的圖皆已產出。

## 五、待人工確認事項

1. **需要 live Atlas 唯讀查證**（詳見章內表8-2-28）：集合清單、各集合 `listIndexes` 是否與表8-2-23 一致、`init_indexes.js` 造成的索引選項衝突（`clips.segmentId`、`video_segments_video.clip_id`）、`text_embedding_index`／`parent_embedding_index`／`video_embedding_index` 是否存在且 READY 及其 filter 欄位、片段 `videoId`／`courseId` 型別分佈、`videos` 中 Pipeline metadata 文件數量、Leaf 向量契約。
2. **`text_embedding_index` 定義來源**：backend 沒有建立腳本，3072 維與 `courseId`／`videoId` filter 取自 `init_indexes.js` 註解與 `current-state.md`，表8-2-24 已標「待確認」。
3. **章節標題用詞**：已依系上規範改為「8-1 資料庫關聯表」；`ntub-chapter-contract.md` 寫「資料庫關聯圖」，若團隊偏好後者可再改回。
4. **MDF／LDF 交付形式**：MongoDB 無對應格式，是否以 `mongodump` 或只交 schema／初始化腳本，需與指導老師確認。
5. **圖表目錄與圖片盤點**：依任務限制未改。`圖表目錄.md` 仍列圖8-1-1 為 `v2-0`、表格編號也與本章不一致（本章為表8-1-1～8-1-4、表8-2-1～8-2-28，圖8-1-1～8-1-6）；`System_Manual/README.md` 的第 8 章狀態與圖片計數也需同步。
6. **其他文件的過期敘述（本次未改）**：
   - `CLAUDE.md`「Video Model」一節說 `bridgeScope.service.js` 會把 `_id`、`videoId`、`video_id` 三種鍵都放進允許集合；目前程式 `addVideoIdentifiers` 只放 `String(video._id)`（`videoId`／`video_id` 只用於「收集影片」階段）。
   - `CLAUDE.md`「LINE Bot」一節說保留最近 6 筆訊息；目前程式預設為 8 則（`MAX_CONVERSATION_TURNS=4` × 2）。
7. **程式層觀察（非本章範圍，未改）**：
   - 示範資料的影片寫有 `videoId`，但示範片段以 `String(_id)` 為鍵；`video.service.js` 刪除影片時以 `videoId ?? video_id ?? _id` 決定片段鍵，對示範影片會以 `videoId` 去刪片段而對不到，可能留下孤立片段。
   - `feedback.service.js` 建立回報分三步寫入（回報 → 附件 → 回填附件清單），未使用交易；中途失敗可能留下附件清單為空的回報或孤立附件。

## 六、驗證紀錄

| 檢查 | 結果 |
| --- | --- |
| schema 與欄位表逐欄比對 | 以 Node 載入 21 個 model，用 `schema.eachPath()` 列出所有欄位路徑並比對章節表格：21 個集合皆對應到章節，缺漏 0；表格中也沒有 schema 不存在的欄位 |
| 圖片連結 | 章內 6 個圖片相對路徑皆存在 |
| `git diff --check` | 通過 |
| 後端／前端測試 | 未執行（本次只改文件與圖檔，未改程式） |
| Atlas | 未連線，未做任何 live 驗證 |

## 七、AI 使用紀錄

| 工具 | 範圍 | 說明 |
| --- | --- | --- |
| Claude Code（Anthropic Claude） | 第 8 章文字、第 8 章 6 張圖的 PlantUML 原始檔與 PNG、本改版說明 | 閱讀規範、初評版與參考手冊的章節結構；逐一核對 21 份 Mongoose schema、索引腳本與相關 service；改寫章節、拆分重繪集合關聯圖並逐張檢視輸出。內容以程式碼為準，未連線資料庫；需由組員人工確認後才可視為定稿。 |

若要列入手冊 README 的 AI 輔助產出表，建議序號 `AI-DOC-20260924`，範圍「第 8 章」，頁碼待排版。
