# 系統手冊第 9 章（程式）改版說明

- 日期：2026-09-24
- 分支：`doc/ch09`（基準 `dev` commit `5230d7a`）
- 範圍：只改 `docs/00_Deliverables/System_Manual/chapters/09_程式.md` 與第 9 章的圖（`diagrams/chapter09/`、`images/` 內圖9-1-1）。未改 README、圖表目錄、圖片盤點與改版待辦、其他章節或任何程式碼。

## 1. 改了什麼、為什麼

依《115 年系統手冊規範》第 9 章只要求「9-1 元件清單及其規格描述」與「9-2 其他附屬之各種元件」（2026-09-24 以 `word-extractor` 直接解出 `115年_系統手冊規範.doc` 原文核對）。本次依規範、初評最終版的用語，以及 114414 組手冊的呈現方式重新整理全章，不是逐字修補舊稿：

| 區塊 | 新版內容 | 原因 |
| --- | --- | --- |
| 9-1-1 | 新增表9-1-1 元件統計與清單索引、表9-1-2 編號代碼；編號改為 `B-SV-33` 形式；圖9-1-1 重繪為 v3-0 | 評審可先看全貌再進清單；字母代碼不用回查就能辨識服務與分層 |
| 9-1-2～9-1-4 | Backend 6 張、Frontend 3 張、Pipeline 1 張清單，每列加「使用個案」欄（UC-01～UC-09，不更動編號） | 規範要求元件清單；使用者要求元件與第 5 章使用個案對應 |
| 9-1-5 | 表9-1-13 對照表，加上 14 張「項目／說明」直式規格卡（位置、輸入、輸出、責任、錯誤處理、驗證方式），每個使用個案至少一張 | 使用者指定的六個欄位；直式兩欄在 A4 Word 比舊稿的五欄寬表好讀 |
| 9-1-6 | 6 段短程式片段，改用 114414 組的「表＋功能／用途」框格式；新增 Pipeline 片段 `notify_backend()` 與授權片段 `canAccessCourse()` | 舊稿沒有 Python 片段；授權規則是全系統最核心的判斷 |
| 9-2-1 | 技術性保護元件改為表格（保護項目、實作元件、機制、錯誤碼） | 可追溯到元件編號與錯誤碼 |
| 9-2-2 | 維運工具表更正指令名，並補上 `database/tools/` 表 | 見第 2 節的更正清單 |
| 9-2-3 | 相依套件拆成 4 表（Backend、Frontend、Pipeline、開發工具），並註明本機執行環境版本 | 版本逐一對照 `package.json` 與 `requirements.txt`，全部一致 |
| 9-2-4 | 系統範圍界線加入「問題回報未列入使用個案」與「保留但未被引用的元件」 | 盤點時發現，需團隊決定 |

## 2. 與舊草稿的主要差異（事實更正）

舊稿中的函式名稱（`restoreAuthSession`、`startVideoProcessing`、`deriveBatchStatus`、`askQuestion`、`upload_all` 等）與套件版本都已逐一核對仍然正確。以下是與目前程式不符、已更正的地方：

| # | 舊稿敘述 | 目前程式 | 依據 |
| --- | --- | --- | --- |
| 1 | 清單缺少問題回報模組 | 已有 `feedback.routes.js`、`feedback.controller.js`、`feedback.service.js`、`feedback.model.js`、`feedbackAttachment.model.js`、`feedbackUpload.middleware.js`、`AdminFeedback.jsx`；已補入清單 | `backend/src/`、`frontend/focus-flow/src/pages/` |
| 2 | 缺少 `utils/imageSignature.js` | 以檔案簽章判斷圖片格式；已補入 B-UT-06 | `backend/src/utils/imageSignature.js` |
| 3 | `auth.service.js`、`App.jsx`、`RegisterPage.jsx`：「學生與教師自助註冊」 | 只開放學生（`SELF_REGISTER_ROLES` 只含 student，前端固定送 `role: 'student'`） | `auth.service.js:21`、`RegisterPage.jsx:25` |
| 4 | `videoUpload.js`：「逐檔送出」 | 以單一 multipart 請求送往 `/courses/:courseId/video-batches` | `services/videoUpload.js:20` |
| 5 | `IssueReportLauncher.jsx`：「導向外部表單」 | 站內回報視窗，POST `/feedback`，最多 3 張截圖，另附外部表單連結 | `IssueReportLauncher.jsx` |
| 6 | `youtube.service.js`：「提供短影片清單」 | 沒有任何模組引用；學生短影音牆由 `youtube.controller.js` 呼叫 `shortAsset.service.js` 的 `listStudentShorts()` | `controllers/youtube.controller.js:6` |
| 7 | `BubbleScene.jsx`：「首頁 3D 角色與粒子場景」 | 沒有任何檔案 import；首頁使用 `LiquidGradientBg`、`Button3D` | `App.jsx:3-4` |
| 8 | `qrcode.react`：「LINE 綁定與影片連結的 QR Code」 | LINE 綁定頁與課程頁「詢問助教」的 LINE 連結 | `StudentCourses.jsx:279` |
| 9 | 網頁問答路徑寫成 `qa.routes → qa.controller → askQuestion()` | 網頁畫面改走 `/conversations/:id/messages` → `conversation.service.sendMessage()` → `askQuestion()`；前端沒有呼叫 `/qa/ask` | `StudentCourses.jsx`、`conversation.service.js:205` |
| 10 | `upload.middleware.js`：「副檔名與大小檢查」 | 檢查 MIME 是否為 `video/*`、500 MB、批次 10 檔；超過 10 檔由 multer 回 `UPLOAD_ERROR` | `upload.middleware.js:40-44`、`error.middleware.js:40` |
| 11 | `health.routes.js`：「回報資料庫…」 | `/health` 不含資料庫狀態；資料庫狀態在 `systemStatus.service.js` | `health.routes.js` |
| 12 | `package.json` 指令 `diagnose:q04` | 實際為 `diagnose:q04:readonly`；另補 `diagnose:phase3b:readonly` | `backend/package.json` |
| 13 | 狀態機互指「圖7-4-1 至圖7-4-5」 | 第 7 章已有圖7-4-1～圖7-4-9 | `chapters/07_實作模型.md` |
| 14 | LINE 行為沿用 CLAUDE.md 描述 | 課程選單只列「有效修課且已發布」的課程（最多 4 筆）；歷史保留 `MAX_CONVERSATION_TURNS × 2`（預設 8 則），不是 6 筆 | `line.service.js:409-433`、`line.service.js:53-56` |
| 15 | 影片完成通知「依課程成員建立」 | 通知對象是掛載該影片之課程中，具有效修課且啟用的學生，每人一次 | `notification.service.js:259` 起 |
| 16 | 舊稿沒有 Python 片段、沒有使用個案對應 | 新增 `notify_backend()` 片段，並在清單與規格卡標示 UC | — |

## 3. 圖表清單

### 缺圖與需重繪的圖判定

| 圖 | 判定 | 理由 |
| --- | --- | --- |
| 圖9-1-1 程式元件閱讀路徑圖 | **需重繪**（v2-0 → v3-0） | v2-0 把 Pipeline 畫成直接寫入 models 並「回報狀態」，實際上狀態是經內部 Webhook（`X-Processing-Secret`）回到 Backend；v2-0 沒有 LINE 入口與外部服務；表號也隨新版清單改變 |
| 其他（如 UC-04 問答的檔案級呼叫路徑圖） | 不新增 | 規範第 9 章沒有指定圖；訊息順序已在圖6-1-4、依賴方向已在圖7-2-5，再畫一張會與第 6、7 章重複（違反 ntub-chapter-contract 的「6-1 = 訊息順序；9 = 檔案職責」分工）。檔案級路徑改用表9-1-21、表9-1-22 的「位置」欄說明 |

### 新增或重繪

| 圖號 | 原始檔 | 輸出 PNG | 版本 |
| --- | --- | --- | --- |
| 圖9-1-1 程式元件閱讀路徑圖 | `diagrams/chapter09/圖9-1-1-程式元件閱讀路徑圖-v3-0.puml` | `images/圖9-1-1-程式元件閱讀路徑圖-v3-0.png`（1370×1398） | v3-0 |

封存（移動，未刪除）：`images/圖9-1-1-程式元件閱讀路徑圖-v1-0.png`、`-v2-0.png` → `images/archive/chapter09-before-20260924/`。舊版 `.puml` 依其他章節慣例保留在 `diagrams/chapter09/`。

產出後以 Read 檢視 PNG：文字無截斷、無重疊，節點與箭頭和程式一致（兩個入口、`routes → controllers → services → models`、service 啟動 Pipeline、uploader 寫入 MongoDB、Pipeline 經內部 Webhook 回報）。第一次渲染時圖內註記的連接線壓到「以子程序啟動」「逐階段執行／續跑」兩個標籤，已拿掉註記（互指改寫在正文），重新渲染後確認。

## 4. 安裝的環境與指令

| 工具 | 版本 | 安裝指令 |
| --- | --- | --- |
| Java（已存在） | OpenJDK 21.0.10 | — |
| Graphviz | 2.43.0 | `apt-get install -y graphviz` |
| 中文字型 | Noto CJK（`fonts-noto-cjk`） | `apt-get install -y fonts-noto-cjk` |
| PlantUML | 1.2025.4（SHA-256 `26518e14…200c1`） | `curl -sSL -o plantuml.jar https://github.com/plantuml/plantuml/releases/download/v1.2025.4/plantuml-1.2025.4.jar`（Maven Central 當時回 429 限流，改從 GitHub Releases 下載） |
| poppler-utils | 24.02.0 | `apt-get install -y poppler-utils`（讀參考 PDF 用） |
| word-extractor（npm） | 最新版，裝在 scratchpad | `npm i word-extractor`（解出 `.doc` 規範原文；LibreOffice 在此容器無法開啟任何檔案） |

渲染指令（檔名含中文，必須設定 UTF-8 locale，否則 PlantUML 回 `No diagram found`）：

```bash
export LANG=C.UTF-8 LC_ALL=C.UTF-8
cd docs/00_Deliverables/System_Manual/diagrams/chapter09
java -Djava.awt.headless=true -Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8 \
  -jar plantuml.jar -charset UTF-8 -tpng -o <輸出目錄> "圖9-1-1-程式元件閱讀路徑圖-v3-0.puml"
```

`_style.puml` 指定的字型「Microsoft JhengHei」在 Linux 不存在，實際由 fontconfig 以 Noto Sans CJK 代替；在 Windows 重新渲染時字型會不同，版面可能略有差異。

## 5. 驗證

| 項目 | 結果 |
| --- | --- |
| 章節內所有反引號檔名與路徑 | 以 `git ls-files` 比對，全部存在 |
| 表號連續性 | 表9-1-1～表9-1-33、表9-2-1～表9-2-7 連續，所有「表9-x-x」引用都有對應表 |
| 引用的他章圖號 | 圖6-1-1～圖6-1-9、圖7-2-1～圖7-2-5、圖7-4-1～圖7-4-9 在 `images/` 都有對應檔 |
| `tools/build_manual.py` | 以複本只建第 9 章、輸出到 scratchpad：成功；表題都在表上方、圖題在圖下方，片段框後接程式碼。另把以表號開頭的正文段落改寫，避免被當成表題吞掉；表題移除反引號，避免 Word 顯示字面上的 `` ` `` |
| Backend `npm test` | 887 項：853 通過、**34 失敗**（全部在 `short-script.service.test.js`、`short-script-review.service.test.js`、`short-script.routes.test.js`，錯誤碼 `SHORT_SCRIPT_EVIDENCE_EMPTY`；單檔執行也可重現，屬 `dev` 既有狀態，本分支未改程式） |
| Frontend `npm test` | 68 項全數通過 |
| AI Pipeline `python -m unittest` | 189 項全數通過（venv 只裝輕量相依，未裝 faster-whisper、sentence-transformers） |

## 6. 未能產出的圖及原因

無。圖9-1-1 v3-0 已產出並引用。Word／PDF 的實際版面預覽未完成：LibreOffice 在此容器無法開啟任何檔案，只能以 python-docx 檢查結構，實際頁面外觀需人工在 Word 確認。

## 7. 待人工確認事項

1. **短影音腳本測試失敗**：`dev` 上 34 項測試回 `SHORT_SCRIPT_EVIDENCE_EMPTY`，第 9 章已照實寫在 9-1-5 與表9-1-26。需團隊判斷是程式回歸還是測試資料過期。
2. **問題回報的使用個案歸屬**：feedback 模組不在第 5 章 UC-01～UC-09 之內，第 8 章也沒有 `feedbacks`／`feedbackattachments` 集合。第 9 章暫標「—」，是否補入 UC-06／UC-09 及第 8 章由團隊決定。
3. **未被引用的元件**：`backend/src/services/youtube.service.js`、`frontend/focus-flow/src/components/BubbleScene.jsx` 是否移除。
4. **`sentence-transformers`**：`requirements.txt` 有宣告，但 `STT_Whisper/src/` 沒有引用，實際用途待確認。
5. **正式主機執行環境版本**：Node.js、Python 的正式 VM 版本仍待填（與第 3 章一致）；本章只寫本機驗證版本（Node.js 22.22.2、Python 3.11.15）。
6. **共用檔需同步**（本次依指示未改）：`圖表目錄.md` 仍寫「圖9-1-1 v1-0」與「表9-1-1～表9-1-4 代表性程式元件規格」；`圖片盤點與改版待辦.md` 仍列 v1-0；`README.md` 第 9 章列寫「4 組短程式片段」（現為 6 段）。
7. **CLAUDE.md 過期描述**：「LINE 切換課程時選項 = 自己 enrollment ∪ 所有 published 課程」、「lineConversationHistory 最近 6 筆」與目前 `line.service.js` 不符（見第 2 節 #14）。本次未改 CLAUDE.md。
8. **既有壞圖（第 6 章）**：`images/圖6-2-4-Web問答授權與引用設計物件圖-v3-0.png` 實際內容是 25 bytes 的文字「Error 500: Internal Server Error」，不是 PNG，會讓 `build_manual.py` 建置全冊時失敗。不在本次範圍，未處理。
9. **參考手冊**：指定的 `四技第115414組-救「舊」我的書-系統手冊.pdf` 在 repo 中只有 5 頁（第 9 章「參考資料」，p.63～67），沒有「程式」章，因此只能參考 114414 組。若有完整版，建議再對照一次。
10. **片段與頁碼**：6 段程式片段的取捨與排版後頁碼，需人工確認。

## 8. AI 使用紀錄

| 工具 | 範圍 |
| --- | --- |
| Claude Code（Anthropic Claude） | 閱讀規範 `.doc`（經 word-extractor 解出文字）、初評最終版 PDF 第 1～8 章、114414 組手冊第 9 章（p.58～62）與 115414 組 PDF；逐檔核對 `backend/src`、`frontend/focus-flow/src`、`STT_Whisper/src`、`database/tools` 與測試檔；改寫 `chapters/09_程式.md`；撰寫圖9-1-1 v3-0 PlantUML 並渲染、檢視 PNG；執行三個服務的測試；撰寫本說明 |

參考手冊只參考章節結構、深度與呈現方式（編號／檔名／功能清單、套件版本表、「部分程式碼」框格式），沒有複製其內容。AI 產出的內容仍需組員逐段確認，尤其是第 7 節所列項目；若要列入手冊第 14 章 AI 使用表，序號與頁碼由團隊排版後填寫。

---

## 9. 第二輪修訂（2026-09-25）

依據：`origin/doc/reference-gap` 的 `docs/reports/reference-gap-ch05-09.md`（第 7 節不符項、第 9 節補強清單），只處理與第 9 章有關的項目；對照來源為 `origin/doc/ch05`（`164af11`）、`origin/doc/ch06`（`9c2675f`）、`origin/doc/ch07`（`9d5746d`）、`origin/doc/ch08`（`ab6c4a3`）與 `dev` 程式碼。只改 `chapters/09_程式.md` 與本說明，沒有改其他章、共用檔、圖或程式碼。

### 9.1 改了什麼與原因

| 報告項目 | 位置 | 修改 | 依據 |
| --- | --- | --- | --- |
| C2 | B-RT-14、B-CT-10、B-SV-28、表9-1-24（輸入、輸出、責任三列） | 「全站公告」改為「系統公告」，並寫明只發給所有啟用中的學生，教師與管理員不會收到 | `notification.service.js` 的 `broadcastSystemNotification()` 以 `role: student`、`isActive: true` 查詢收件人；doc/ch05 FR-18 也寫「對所有啟用中的學生發送系統公告」 |
| C4 | 9-2-4 問題回報段落；B-RT-15、B-CT-15、B-SV-18、B-MD-20、B-MD-21、B-MW-07、F-CP-10 的使用個案欄 | 段落改寫為對應 FR-23，送出回報屬 UC-06、管理員處理屬 UC-09，資料存於第 8 章 DB-20 `feedbacks`、DB-21 `feedbackattachments`；原「—（見 9-2-4）」改為 UC-06、UC-09（附件上傳 middleware 與前端回報視窗只屬 UC-06） | doc/ch05 表5-1-1 FR-23（UC-06、UC-09）；doc/ch08 DB-20、DB-21；另確認 `feedback.service.js` 不發通知、不自動分派 |
| C6 | 9-1-1 使用個案說明段 | 「表5-1-1」改為「表5-2-2 使用個案清單」 | doc/ch05 表5-2-2 為使用個案清單，表5-1-1 為功能性需求表 |
| C7 | 同上 | 九個使用個案名稱改為與 doc/ch05 表5-2-2 完全相同：UC-02 教師管理課程與修課名單、UC-03 教師加入影片並追蹤處理、UC-04 學生在網頁觀看與提問、UC-05 學生綁定 LINE 並提問、UC-06 使用者維護個人資料與通知、UC-07 學生查看短影音、UC-08 教師產生腳本並提交短影音成品、UC-09 管理員維運系統（UC-01 註冊與登入原本即一致） | doc/ch05 表5-2-2 |
| 第 18 項 | 表9-1-13「相關圖」欄 | 唯一的「—」（表9-1-14 認證與角色授權 middleware）改為「圖6-1-9（步驟 3～4）、圖7-2-2」；現在 14 列都有圖號 | doc/ch06 圖6-1-9 的判讀寫明步驟 3～4 為 JWT 驗證與管理員角色檢查；doc/ch07 圖7-2-2 為後端套件圖（含 middleware 分群） |

另確認 doc/ch06 的圖6-1-1～圖6-1-9、圖6-2-1～圖6-2-4，以及 doc/ch07 的圖7-2-1～圖7-2-5、圖7-3-1 編號與名稱沒有變動，第 9 章既有引用不需調整。

修改後重新檢查：章節內所有檔名與路徑都存在於 repo；表號仍為表9-1-1～表9-1-33、表9-2-1～表9-2-7 連續；沒有以表號開頭而會被 `build_manual.py` 誤判為表題的正文段落。

### 9.2 第 9 章引用的第 7 章圖號（C3 對照用，未修改）

依指示保留所有引用，沒有刪除或改號。下表是第 9 章目前引用的第 7 章圖號，以及每張圖在第 9 章中指的物件，供與第 7 章補回的圖對照：

| 圖號 | 第 9 章所指的物件 | 程式依據 | 第 9 章引用位置 | doc/ch07 現況 |
| --- | --- | --- | --- | --- |
| 圖7-2-1～圖7-2-5 | 前端、後端、AI Pipeline、資料儲存、LINE 與 QA 五張套件圖（依賴方向） | — | 章首第 2 段 | 存在 |
| 圖7-2-2 | 後端套件圖（middleware 分群） | `backend/src/middleware/` | 表9-1-13（表9-1-14 列） | 存在 |
| 圖7-4-1～圖7-4-9 | 狀態機圖整組（範圍引用） | — | 章首第 2 段 | 圖7-4-1～7-4-5 存在；7-4-6～7-4-9 在 archive |
| 圖7-4-1 | 前端登入 Session（`AuthSession`：anonymous／authenticated／invalid／unavailable／forbidden） | `frontend/focus-flow/src/authSession.js` | 表9-1-13、表9-1-16 | 存在 |
| 圖7-4-2 | 影片批次 `VideoBatch`（processing／completed／partial／failed） | `videoBatch.service.js` 的 `deriveBatchStatus()` | 表9-1-13、表9-1-18 | 存在 |
| 圖7-4-3 | 單支影片 `Video.processing`（queued／processing／completed／failed） | `videoProcessing.service.js` | 表9-1-13、表9-1-19 | 存在 |
| 圖7-4-4 | 一次提問 `Question`（answered／no_match／failed） | `qa.service.js`、`answerGeneration.service.js` | 表9-1-13、表9-1-22 | 存在 |
| 圖7-4-5 | LINE 對話範圍（`User.lineConversationState`、`activeCourseId`） | `line.service.js` | 表9-1-13、表9-1-23 | 存在 |
| 圖7-4-6 | 修課 `Enrollment`（active ↔ revoked，重新指派沿用同一筆） | `enrollment.service.js` | 表9-1-13、表9-1-17 | **archive，待第 7 章補回** |
| 圖7-4-7 | 短影音腳本 `ShortScript`（evidence_ready／generated／changes_requested／approved／dismissed） | `shortScript.service.js` 的 `ALLOWED_TRANSITIONS` | 表9-1-13、表9-1-26 | **archive，待第 7 章補回** |
| 圖7-4-8 | 短影音成品 `ShortAsset`（`status` 與 `reviewStatus`） | `shortAsset.service.js`、`constants/enums.js` | 表9-1-13（表9-1-25 列） | **archive，待第 7 章補回** |
| 圖7-4-9 | YouTube 上傳 `Video.youtubeUpload`（uploading／uploaded／failed） | `youtubeUpload.service.js` | 只在章首範圍「圖7-4-1～圖7-4-9」中 | **archive，待第 7 章補回** |

若第 7 章補回時圖號或物件與上表不同（例如 7-4-6 不是 Enrollment），第 9 章的表9-1-13、表9-1-17、表9-1-25、表9-1-26 與章首範圍需跟著調整。

### 9.3 未完成項目及原因

| 項目 | 原因 |
| --- | --- |
| C3（圖7-4-6～7-4-9 在 doc/ch07 被移入 archive） | 依指示不修；由第 7 章的另一個 session 依相同圖號補回。對照清單見 9.2 |
| 第 17 項（9-2-1 請求防護層級圖）、8.5 的可選調整（圖9-1-1 移到 9-1-1 第一段之後） | 優先度低的可選項，依指示不做 |
| 第 14 項（表7-2-1 與表9-2-4～9-2-7 版本去重） | 建議的做法是刪減第 7 章的版本表、第 9 章保留，屬第 7 章的修改；第 9 章不需改 |
| C1、C5、C8 及其他第 5～8 章項目 | 不屬於第 9 章 |

### 9.4 待人工確認事項

1. 第 7 章補回圖7-4-6～7-4-9 後，確認圖號與物件是否與 9.2 表一致。
2. C2 採用 doc/ch05 FR-18 的用詞「系統公告」；若團隊最後決定改用其他稱呼，第 9 章的 B-RT-14、B-CT-10、B-SV-28 與表9-1-24 需同步。
3. 問題回報的使用個案欄依 FR-23 標為 UC-06、UC-09；前提是 doc/ch05、doc/ch08 的 FR-23、DB-20、DB-21 會與本分支一起合併。若合併順序不同，9-2-4 會暫時引用尚不存在的需求或集合編號。
4. 表9-1-14 的相關圖指向 doc/ch06 圖6-1-9 的「步驟 3～4」，若第 6 章之後重新編步驟，需要同步。
5. 第一輪第 7 節的第 2 項（問題回報的使用個案歸屬）已由本輪依 FR-23 處理；其餘待確認項目不變。
