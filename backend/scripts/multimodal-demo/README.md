# 多模態本機展示

這個 CLI 使用本機影片實際切出聲音與畫面，再用 Mock 三路候選執行 RRF 排名融合。範例 chunk 的文字與秒數是示意，與原片教學內容無對應保證。向量為標示清楚的 Mock，實際語意搜尋效果待 Gemini 與 Atlas 整合後驗證。

## 啟動

需要 Node 22.23.4 或 repo 支援版本、Python 3.10 以上、STT 虛擬環境及 FFmpeg。Windows 從 repo 根目錄執行，後續指令都使用這個終端機。

```powershell
. .\.local-tools\activate.ps1
cd backend
npm.cmd run demo:multimodal
```

其他機器依根 README 安裝支援版本的 Node。可攜式 `.local-tools` 是本機工具，未納入 Git。預設原片為 `backend/uploads/1785570957608-aiA10_1140119_1.mp4`，Python 使用 `STT_Whisper/.venv`。可透過 `--video`、`--python` 指定路徑，路徑有空白時加雙引號。替換原片時，範例秒數必須落在影片時長內。

```powershell
npm.cmd run demo:multimodal -- --case rescue
npm.cmd run demo:multimodal -- --case rescue --mode text_weighted
npm.cmd run demo:multimodal -- --case rescue --fail audio
npm.cmd run demo:multimodal -- --case rescue --missing visual
npm.cmd run demo:multimodal -- --case empty
```

`normal` 示範三路共同找到人工智慧片段，`rescue` 示範文字候選漏掉全聯廣告範例，媒體 Mock 候選把它補回。這些候選由程式中的情境指定，聲音向量辨別同音字的能力仍待實測。

## 看懂結果

1. 開頭列出實際切片與 Mock 步驟。三個範例 chunk 原始時間為 10–12、22–32、40–50 秒，第一段補成 7–15 秒取樣，引用仍為 10–12 秒。
2. 音訊輸出單聲道 16 kHz WAV，畫面輸出無聲、480 高、每秒一格 MP4。表格列出處理狀態、檔案大小與是否沿用檢查點。
3. 三路表格顯示候選名次。融合表格由真正的 RRF 函式計算，列出來源、各路名次與原始秒數。
4. 預設結果在 repo 根目錄 `.local-tools/multimodal-demo/`，`media/manifest.json` 包含可直接開啟的切片完整路徑、取樣時間、雜湊及 Mock 向量。
5. `result-<case>-<mode>.json` 保存排名及貢獻。等權模式下，`rescue` 的第一名範例在 audio、visual 都是第 1 名，分數應為 `1/61 + 1/61`。融合保留全部候選，尚未套用 RAG 上下文截斷。

相同輸入的排名可重現。第二次執行沿用成功切片，`reused` 變為 true。原片內容或 chunk 改變會產生不同檢查點，切片被改動也會重做。同時寫入同一 output 的第二個媒體程序會被鎖擋下，請等待第一個完成；若程序被強制終止，先確認沒有執行中的切片程序，再移除該目錄的 `.prepare.lock` 後重試。

## 資料與轉接介面

候選沿用 `courseId`、`videoId`、`chunkId`、`startSec`、`endSec`、`text`，結果增加 `fusionScore`、`retrievedBy`、`channelRanks`、`channelScores`、`contributions`。通道使用 `success`、`missing`、`failed` 診斷，空結果以空陣列表示。

Python 接受 camelCase 或原 pipeline 的 snake_case chunk，保留原值並輸出 camelCase 對應。媒體紀錄另存 `sampleStartSec`、`sampleEndSec`、`provider`、`model`、`dimension`、`contractVersion`、`status`、`skipReason`、`error`。過長片段為 skipped，未產向量為 null，失敗附錯誤類型。Mock 契約使用 `mock_*_v1`，真實模型目標契約另存 `targetContractVersion`。

`embed_with_adapter` 接受一個切片與模態，驗證單一 3072 維有限數值向量並正規化，暫時性錯誤最多三次退避重試。CLI 僅提供 Mock adapter，執行前顯示費用 US$0，要求費用上限參數；真實模型呼叫、價格估算與累計費用管理需後續授權接入。`retrieveMultimodal` 可注入三個搜尋函式，各路先過濾課程／影片權限，再取 20 名與融合。

## 驗證與排錯

```powershell
# backend 目錄
node --test tests/rank-fusion.service.test.js tests/multimodal-retrieval.service.test.js
# repo 根目錄
STT_Whisper\.venv\Scripts\python.exe -m unittest discover -s STT_Whisper/tests -p test_segment_media_embedding.py -v
```

原片不存在時用 `--video` 指定本機素材。Python 或 FFmpeg 缺少時依 STT README 補齊套件。切片失敗會回傳非零狀態，可查 `media/manifest.json` 的 failed 紀錄；修復素材後重跑即可。`--no-media` 可只檢查 Mock 排名，該次輸出會標示略過切片。此命令獨立執行，所有輸出寫入本機，不啟動後端，也不連線 MongoDB 或模型服務。
