# 系統手冊第 5 章（需求模型）變更說明

- 日期：2026-09-24
- 分支：`doc/ch05`（目標合併分支：`dev`）
- 範圍：`docs/00_Deliverables/System_Manual/chapters/05_需求模型.md`、`diagrams/chapter05/`、`images/` 中第 5 章圖檔與 `images/archive/chapter05-before-20260924/`
- 未改動：`README.md`、`圖表目錄.md`、`圖片盤點與改版待辦.md` 等共用檔，以及其他章節

## 1. 讀取的資料與使用方式

| 來源 | 讀取範圍 | 使用方式 |
| --- | --- | --- |
| `AGENTS.md`、`CLAUDE.md`、`.claude/rules/*` | 全文 | 工作規則與不可誤稱邊界 |
| `System_Manual/README.md`、`diagrams/章5至10_製圖brief_2026-09-19.md` | 全文 | 章節定位、圖表 brief |
| `.claude/skills/ooad-uml-diagramming`（含 `ntub-chapter-contract.md`、`focusflow-conventions.md`） | 相關節 | 圖種契約、版面決議、版本規則 |
| `source-documents/115年_系統手冊規範.doc` | 以 `word-extractor` 抽出全文，核對「大學部（物件導向）」第 5 章與圖表格式 | 5-1 須分功能／非功能需求；5-2 使用個案圖；5-3 以活動圖描述使用個案；5-4 分析類別圖（分析物件圖為延伸）；表題在上、圖說在下 |
| 初評最終版 PDF（`四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf`） | 第 29–36 頁（第 5 章） | 保留開頭定位段落、「Use Case／需求」對照與「行為者／前提／結束狀態／事件路徑」的描述結構；初評功能範圍與舊類別圖不作為現況證據 |
| 參考手冊 114414 組《動起來「揪」對了》 | 第 25–33 頁（第 5 章） | 只參考章節結構與表格深度（每個使用個案一張描述表、編號步驟對照行為者動作與系統回應）；未複製內容 |
| 參考手冊 115414 組《救「舊」我的書》 | 全部 5 頁 | **此 repo 內的 PDF 只有 5 頁（第 9 章參考資料與 AI 使用表），不含第 5 章**，因此無法比對其第 5 章；僅觀察到 AI 使用表的格式 |
| 程式碼（事實依據） | `backend/src/routes`、`services`（auth、loginThrottle、passwordReset、avatar、enrollment、course、video、videoBatch、videoProcessing、qa、askLimits、conversation、line、notification、feedback、shortScript、shortAsset、admin）、`models`、`constants/enums.js`、`config/env.js`、`middleware/*Upload*`；`frontend/focus-flow/src/pages`（StudentCourses、StudentLineBot、AdminCourses 等）、`components/DashboardApp.jsx` | 查證每條需求的條件、上限值、判斷順序與例外 |

## 2. 改了什麼與原因

### 5-1 使用者需求

- **功能性需求表改為一列一條**（編號／需求名稱／需求說明／對應使用個案）。原表把多條需求用 `<br>` 擠在同一格，而 `tools/build_manual.py` 不會轉換 `<br>`，排版後會出現字面標籤；改為一列一條後可直接追溯。
- **FR-01～FR-22 的編號與原意不變**（第 6、10 章引用 FR-09、FR-10、FR-14、FR-15），只依程式補上可驗證的條件與預設值：
  - FR-01：密碼至少 8 字元。
  - FR-02：鎖定門檻預設 15 分鐘內 5 次、鎖 15 分鐘。
  - FR-03：頭像 JPEG／PNG／WebP、1 MiB；忘記密碼驗證碼 6 位數、10 分鐘、錯 5 次失效。
  - FR-06：名單匯入單次最多 200 筆；尚無帳號者**以學號為初始密碼建立學生帳號**（原稿未寫出）。
  - FR-08：單檔 500 MB；啟用時本機影片以 unlisted 上傳 YouTube。
  - FR-09：每批最多 10 支。
  - FR-11：刪除影片會一併移除片段與 FAQ 快取（`video.service.js`）。
  - FR-12：80% 觀看門檻（`StudentCourses.jsx`）。
  - FR-13：問題 50 字、每日 5 次（網頁與 LINE 合併）、每月用量配額。
  - FR-17：綁定碼 10 分鐘有效、最多列 4 門課、可解除綁定、課程 QR Code。
- **修正與程式不符之處**：
  - FR-18／UC-09：原稿寫「管理員可發送全站公告」，程式 `broadcastSystemNotification` 只發給**啟用中的學生**，已改寫。
  - UC-05：原稿寫「LINE 已綁定其他帳號時拒絕」，程式 `handleBind` 是**把該 LINE 帳號改綁到新帳號**（清除原帳號的綁定），已改寫。
  - UC-01：原活動圖把「憑證、帳號狀態與角色」合成一個判斷並一律累計失敗次數；程式實際順序為鎖定期間 → Email 與密碼（只有這一步累計失敗）→ 帳號停用 → 角色相符，已拆開。
- **新增 FR-23 問題回報與處理**：`feedback` 路由與前端 `IssueReportLauncher`（學生、教師）及 `AdminFeedback` 已存在，但原需求表完全沒有對應。依限制不新增使用個案，暫對應 UC-06（提交）與 UC-09（處理），見第 6 節建議。
- **非功能性需求表**：NFR-01～NFR-12 的編號與類別不變（第 10 章引用 NFR-01、04、05、12），新增「類別」與「相關使用個案」欄，並把 NFR-08 改為可驗證的上限值；問答回應時間與同時使用人數的量化目標查無依據，標「待確認」。NFR-12 改寫為「正式環境以 HTTPS 提供服務＋外部服務須實際環境驗收」，與第 10 章 TC-TLS-01 對 NFR-12 的用法一致。
- **新增表5-1-3 使用個案與需求追溯表**（UC → FR → NFR → 活動圖）。

### 5-2 使用個案圖

- 使用個案圖 `圖5-2-1-系統使用個案圖-v1-0` 與現況相符，**未重繪**。
- 表5-2-1 補上問題回報、系統服務狀態等職責。
- **新增表5-2-2 使用個案清單**（編號、名稱、主要行為者、目的），使 9 個使用個案一覽可查。9 個使用個案的編號與名稱未更動。

### 5-3 使用個案描述

- 每個使用個案改為三張表：**基本資料**（行為者、目的、前置條件、完成條件〔含成功與失敗〕、追溯需求）、**主要流程**（步驟／行為者動作／系統回應）、**例外流程**（編號／發生步驟／條件／系統處理）；UC-06 另有「替代流程（忘記密碼）」。
- 例外流程依程式錯誤碼補齊，例如：`INVALID_ENCODING`、`QA_QUOTA_EXCEEDED`、`VIDEO_PROCESSING_RETRY_SOURCE_UNAVAILABLE`、`FAQ_INVALIDATION_FAILED`、`SHORT_ASSET_REVIEW_STALE`／`CONFLICT`、`PASSWORD_RESET_UNAVAILABLE`、`YOUTUBE_UPLOAD_RETRY_UNSAFE`。
- 每張活動圖後補一段「判讀」文字（描述系統行為，不寫製圖取捨）。
- 保留原稿 UC-04「`/uploads` 靜態網址屬直接連結存取」的描述（`app.js` 仍以 `express.static` 提供，已再查證）。

### 5-4 分析類別圖

- 表5-4-1 營運實體新增 Feedback，控制類別新增「問題回報處理」。
- 分析類別圖重繪為 `v3-0`，依 `backend/src/models` 查證：
  - **Course－Video 改為 1..* 對 0..***：影片可掛載到多門課程（`Course.videoIds`、attach／detach），原圖 1 對 0..* 不正確。
  - **新增 User－Question（提問者）、User－Feedback（回報者）、ShortScript－Question（來源提問，0..* 對 1..*）**。
  - VideoBatch－Video 改為 0..1 對 0..*（YouTube 連結建立的影片不屬於批次）。
  - 重新排版，消除原圖「所屬課程」「凍結來源」等標籤與線段重疊；目前仍有兩處垂直交叉（User－Question × Conversation－Course、ShortScript－Course × Question－VideoSegment），標籤均不重疊。
- 新增表5-4-2 主要關聯與多重性說明，取代原本的條列判讀。

## 3. 圖表清單

### 缺圖與不符盤點（修訂前）

| 圖號 | 修訂前檔案 | 判定 | 原因 |
| --- | --- | --- | --- |
| 圖5-2-1 | `v1-0`（draw.io） | 保留 | 與現況相符 |
| 圖5-3-1 | `v2-1` | 需重繪 | 登入判斷順序與失敗計數與程式不符 |
| 圖5-3-2 | `v1-0` | 需重繪 | 未套用 2026-09-21「拒絕分支各自結束」版面決議；缺名單上限與建立學生帳號 |
| 圖5-3-3 | `v2-0` | 需重繪 | 含「Pipeline batch 已啟用？」部署旗標等設計層細節；缺批次上限、完成通知 |
| 圖5-3-4 | `v2-0` | 需重繪 | 缺觀看 80% 進度、字數／每日次數／配額與回答失敗可重試分支 |
| 圖5-3-5 | `v2-0` | 需重繪 | 缺綁定碼時效、最多 4 門、提問上限；改綁行為與程式不符 |
| 圖5-3-6 | `v2-0` | 需重繪 | 使用個案圖已有「忘記密碼重設」延伸，活動圖未畫；缺問題回報 |
| 圖5-3-7 | `v2-0` | 保留 | 與 `listStudentShorts` 篩選條件相符 |
| 圖5-3-8 | `v2-0` | 小幅修正 | 缺版本衝突拒絕、核准後待 YouTube 上傳完成才上架、退回轉私人 |
| 圖5-3-9 | `v2-0` | 需重繪 | 缺問題回報處理、系統服務狀態；公告對象不正確 |
| 圖5-4-1 | `v2-0` | 需重繪 | Course－Video 多重性錯誤；缺 User－Question、Feedback；標籤重疊 |
| — | 缺圖 | 無 | 5-1～5-4 官方指定圖皆已具備；分析物件圖屬延伸項目，本次未製作 |

### 新增或重繪的圖

| 圖號 | 原始檔（`diagrams/chapter05/`） | 輸出（`images/`） | 版本 |
| --- | --- | --- | --- |
| 圖5-3-1 註冊與登入活動圖 | `圖5-3-1-註冊與登入活動圖-v3-0.puml` | `圖5-3-1-註冊與登入活動圖-v3-0.png` | v2-1 → v3-0 |
| 圖5-3-2 課程與修課名單管理活動圖 | `圖5-3-2-課程與修課名單管理活動圖-v2-0.puml` | `圖5-3-2-課程與修課名單管理活動圖-v2-0.png` | v1-0 → v2-0 |
| 圖5-3-3 影片加入與處理追蹤活動圖 | `圖5-3-3-影片加入與處理追蹤活動圖-v3-0.puml` | `圖5-3-3-影片加入與處理追蹤活動圖-v3-0.png` | v2-0 → v3-0 |
| 圖5-3-4 學生網頁觀看與提問活動圖 | `圖5-3-4-學生網頁觀看與提問活動圖-v3-0.puml` | `圖5-3-4-學生網頁觀看與提問活動圖-v3-0.png` | v2-0 → v3-0 |
| 圖5-3-5 LINE綁定與課程問答活動圖 | `圖5-3-5-LINE綁定與課程問答活動圖-v3-0.puml` | `圖5-3-5-LINE綁定與課程問答活動圖-v3-0.png` | v2-0 → v3-0 |
| 圖5-3-6 個人資料與通知活動圖 | `圖5-3-6-個人資料與通知活動圖-v3-0.puml` | `圖5-3-6-個人資料與通知活動圖-v3-0.png` | v2-0 → v3-0 |
| 圖5-3-8 短影音腳本與成品審核活動圖 | `圖5-3-8-短影音腳本與成品審核活動圖-v2-1.puml` | `圖5-3-8-短影音腳本與成品審核活動圖-v2-1.png` | v2-0 → v2-1 |
| 圖5-3-9 管理員維運活動圖 | `圖5-3-9-管理員維運活動圖-v3-0.puml` | `圖5-3-9-管理員維運活動圖-v3-0.png` | v2-0 → v3-0 |
| 圖5-4-1 系統分析類別圖 | `圖5-4-1-系統分析類別圖-v3-0.js` | `圖5-4-1-系統分析類別圖-v3-0.png`、`.svg` | v2-0 → v3-0 |

- 所有新圖源都有 `ooad-phase`／`chapter`／`realizes`／`source`／`verified`／`status: draft`／`implemented`／`ai-assisted` 檔頭。
- 被取代的 11 個舊圖檔（含一直留在根目錄的 `圖5-3-1-…-v2-0.png`）已以 `git mv` 移到 `images/archive/chapter05-before-20260924/`，未刪除。舊版 `.puml`／`.js` 原始檔依既有慣例留在 `diagrams/chapter05/`。
- 每張 PNG 產出後都以 Read 檢視：文字未截斷、未重疊。檢視後修正了三處：圖5-3-2 與圖5-3-6 初版跨泳道 `switch` 的匯流菱形脫節且線段交錯，改為「行為者泳道選擇 → 系統泳道依項目處理」兩段式；圖5-3-8「要求修改或放棄」分支標籤壓到連線，改為是否判斷；圖5-4-1 的 ShortScript－Course 線與 Course－Video 線在 Course 右側平行、多重性疊在一起，改由 Course 底邊進入。

## 4. 環境建置

| 工具 | 版本 | 取得方式／指令 |
| --- | --- | --- |
| Java（OpenJDK） | 21.0.10 | 容器已預裝 |
| Graphviz | 2.43.0 | `apt-get update && apt-get install -y graphviz` |
| PlantUML | 1.2025.4 | `curl -sSL -o plantuml.jar https://github.com/plantuml/plantuml/releases/download/v1.2025.4/plantuml-1.2025.4.jar`（放在工作暫存區，未進版控） |
| Node.js | 22.22.2 | 容器已預裝 |
| sharp（SVG→PNG） | 0.35.4 | `npm i sharp`（暫存區，以 `NODE_PATH` 載入，未加入 repo 相依） |
| word-extractor（讀 .doc） | 1.0.4 | `npm i word-extractor`（暫存區） |
| Python | 3.11.15 | 容器已預裝，只用於小型文字替換腳本 |
| poppler-utils（PDF 分頁讀取） | 24.02.0 | `apt-get install -y poppler-utils` |
| 中文字型 | Noto Sans／Serif CJK TC、AR PL UKai TW | `apt-get install -y fonts-noto-cjk fonts-arphic-ukai` |

- 渲染指令：
  - PlantUML：`LANG=C.UTF-8 java -Dsun.jnu.encoding=UTF-8 -jar plantuml.jar -charset UTF-8 -tpng -o <輸出目錄> <圖檔>.puml`（未設 UTF-8 locale 時中文檔名會回報 `No diagram found`）。
  - 分析類別圖：`NODE_PATH=<暫存區>/node_modules node 圖5-4-1-系統分析類別圖-v3-0.js`。
- 字型對應：共用樣式指定的 `Microsoft JhengHei`、SVG 產生器指定的 `DFKai-SB`／`標楷體` 在 Linux 不存在，以使用者層級 fontconfig（`~/.config/fontconfig/fonts.conf`，未進版控）分別對應到 Noto Sans CJK TC 與 AR PL UKai TW，`Times New Roman` 對應到 Liberation Serif。
- 與既有管道的差異：專案慣例的 PlantUML 走 kroki.io、類別圖在 Windows 以原字型轉檔；本次改為本機 PlantUML jar 與 Linux 替代字型，**字形外觀與同章未重繪的圖（圖5-2-1、圖5-3-7）略有差異**。若需完全一致，可在 Windows 以原管道重新匯出同一份圖源。

## 5. 未能產出的圖及原因

- 無。官方指定的 5-1～5-4 圖表均已具備。
- 分析物件圖（規範以「甚至」標示的延伸項目）本次未製作，也未列為缺圖。
- 圖5-2-1 不需重繪，因此未安裝 draw.io Desktop（容器中沒有，也未嘗試以其他方式產生）。

## 6. 待人工確認事項

1. **問題回報的使用個案歸屬**：FR-23 暫對應 UC-06（提交）與 UC-09（處理），並寫入 UC-06／UC-09 的流程與活動圖。建議評估新增獨立使用個案（例如「UC-10 回報系統問題」，行為者 Student、Teacher，並由 Admin 處理）；若採用，需同步第 5 章使用個案圖、第 6 章循序圖與第 10 章測試追溯。
2. **儀表板檢視**：學生與教師儀表板（`/stats/student`、`/stats/teacher`）目前只由 FR-19 描述，對應 UC-09，沒有學生或教師的使用個案承接。是否需要把「查看學習儀表板」併入 UC-04／UC-02，或另立使用個案，待確認。
3. **NFR-08 量化目標**：問答回應時間、同時使用人數等效能目標查無依據，已標「待確認」，需團隊決定數值與量測方式。
4. **名單匯入以學號為初始密碼**：FR-06 如實描述程式行為；手冊 README 已列為安全與產品決策待確認事項。
5. **`/uploads` 直接連結存取**：UC-04 保留原稿描述，與 NFR-01「非公開資源須驗證身分」有落差；README 已列為待修正事項。
6. **管理員 API 回傳 `lineUserId`**：`admin.service.js` 的 `listUsers`／`updateUser` 回應包含 `lineUserId`，與 `.claude/rules/security.md`「回應中不得出現 `lineUserId`」不一致。第 5 章 NFR-03 寫成「不得對無權限者公開」；是否把管理員視為有權限者，或應修正 API，待確認（未改程式）。
7. **CLAUDE.md 與程式不一致（未改，屬共用檔）**：
   - CLAUDE.md 寫「LINE 切換課程的選項 = 自己 enrollment ∪ 所有 published 課程」，程式 `handleSwitchCourse` 實際為「有效修課 ∩ 已發布 ∩ 已有影片」，最多 4 門。
   - CLAUDE.md 寫「`lineConversationHistory` 最近 6 筆訊息」，程式以 `MAX_CONVERSATION_TURNS`（預設 4 輪，即 8 則）截斷；正式 VM 的設定值未查證。第 5 章只寫「帶入近期對話脈絡」，不寫死數字。
8. **共用檔需同步（依限制未改）**：
   - `圖表目錄.md`：圖5-3-1、5-3-3～5-3-6、5-3-9、5-4-1 改為 `v3-0`，圖5-3-2 改為 `v2-0`，圖5-3-8 改為 `v2-1`，並新增表5-1-3、表5-2-2、表5-4-2。
   - `圖片盤點與改版待辦.md`：同上版本資訊。
   - `README.md`：第 5 章狀態與 AI 使用紀錄（下節）。
9. **第 6 章一致性**：第 6 章循序圖應回頭核對本次修正的三個行為——登入判斷順序、LINE 改綁行為、公告對象為啟用中的學生。本次未改第 6 章。
10. **正式環境與 shared Atlas**：本次只查證 repository 程式碼，沒有連線正式 VM、shared Atlas 或任何外部服務；章節中的預設值（鎖定門檻、提問上限等）是程式預設值，正式環境的實際設定值未驗證。
11. **VPP／VPD 交付格式**：官方要求交付 Visual Paradigm 檔，本次圖源仍為 PlantUML 與 SVG 產生器（沿用既有 open issue）。

## 7. AI 使用紀錄

| 項目 | 內容 |
| --- | --- |
| 工具 | Claude Code |
| 使用範圍 | 閱讀規範、初評第 5 章與參考手冊第 5 章；查證後端、前端程式碼；改寫 `05_需求模型.md`（5-1～5-4 全節）；撰寫 8 張活動圖 PlantUML 母稿與分析類別圖產生器並渲染 PNG；以影像檢視確認版面；撰寫本變更說明 |
| 未由 AI 決定的事項 | 使用個案的新增、合併或改名（只列為建議）；效能量化目標；安全相關產品決策 |
| 建議的第 14 章 AI 使用表紀錄 | 「使用 Claude Code 依程式碼查證並改寫第 5 章需求表、使用個案描述，重繪圖5-3-1～圖5-3-6、圖5-3-8、圖5-3-9 與圖5-4-1」；頁碼待排版後填寫 |

## 8. 驗證

- `git diff --check`：無空白錯誤。
- 章節內 11 個圖片相對路徑逐一確認檔案存在。
- 本次只改文件與圖，未改程式，因此未執行 backend／frontend 測試。
