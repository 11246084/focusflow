# short_render

「程式化動畫＋老師原片原音」短影片的 plan 驗證器與渲染 CLI（`recut-v1`）。獨立於 `backend/`，做法與 `STT_Whisper/` 相同：自己的依賴、自己的指令。

**狀態：第一階段（本機工具）。** 後端沒有呼叫它，也沒有 API／資料表／前端；`ShortScript.payload.kind = "recut-v1"`、LLM 生成 plan、教師審核介面都還沒做。目前只驗證過兩支原型（見「已驗證與未驗證」）。

## 它做什麼

```
plan.json（選段＋字幕＋圖卡，只寫「老師講到哪個詞」，不寫秒數）
   │  validate   檢查結構、證據引用、數字對證（不需要影片）
   ▼
align    對選段視窗跑字詞級 ASR 與靜音偵測 → 錨點換成秒數 → resolved.json
   ▼
preview  剪出老師畫面、組出 HTML、出預覽截圖（給教師審 plan，約 1 分鐘）
   ▼
render   驗證剪點 → HyperFrames 渲染 → loudnorm → final.mp4（720×1280、約 -14 LUFS）
```

版面：上方圖卡面板（標題列、動畫、黃字重點字幕）＋ 橘色分隔線 ＋ 下方老師畫面（同一段原片、原音、不加速），結尾接文字結尾卡。色票取自 FocusFlow 前端（深梅紫底、品牌橘只做結構、黃色只做強調）。

## 需求（本機）

| 項目 | 說明 |
|---|---|
| Node.js ≥ 22 | HyperFrames 的要求 |
| Chrome | HyperFrames 渲染用（系統已安裝的即可；`npx hyperframes doctor` 可檢查） |
| FFmpeg／FFprobe，含 libx264 | 在 PATH 上，或設 `SHORT_RENDER_FFMPEG`、`SHORT_RENDER_FFPROBE` |
| Python＋faster-whisper | 預設用 `STT_Whisper/.venv`；或設 `SHORT_RENDER_PYTHON` |
| Noto Sans TC 可變字型（OFL） | 約 12 MB 不進 git。Windows 11 通常已有 `C:\Windows\Fonts\NotoSansTC-VF.ttf`；否則設 `SHORT_RENDER_FONT` |

```powershell
cd short_render
npm install
npm test
```

> VM（`rocky101702`，3.5 GiB RAM）已在 2026-10-23 升到 Node 22，但其他條件與記憶體是否足夠**尚未查證**，目前只在開發機執行。不要在 VM 上直接跑渲染。

## 指令

```powershell
node bin/short-render.js validate fixtures/plan2.json --evidence fixtures/evidence5.json
node bin/short-render.js align    plan.json --evidence evidence.json --source 原片.mp4 --out out/x
node bin/short-render.js preview  plan.json --evidence evidence.json --source 原片.mp4 --out out/x
node bin/short-render.js render   plan.json --evidence evidence.json --source 原片.mp4 --out out/x
```

- `--evidence`：`ShortScript.evidence` 的格式（`chunkId / videoId / startSec / endSec / rawText`）。
- `--out`：中間檔與 ASR 快取都放這裡；同一視窗不會重跑 ASR。第一次對齊約 1–3 分鐘（CPU，依選段數與視窗長度），之後秒級。
- `render` 會把剪出的音訊重新轉錄、與預期文字比對（V6），不符就停下，避免剪掉半個字；`--skip-verify` 可略過。
- 結束碼：0 成功；1 驗證／對齊失敗；2 用法或環境錯誤。
- HyperFrames 的 telemetry 在這裡一律關閉（`HYPERFRAMES_NO_TELEMETRY=1`）。

## plan 格式（`recut-v1`）

範例見 `fixtures/plan1.json`（數字型）、`fixtures/plan2.json`（概念型）。

| 欄位 | 內容 |
|---|---|
| `clips[]` | 選段：`chunkIds`（必須在凍結證據內）、`from`／`to` 文字錨點、`cut`（`snap` 吸附氣口，預設；`exact` 字連字時精確剪） |
| `subtitles[]` | 短字卡（≤ 20 字、繁體）：`runs: [{t, hl?}]`（`hl` 為黃字），`from` 錨點決定何時出現 |
| `scenes[]` | `clips`（涵蓋的連續選段）、`component`、`params`、`cues`（動畫出現時機的錨點）、`basedOn`、可選 `stamp` |
| `derived[]` | 推導數字：`expr`（只允許數字與 `+ - * / ( )`）、`value`、`shows` |
| `source` | `videoId`、`teacherRegion`（老師視窗在原片裡的像素位置；因錄影而異） |

**錨點**：`{ text, nth?, offset? }`。`text` 是老師實際講的字（比對時忽略標點空白；ASR 錯字時 ≥ 5 字的錨點允許 2 字差異並標記為模糊命中）。`nth` 在 `from`／`to` 以對齊視窗計、在 cue 與字幕以所屬選段計。

**元件**（`src/plan/components.js` 是唯一定義，同時決定參數檢查、cue 名稱與「畫面上會出現哪些文字」）：

| 元件 | 用途 | cue 名稱 |
|---|---|---|
| `stat` | 大數字（計數動畫）＋標籤＋徽章 | label kicker value unit badge |
| `slots` | 伺服器插槽依序亮起 | show lit0… |
| `rows` | 通用文字列（算式、標題、大字） | r{列}t{字} note |
| `quote-reveal` | 一句話逐字揭露 | label text |
| `chips` | 詞語方塊；高亮、淡化其餘、問號 | enter note caption hl{i} dim q |
| `compare` | 左右對照＋連結＋✕／✓ | left link right mark |
| `checklist` | 項目逐條出現（可帶 ✕／✓、橫幅） | head item{i} banner |
| `place-values` | 位值格（個十百千萬） | d{i} note |
| `relation` | 三個詞以連線串起 | w0 w1 w2 l0 l1 note |
| 疊加 `stamp` | 任一場景可加的印章 | stamp |

沒寫的 cue 會用場景開頭加固定偏移當預設，不會失敗。

## 驗證（`src/plan/validators.js`）

| # | 檢查 | 結果 |
|---|---|---|
| V0/V4/V8 | 結構、元件參數、字幕長度與繁體、cue 名稱、場景順序 | 錯誤 |
| V1 | `chunkIds`／`basedOn` 必須在凍結證據內；證據的 `videoId` 必須等於 `source.videoId` | 錯誤 |
| V2 | 每個錨點必須出現在它引用的 chunk 原文；對齊後的選段必須落在引用 chunk 的時間範圍 ±2 秒 | 錯誤 |
| V3 | **畫面上每個數字**必須出現在引用證據，或由 `derived` 重算得出（含萬／億等十進位換算） | 錯誤 |
| V5 | 總長 30–65 秒、每場景 ≥ 1.5 秒、cue 在場景內、選段 ≥ 0.8 秒 | 錯誤 |
| V6 | 剪出的音訊重新轉錄後與預期文字相似度 ≥ 0.75（`render` 內執行） | 錯誤 |
| V7 | 引用文字含「你們看這邊」等指涉畫面句 | 警告 |

V3 只擋數字；人名、專有名詞與語意是否偏移**不在自動檢查範圍**，仍需教師審核。

## 已驗證與未驗證

已驗證：
- `npm test`：72 項（plan 驗證與負面案例、中文數字正規化、錨點與吸附、對齊後時間、HTML 產生與跳脫、ffmpeg 參數）。
- 以兩份 fixture plan 在開發機（i7-12700H、16 GB）實際跑過 `align`、`preview`、`render`（第 1、5 支課程錄影）：整條 `render` 含對齊與 V6 剪點驗證，約 2–5 分鐘 / 支（ASR 結果已快取時約 2 分鐘）。

**實跑才發現、已處理的問題**（寫在這裡是因為它們會再發生）
- Whisper 會把「200 張」「60 萬」寫成「兩百張」「六十萬」，證據可能是阿拉伯數字 → 比對前兩邊都把中文數字轉成阿拉伯數字（`src/plan/text.js`）；轉換在去標點**之前**做，否則「六十，六十萬」會被接成 66。
- 老師寫板書的長靜默會讓 Whisper 重複同一句數十次（實測「六十萬吧」×30）→ 對齊用 `vad_filter` 並關閉 `condition_on_previous_text`。
- Whisper 的字詞時間在靜默前後不可靠（「做」被標成 1 秒長）→ 剪點以靜音偵測為準，下刀點一律落在靜音之內（`snapStart`／`snapEnd`）。
- 同一段音訊重跑 ASR 結果可能略有不同（溫度 fallback 是取樣式的）→ 引用同一組 chunk 的 clip 共用同一次轉錄，結果快取在 `--out/cache`；**plan 的可重現性以快取為準**。
- 錨點寫在 plan 裡的是 LLM 看到的證據文字，對齊用的是另一個模型，字不一定相同 → ≥ 5 字的錨點允許 2 字差異（模糊命中，`resolved.clips[].anchorsExact=false`）；單字錨點（如「個」被聽成「各」）很脆弱，`place-values` 的 cue 改用整句加 `offset`。

**未驗證／已知限制**
- 沒有人聽過成品；播放器相容性只看了編碼規格。
- 只有 2 份 plan，都是手寫的；**LLM 能否穩定產出合法 plan 尚未驗證**。
- 老師畫面來自 Zoom 錄影右側的小視窗（約 478×269）放大 2 倍，畫質偏糊；`teacherRegion` 目前要人工指定。
- `fixtures/` 的 evidence 是原型的 ASR 結果，不是資料庫實際的 chunk。
- 簡體字清單與 `backend/src/services/shortScriptGeneration.service.js` 的 `SIMPLIFIED_ONLY` 是兩份複本（見 `src/plan/text.js` 註解），整合進後端時要合併。
- 老師肖像、聲音的使用需要老師同意（既有規格 R-07 的流程）；原型成品不得對外公開。

## 授權

HyperFrames 0.8.153 為 Apache-2.0（以套件 `package.json` 為準），GSAP 3.15.0 依其授權條款；Noto Sans TC 為 SIL OFL。本資料夾沒有複製任何第三方 skill 的程式碼。
