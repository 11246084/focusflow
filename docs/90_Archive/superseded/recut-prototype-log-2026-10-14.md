# 短影音原型製作紀錄（2026-10-14）

目標：把課程原始長片剪成類似參考成品的直式短片（上：程式化動畫＋重點字幕；下：老師原片原音）。
成品：`output/short1_v1_loudnorm.mp4`（720×1280、30fps、61 秒、H.264 High/yuv420p、AAC）；未正規化版 `output/short1_v1.mp4`。
**僅供內部討論，不對外公開。**（老師肖像未取得同意；結尾卡只用文字，沒有任何他人 logo。）

## 素材與選段
- zip 解壓到 `source/`：6 支 aiA10_1140119_*.mp4（Zoom 錄影，1800×900 或 1920×812，約 30–36 分鐘，投影片＋右側小視窗老師）。
- 轉錄 faster-whisper `small`（本機 CPU）。兩支 30 分鐘長片同時跑約 25 分鐘。
- 選用第 1 支：講「訓練大模型的入門門檻：200 張 A100，一張約 60 萬，合計約 1.2 億」。
  理由：有數字、有計算、有轉折（只算顯卡），最接近參考影片的解題節奏。第 5 支（自然語言／Siri 範例）是概念型備選，未做。
- 剪輯：14 段（4 段來自 11:22–11:36 的開場、10 段來自 20:04–21:30），依 `silencedetect -33dB` 吸附到氣口，不加速，段間靜音刪除；輸出 57.4 秒。

## 用到的 skills／工具（版本）
| 項目 | 用途 | 來源／位置 |
|---|---|---|
| HyperFrames CLI 0.8.153（Apache-2.0） | 把 HTML＋GSAP 渲染成 mp4；`lint`、`snapshot`、`render` | `hf/node_modules`（本專案內安裝，已關閉 telemetry） |
| skill `talking-head-recut` | 「老師影片＋圖卡」的版面與規則（stack 版面、card 設計、GSAP 對照）——**版型思路最接近參考影片** | 複製到 `D:\AI-workspace\.claude\skills\` |
| skills `hyperframes`、`hyperframes-core`、`hyperframes-cli` 等 | 組合檔結構、`data-*` 時間屬性、lint 規則 | 同上，共 13 個 |
| skill `embedded-captions` | 字幕樣式目錄；**本次沒用**（字幕自己做在圖層裡，因為要與動畫共版面、且需短字卡） | 同上 |
| FFmpeg 9.0.2 | 剪輯、裁老師視窗、響度 | winget |
| faster-whisper 1.2.1（`STT_Whisper/.venv`） | 逐字稿與字詞時間 | repo 既有環境（**HyperFrames 的 transcribe 需 whisper-cpp，本機沒裝，沒用**） |
| Noto Sans TC（`C:\Windows\Fonts\NotoSansTC-VF.ttf`） | 繁中字型，複製進專案 `fonts/` | 系統內建 |
| 自寫 `tools/make_edl.py`、`tools/build_composition.py`、`tools/verify_numbers.py` | 剪輯清單、場景資料→HTML、數字對證 | 本專案 |
下載保存（未啟用）：`D:\AI-workspace\04_Workbench\skill-downloads-2026-10-13\`（remotion-skills、clipify、youtube-clipper）。hyperframes 完整 repo 已於 2026-10-17 移至資源回收筒，需要時從 GitHub 重新 clone。
- 未使用：`guizang-product-video-skill`（產品宣傳片流程，不適用）、Remotion、clipify（MIT，需 macOS VideoToolbox；talking-head 對話，不適合單人講課）。

## 管線（可重現）
1. `tools/make_edl.py`：期望時間 → 吸附靜音 → `ffmpeg` 剪＋裁老師視窗（x1400,y317,359×269 → 720×540）→ `hf/short1/teacher.mp4`，同時輸出 `work/edl.json`。
2. 再轉錄 `teacher.mp4` 取得輸出時間軸上的字詞時間（驗證剪點沒切到句子，並決定動畫與字幕時間）。
3. 人工（含 AI）寫 `hf/short1/scenes.json`：11 個場景（元件類型＋參數＋時間）、19 張字幕卡、證據與推導。
4. `tools/build_composition.py`：`scenes.json` ＋ `style.css` → `index.html`（確定性模板，無模型）。
5. `hyperframes lint`（0 error）→ `snapshot`（16 個時間點目視）→ `render`。
6. `ffmpeg loudnorm` → -14 LUFS 目標；`tools/verify_numbers.py` 確認每個數字都有證據或推導。

## 耗時
安裝 hyperframes 約 1 分鐘；hyperframes repo clone 約 10+ 分鐘（含 git-lfs，520MB，其實只需 skills 的 16MB）；轉錄約 25 分鐘（兩支長片）＋約 1 分鐘（剪後驗證）；EDL＋剪輯 35 秒；snapshot 22 秒；**渲染 61 秒影片 286 秒**（約 4.7× 實際長度，CPU、standard 品質）。

## 結果與問題
- 版面、字幕、動畫與老師畫面同步正常；數字全數可對證（1.2 億為 60 萬×200 張推導，板書也寫 12000 萬）。
- **老師畫面解析度偏低**：原錄影的老師只是右側 478×269 小視窗，放大 2 倍後偏糊；這是素材限制，之後要有 1080p 老師畫面才好看。
- 開場 4 段是從 9 分鐘前的句子拼接（「入門門檻叫做 200 張的，當時是 A100」），有跳接感；真實講課口語沒有現成的「乾淨 60 秒」，必須靠剪＋拼＋刪空白才成片。
- 老師講課有 7–10 秒的板書靜默，靠靜音偵測自動刪除可行。
- ASR（small）會錯字（「大語言模型」→「大圓模型」、「插了」→「差了」），字幕要人工或有詞表校正。
- 場景 s9（不算…）在項目少時內容偏上，版面細節未精修。
- 沒有配樂、沒有音效（原型不做）。
- 未驗證：聽感（沒有人聽過成品）、Windows 內建播放器實際播放（編碼規格符合）。

## 第二支：概念型（第 5 支課程影片，Siri 範例）
成品：`output/short2_v1_loudnorm.mp4`（720×1280、60.4 秒；未正規化版 `short2_v1.mp4`）。主題「Siri 怎麼聽懂一句話？」：先拋「附近有哪些餐廳」→ 最重要的字是餐廳 → 只看餐廳會推薦到高雄夢時代 → 附近也很重要 → 要理解字與字的關聯。
- 選段：942–1075 秒（約 2 分鐘的 Siri 範例）剪成 10 段、56.8 秒；整段本來就是「問題→錯誤→修正」的完整敘事，比第 1 支乾淨，**只需刪掉中間的口語贅詞與停頓**，沒有跨 9 分鐘的拼接。
- 管線完全重用：`make_edl_cfg.py`（改成吃設定檔，新增 `"s"/"e"` 精確剪點旗標，避免字連著字時被靜音吸附切掉半個字）、`map_words.py`（把原片字詞時間換算到輸出時間軸，**不必再轉錄剪後影片**）、`build_composition.py`（新增 8 種概念型場景元件：bubble、chips、locations、routes、bigword、linkchips、relation、check）。
- 場景元件為通用型（字詞 chips、重點高亮、前後對照、關聯連線），與第 1 支的數字型元件（count、digits、result…）共用同一個建置腳本與樣式。
- 渲染 60 秒影片 161 秒（第 1 支 286 秒；差異來自動畫較簡單）。
- 這次踩到：①標題太長換行壓到內容（縮短）；②字詞 chips 在 64px 會折行（改 54px、nowrap）；③「假」字被剪進前一段結尾（改精確剪點）；④重複的「那」（合併相鄰兩段）。
- 數字檢查：本支沒有數字，改以逐字稿對證每個詞（餐廳、附近、台北、高雄夢時代）皆出自原話；「補充」「關聯」也是老師原話。
- 未驗證：聽感、播放器實測。

## 對「做進系統」的初步判斷（待討論）
- **能自動化**：吸附靜音剪輯、剪後再轉錄校驗、`場景 JSON → HTML → mp4`、數字對證、響度。
- **必須人工／需設計**：選段（哪一段有完整觀念）、場景元件的設計與字幕短字卡撰寫（目前是我手寫，系統要靠 LLM 產 JSON 再驗證）、字幕錯字校正、老師肖像同意。
- **成本**：渲染需要 Chrome＋FFmpeg，單支約 5 分鐘 CPU；不需要 GPU，但不適合放在小規格 VM 上與後端搶資源。
- **授權**：HyperFrames 為 Apache-2.0（以套件 metadata 與 repo LICENSE 檔頭確認）；skills 內含的字型與素材另有授權，進 repo 前要逐項確認。
