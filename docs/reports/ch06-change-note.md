# 系統手冊第 6 章（設計模型）修訂說明

- 分支：`doc/ch06`（自 `dev` 5230d7a 分出）
- 修訂日期：2026-09-24
- 範圍：`docs/00_Deliverables/System_Manual/chapters/06_設計模型.md`、`diagrams/chapter06/`、`images/` 內第 6 章圖檔與 `images/archive/chapter06-before-20260924/`
- 未修改：`README.md`、`圖表目錄.md`、`圖片盤點與改版待辦.md` 等共用檔與其他章節（依任務限制；需要同步的地方列在「待人工確認事項」）

## 1. 讀取的依據

| 優先序 | 來源 | 用途 |
| --- | --- | --- |
| 1 | `backend/src/routes`、`controllers`、`services`、`models`、`middleware`、`constants/enums.js`；`frontend/focus-flow/src/pages/StudentCourses.jsx`、`StudentShortsWall.jsx`、`TeacherShortScripts.jsx`；`STT_Whisper/src/main.py` | 事實依據。每張圖的訊息、錯誤碼、狀態轉換與類別方法都逐一對照程式碼 |
| 2 | `source-documents/四技第115413組-FocusFlow AI-系統手冊_初評最終版.pdf` 第 32～37 頁（PDF 第 37～42 頁） | 保留「圖前先說明用途、圖後說明判讀」的寫法、業務層參與者（使用者／前端／後端 API／資料庫）與 Mermaid 灰階畫風；初評的設計物件圖以實例值呈現的做法沿用到圖6-2-4 |
| 3 | `docs/90_Archive/external-examples/四技114參考文件/四技第114414組-動起來「揪」對了-系統手冊 .pdf` 第 34～41 頁 | 只參考結構：訊息編號、alt 分支標示、設計類別圖列出型別與方法；未複製內容 |
| 3 | `docs/90_Archive/external-examples/四技第115414組-救「舊」我的書-系統手冊.pdf` | 該 PDF 只有 5 頁（手冊第 63～67 頁，參考資料章），沒有第 6 章，無法參考其設計模型的結構；僅看到其 AI 使用表格式 |
| — | `source-documents/115年_系統手冊規範.doc`（以 word-extractor 抽文字） | 規範原文：「6-1 循序圖(Sequential diagram)或通訊圖(Communication diagram)」「6-2 設計類別圖(Design class diagram)，甚至設計物件圖(Design object diagram)」 |
| — | `AGENTS.md`、`System_Manual/README.md`、`diagrams/章5至10_製圖brief_2026-09-19.md`、`chapters/05_需求模型.md`、`.claude/skills/ooad-uml-diagramming/` | 工作規則、檔名與版本規則、第 5 章 UC-01～UC-09 |

## 2. 改了什麼與原因

### 2.1 章節文字

- 6-1 新增表6-1-1「循序圖參與者與責任」與表6-1-2「循序圖與使用個案對照」（含每張圖的主要例外分支），並說明箭頭、`alt`／`opt`／`loop` 與步驟編號的讀法。
- 9 張循序圖都改為「用途與參與者 → 圖 → 以步驟編號說明主流程與例外分支」，內文引用的步驟編號已逐一對照 `.mmd` 的自動編號。
- 6-2 將表6-2-1 改為「分析類別（表5-4-1）→ 設計類別 → 設計圖」的完整對照，並說明記法：«service» 代表以 CommonJS 模組實作的服務（不是 JS class）、方法名稱即實際函式、省略參數列保留回傳型別、實線為參照關聯、虛線為使用關係、參照完整性由應用層維護。
- 6-2-4 補上情境前提（第一個提問、兩層快取未命中）與物件名稱記法說明。
- 刪除原文中與程式不符的敘述（見 2.2）。

### 2.2 與程式碼不一致而更正的內容

| 位置 | 原內容 | 程式實際行為（依據） |
| --- | --- | --- |
| 圖6-1-1 | 「API→資料庫：查詢帳號並檢查登入鎖定狀態」 | 鎖定狀態存在後端記憶體，查帳號前先檢查，鎖定中不查帳號（`auth.service.js` login、`loginThrottle.service.js`） |
| 圖6-1-1 | 失敗分支只有「密碼錯誤或帳號鎖定中」 | 另有帳號停用 403 `USER_INACTIVE`、角色不符 403 `ROLE_MISMATCH`，且在密碼驗證通過後才檢查 |
| 圖6-1-2 | 名單匯入只寫「逐筆建立或重新啟用 Enrollment」 | 名單中尚無帳號者會以學號為初始密碼建立學生帳號；單筆指派查無學生回 404（`enrollment.service.js`） |
| 圖6-1-3 | 「API 保存片段」 | 片段由 AI Pipeline 直接寫入 `video_segments_text`，之後才呼叫 complete webhook（`STT_Whisper/src/main.py`） |
| 圖6-1-3 文字 | 「通知讓教師不必輪詢」 | 影片完成通知的對象是修課中的啟用學生，不是教師（`notification.service.js` fanoutVideoCompletedNotifications） |
| 圖6-1-3 | 未呈現 | 完成後另排程 YouTube 自動上傳（`videoProcessing.service.js` runCompletionSideEffects） |
| 圖6-1-4 與文字 | 「完全相同的提問命中快取時不檢查每日配額、不計入學生每日次數」；兩層快取之間是「當日提問配額」 | 每日次數在進入 QA 前由 conversations／`/qa/ask`／LINE 入口檢查（`askLimits.service.js` assertCanAsk），快取命中同樣計入；兩層快取之間檢查的是每月 token 配額（`costControl.service.js`） |
| 圖6-1-4 | 未區分網頁對話 | 網頁提問實際走 `POST /conversations/:id/messages`；FAQ 快取只用於沒有對話歷史的提問（`qa.service.js` faqCacheEnabled） |
| 圖6-1-5 | 「綁定成功並列出課程」 | 綁定回覆只提示先選課；課程選單由「切換課程」與 postback 觸發，最多 4 門（`line.service.js`） |
| 圖6-1-8 | 「核准腳本」之後才能上傳成品 | 後端只要求腳本至少有一個版本即可上傳，不檢查是否已核准（`shortAssetPublish.service.js` createAssetFromScript）；另補揭露確認、版本衝突 409、退回轉 private |
| 圖6-1-9 | 「操作衝突時資料庫回傳驗證錯誤」的泛稱 | 依實際 API 拆為使用者、影片刪除（先清 FAQ，失敗 503）、課程名單、公告四種；公告只發給啟用中的學生 |
| 圖6-2-1～6-2-3 | `findByExactQuestion()`、`register()`、`startProcessing()` 等方法名稱 | 更正為實際函式名稱（`findFaqByExactQuestion`、`startVideoProcessing` 等） |
| 圖6-2-2 | `Question 0..* -- 0..* FAQ`，文字稱「FAQ 命中時關聯回原始 Question」 | 程式中沒有這個關聯，已移除；快取命中時新增一筆 Question |
| 圖6-2-2 | `Message.citations` | 欄位實際名稱為 `sources` |
| 圖6-2-4 | `message02 → question01「對應提問」` | Message 與 Question 之間沒有參照欄位，已移除；改以 Enrollment 表達授權、VideoSegment 表達引用 |

## 3. 新增或重繪的圖表

13 張圖全部重繪。圖源在 `diagrams/chapter06/`（舊版 `.mmd` 以 `git mv` 改名為新版本，舊內容保留在 git 歷史），PNG 在 `images/`，被取代的 13 張舊 PNG 移到 `images/archive/chapter06-before-20260924/`，未刪除。

| 圖號 | 檔名（.mmd／.png 同名） | 舊版 → 新版 | 主要變更 |
| --- | --- | --- | --- |
| 圖6-1-1 | 圖6-1-1-註冊與登入循序圖 | v3-0 → v4-0 | 記憶體鎖定檢查、停用與角色不符分支、錯誤碼 |
| 圖6-1-2 | 圖6-1-2-課程與修課名單管理循序圖 | v3-0 → v4-0 | 權限拒絕、單筆與匯入分流、撤銷清除 LINE 範圍 |
| 圖6-1-3 | 圖6-1-3-影片加入與處理追蹤循序圖 | v3-1 → v4-0 | 批次逐檔、Pipeline 直寫片段、webhook 驗證、YouTube、重試 |
| 圖6-1-4 | 圖6-1-4-學生網頁觀看與提問循序圖 | v4-0 → v5-0 | conversations API、限額順序、月配額、AI 服務、失敗與重試 |
| 圖6-1-5 | 圖6-1-5-LINE綁定與課程問答循序圖 | v3-0 → v4-0 | 簽章 401、綁定碼無效、切換課程 postback、提問前檢查 |
| 圖6-1-6 | 圖6-1-6-個人資料與通知循序圖 | v3-0 → v4-0 | 資料／頭像／忘記密碼三路徑、SMTP、通知 404 |
| 圖6-1-7 | 圖6-1-7-學生短影音瀏覽循序圖 | v3-0 → v4-0 | 非學生 403、空列表、游標、YouTube 嵌入與背景同步 |
| 圖6-1-8 | 圖6-1-8-短影音腳本與成品審核循序圖 | v3-0 → v4-0 | 功能旗標、證據凍結、引用驗證、揭露確認、版本衝突 |
| 圖6-1-9 | 圖6-1-9-管理員維運循序圖 | v3-0 → v4-0 | 401／403、四種維運操作、FAQ 清除失敗 503 |
| 圖6-2-1 | 圖6-2-1-帳號課程與影片設計類別圖 | v3-0 → v4-0 | 新增 LoginThrottle、CourseAccessService；型別、多重性、實際方法 |
| 圖6-2-2 | 圖6-2-2-問答與對話設計類別圖 | v3-0 → v4-0 | 新增 LineService、CostControlService、AnswerGenerationService、VideoSegment、LineBindToken；移除不存在的關聯 |
| 圖6-2-3 | 圖6-2-3-個人資料通知與短影音設計類別圖（原名「通知與短影音設計類別圖」） | v3-0 → v4-0 | 更名；補 AvatarService、PasswordResetService；短影音拆三個服務 |
| 圖6-2-4 | 圖6-2-4-Web問答授權與引用設計物件圖 | v3-0 → v4-0 | 補 Enrollment、Video、VideoSegment、Faq 實例，移除不存在的連結 |

缺圖盤點：第 5 章 9 個使用個案原本都已有對應循序圖，6-2 也已有 3 張類別圖與 1 張物件圖，沒有缺圖；13 張都屬「與現況不符需重繪」。

渲染方式：每張圖產出後都以 Read 檢視 PNG，確認文字沒有截斷或重疊、生命線完整、內容與章節及程式一致；步驟編號另以腳本逐一比對內文。渲染過程中修正的問題：
- 拉丁字元原本退回襯線字型，改用 Mermaid 頂層 `fontFamily` 設定。
- 自我訊息的標籤與編號圓圈重疊，改用 `Note` 方框表示後端內部檢查。
- `mirrorActors: false` 在較長的圖上會讓生命線提早結束（Mermaid 版面缺陷），改為 `true`，底部重複列出參與者。
- mmdc 預設 800px 視窗會縮小寬圖，改用 `-w 2400` 以原生尺寸輸出。
- 類別圖改用 ELK 版面（正交走線，避免多重性標籤疊在一起）；`Message` 自我關聯與 `0..1` 標籤被方框遮住的兩處，分別以屬性表示或反轉宣告方向解決。

圖源格式依 `.claude/skills/ooad-uml-diagramming` 的慣例更新：YAML frontmatter 的 `title` 與 `config`（取代已不建議的 `%%{init}%%`），以及八欄檔頭宣告（`source` 改為實際程式檔、`verified: 2026-09-24`）。

## 4. 環境與指令

原本的 kroki.io 轉檔管線改為本機 Mermaid CLI，不經外部轉檔服務。

| 工具 | 版本 | 安裝方式 |
| --- | --- | --- |
| Node.js | v22.22.2 | 環境預裝 |
| npm | 10.9.7 | 環境預裝 |
| @mermaid-js/mermaid-cli（mmdc） | 11.17.0（內含 mermaid 11.17.2、@mermaid-js/layout-elk 0.2.3） | 安裝在 session scratchpad，未寫入 repo |
| Chromium | 141.0.7390.37 | 環境預裝於 `/opt/pw-browsers/chromium-1194`，以 puppeteer 設定檔指定，未另外下載 |
| 中文字型 | WenQuanYi Zen Hei | 環境預裝 |
| poppler-utils（pdftoppm） | 24.02.0 | `apt-get install -y poppler-utils`，用於分頁檢視 PDF |
| word-extractor、pdfjs-dist@4 | — | 安裝在 scratchpad，用於抽取 `.doc` 規範與 PDF 文字 |
| Pillow | — | `pip install pillow`，只用於裁切 PNG 以放大檢查標籤 |

```bash
# 安裝 mermaid-cli（跳過 puppeteer 自帶 Chromium 下載，改用預裝版本）
mkdir mmdc && cd mmdc && npm init -y
PUPPETEER_SKIP_DOWNLOAD=1 npm install @mermaid-js/mermaid-cli

# puppeteer.json
{"executablePath":"/opt/pw-browsers/chromium-1194/chrome-linux/chrome","args":["--no-sandbox","--disable-gpu"]}

# 轉檔（原生尺寸、2 倍解析度、白底）
npx mmdc -p puppeteer.json -i "<圖源>.mmd" -o "<圖檔>.png" -w 2400 -s 2 -b white

# artifact chain 檢查
python .claude/skills/ooad-uml-diagramming/scripts/validate_diagram_artifacts.py \
  --diagram-dir docs/00_Deliverables/System_Manual/diagrams/chapter06 \
  --image-dir docs/00_Deliverables/System_Manual/images \
  --chapter docs/00_Deliverables/System_Manual/chapters/06_設計模型.md \
  --toc docs/00_Deliverables/System_Manual/圖表目錄.md --require-version
```

artifact chain 檢查結果：圖源、PNG 與章節引用一致；14 項錯誤全部來自 `圖表目錄.md` 仍記錄舊版本與舊圖名（本任務不修改該檔，見第 6 節）。Windows 使用者若要重現，`executablePath` 改為本機 Chrome 或刪除 `-p` 讓 puppeteer 自行下載。

## 5. 未能產出的圖

無。13 張圖均已產出並檢視。

## 6. 待人工確認事項

### 6.1 共用檔需要同步（本任務依限制未修改）

- `圖表目錄.md`：第 6 章 13 列的版本改為上表新版本；圖6-2-3 名稱改為「個人資料通知與短影音設計類別圖」。
- `README.md`：第 6 章狀態列與「圖表與素材」段落仍寫 `v3-0`、2026-09-21；AI 輔助表需新增本次紀錄（見第 7 節）。
- `圖片盤點與改版待辦.md`：第 6 章列仍是更早的檔名。
- `.claude/skills/ooad-uml-diagramming/references/local/focusflow-conventions.md` 仍記載 Mermaid 以 kroki.io 轉檔、density 72，本次改為本機 mmdc；是否把新管線寫回慣例文件，請團隊決定。

### 6.2 第 5 章可能需要調整（只記錄，未修改）

- 表5-3-2／FR-06：名單匯入會替尚無帳號者以學號建立學生帳號，第 5 章未描述；README 已把「CSV 以可預測學號建立初始憑證」列為待決的安全議題。
- 表5-3-5 例外欄「LINE 已綁定其他帳號時拒絕」：程式實際做法是解除舊綁定、改綁到新帳號，不會拒絕。表5-3-5 步驟 2～3「綁定後列出課程」：實際由「切換課程」觸發。
- 表5-3-8 步驟 4～5 暗示腳本核准後才上傳成品：後端只要求腳本已有版本，不檢查是否核准；請確認這是設計意圖（前端是否另有限制）還是需要補檢查。
- FR-18「管理員可發送全站公告」：程式只發給啟用中的學生，教師與管理員收不到。
- FR-01「教師與管理員帳號僅由管理流程建立」：後端沒有建立教師帳號的 API，管理員只能以 `PATCH /admin/users/:userId` 修改既有帳號的角色（或使用 seed）。「管理流程」實際指什麼，待確認。
- 表5-3-3 未提及影片完成後的 YouTube 自動上傳與完成通知的收件對象（學生）。

### 6.3 版面與交付

- 圖幅較大：循序圖原生高度約 1,500～3,000 px，類別圖寬約 1,600～2,200 px。放進 A4 直式單頁時，文字約 3.5～5.5 pt（圖6-1-4、圖6-1-6、圖6-1-8 最小）；類別圖建議放在橫式頁面。PNG 為 2 倍解析度，PDF 放大可清楚閱讀。若評審要求紙本可讀，可考慮把 UC-04、UC-06、UC-08 各拆成兩張（須先確認是否接受「一個使用個案不只一張圖」）。
- 循序圖的參與者依任務要求採業務層抽象（使用者／前端／後端 API／資料庫／外部服務）。`ooad-uml-diagramming` skill 的互動圖指南把「只有前端、後端、資料庫」列為應避免的分層示意，本章以 6-2 設計類別圖補足服務層分工；若評審要求服務層生命線，需另行討論。
- Mermaid 物件圖無法把物件名稱加底線（UML 記法），內文已註明。
- 規範要求最終交付 VPP／VPD（Visual Paradigm），本章仍以 Mermaid 為母稿，是否可替代需向指導老師確認（既有 open issue）。

### 6.4 待確認的事實

- 圖6-1-3 步驟 23「原始檔已不存在回 409」：錯誤碼 `VIDEO_PROCESSING_RETRY_SOURCE_UNAVAILABLE` 在排程啟動本機 Pipeline 時丟出，批次模式與單支模式的實際回應路徑未以測試驗證，**待確認**。
- 本章所有行為都來自靜態閱讀程式碼，未對正式 VM、共享 Atlas、Gemini、LINE、YouTube 或 SMTP 做 live 驗證，也未執行 backend 測試（本任務未改程式）。

### 6.5 章節範圍外的觀察

- `backend/src/services/admin.service.js` 的 `updateUser` 回應包含 `lineUserId`，與 `.claude/rules/security.md`「回應中不得出現 lineUserId」不一致。未在本分支處理。

## 7. AI 使用紀錄

| 序號 | 工具 | 使用範圍及說明 | 章節／頁碼 |
| --- | --- | --- | --- |
| AI-UML-20260924 | Claude Code（Anthropic） | 閱讀規範、初評第 6 章與兩份參考手冊；對照後端 routes／services／models、前端頁面與 Pipeline 程式碼查證 9 個使用個案的實際流程；重寫第 6 章文字；以 Mermaid 重繪 9 張循序圖、3 張設計類別圖與 1 張設計物件圖並以 mermaid-cli 轉檔、逐張目視檢查；撰寫本修訂說明 | 第 6 章；頁碼待排版 |

AI 產出的圖與文字均為草稿（`status: draft`），內容正確性、第 5 章調整與共用檔同步需組員確認。
