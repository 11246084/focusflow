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

---

## 第二輪修訂（2026-09-25）

依據：`doc/reference-gap` 分支 `docs/reports/reference-gap-ch05-09.md` 第 9 節清單，只處理與第 7 章有關的第 1、13、14 項（第 20 項等低優先度可選項未做）。核心原則：以圖為主，文字搭配圖說明。本輪只修改第 7 章正文、`diagrams/chapter07/`、第 7 章圖檔與本檔，未修改其他章節與共用檔。

### A. 改了什麼與原因

| 報告項目 | 修改 | 原因 |
| --- | --- | --- |
| 第 1 項（高）＋ C3 | 補回 4 張狀態機（圖7-4-6～7-4-9），依目前 service 重繪；7-4 由 5 張擴為 9 張 | 第 9 章（`doc/ch09`）前言引用「圖7-4-1～圖7-4-9」，表9-1-17 引用圖7-4-6、表9-1-26 引用圖7-4-7、表9-1-25 引用圖7-4-8；第一輪移入 archive 會造成合併後引用斷裂，且這 4 個物件的狀態原本只寫在表格文字中 |
| 第 1 項＋ C5 | 表7-4-1 ShortAsset 列補上 `ready`，並說明它目前無寫入路徑；新增 4 列的圖號；Video.youtubeUpload 列補上「未上傳（`null`）」 | `constants/enums.js` 的 `SHORT_ASSET_STATUSES` 含 `ready` |
| 第 13 項（中） | 圖7-2-3、7-2-4、7-4-1、7-4-4、7-4-5 重新排版為直式（高寬比 0.36～0.46 → 0.63～0.84），升小版本 `v3-1` | 橫條圖放進直式 A4 時字級過小；內容未變，只調整版面 |
| 第 14 項（中）＋ C9 | 表7-2-1 刪除版本、改為「函式庫／依賴它的套件（圖）／用途」三欄，並移到 7-2 末尾，使 7-2 以圖7-2-1 開頭；圖7-2-1、7-2-2、7-2-3 的 `«library»` 框同步移除版本（升 `v3-1`）；7-2 導言註明版本統一見第 9 章 9-2-3 | 版本在第 7、9 章重複維護容易不同步 |
| 圖文順序 | 表7-4-1 由 7-4 開頭移到 7-4 末尾「狀態彙整」，7-4 改以圖7-4-1 開頭 | 以圖為主；表格作為彙整 |
| 補充文字 | 圖7-2-3 移除 webhook 附註（以減少交錯連線），改在判讀段補一句「`main.py` 以 HTTP 呼叫 internal processing webhook（見圖7-4-3）」 | 資訊不減少，只從圖移到文字 |

四張新狀態機依程式修正了舊版 `v1-0`（已在 archive）的錯誤：

- **ShortScript**：舊版把 `approved` 畫成教師審核動作 `reviewAction(approve)`；實際上 `submitReview` 只接受 `request_changes` 與 `dismiss`，`approved` 只由 `markScriptPublished`（成品上架成功）寫入。舊版「證據包無轉折句時轉 dismissed」也不符：生成回 422 `SHORT_SCRIPT_ARC_NOT_APPLICABLE` 時狀態不變。
- **ShortAsset**：舊版寫「`published` 重新產生新版本回到 `pending_review`」「來源影片刪除連動封存」，兩者皆不存在：`createAssetFromScript` 只對尚未上架、未封存的成品換代，封存只由課程刪除觸發。本版改以 `draft` 複合狀態（內含 `pending`／`approved`／`rejected`）呈現 `status × reviewStatus`，並加入 `ready` 保留值。
- **Enrollment**：補上課程刪除時整批刪除修課紀錄、觀看進度更新。
- **YouTube 上傳**：補上「未上傳（`null`）」初始狀態；`failed` 拆成「可重試」與「需人工確認」兩個子狀態；註明開機復原受 `YOUTUBE_UPLOAD_RECOVERY_ENABLED` 控制（預設關閉），且只在啟動時執行。

### B. 新增或重繪的圖

圖7-4-6～7-4-9 的物件對應依 `doc/ch09` 第 9 章確認：表9-1-17「課程存取與修課名單服務」引用圖7-4-6、表9-1-26「短影音腳本服務」引用圖7-4-7、表9-1-25「學生短影音牆」引用圖7-4-8；圖7-4-9 第 9 章只在前言以「圖7-4-1～圖7-4-9」範圍引用，未指明物件，因此依預設對應 YouTube 上傳。

| 圖號 | 對應物件 | 圖源／PNG 檔名 | 版本 | 高寬比 | 性質 |
| --- | --- | --- | --- | --- | --- |
| 圖7-4-6 | Enrollment（修課） | `圖7-4-6-修課狀態機圖-v2-0.puml`／`.png` | v2-0 | 0.68 | 補回並重繪（v1-0 在 archive） |
| 圖7-4-7 | ShortScript（短影音腳本） | `圖7-4-7-短影音腳本狀態機圖-v2-0.puml`／`.png` | v2-0 | 1.01 | 補回並重繪 |
| 圖7-4-8 | ShortAsset（短影音成品，`status × reviewStatus`，含 `ready`） | `圖7-4-8-短影音成品狀態機圖-v2-0.puml`／`.png` | v2-0 | 0.91 | 補回並重繪 |
| 圖7-4-9 | Video.youtubeUpload（YouTube 上傳） | `圖7-4-9-YouTube上傳狀態機圖-v2-0.puml`／`.png` | v2-0 | 0.77 | 補回並重繪 |
| 圖7-2-1 | 前端套件圖 | `圖7-2-1-前端套件圖-v3-1.puml`／`.png` | v3-1 | 0.92 | 移除版本 |
| 圖7-2-2 | 後端套件圖 | `圖7-2-2-後端套件圖-v3-1.puml`／`.png` | v3-1 | 0.65 | 移除版本 |
| 圖7-2-3 | AI-Pipeline套件圖 | `圖7-2-3-AI-Pipeline套件圖-v3-1.puml`／`.png` | v3-1 | 0.76（原 0.46） | 直式排版、移除版本 |
| 圖7-2-4 | 資料儲存套件圖 | `圖7-2-4-資料儲存套件圖-v3-1.puml`／`.png` | v3-1 | 0.84（原 0.46） | 直式排版 |
| 圖7-4-1 | 登入Session狀態機圖 | `圖7-4-1-登入Session狀態機圖-v3-1.puml`／`.png` | v3-1 | 0.64（原 0.44） | 直式排版 |
| 圖7-4-4 | QA提問狀態機圖 | `圖7-4-4-QA提問狀態機圖-v3-1.puml`／`.png` | v3-1 | 0.63（原 0.45） | 直式排版 |
| 圖7-4-5 | LINE對話範圍狀態機圖 | `圖7-4-5-LINE對話範圍狀態機圖-v3-1.puml`／`.png` | v3-1 | 0.72（原 0.36） | 直式排版 |

被取代的檔案（未刪除）：

- 7 張 `v3-0` PNG 以 `git mv` 移至 `images/archive/chapter07-before-20260925/`。
- 7 個 `v3-0` 圖源由 `git mv` 改名為 `v3-1`，另將 `v3-0` 原內容複製一份到 `diagrams/chapter07/archive/`，與第一輪做法一致。

驗證：

- 16 個圖源 `plantuml -checkonly` 通過；11 張新／改圖逐張以 Read 檢視，文字未截斷、未重疊。排版過程中依檢視結果調整：圖7-4-6 刪除與「觀看進度」自我轉換重疊的「重複指派」迴圈（改寫在正文）；圖7-4-7 以複合狀態「進行中」收斂 4 條放棄轉換；圖7-4-8 改為直式並把課程刪除失敗的還原寫入附註與正文。
- 匯出到 `images/` 的 PNG 與檢視過的版本逐位元組相同。
- `validate_diagram_artifacts.py --require-version`（不含圖目錄）：`DIAGRAM_ARTIFACTS_OK diagrams=16`。含圖目錄時有 16 個錯誤：12 個是既有列未記錄新版本，另 4 個是圖目錄沒有圖7-4-6～7-4-9 的列。
- `git diff --check` 通過。

### C. 未完成項目及原因

- **圖目錄同步**：`圖表目錄.md` 需新增圖7-4-6～7-4-9 四列，並把圖7-2-1～7-2-4、7-4-1、7-4-4、7-4-5 的版本改為 `v3-1`、其餘改為 `v3-0`。本任務限定不改共用檔，未處理。
- **報告第 20 項（低，可選）**：佈署圖層名加編號，依指示不做。
- **第 9 章 9-2-3**：版本只保留在第 9 章的前提是 `doc/ch09` 表9-2-4～9-2-7 與 manifest 一致；本輪只讀取、未修改第 9 章。
- **其餘報告項目**（第 2～12、15～19、21 項）屬第 5、6、8、9 章，依指示不處理。

### D. 待人工確認事項

1. `圖表目錄.md`、`圖片盤點與改版待辦.md`、`README.md`（第 7 章圖數由 12 張變為 16 張）需同步。
2. ShortAsset 的 `ready`：程式中沒有寫入路徑，是否保留此列舉值或補上實際用途，需由團隊決定；本章如實標為保留值。
3. `updateShortAsset`／`createShortAsset` 目前沒有 route 或 controller 呼叫，是否為保留 API，需團隊確認。
4. 圖7-4-9 的物件對應是依預設（第 9 章未明示），若第 9 章另有意圖需回報。
5. 第一輪列出的待確認事項（正式環境 live 狀態、LINE 歷史則數與 `CLAUDE.md` 不一致等）仍適用。

### E. AI 使用紀錄（第二輪）

| 工具 | 使用範圍 | 產出 |
| --- | --- | --- |
| Claude Code（Anthropic） | 讀取差距報告與 `doc/ch09` 第 9 章引用；閱讀 `enrollment.service.js`、`course.service.js`、`shortScript.service.js`、`shortAsset.service.js`、`shortAssetPublish.service.js`、`youtubeUpload.service.js` 查證轉換；撰寫 4 個新圖源、重排 7 個圖源、渲染並目視檢查；改寫 7-2 與 7-4 文字；撰寫本節 | `chapters/07_實作模型.md`、`diagrams/chapter07/` 11 個圖源、`images/` 11 張 PNG、本節 |
