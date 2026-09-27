# FocusFlow 研究架構圖：來源與製作紀錄

狀態：**v1.0 圖稿初稿，待研究團隊人工審閱**。建立日期：2026-09-27。

## 建議檢視與使用

- [可編輯 SVG](../../results/v1-0/focusflow-research-framework-v1-0.svg)：文字、箭頭及圖形皆為獨立向量元素。
- [PNG 預覽](../../results/v1-0/focusflow-research-framework-v1-0.png)／[向量 PDF](../../results/v1-0/focusflow-research-framework-v1-0.pdf)：由相同 SVG 匯出。
- [瀏覽器檢視版](../../results/v1-0/focusflow-research-framework-v1-0.html)：自包含 HTML，無外部圖片、字型下載或網路請求。
- [繪圖原始碼](../../source/v1-0/build-research-framework-v1-0.mjs)：Node.js 標準函式庫，座標、文字、連線及配色均明確定義。
- [來源與雜湊清單](focusflow-research-framework-v1-0.manifest.json)：記錄 Git commit、來源檔 SHA-256、圖稿與繪圖程式 SHA-256。

這份圖不自動替換系統手冊或論文內的任何既有圖。v1.0 是可追溯重繪版本；聊天中的生成式圖片只是前期版面探索，未嵌入、描摹為底圖或充當本圖的研究證據。

## 圖說建議

> 圖 X　FocusFlow 整體研究架構。資料來源：本研究依 FocusFlow 系統程式碼與功能規格整理繪製。圖中片段內容、時間、向量與介面為示意；短影音影片產製由教師於系統外完成。

「本研究整理繪製」仍須由研究團隊審閱並承擔內容責任；AI 協助繪圖程式撰寫的事實另如實揭露，不能改寫成完全由人手繪。

## 三種不同的來源

1. **內容依據**：下表 R01–R07 對應目前 repository 中的程式碼與規格。這能支持系統設計描述，不能代替 live 執行、可用率或學習成效證據。
2. **視覺素材**：所有播放器、資料卡、波形、向量示意、資料庫及箭頭均由本資料夾繪圖程式以 SVG 幾何元素構成。沒有下載第三方圖示、照片、logo 或使用生成圖片。示意波形與色塊不代表測量值；介面不是實際產品截圖。
3. **版式參考**：使用者提供的 `1668497.jpg`，採用其「編號 Step、分區框與中間產物」的表達方向。原作者、論文名稱、圖號、DOI 與授權資訊尚未提供，故未建立猜測的文獻引用。未複製該圖的照片、決策樹、公式或標題。若後續要在論文直接重製／改繪該原圖，需另查明來源與使用條件。

## Step 與程式碼對照

路徑相對於 repository 根目錄；函式名稱比易漂移的行號更適合長期追溯。各來源實際檔案雜湊由 manifest 固定。

| 編號 | 圖中主張 | 主要來源／定位 | 表達界線 |
|---|---|---|---|
| R01 | 音訊擷取、時間逐字稿、術語正規化 | [main.py](../../../../../STT_Whisper/src/main.py)；[transcribe.py](../../../../../STT_Whisper/src/transcribe.py) `transcribe_videos`；[normalize_transcript.py](../../../../../STT_Whisper/src/normalize_transcript.py) `normalize_transcripts` | 不宣稱真實音訊辨識率；字典正規化不保證所有錯字均被修正 |
| R02 | 依長度、段數、時間整併相鄰逐字稿 | [chunking.py](../../../../../STT_Whisper/src/chunking.py) `build_chunks_for_transcript`；[chunk_strategy.py](../../../../../STT_Whisper/src/chunk_strategy.py) | 規則式分段；重疊可設定，未畫成固定啟用；時間為示意 |
| R03 | 片段向量與原始文字／時間資訊供檢索 | [embedding.py](../../../../../STT_Whisper/src/embedding.py) `embed_chunks`；[embedding_contract.py](../../../../../STT_Whisper/src/embedding_contract.py)；[mongodb_uploader.py](../../../../../STT_Whisper/src/mongodb_uploader.py)；[queryEmbedding.service.js](../../../../../backend/src/services/queryEmbedding.service.js) | 未查 shared Atlas；不代表當前 active vectors／index 已驗證 |
| R04 | 追問主題補足、課程範圍檢索、組織脈絡 | [contextualQuestion.service.js](../../../../../backend/src/services/contextualQuestion.service.js) `contextualizeQuestion`；[qa.service.js](../../../../../backend/src/services/qa.service.js) `searchSegmentsWithAtlas`；[answerGeneration.service.js](../../../../../backend/src/services/answerGeneration.service.js) 的 context 排序；[leafContextSelection.service.js](../../../../../backend/src/services/leafContextSelection.service.js)；[env.js](../../../../../backend/src/config/env.js) | 主題補足為規則法；相鄰 Leaf 與 Parent–Child 為開關控制擴充，不宣稱已在正式環境啟用 |
| R05 | 回答與採用證據 ID、格式／ID 檢查 | [answerGeneration.service.js](../../../../../backend/src/services/answerGeneration.service.js) `parseStructuredAnswer` 與回答 prompt | ID 合法不等於每句回答在語意上正確；不描繪模型訓練 |
| R06 | 引用對應與影片時間跳轉 | [qa.service.js](../../../../../backend/src/services/qa.service.js) `buildUserFacingCitations`；[StudentCourses.jsx](../../../../../frontend/focus-flow/src/pages/StudentCourses.jsx) `jumpToVideo` | S1、S3 是本圖內部示例；前端實際引用欄位由後端映射；播放資訊檢查不保證遠端影片永遠可播放 |
| R07 | 從累積提問選題、證據、腳本、人工影片產製與審核 | [shortScriptTopic.service.js](../../../../../backend/src/services/shortScriptTopic.service.js) `listTopicCandidates`；[shortScript.service.js](../../../../../backend/src/services/shortScript.service.js) `generateScriptVersion`；[shortAssetPublish.service.js](../../../../../backend/src/services/shortAssetPublish.service.js)；[系統規格](../../../System_Manual/chapters/03_系統規格.md) | 非每則回答必經步驟；外部影片工具不代表自動串接；不據文件數字宣稱本輪 live 驗收 |

## 製作方法與重建

使用 Node.js 標準函式庫組合 SVG，所有幾何座標與文字固定，不依賴隨機數或生成式影像模型。HTML 直接內嵌相同 SVG。採用本機 Microsoft JhengHei 字型，未散布字型檔；其他機器可能使用 fallback，版面仍須檢查。

在 repository 根目錄執行：

```powershell
node docs/00_Deliverables/Research_Framework/source/v1-0/build-research-framework-v1-0.mjs
```

會重建本版 SVG、HTML 與 manifest。保存正式版本前，請保留整個資料夾；若要改版，先另存版本化繪圖程式及輸出名稱，避免覆蓋已引用版本。manifest 雜湊能確認檔案是否變更，不能單獨證明主張正確。

PNG／PDF 僅為瀏覽器從這份 SVG 的衍生輸出，不是新的繪圖來源。若有導出，渲染方法、環境與檢查結果另存 `validation-v1-0.json`；需在相同字型與瀏覽器環境下才能期待相同像素。SVG 原始碼是可重建的主檔。

本輪使用現有 Playwright MCP 瀏覽器匯出，未安裝套件。先以 `node docs/00_Deliverables/Research_Framework/source/v1-0/preview-server-v1-0.mjs` 啟動只供應本圖的本機伺服器，再把 [render-research-framework-v1-0.js](../../source/v1-0/render-research-framework-v1-0.js) 作為 `browser_run_code_unsafe` 的 `filename` 輸入。執行前檢查其中輸出路徑；檢查通過後會重建本版 PNG／PDF。完成後以 Ctrl+C 停止伺服器。

倉庫 diagram bootstrap 的唯讀 Check 因本機 `claude.exe` 執行權限而未完成；Python 執行亦受限，因此未宣稱執行 skill 的 Python self-check。本輪改以 Node.js 及既有瀏覽器執行 XML、可存取名稱、來源連結、文字邊界與交疊檢查。

## 設計與決策紀錄

- 以使用者提供的直式 Step 參考圖為版式方向；六個問答主步驟及一條短影音回饋支線。
- 參考 `diagram-design` 的可存取 SVG、連線及視覺檢查做法。使用者指定的白底、Step 分區版式優先於工具預設品牌樣式，未修改全域 skill／style profile。
- 流程只顯示研究方法所需資訊，FAQ 快取、登入、配額、監控及錯誤恢復未逐項展開；因此這不是完整執行路徑圖。
- 標準流程是 1 → 2 → 3 → 4 → 5 → 6；Step 7 由累積提問紀錄另行啟動，與回答呈現不畫成強制串接。
- 相鄰片段與 Parent–Child 以附註呈現，不畫成主流程必經節點。
- 短影音教師產製區用虛線框標出系統外責任。
- 自繪圖形及範例資料不冒充真實介面或實驗圖；來源代號置於每個 Step 標題，詳細對照保留於此文件。

## AI 輔助產出揭露草稿

> 本圖內容依本研究系統程式碼與規格整理。製作過程使用 Codex 協助盤點來源、撰寫與修訂 SVG 繪圖程式，並進行版面檢查；前期曾以生成式影像工具探索版面，該探索圖未納入本版圖稿素材。本版以固定座標、文字及向量圖元產生，繪圖原始碼、來源對照與版本雜湊均保留。研究團隊仍須確認流程與論文敘述一致。

此段是供團隊採用的揭露草稿，尚未寫入系統手冊 AI 使用紀錄或論文正文。未確認影像工具的精確模型版本，故不記為「GPT Image 2.5」。

## 本輪驗證界線

僅產生與檢查本機圖稿；未執行服務測試、啟服、外部模型呼叫、Atlas 查詢／寫入、VM 部署或 Git commit／push。圖稿通過排版檢查亦不等同論文正式接受。
