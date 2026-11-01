# short_render

## RC5 句子契約（0.2.0）

後端以 `require('./src/plan')` 使用 `buildRecutPlan`、`validatePlan`、`resolvePlan`、`getComponentCatalog`、`getCardsResponseSchema`、`getAllowedIcons`、`getAssetCatalog`、`getRendererMetadata`。新版仍用 `schemaVersion: 'recut-v1'`，另帶 `contractVersion: 'sentence-v1'`，與下方歷史文字錨點原型分開辨識。`tests/sentence.fixture.js` 是無真人素材的完整合成樣本。

- `buildRecutPlan({source,selectionResult,scenes,subtitles,title,endCard,modelId,audio,theme})` 回 `{plan,resolved,errors}`；來源與選段使用 RC2／RC3 的凍結句子及絕對逐字秒數。`audio` 可用 RC2 的 `integratedLufs/truePeakDbtp/fixedGainDb`；預設 N2、結尾卡額外時長 0，避免擅改已鎖定的 65 秒選段。
- `validatePlan(plan,{sentences,evidence,resolved?})` 回 `{valid,errors,warnings}`；`evidence` 可為凍結 chunk 陣列或 RC2 source。`resolvePlan(plan,{sentences})` 回 `{resolved,errors}`。新版不再呼叫第二次 ASR、模糊比對或靜音吸附，剪點須與 RC3 逐字邊界相同。
- 配圖輸出 `scenes:[{id,from:'s1',to:'s3',component,params,cues:{text:{sentenceId:'s1',text?:'原話片語'}}}]`；程式填回 `clips/basedOn`。字幕為 `subtitles:[{from:{sentenceId:'s1',text?},runs:[{t,hl?}],level?}]`；程式填 clip。施工單的 clip 另外保留程式填入的 `textAnchors` 作回溯。
- 圖卡目錄共 12 種加 RC6 `code` 擴充。`getComponentCatalog({aiOnly:true})` 暫回原有 9 種；三種新卡必須經另一位代理完成手機可讀性檢查才開 AI；`code` 由 RC6 畫面抄錄步驟提供，配圖模型不可自行編寫。每筆目錄含用途、參數 schema、三行範例與不適用情境。
- RC6 `code.params`：`language`、`lines:[{text,source:'畫面原樣|AI 修正|AI 補寫',originalText,intentionalError?}]`，選填 `highlightLines:[1]`、`boxes:[{line:1,text:'唯一文字'}]`、`requiredVariables:['x']`、`errorMessage`、`diagram:{layers:[{text,icon?}]}`。每行至多 36 字、每卡至多 12 行；故意錯誤必須維持畫面原樣。

素材只讀固定 npm 套件：Fluent 1.2.6、Phosphor 2.1.1；依已核准的 2026-10-17 清單開放 1,341 個預設 Fluent，排除 51 個物件、Flags 及非白名單 Symbols。Iconify 的右指手勢是鏡像 alias，程式明確保留這個預設 alias；不能用名字結尾 `light` 一律判膚色，否則會誤擋紅綠燈。

演算法與限制：建立句子 ID 索引，逐段依 RC3 首尾完整字詞選取、累加原片首字至末字的時間；冷開場只允許一次、不重複播放。片語僅在指定句內做唯一且完整字詞的比對，保留小數點、負號與程式符號；拒絕字元比例推算及模糊命中。圖卡完整覆蓋選句、每張 3～12 秒、只在句界更換。預覽與成品的固定增益為 `min(-16-inputLUFS,-1.5-inputTruePeak)` dB；峰值限制後低於 -18 LUFS 即拒絕。上述測試是離線合成資料驗證，未宣稱模型品質或實際 MP4 驗收。

## sentence-v1 預覽與渲染

Node 22.23.4 以上的 22 版；使用已安裝並固定版本的 npm 套件，執行中不下載圖示、字型或瀏覽器。字型使用既有 Noto Sans TC 可變字型；真正渲染另需已安裝的 chrome-headless-shell、FFmpeg／ffprobe。下方指令會處理本機檔案；本輪驗證只有合成資料與假的外部執行器，沒有製作真實 MP4。

```powershell
cd short_render
npm.cmd test
# 自製圖卡、30 秒靜音，沒有原片或外部呼叫
node bin/prototype.js
# 在瀏覽器開啟 out/prototypes/index.html，選主題後拖曳播放位置

# source.json 為 RC2 的凍結來源，含 sentences 與逐字絕對時間
node bin/short-render.js validate plan.json --evidence source.json
node bin/short-render.js align plan.json --evidence source.json --out out/job
node bin/short-render.js preview plan.json --evidence source.json --source source.mp4 --out out/job
# preview 只剪原音與產生 stage/preview.html，不啟動 HyperFrames
node bin/short-render.js render plan.json --evidence source.json --source source.mp4 --out out/job --browser C:/path/to/chrome-headless-shell.exe
```

`align` 對 sentence-v1 只做確定性句子解析，不重跑 ASR。舊 fixtures 保留 validate／align 相容性；舊版不能直接 stage／render，避免缺少固定增益與版本資料。原型入口會重建五個主題頁與 `catalog.json`；每 5 秒依序展示「放不進去」「合不起來」「層層包含」。三張新卡與 code 均維持 `aiEnabled:false`，另一位代理的手機畫面檢查尚未完成。

`stageProject({plan,resolved,sentences,evidence,sourcePath,outDir,runCommand?,resolveFont?})` 先核對版本與重新解析後的完整時間，再建立 `stage/index.html`、`preview.html`、本機字型、GSAP 與 `narration.wav`。`skipCut:true` 只供離線原型使用，不能進入 render。`renderProject({plan,resolved,stageDir,outDir,runCommand?,hyperframesImpl?,ensureFontLoaded})` 重新核對 planHash、增益、HTML／字型／GSAP／音訊雜湊；缺少字型檢查器或觀測失敗就拒絕渲染。`src/render/browser.js` 使用 HyperFrames 鎖定依賴中的 puppeteer-core，僅啟動傳入的既有瀏覽器路徑，不安裝瀏覽器、不允許網路請求。常駐 worker 的設定與啟動方式見下節。

演算法與取捨：

- **同一時間軸**（`src/render/html.js`）：輸入 plan 與 resolved，產生共用的卡片、字幕與 GSAP 動畫；預覽只額外加入控制項與程式碼來源對照。播放、暫停與拖曳都用原音 `currentTime` 對動畫 seek；逐格渲染使用同一條已暫停的 timeline。卡片與字幕的可見區間同時寫進 timeline，避免逐格時重疊。相較分開維護兩套動畫，這能降低預覽與成品漂移，但仍需真實瀏覽器與 MP4 比對。字型載入後才註冊 timeline；手機預覽等比縮放 720×1280 畫布，輸出尺寸固定。
- **原音剪接與固定增益**（`cut.js`、`render.js`）：以每段的絕對 srcStart／srcEnd 做 `atrim`，重設時間後串接 PCM 音訊；只在額外結尾卡補靜音。預覽套 Web Audio `10^(gainDb/20)`，成品於最後一步套一次 FFmpeg `volume=gainDb dB`。未採動態 loudnorm，避免改變聲音動態。結尾卡過長仍可能被 RC7 靜音檢查擋下；預設 0 秒。
- **程式碼顯示與隔離**（`html.js`）：固定規則 tokenizer 為關鍵字、字串、數字與註解上色，不執行程式、不驗證語法；比完整編譯器簡單且沒有語言模型呼叫，但不能完整辨識所有語言。行號、行高亮、唯一片語方框與錯誤框來自已驗證參數；原始畫面抄錄與逐行來源只輸出到 preview 的畫布外對照區，render HTML 不序列化整份 plan，因此不帶 OCR／provenance。程式內容的正確性仍由 RC6 與教師審閱負責。
- **版本 fencing**（`render.js`）：鎖定 renderer／素材／GSAP／HyperFrames 版本，再用雜湊阻止 staging 後內容漂移。這處理本機工件一致性；工作核准、租約與上傳版本核對由 RC7 後端處理，不能以本機雜湊代替核准。

本輪測試見 `tests/render.sentence.test.js`：五主題、共用 seek、字型閘門、渲染頁來源隔離、音訊遭修改時拒絕、固定增益與純原音剪接，以及新卡 AI 仍停用。外部 FFmpeg、HyperFrames、瀏覽器啟動均以替身驗證；尚未宣稱真實響度、字型截圖、手機可讀性、MP4 或人工驗收通過。

## RC7 常駐 worker

worker 是組員電腦上的渲染程式：向後端領一支已核准工作，下載受限原片，再用上述 RC5 流程製作並檢查 MP4。每台電腦只用自己的專用金鑰，一次做一支；接工作／暫停及停用由管理員後台控制。功能進度與驗收範圍見[目前狀態](../docs/current-status.md)，API 詳見[後端 worker 契約](../backend/docs/recut-review.md#rc7-專用-worker-與持久租約)。

先安裝 Node 22.23.4 以上的 22 版與鎖定依賴（`npm.cmd ci`），備妥既有 chrome-headless-shell、Noto Sans TC 可變字型及 FFmpeg／ffprobe。worker 不安裝瀏覽器、不下載模型；管理員必須先為這台電腦建立 worker 金鑰。不要使用教師／管理員 JWT，也不要把金鑰放在命令列或 Git。

建立受信任的本機設定，例如 `D:/AI-workspace/private/recut-worker.cjs`；此檔是 Node 模組，只載入自己維護的設定。以下從具名環境變數注入未來的 worker 金鑰，不載入或掃描任何 `.env` 檔：

```javascript
module.exports = {
  backendUrl: 'http://127.0.0.1:3000', // 非 localhost 必須 HTTPS，僅填 origin
  getWorkerKey: async () => process.env.RECUT_WORKER_KEY,
  workRoot: 'D:/AI-workspace/recut-worker-jobs',
  browserExecutable: 'D:/tools/chrome-headless-shell/chrome-headless-shell.exe',
  fontFile: 'C:/Windows/Fonts/NotoSansTC-VF.ttf',
  ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', // 或填安裝後的完整路徑
  hostKind: 'desktop',
};
```

由自己的啟動環境提供 `RECUT_WORKER_KEY` 後，在 `short_render` 執行：

```powershell
# 只顯示用法，沒有領工作或啟動工具
node bin/recut-worker.js --help
# 以下會真正領工作、下載原片並渲染，需已準備好上述本機環境
node bin/recut-worker.js --config D:/AI-workspace/private/recut-worker.cjs --once
node bin/recut-worker.js --config D:/AI-workspace/private/recut-worker.cjs
```

`--once` 處理至多一支；常駐模式每 10 秒輪詢。Ctrl+C 中止目前工作。`hostKind:'vm'` 預設回 `disabled` 且不領工作；僅管理員已另外授權 VM 渲染時才明確加入 `enableVmRender:true`。沒有設定就只顯示用法；不隨後端啟動自動執行。版本不符時輸出 `RECUT_RENDER_VERSION_MISMATCH` 與 `action:'upgrade-worker'` 並停止，請管理員安裝與核准施工單相同的 renderer／素材版本；不可自行換模型或改施工單。

例如「已核准 30 秒施工單」→ `claim` 取得凍結來源與 10 分鐘租約 → 同一 worker 每 60 秒延長租約 → 檢查合格後 `result` 送回待審成品；教師仍須看實際 MP4，才能核准發布。原片 URL、HTTP 回應檔名與 job 自帶下載目標均不採用，只能從同一後端的 `/api/v1/recut-worker/jobs/:jobId/source` 下載；不跟隨 redirect。預設原片上限 4 GiB、成品上限 512 MiB；`maxDownloadBytes`／`maxUploadBytes` 可由本機設定縮小，仍受後端上傳限制。

演算法與取捨（對應 `src/worker/`）：

- **單工與版本核對**：`client.js` 先檢查固定 renderer／素材版本、凍結來源、施工單 SHA-256、句子時間與固定 gain，之後才惰性載入 renderer。後端 FIFO 決定工作順序，client 不自行選片或重生施工單。planHash 的 canonical JSON 格式與後端相同；本機 staging 另驗 HTML、字型、音訊 hash，兩者用途不同。
- **租約與取消**：領工作到完成始終持有同一 lease。心跳失敗、租約到期或取消會停止渲染；Windows 終止自己的程序樹，POSIX 終止自己的程序群組，等結束後才清暫存。成功、失敗與拒收均只清除 worker 自建的 `recut-job-*` 目錄，不採用遠端提供的本機路徑。
- **實測後才上傳**：`checks.js` 從 ffprobe 讀一影一音、720×1280、30fps、總長 ±0.5 秒；從 FFmpeg 讀黑畫面（像素門檻 .05、須小於 .5 秒）、靜音（-50 dB、須小於 2 秒）、響度（-16 LUFS ±2）與真峰值（≤-1.5 dBTP）。字型旗標來自真正的 browser 載入檢查。缺少值不能用預設 passed；偶發／固定分類與後端門檻相同，原始測值隨 failure 或 result 回傳。
- **結果只送一次**：先做最後一次 heartbeat，再以 `video`／`metadata` multipart 送到專用 result 路由；metadata 帶 `versionId`、`planVersion`、`planHash`、固定版本、`checks` 與 `renderDurationMs`。不直接用教師 asset API。上傳回應遺失可能表示後端已接受，故不重送 result 或接著送 failure；由後端持久紀錄恢復。逾期／錯 owner 的結果由後端拒絕，client 清理本機輸出。

可調 `requestTimeoutMs`（預設 2 分鐘）、`jobTimeoutMs`（30 分鐘）、`pollMs`（10 秒）與 `heartbeatMs`（最多 60 秒）。timeout／取消透過偶發失敗交後端重派；同一支最多三次、不得派回同一台的規則由後端持久化，client 不建立第二套重試佇列。工具只繼承必要 OS 路徑環境，不傳 worker 金鑰；日誌只回安全狀態、ID 與錯誤代碼，不轉印上游 message／token。

隔離驗證使用 `tests/worker.*.test.js`：HTTP、renderer、FFmpeg／ffprobe、browser 與程序控制均注入替身，涵蓋成功、固定／偶發檢查、錯版、過期、心跳、取消、單工、重複結果、串流大小限制、路徑與 redirect。這些測試不證明真實 MP4、外部 API、Atlas 或人工驗收；實際工作只能在取得授權且完成環境安裝後執行。

<details>
<summary>第一階段歷史原型說明（舊畫面、ASR 與音量資訊不適用 sentence-v1）</summary>

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

</details>
