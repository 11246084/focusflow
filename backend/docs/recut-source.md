# recut 連續視窗、音量與切句

RC2 把主題證據變成同一影片的凍結視窗與帶時間的句子，供 RC3 選段。介面從 [recutSource.service.js](../src/services/recutSource.service.js) 的 `createRecutSourceSteps({loadInputs, media})` 取得四個步驟，接到 RC1 registry；完整生成還需要 RC3、RC4，不能只註冊這四步當成產片。功能狀態與驗證結果見[目前狀態](../../docs/current-status.md)。

## 連續視窗規則

輸入為直接檢索命中與同影片片段。`loadSourceInputs` 依課程實際影片範圍解析 native／external 識別，轉成 `Video._id`；跨影片、未屬於課程或缺本機原片時停止。

1. 所有直接命中必須在同一影片，而且能全部放入 120～180 秒的視窗；不默默丟掉較遠命中。
2. 依片段時間排序、去重，枚舉以片段起點／終點為界的候選。相鄰片段最多容許 10 秒空隙，避免把未涵蓋的大段內容當成連續證據。
3. 候選先比與 150 秒的差，再比與命中中心的差，最後選較早者。太短、太長、缺命中片段或沒有合格候選，回報找不到視窗。
4. 生成的第一個步驟固定起訖與 `frozenAt`；後續步驟使用相同範圍，不重新查證據挑視窗。

例如命中在 75～90 秒、同影片有連續 15 秒片段，會挑包含命中且最接近 150 秒的片段邊界。演算法為候選枚舉與穩定排序，最壞約 O(n²)；參數集中在 [recutSource.js](../src/constants/recutSource.js)。

替代方案是只挑最密集命中群，成功率可能較高，但可能漏掉代表題所需證據，因此先採全部命中。10 秒空隙門檻與 150 秒目標是工程規則，待試跑調整；不是語意連續性的證明。

## 原片與固定增益

`createRecutMediaTools({run,resolveSource})` 包裝外部工具，測試替換兩個依賴。本機原片先經既有 uploads 路徑與實體檔案檢查，不接受 API 自訂路徑。ffprobe 確認聲音軌與長度，FFmpeg 在視窗內解碼；任一步失敗都不做 ASR、不扣 Gemini 額度。

視窗量測為整體響度 `I` 與真峰值 `P`，固定增益 `g = min(-16-I, -1.5-P)` dB。若加完仍比 -16 LUFS 低至少 2 LU，停止並回報原片音量過低。只保存固定增益供 renderer 使用，不壓縮動態或改聲音內容；量測為非有限數值也拒絕。

## 辨識與句子

只抽取視窗為 16 kHz 單聲道 WAV，沿用 [transcribe_words.py](../../short_render/src/align/transcribe_words.py) 的繁中、VAD 與逐字時間設定。程序內單一 ASR 序列執行，暫存目錄在 finally 清除；設定離線模式，模型須事先安裝，不在任務中下載。

| 環境變數 | 預設／用途 |
|---|---|
| `RECUT_FFMPEG` | `ffmpeg` |
| `RECUT_FFPROBE` | `ffprobe` |
| `RECUT_PYTHON` | repo 內 `STT_Whisper/.venv` 的 Python |
| `RECUT_ASR_MODEL` | `small`；指向預先準備的模型名稱或路徑 |

ASR 原始輸入 `{w,s,e}` 為視窗相對秒數；輸出改成原片絕對秒數。停頓至少 0.3 秒、標點或累計即將超過 8 秒，在字詞邊界切句；單字詞超長則拒絕，不虛構字內時間。輸出格式與合成樣本見 [RC1 句子介面](recut-foundation.md#rc2--rc3-的句子清單)。`retrievalHit` 依句子與直接命中時間重疊標記，`chunkIds` 留下重疊片段。

四步依序回傳 `sourceWindow/sourceVideoId/sourcePath`、`sourceCheck/audio`、`rawWords`、`sourceId`；最後透過 `createRecutSource` 寫 `recutsources`。前三者僅為步驟內資料，RC3 以 `sourceId` 讀凍結句子，不需重辨識。

## 證據與限制

`recut-source.service.test.js` 與 `recut-media.service.test.js` 使用合成 JSON／逐字時間與假外部執行器，涵蓋視窗、三類原片失敗、增益、切句、單一 ASR、清除暫存與 queue 失敗還原。2026-10-14 原型紀錄只供設計參考，沒有複製其肖像素材、腳本或成品。真實 FFmpeg、Whisper 的速度與辨識品質須在另行授權的試跑驗證。
