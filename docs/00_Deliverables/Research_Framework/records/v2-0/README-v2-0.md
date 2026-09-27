# 第二版：第三章內文使用的核心流程說明圖

2026-09-27｜v2.0｜待團隊審閱。**本版供第三章圖文編排使用，尚未替換手冊正文或 DOCX。**

## 建議先看

1. [第三章 A4 圖文排版預覽 PDF](../../results/v2-0/chapter03-placement-v2-0.pdf)：檢視圖與正文、圖說的實際比例。
2. [第二版圖片 PNG](../../results/v2-0/focusflow-research-framework-v2-0.png)：可插入 Word，3300 × 3348 px。
3. [可編輯 SVG](../../results/v2-0/focusflow-research-framework-v2-0.svg)／[單圖向量 PDF](../../results/v2-0/focusflow-research-framework-v2-0.pdf)。
4. [插入段落與圖說建議](chapter03-insertion-v2-0.md)。

第一版完整保留於 `../v1-0/`。`v1-preservation.json` 記錄第一版正式圖稿的 SHA-256，驗證程式會確認其內容未變。

## 為什麼重新設計

第一版是七個看板式步驟，英文副標、版本標記、來源編號及限制文字佔去圖面，素材比例偏小。第二版根據兩張參考圖採用「分區＋中間產物＋關聯箭頭」的組合，重新畫為四個區塊；不是僅重新配色。

| 第二版 | 對應第一版 | 視覺內容 |
|---|---|---|
| Step 1 教學影片知識化 | Step 1–2 | 自繪授課畫面、波形、時間逐字稿與片段條帶 |
| Step 2 語意索引 | Step 3 | 向量矩陣示意、embedding、影片知識庫 |
| Step 3 課程問答與影片回溯 | Step 4–6 | 學生與問題、課程範圍、候選證據、既有 LLM、回答來源、影片回溯 |
| Step 4 提問回饋與短影音教材 | Step 7 | 問題群組、證據包、八拍分鏡、教師外部製作、成品審核、複習短影音 |

全圖只有必要的中文標籤與模型名稱，來源編號、版本日期、長篇限制及重複英文標題移到本文件。圖名、資料來源、圖號放於正文圖說，不放在圖片內。

## 第三章定位與排版

- 目前 `03_系統規格.md` 的圖3-1-1 是技術架構圖，包含前端、後端與外部服務。第二版補充「資料如何變成學習資源」，不宣稱能取代既有圖的全部功能。
- 建議作為 **圖3-1-2　FocusFlow 教學影片知識化與學習回饋流程**，放於 3-1 系統架構末段、3-2 之前。圖號尚待編排確認。
- 圖片寬 **16 cm**，高約 **16.23 cm**，適合 A4 頁面左右各 2.5 cm 邊界；主要標籤最小約 **9.07 pt**，Step 標題較大。
- 隨附 A4 預覽是獨立排版樣張，使用建議段落、圖與圖說；未更動現有 Markdown、Word 檔、圖目錄或正式圖號。
- 若縮至 14 cm 以下，最小標籤會小於 8 pt，應改版或拆圖，勿以提高 PNG 解析度取代字級調整。

## 內容來源

沿用第一版 [R01–R07 的來源對照](../v1-0/README-v1-0.md)，本次重新讀取第三章正文、圖目錄並檢查 QA 與功能開關定位。19 個來源檔案的當前雜湊與 Git commit 保存於 [manifest](focusflow-research-framework-v2-0.manifest.json)。

| 本版 Step | 來源群組 | 主要程式與語意 |
|---|---|---|
| 1 | R01、R02 | `transcribe.py`、`normalize_transcript.py`、`chunking.py`；保留時間資訊，依規則整併逐字稿 |
| 2 | R03 | `embedding.py`、`embedding_contract.py`、`mongodb_uploader.py`、`queryEmbedding.service.js`；教材及 query 使用相容向量契約 |
| 3 | R04、R05、R06 | `contextualQuestion.service.js`、`qa.service.js`、`answerGeneration.service.js`、`StudentCourses.jsx`；課程範圍、證據、回答與時間跳轉 |
| 4 | R07 | `shortScriptTopic.service.js`、`shortScript.service.js`、`shortAssetPublish.service.js` 與第三章短影音敘述；紀錄選題、證據快照、腳本、人工製作與審核 |

重要界線：

- 本圖描述非 FAQ 快取命中的問答主流程；快取、權限實作細節、額度、重試與維運等由第三章正文及其他設計圖解釋。
- 規則式分段依目前程式碼表達。第三章個別段落仍寫「依語意完整性切分」及將切分統稱 AI 工作，待正文另行對齊；本次不依該措辭畫成 LLM 自動分段。
- 相鄰片段補全與 Parent–Child 功能受開關控制，第二版不再占用主圖空間；不因此宣稱已啟用。
- 「無依據」分支是結果語意的摘要，沒有宣稱系統另有已驗證的答案正確性分類器；證據 ID 合法不保證語意正確。
- S1、S3 及 00:20 為同一示意故事的關聯標記；實際產品的 citation 欄位仍由後端映射。未使用實際學生資料。
- 八格分鏡對應第三章的八拍腳本設計；格內線條為示意。教師影片產製明確框出系統外責任，未畫成 FocusFlow 自動呼叫 ComfyUI。
- 未查正式環境啟用狀態、Atlas 資料或學習成效。設計圖不是驗收結果。

## 兩張參考圖與素材紀錄

- `1668497.jpg`：參考 Step 分區、具體中間產物及模型前後的資料變化。
- `1668506.jpg`：參考非等寬分區、人物／資料圖形及跨區資料流。
- 原圖作者、論文與授權資訊仍未知；不猜測書目，不將原圖嵌入本圖。兩張原圖的雜湊保留在 manifest；未複製其中的照片、公式、模型或主張。
- 影片畫面、人物、波形、逐字稿、矩陣、知識庫、LLM 示意、分鏡及播放器均由本版程式以 SVG 元素繪製；沒有下載圖庫或使用 image generation。示意波形不是實測，向量矩陣不是降維實驗圖，影片框不是產品截圖。

## 製作與重建

[繪圖原始碼](../../source/v2-0/build-research-framework-v2-0.mjs) 使用 Node.js 標準函式庫。文字、座標、配色與連線固定，SVG 為主要可編輯來源。字型使用本機 Microsoft JhengHei，未嵌入或散布字型檔。

```powershell
node docs/00_Deliverables/Research_Framework/source/v2-0/build-research-framework-v2-0.mjs
node docs/00_Deliverables/Research_Framework/source/v2-0/preview-server-v2-0.mjs
```

瀏覽 `http://localhost:8795/` 查看圖、`http://localhost:8795/chapter` 查看 A4 樣張。PNG／PDF 由 [render-research-framework-v2-0.js](../../source/v2-0/render-research-framework-v2-0.js) 配合既有 Playwright MCP 的 `browser_run_code_unsafe(filename=...)` 匯出；搬移資料夾後需更新其 `outputDir`。匯出要求 localhost 的瀏覽器縮放為 100%，否則明確停止，以免截圖產生偏移或留白。完成後 Ctrl+C 停止本機預覽。

執行 [verify-research-framework-v2-0.mjs](../../source/v2-0/verify-research-framework-v2-0.mjs) 核對來源、第一版保存、重建一致性及輸出檔案。結果見 [validation-v2-0.json](validation-v2-0.json)。渲染與目視檢查不等於團隊接受。

AI 輔助揭露：Codex 協助解讀程式碼、整理流程、撰寫與修訂向量繪圖原始碼、進行排版檢查。第二版未呼叫生成式影像工具，未沿用先前生成圖的像素；前期生成圖探索紀錄仍留於聊天及第一版說明。正式採用前由團隊審閱。沒有更動系統手冊的既有 AI 使用紀錄。
