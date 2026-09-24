# 系統手冊第 7 章（實作模型）變更說明

- 日期：2026-09-24
- 分支：`doc/ch07`（PR 目標：`dev`）
- 範圍：`docs/00_Deliverables/System_Manual/chapters/07_實作模型.md`、`diagrams/chapter07/`、`images/` 內第 7 章圖檔、`images/archive/chapter07-before-20260924/`
- 未修改：`README.md`、`圖表目錄.md`、`圖片盤點與改版待辦.md`、`diagrams/_style.puml`、其他章節

## 1. 依據與讀取來源

| 優先序 | 來源 | 用途 |
| --- | --- | --- |
| 規範 | `source-documents/115年_系統手冊規範.doc` | 以 UTF-16 字串擷取核對原文：「7-1 佈署圖、7-2 套件圖、7-3 元件圖、7-4 狀態機，甚至時序圖」。狀態機為必要，時序圖為延伸，本輪未繪製時序圖 |
| 1 | 目前程式碼、設定與部署檔 | `.github/workflows/deploy.yml`、`backend/src/`（server.js、app.js、routes、services、models、config）、`frontend/focus-flow/src/`、`STT_Whisper/src/`、各 `package.json`／`requirements.txt`、`docs/40_Operations/deployment/` |
| 2 | 初評最終版 PDF 第 7 章（PDF 第 43～50 頁） | 沿用章節架構（佈署圖四層、5 組套件圖、5 組狀態機）與「套件版本＋用途」的說明方式；初評的套件圖只列第三方函式庫，本輪保留其版本與用途敘述並移入表7-2-1，套件圖改以程式分群為主、函式庫為依賴對象 |
| 3 | 114414 組系統手冊第 7 章（PDF 第 42～47 頁） | 只參考結構與版面：一圖一模組、圖幅精簡、圖說置於圖下。未複製內容；其狀態圖屬畫面流程，本手冊不仿照 |
| 3 | 115414 組系統手冊 | repo 內的 PDF 只有 5 頁，是該手冊第 9 章參考資料（原書第 63～67 頁），不含第 7 章，因此無從參考 |
| 規則 | `AGENTS.md`、`CLAUDE.md`「部署與對外連線（VM）」、`diagrams/章5至10_製圖brief_2026-09-19.md`、`System_Manual/README.md`、`.claude/skills/ooad-uml-diagramming/`（章節契約、製圖慣例、審查清單） | 製圖規範、版本規則與敘述邊界 |

## 2. 改了什麼與原因

### 2-1 章節文字

- 章首改寫為四個視角的導讀，並說明 live 狀態一律以「待確認」標示。
- 7-1：表7-1-1 表名改為與圖表目錄一致的「部署層級、用途與驗收邊界」，新增「執行環境狀態」欄；判讀文字依請求路徑（網頁、LINE、影片處理、外部服務、自動部署、對外連接埠）分點說明，補上 GitHub Actions runner、`backend/uploads`、YouTube IFrame 播放路徑與部署 workflow 的實際步驟。
- 7-2：表7-2-1 依各 manifest 補齊宣告版本；刪除未被 `backend/src` 直接 require 的 `js-yaml`、未被 `STT_Whisper/src` 直接 import 的 `numpy`／`sentence-transformers`；`mongodb` driver 註明只用於維運腳本。五張套件圖各有前導與判讀段落。
- 7-3：原本的純文字依賴流程改為表7-3-1「提供／需要的介面」對照，與圖7-3-1 一致。
- 7-4：標題改為「狀態機（State machine），甚至時序圖（Timing diagram）」；表7-4-1 保留 10 個對象並新增「圖」欄；五張狀態機各有前導與判讀段落。
- 刪除「前端導覽主要以 component state 切換」等已不符現況的敘述（`pageRouting.js` 已同步網址）。

### 2-2 與程式不符而修正的內容

| 圖 | 舊版問題 | 修正依據 |
| --- | --- | --- |
| 圖7-1-1 | 缺 GitHub Actions runner、上傳暫存目錄、瀏覽器直連 YouTube 播放；四層結構不明顯 | `deploy.yml`、`video.service.js`、`StudentCourses.jsx` |
| 圖7-2-1 | `api.js` 誤放 `services/`、`navigationConfig.js` 誤放 `utils/`；未呈現第三方函式庫 | 實際目錄與 import |
| 圖7-2-2 | 未呈現分層例外（health／stats route 直接呼叫 service、`authenticate` 直接讀 User model、啟動程式呼叫 service） | `backend/src` 各目錄 require 關係 |
| 圖7-2-3 | 未呈現 `batch_manager.py` 以子程序呼叫 `main.py` 的反向依賴 | `batch_manager.py` |
| 圖7-2-4 | 「應用集合」與程式碼套件混為同層、依賴對象不清 | Mongoose models、uploader、`database/tools` |
| 圖7-2-5 | `SharedQa ..> SharedQa` 自我依賴無意義；缺回答生成與 models | `qa.service.js` 等 require 關係 |
| 圖7-3-1 | 外部服務的介面全接在單一 API 元件上，無法看出 adapter 集中點；缺 LINE webhook、SMTP、YouTube IFrame | `routes/index.js`、各 adapter service |
| 圖7-4-1 | 以 `unavailable` 當作驗證中狀態；「受保護 API 回 401 時轉 invalid」在程式中不存在 | `authSession.js`、`App.jsx`、`AdminApp.jsx` |
| 圖7-4-2 | 含程式中不存在的 `archiveView`、`noFurtherRetry` 轉換；未說明狀態是查詢時推導 | `videoBatch.service.js` 的 `deriveBatchStatus`／`syncBatchStatus` |
| 圖7-4-3 | 缺「STT 程序異常結束 → failed」、retry 權限條件；completed 後的 `retain` 轉換不存在 | `videoProcessing.service.js`、`video.service.js` |
| 圖7-4-4 | 把 4xx 權限拒絕畫成 `failed`，但程式對 4xx 不寫入 `questions` | `qa.service.js` 的 `isSystemAskFailure` |
| 圖7-4-5 | `token_issued` 屬於 `LineBindToken` 而非 `User`，違反單一 classifier；缺網頁帶入課程、綁定連結含課程、改綁他人等轉換 | `line.service.js`、`enrollment.service.js` |

### 2-3 狀態機由 9 張調整為 5 張

依指示維持 5 組狀態機（與 `圖表目錄.md` 目前列出的圖7-4-1～7-4-5、`README.md` 的「5 組狀態機」及第 9 章「圖7-4-1 至圖7-4-5」的引用一致）。2026-09-21 新增的圖7-4-6～7-4-9（修課、短影音腳本、短影音成品、YouTube 上傳）移入 archive，未刪除；其狀態與約束仍保留在表7-4-1 的文字列。若團隊希望恢復這四張圖，需另行同步圖表目錄。

## 3. 新增或重繪的圖表

所有圖皆為重大重繪，主版本遞增為 `v3-0`（圖7-1-1 由 `v2-1` 升版）。圖源在 `diagrams/chapter07/`，PNG 在 `images/`。

| 圖號 | 名稱 | 圖源／PNG 檔名 | 版本 |
| --- | --- | --- | --- |
| 圖7-1-1 | 正式環境佈署圖 | `圖7-1-1-正式環境佈署圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-2-1 | 前端套件圖 | `圖7-2-1-前端套件圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-2-2 | 後端套件圖 | `圖7-2-2-後端套件圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-2-3 | AI-Pipeline套件圖 | `圖7-2-3-AI-Pipeline套件圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-2-4 | 資料儲存套件圖 | `圖7-2-4-資料儲存套件圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-2-5 | LINE與QA套件圖 | `圖7-2-5-LINE與QA套件圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-3-1 | 系統元件圖 | `圖7-3-1-系統元件圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-4-1 | 登入Session狀態機圖 | `圖7-4-1-登入Session狀態機圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-4-2 | 影片批次狀態機圖 | `圖7-4-2-影片批次狀態機圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-4-3 | 影片處理狀態機圖 | `圖7-4-3-影片處理狀態機圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-4-4 | QA提問狀態機圖 | `圖7-4-4-QA提問狀態機圖-v3-0.puml`／`.png` | v3-0 |
| 圖7-4-5 | LINE對話範圍狀態機圖 | `圖7-4-5-LINE對話範圍狀態機圖-v3-0.puml`／`.png` | v3-0 |

被取代的檔案（以 `git mv` 移動，未刪除）：

- PNG 16 張 → `images/archive/chapter07-before-20260924/`（圖7-1-1 `v2-1`、圖7-2-1～7-4-5 `v2-0`、圖7-4-6～7-4-9 `v1-0`）
- `.puml` 16 個 → `diagrams/chapter07/archive/`。這些檔案仍寫 `!include ../_style.puml`，移入 archive 後相對路徑不再指向共用樣式；若要重新渲染舊版，需改為 `../../_style.puml`。

缺圖：無。規範指定的佈署圖、套件圖、元件圖、狀態機均已涵蓋；時序圖屬延伸，未繪製。

## 4. 驗證

- `plantuml -checkonly`：12 個圖源全部通過。
- 實際渲染 12 張 PNG，逐張以影像檢視確認：文字未截斷、無圖元重疊。過程中依檢視結果調整版面（佈署圖改為四層、移除造成交錯的 note、改用方向提示）。尚存少數連線穿過標籤邊緣的情形（圖7-3-1 的「Messaging API」「Processing Webhook」標籤），文字仍可辨識。
- 內容一致性：每張圖的狀態、轉換、依賴與介面皆對照第 1 節所列程式碼逐項核對；各圖檔頭 `source` 欄列出對應檔案。
- `validate_diagram_artifacts.py --require-version`（不含圖目錄）：`DIAGRAM_ARTIFACTS_OK diagrams=12`。
- 含 `--toc 圖表目錄.md` 時有 12 個錯誤，皆為「圖目錄狀態欄未記錄 v3-0」；因本任務不得修改圖表目錄而保留，見第 7 節。
- `git diff --check`：無空白錯誤。
- 字型：`_style.puml` 指定 Microsoft JhengHei，本環境沒有此字型，PNG 以系統的文泉驛正黑字型渲染。在 Windows 重新渲染時字型會不同，版面可能略有差異。

## 5. 安裝的環境與指令

| 工具 | 版本 | 安裝方式 |
| --- | --- | --- |
| Java | OpenJDK 21.0.10 | 環境已預裝，未安裝 |
| Graphviz | 2.43.0（套件 2.42.2-9ubuntu0.1） | `apt-get install -y graphviz` |
| PlantUML | 1.2026.8（jar SHA-256 `5e1ecfa8ecd32c90…`） | Maven Central 回 429（rate limit），改由 GitHub Releases 下載：`curl -L -o /opt/plantuml/plantuml-1.2026.8.jar https://github.com/plantuml/plantuml/releases/download/v1.2026.8/plantuml-1.2026.8.jar`。GitHub 未提供可比對的官方雜湊，因此雜湊未能交叉驗證 |
| poppler-utils | Ubuntu 套件 | `apt-get update && apt-get install -y poppler-utils`，用於分頁讀取 PDF 與抽取文字 |

渲染指令（中文檔名需指定 UTF-8，否則 PlantUML 找不到檔案）：

```bash
cd docs/00_Deliverables/System_Manual/diagrams/chapter07
LANG=C.UTF-8 java -Dsun.jnu.encoding=UTF-8 -Dfile.encoding=UTF-8 -Djava.awt.headless=true \
  -jar /opt/plantuml/plantuml.jar -charset UTF-8 -tpng -o ../../images 圖7-*.puml
```

以上安裝都在本次雲端容器內進行，不會進入 repository，也不影響其他成員的環境。

## 6. 未能產出的圖

無。時序圖（Timing diagram）為規範「甚至」的延伸項目，本輪未繪製。

## 7. 待人工確認事項

1. **共用檔同步（本任務範圍外）**
   - `圖表目錄.md` 第 43～54 列的狀態欄仍寫 `v2-0`，需改為 `v3-0`；表7-1-1 名稱已與目錄一致。
   - `圖片盤點與改版待辦.md` 第 56～67 列仍引用 `v2-0` 檔名。
   - `README.md` 圖片數量敘述（「第 7 章 16 張」）與實際（12 張）不符；「`v2-0` 圖稿已重繪」需更新。
   - `tools/build_manual.py` 第 191～198 行以舊版第 7 章字串做取代，改版後這些取代不會命中；重新產生 Word 前需確認。
2. **正式環境狀態（皆標為待確認，本輪無法驗證）**：VM 上 Nginx、PM2、ngrok、Python 虛擬環境與模型是否就緒；Atlas `text_embedding_index` 狀態；Gemini、LINE、YouTube、SMTP 憑證是否有效；80 埠仍被阻擋、443 憑證自動續約是否正常。
3. **LINE 對話歷史則數**：`CLAUDE.md` 寫「最近 6 筆訊息」，但程式以 `MAX_CONVERSATION_TURNS × 2` 截斷，預設 4 輪即 8 則；正式 VM 的 `.env` 實際值待確認。本章依程式寫 8 則。
4. **LINE 切換課程的選項**：`CLAUDE.md` 寫「自己的 enrollment ∪ 所有 published 課程」，但 `handleSwitchCourse` 只列出有效修課且已發布的課程；本章依程式撰寫。
5. **狀態機由 9 張減為 5 張**：請團隊確認是否接受（見 2-3）。
6. **交付格式**：PlantUML 為工作母稿，官方要求的 VPP／VPD 交付格式仍待指導老師確認。
7. **PlantUML jar 來源**：未能以官方雜湊交叉驗證（見第 5 節）。

## 8. AI 使用紀錄

| 工具 | 使用範圍 | 產出 |
| --- | --- | --- |
| Claude Code（Anthropic） | 閱讀規範、初評 PDF 第 7 章與參考手冊結構；對照程式碼查證部署、套件、元件與狀態轉換；撰寫 12 個 PlantUML 圖源並渲染、目視檢查 PNG；改寫第 7 章文字；撰寫本變更說明 | `chapters/07_實作模型.md`、`diagrams/chapter07/*-v3-0.puml`、`images/圖7-*-v3-0.png`、本檔 |

各圖檔頭 `ai-assisted` 欄皆已填寫，可彙整至第 14 章 AI 使用表；頁碼待排版後補上。所有圖表狀態為 `draft`，需組員人工確認後才可定稿。
