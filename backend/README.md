# FocusFlow 後端安裝與使用

這份文件說明如何啟動 FocusFlow 後端，供網頁與 LINE 呼叫。請先設定自己的資料庫，再啟動服務；功能進度及驗收結果只看[目前狀態](../docs/current-status.md)。

## 安裝與設定

使用 Node.js 22.23.4 以上、npm 10 以上；版本理由與檢查方式見[根 README 環境需求](../README.md#環境需求)。從 repo 根目錄執行：

```powershell
cd backend
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env` 是程序讀取的環境設定檔。啟動前編輯下列項目；更多設定見[範例檔](.env.example)：

| 設定 | 本機操作 |
|---|---|
| `MONGODB_URI` | 指向自己的資料庫，例如 `mongodb://127.0.0.1:27017/focusflow_local`。 |
| `JWT_SECRET` | 設定自行產生的隨機密鑰，用於驗證登入憑證。 |
| `PROCESSING_WEBHOOK_SECRET` | 設定影片處理回報的密鑰，與 Pipeline 相同。 |
| `QA_QUERY_EMBEDDING_PROVIDER=mock`、`QA_ANSWER_PROVIDER=template`、`QA_VECTOR_SEARCH_MODE=memory` | 本機模擬問答設定；仍需資料庫，不代表真實模型效果。 |

Gemini、LINE 與 YouTube 的金鑰依要使用的功能填寫；不要把金鑰提交到 Git。後端連線使用 [Mongoose](src/config/database.js)（操作 MongoDB 的套件），啟動可能建立索引，請勿用共用 Atlas 驗證啟動。

## 啟動與操作

```powershell
npm.cmd run dev
```

開發模式會監看檔案變更；一般啟動用 `npm.cmd start`。預設服務在 `http://localhost:4000`，可讀取 `/health`，並由 `/docs` 查看 API（前端呼叫後端的介面）說明。

需要本機示範資料時，在確認 `MONGODB_URI` 後執行 `npm.cmd run seed`，此操作會寫入指定資料庫。例：空白本機資料庫 → 執行 seed → 以 `student@focusflow.local`／`Student123!` 登入；帳號定義見[種子資料](src/scripts/seedDemoUsers.js)。

## 資料工具與問答設定

recut 視窗處理的 `RECUT_FFMPEG`、`RECUT_FFPROBE`、`RECUT_PYTHON`、`RECUT_ASR_MODEL` 設定與離線模型前提見[原片處理說明](docs/recut-source.md)。

recut 模型與額度暫透過設定轉接函式讀 `RECUT_GEMINI_MODEL`、`RECUT_INITIAL_CALL_LIMIT`、`RECUT_MODIFICATION_CALL_LIMIT`；模型未填沿用 `GEMINI_CHAT_MODEL`，上限預設各 5。步驟註冊及 S1 替換方式見[選段說明](docs/recut-selection.md)。

教師審閱 API、草稿／復原、核准與 RC4 重跑註冊見[審閱介面](docs/recut-review.md)。RC9 以 OpenAPI 的 `GET /recut/review` 接資料；尚未註冊 RC4 時套用回 503。

下列指令會寫入 `MONGODB_URI` 指向的資料庫；指向共用 Atlas 時，先確認目標與授權。

| 指令 | 作用 |
|---|---|
| `npm.cmd run seed` | 把示範資料收斂到基準狀態，不清除既有資料 |
| `npm.cmd run seed:reset` | 保守清除示範帳號產生的資料後重建 |
| `npm.cmd run db:sync-atlas` | 把本機資料同步到 Atlas |
| `npm.cmd run db:ensure-questions` | 建立 `questions` 集合並同步索引 |
| `npm.cmd run db:backfill-questions` | 預設只預覽（dry-run），加 `-- --write` 才寫入 |

問答設定有幾個限制：`QA_ANSWER_PROVIDER=gemini` 必須設定 `GEMINI_API_KEY`，缺少時直接回設定錯誤，不會改用其他方式；`QA_VECTOR_SEARCH_MODE=atlas` 不能搭配 `QA_QUERY_EMBEDDING_PROVIDER=mock`。服務是否可用，看 `/health` 的 `runtime.qa`、`runtime.line`、`runtime.youtubeUpload`，不以 `.env` 有填值推定。

例：本機沒有金鑰 → 設定 `mock`／`template`／`memory` → `/health` 的 `runtime.qa` 顯示可用，但回答只是模擬結果。

測試、規格檢查與其他資料工具指令見 [package.json](package.json)；驗證方式依[測試規則](../.claude/rules/testing.md)選用。設定問題查[技術索引](docs/current-state.md)，操作文件查[文件入口](docs/README.md)。

recut 的最小 API 沿用 `SHORT_SCRIPT_AUTOMATION_ENABLED`，預設關閉。RC2～RC4 註冊步驟前，啟動生成回 `503 RECUT_STEPS_NOT_CONFIGURED`；開關不會啟用假的產片。集合、句子樣本、註冊方式及本機隔離 Mongo 測試見 [recut 後端接手](docs/recut-foundation.md)。

YouTube 所有權的真實 Mongo 整合測試需另外執行，不會隨 `npm.cmd test` 連線。課程刪除使用 transaction，因此完整測試需要 replica set。先啟動只綁定 loopback 的測試 Mongo，再由 backend 目錄執行（名稱與 port 須未被使用）：

```powershell
docker run --detach --name focusflow-youtube-test --publish 127.0.0.1:27128:27128 mongo:7 mongod --replSet ffReview --bind_ip_all --port 27128
docker exec focusflow-youtube-test mongosh --port 27128 --quiet --eval 'rs.initiate({_id:"ffReview",members:[{_id:0,host:"127.0.0.1:27128"}]})'
$env:YOUTUBE_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27128'
npm.cmd run test:youtube-mongo
```

只接受明確 port、沒有資料庫名稱或認證參數的本機 URI，不從 `.env` 取得預設值。每次建立隨機 `focusflow_youtube_test_` 資料庫，成功與失敗都會刪除該次資料庫並關閉連線；測試不載入正式 server 或記憶體 harness，關閉 autoIndex／autoCreate，只在測試 DB 明確建立必要 collection 與既有 ShortAsset index。YouTube 呼叫全部是假 API。

此指令也執行 [FR01～FR06 回歸](integration/youtube-review-fixes.mongo.js)：以獨立 Node 子行程重現共用 DB 的競態，並測試舊資料、合法跨課程掛載與刪檔後的資料庫恢復。`youtubebackups` 使用 Mongo 內建 `_id` 唯一索引；不對 `videos.youtubeVideoId` 加唯一索引。所有 backend writer 升級與持久佔用的限制見[實作約束](../docs/04_Features/YouTube_Lifecycle/decisions.md#fr01fr06-共用資料庫修復約束2026-10-27)。

[NR01／NR02 回歸](integration/youtube-recovery-atomicity.mongo.js)另外檢查恢復接管、課程刪除交易與外部工作重試。預設以隔離 DB 時間戳注入租約過期；設 `$env:YOUTUBE_TEST_REAL_LEASE = 'true'` 會讓兩個原始競態案例各實際等待 120 秒。程序中斷測試可能等待 Mongo 清除未完成交易，整套需要數分鐘。要檢查 standalone 的拒絕行為，另用獨立的 loopback standalone Mongo URI 執行 `node --test integration/course-deletion-standalone.mongo.js`；預期回 503 且資料完全不變。

課程刪除的資料庫變更與 `coursedeletionjobs` 待辦在同一交易提交；YouTube 轉私人由提交後與啟動／每分鐘排程執行。單筆外部操作（含 token 與回應本文）上限 30 秒，超時取消請求並保留待辦重試，繼續處理下一筆。該集合以 `_id` 防重複、無 TTL 或自動索引同步；失敗及租約過期會重試，已完成紀錄保留。需要可交易的 MongoDB，standalone 回 `503 COURSE_DELETE_UNAVAILABLE`，不退回逐筆刪除。正式環境仍須另行授權查證；本機測試不代表部署前提已成立。

recut 成品核准、YouTube ready 與 worker 租約介面見 [審閱與worker契約](docs/recut-review.md)，本輪本機候選與驗證結果只看 [目前狀態](../docs/current-status.md)。
## recut 本機試產 CLI

以下工具把兩門指定課程的資料複製到本機，再從既有候選腳本試產一題。開發驗證只用假的模型、媒體與資料庫；實際唯讀 Atlas、呼叫 Gemini 或渲染，須當次授權並確認課程、筆數及呼叫額度。工具不載入 `.env`，連線與金鑰只從指令明確指定的環境變數名稱取得，不輸出其值。

### 從本機影片建立獨立試產資料

沒有既有課程／候選腳本時，使用 `recutBootstrapTrial.js`，不需要 Atlas。準備 JSON：

```json
{
  "trialId": "professor-siri",
  "videoPath": "D:/local/professor-5.mp4",
  "allowedRoot": "D:/local",
  "topic": "Siri 如何處理問題？",
  "startSec": 942,
  "endSec": 1075,
  "sourceSnapshotCache": "D:/local/fresh-source-snapshot.json",
  "authorization": {
    "scope": "local-trial-only",
    "originalAudio": true,
    "reference": "本次使用者允許教授影片的本機試產，尚未完成正式內容同意驗收"
  }
}
```

`trialId` 只接受小寫英數與連字號；目標必須是 loopback 的專用 `recut_trial_<trialId>` DB。視窗須為連續 120～180 秒；程式檢查影片路徑、SHA-256 與明確本機目錄。這只是試產範圍，不會授權發布或宣稱教授內容同意已驗收。

```powershell
node src/scripts/recutBootstrapTrial.js --input D:/AI-workspace/recut/import.json --target-uri-env RECUT_LOCAL_URI
# 明確允許建立本機試產資料後才執行；不呼叫模型、ASR 或渲染
node src/scripts/recutBootstrapTrial.js --input D:/AI-workspace/recut/import.json --target-uri-env RECUT_LOCAL_URI --execute --output D:/AI-workspace/recut/prepared
```

預設 dry-run 不連 DB、不寫檔、不取密碼。`--execute` 只以 insert-only 建立獨立測試教師、課程、影片、手動視窗、候選腳本與授權紀錄，產生後續單題所需的 `topic.json`；重跑不覆寫本機審閱。測試信箱為 `recut-<trialId>@trial.invalid`，預設隨機密碼只雜湊保存、不印出；若首次建立即需要網頁登入，可明確加 `--teacher-password-env RECUT_TRIAL_PASSWORD` 從具名變數取初始密碼。不要在對話、JSON 或命令列貼密碼；重跑不重設既有密碼，也不修改正式帳戶。

`sourceSnapshotCache` 可省略，省略時不捏造逐字稿，後續才執行 RC2 ASR。提供時須是明確的 JSON 快照：`sourceSha256`、`transcriptVersion`、`asrProvenance`、`window.startSec/endSec/segments`、`sentences`、`excludedSentenceIds`。快照需與影片 SHA／視窗相符；保留 fresh ASR 或歷史快取的來源說明，不把歷史快取冒充新辨識。本機 chunk 標籤另加試產 namespace。後續 runtime 仍檢查原片與音量，重新核對 SHA，但不重跑 ASR；截斷邊界句由選段驗證器拒選。沒有模型生成或人工核聽證據時，仍不能稱完成試片或人工驗收。

新辨識路徑也保留逐字正規化證據：只有已成功抽取明確視窗、最後一字為有限 `s===e` 且位於窗尾 50ms 內，才排除該零長度字，保存原始逐字 SHA、排除字／時間／原因與抽取範圍；不補造時間。整個最後句禁選，若另有明確窗頭截斷證據也禁首句。這是保守邊界警告，不代表人工確認截斷；內部零長度、倒序、重疊、超窗或缺少抽取證據仍直接失敗。共用 API／人工編輯的持久排除檢查須由 shared source／schema 整合完成後，才可把同一快照交給網頁審閱與正式試產。

在 backend 目錄執行。先確認本機已有 `mongo:7`，沒有時停止，不拉取映像檔；啟動與停止不刪具名資料卷：

```powershell
docker image inspect mongo:7
docker run --pull=never --detach --name focusflow-recut-local --publish 127.0.0.1:27131:27017 --mount source=focusflow-recut-local-data,target=/data/db mongo:7
docker stop focusflow-recut-local
docker start focusflow-recut-local
```

`RECUT_LOCAL_URI` 與本機後端的 `MONGODB_URI` 均設為 `mongodb://127.0.0.1:27131/recut_trial`；來源用另行提供的 `RECUT_SOURCE_URI`，只讀取 `courses`、`videos`、`video_segments_text`、`questions`、`shortscripts`。課程以兩個明確 ObjectId 篩選；影片含課程所掛載的 `videoIds`，片段只讀這些影片的 native／pipeline 識別碼。沒有複製帳號、憑證、其他課程、向量索引或圖片集合。缺少所需兩門課就停止；複製不是完整帳號搬移，本機教師需已有對應權限。

```powershell
node src/scripts/recutCopyCourses.js --source-uri-env RECUT_SOURCE_URI --target-uri-env RECUT_LOCAL_URI --courses <課程一ObjectId>,<課程二ObjectId>
# 確認 dry-run 的 counts／existing／wouldInsert，取得當次寫入本機授權後，才加 --execute
node src/scripts/recutCopyCourses.js --source-uri-env RECUT_SOURCE_URI --target-uri-env RECUT_LOCAL_URI --courses <課程一ObjectId>,<課程二ObjectId> --execute
node src/scripts/recutSingleTopic.js
```

最後一行只回預估：一般選段、配圖、整段檢查共 3 次模型呼叫，共用上限預設 5 次；每張程式碼圖卡另需 2 次。它不讀資料庫、不建立 adapter、不呼叫模型；token 取決於視窗與回應，無法事前精算。正式呼叫前先看預估，再提供 `--allow-model`；不設 fake provider 作預設。

單題輸入 JSON 需有 `courseId`、`scriptId`（本機已複製的候選腳本），可附固定 `model: {"provider":"gemini","model":"<已核准模型ID>"}` 與 `callLimit`。runtime JSON 需有 `geminiApiKeyEnv`（例如 `RECUT_GEMINI_API_KEY`）、`model`、`browserExecutable`（已有的 chrome-headless-shell 路徑），與 `media: {allowedRoot, ffmpeg, ffprobe, python, transcriber, asrModel}`；各路徑明確指定本機現有檔案，`transcriber` 指向 `short_render/src/align/transcribe_words.py`。Whisper 只離線讀取已有模型，缺少模型就停止，不下載。`maxOutputTokens` 明確限制每次模型輸出，預設 4096，合法範圍 128～16384。

需要程式碼圖卡時，在 runtime JSON 明確設 `codeCards: {"enabled":true}`。CLI 會惰性截取指定句子區間的最多三張本機 PNG，送 Gemini 圖片 parts 做抄錄與複核，每個來源句子區間最多兩次額外模型呼叫；失敗或看不清就用文字圖卡。只有這個獨立辨識路徑就緒時，配圖 schema 才開放請求 `code`，配圖模型不能自己提供程式碼行；其他待審的新元件維持停用。未開啟時回 `optionalMissing: ["codeCards.enabled"]`，明確開啟卻缺截圖轉接時列出 required `missing`。截圖不放進成品，日誌只記圖片指紋／來源秒數，不保存 base64；逐行來源留在 plan，畫面只顯示程式碼內容。

```powershell
node src/scripts/recutSingleTopic.js --input D:/AI-workspace/recut/topic.json --runtime D:/AI-workspace/recut/runtime.json --output D:/AI-workspace/recut/run-one --target-uri-env RECUT_LOCAL_URI --allow-model --render
```

例：指定已複製的 OpenCV 候選題 → RC2 視窗與辨識 → RC3 選段 → RC4 配圖與檢查 → 本機 `final.mp4`、`full-script.txt`、`plan.json`、`run.json`。每一步失敗即停止；模型次數、token 用量及步驟紀錄留在 run。資料庫只接受單一 loopback 主機、明確埠與資料庫名稱，拒絕 SRV、認證、多主機及 query 選項。新的 `recutsources` 快照記錄影片 `activeTranscriptVersion`（缺省 `legacy`）與片段快照，不覆寫來源 chunk。

結果同步寫入本機 `recutversions`、`recutreviewevents`、`shortassets` 與 `recuttrialruns`，更新 `shortscripts.recut` 的版本與成品參照，供 RC8／RC9 讀取。產片後仍停在講稿審閱階段，成品沒有取得核准或發布授權。本機後端另依原有方式啟動，先確認 `MONGODB_URI` 指向上述 loopback DB，關閉不必要的外部服務設定，再開啟教師審閱頁；不要指向共享 Atlas 驗證。

字幕數字對證將阿拉伯／全形／中文數詞正規化後，逐句比對來源，保留正負、小數、百分比與分數的區別；例如「1 個」可改寫為「一個」，不能改為「九百九十九個」。一般詞語「一起／一般／一樣」不當成數量；這層不取代整段語意檢查。可信度修正後也須保留同一個共用池的整段複檢額度，不能只通過 renderer 結構驗證就保存版本。

API 與 CLI 的惰性介面為 `createRecutRuntimeAdapters({...})`，回傳 `decide`、renderer、`sourceOptions.media`、設定轉接及 `missing` 清單，可交給 `createRecutPipeline(...).register(queue)`。建構時不啟動資料庫、程序或模型；provider 與 `probe/decode/measure/transcribe` 不足時明確拒絕。單題工具另用原生 MongoDB driver，避免啟動 Mongoose autoIndex。課程範圍複製採固定集合與原子 insert-only upsert：同 `_id` 的本機文件一律保留，重跑不覆寫教師修改、recut 版次或核准。dry-run 唯讀比較來源與本機，分列 `existing`、`wouldInsert`；執行後另列實際 `inserted`。相較整庫 dump 可避免帶入無關資料，但不搬媒體檔與帳號，寫入中斷可能留下部分本機資料，須修正後重跑，不能當完整備份使用。

### 有當次金額上限的文字試片

試片 runtime JSON 可明確提供 `trialPolicy`，不改產品的全域模型。例：本次核准模型為 `gemini-3.8-flash` 時，設定 `model: {"provider":"gemini","model":"gemini-3.8-flash"}`、`callLimit:5`、`maxOutputTokens:4096`、`thinkingLevel:"low"`、`codeCards:{"enabled":false}`，另設：

```json
{
  "trialPolicy": {
    "modelId": "gemini-3.8-flash",
    "maxCalls": 5,
    "maxRequestBytes": 100000,
    "maxOutputTokens": 4096,
    "budgetUsd": 0.50,
    "inputPerMillion": 0.75,
    "outputPerMillion": 3.75,
    "validUntil": "2026-12-31"
  }
}
```

這組價格是 2026-11-02 當次試片的明確輸入範例，來源為 [Gemini 3.8 官方說明](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8)；未來執行須重新查證並取得該次授權。provider 在每次外呼前核對固定模型、完整 request body 的 UTF-8 bytes、最多呼叫數、輸出上限及累計保守預留金額。用 bytes 作 input token 上界，以上設定的最壞預留為 US$0.4518；這是預留估計，實付仍依回傳 token 與注入價目計算。價格期限過期、缺設定或超額就停，不切模型。

此模式只傳 stage 所需的題目、逐字稿、卡片／施工單與 schema，禁止圖片、原片、工具／grounding、帳戶／密碼、runtime／環境物件及本機媒體路徑。provider 保留 `generateContent`，使用官方 [ThinkingConfig REST 欄位](https://ai.google.dev/api/generate-content#thinkingconfig) 的 `thinkingConfig.thinkingLevel: "LOW"`，不送 `thinkingBudget` 或已移除的 sampling 參數；3.8 不接受 minimal。模型 404 或權限不足會明確失敗，不能以付費試探不同 API 或靜默換模型。`settingsSnapshot`、request 的 `requestedModelId` 與實際請求 URL 都保留當次固定模型。

### 教授單題的單次預算與輸出保護

目前核准的 `trialPolicy` 模式只接受 `gemini-3.8-flash`、LOW、最多 5 次、每次輸出 4096、request body 100000 bytes、US$0.50 上限與上述期限內價目；程式碼圖片與備援模型關閉。目標限 `mongodb://127.0.0.1:27029/recut_trial_professor-siri-YYYYMMDD`，拒絕其他主機／埠／資料庫及 query。教授 DB namespace 本身會強制要求完整政策，刪除或設 null 不能退回一般模式；只允許已審查的 `recutSingleTopic.js` 單題入口，十題 `recutFormalTrial.js` 即使帶完整政策仍拒絕。這是本機教授試片範圍，沒有放寬正式同意或發布檢查。

`recutSingleTopic.js` 在建立 provider 前獨占建立新的 output 目錄，既存目錄一律拒絕，避免覆寫已記錄用量。首次外呼前，原生本機 repository 在 `recuttrialbudgets` 以 **scriptId 作唯一 `_id`** 預留整次核准額度；變更 output、政策或重開程序都不能重置。已有 `recuttrialruns` 成功紀錄也拒絕再預留。預留後失敗或程序中斷仍保留，不退款、不自動清除，也不自動重試模型。此 collection 僅用在明確 loopback 試產 DB，沒有 Shared Atlas 寫入或全域 index／Mongoose schema 變更；dry-run 不建立它。

金鑰只由執行者自己在目前 PowerShell 遮蔽輸入後，放在該視窗的暫時 `GEMINI_API_KEY`。命令只傳**變數名稱**，不可把實際值貼在命令列、JSON、文件或對話。先在相同視窗設定不含憑證的 `RECUT_LOCAL_URI`，使用絕對 `--require` 載入既有 `tests/helpers/noDotenv.cjs`；先 bootstrap `--execute` 建立本機資料，再將其 `topic.json` 交給 single-topic 的 `--allow-model --render`。完成後由執行者清除該視窗金鑰。這些指令不會讓其他終端機或代理取得該視窗的環境變數；不要為了傳遞金鑰去讀 `.env` 或擷取其他程序的環境。

例如 `--output .../run-once` 已存在 → 在 provider 建構前回 `RECUT_TRIAL_OUTPUT_EXISTS`；改成別的 output 但 script 已預留 → 回 `RECUT_TRIAL_BUDGET_ALREADY_RESERVED`，不再呼叫模型。兩種失敗都保留既有證據。FFmpeg、Python 與 HyperFrames 子程序只繼承明列的 OS 路徑及離線／渲染旗標，不繼承 provider 金鑰或資料庫 URI。

### 十題技術試跑與統計

先在本機挑出十個不同主題，準備 topics JSON 陣列；每筆有 `topicId`（英數、底線、點或連字號）、`scriptId`、`courseId`，可加 `operationTimes: [{"phase":"script_review","durationMs":1234}]`。操作階段只接受 `script_review`、`asset_review`、`production_wait`，時間來自實際操作紀錄，不填時維持空值。試跑重用上述 runtime JSON，完全從 loopback MongoDB 讀寫，不自動連 Atlas。

```powershell
node src/scripts/recutFormalTrial.js --topics D:/AI-workspace/recut/topics.json
# 當次授權十題與模型呼叫後，才加 --allow-model；預設包含渲染
node src/scripts/recutFormalTrial.js --topics D:/AI-workspace/recut/topics.json --runtime D:/AI-workspace/recut/runtime.json --output D:/AI-workspace/recut/trial-2026-11-18 --target-uri-env RECUT_LOCAL_URI --price D:/AI-workspace/recut/prices.json --allow-model
```

不提供 `--price` 也可執行，費用維持 null／unknown。價格 JSON 由執行者依當次已查證價目提供：`modelId`、`currency`、`inputPerMillion`、`outputPerMillion`、`asOf`，有快取 token 時另需 `cachedInputPerMillion`；工具不內建價格、不推測匯率，模型不符或用量不完整也不算費用。例：測試價的 input/output 各每百萬 2／4 單位，100 個 input 與 50 個 output 算出 0.0004 單位；此例不是現價。

每題先跑一遍完整單題流程，再在同一份來源快照獨立重跑兩遍第一步，共三遍；採完整流程中尚未被整段檢查修訂的第一步結果比較。十題依序執行；單題失敗就停止該題並保留錯誤代碼，下一題繼續。一般共預估 50 次模型呼叫（每題 3 次完整流程＋2 次選段）；若各次任務均採預設 5 次額度，含重試上限為 150 次，程式碼圖卡另計；token 與費用預估為 unknown。`--no-render` 只適合除錯，這類執行不能當渲染驗收。

統計採每兩次選段的「秒數交集／聯集」再取平均，先合併重疊時間避免重複計數；三次全部無選段時比例為 null，另記回答不了判斷是否一致。標籤差計三次標籤不一致的句數，並保留三組成對比較。成功率分開列生成成功、流程完成與回答不了；渲染時間及三段操作時間各報筆數、中位數與最小／最大值，缺資料不補零。費用包含 thinking 輸出與額外程式碼辨識，並分開列單次生成與穩定度重跑的用量。

只在本次明確指定的 `--output` 目錄產生 `report.md`、`evidence.json` 與各題的施工單、講稿、run 紀錄／mp4。剪接自然度、團隊修改量、教授核准與回答不了判斷正確性均留空由人填。開發測試不在 repo 製造正式證據；實際授權試跑後，再將真實報告依 [RC11b 工單](../docs/04_Features/Short_Video/work-orders/RC11-trial-tooling.md) 登記至 evidence 索引。

辨識與審閱串接需同時使用 [來源介面](docs/recut-source.md)與[選段限制](docs/recut-selection.md)：媒體轉接回逐字與辨識證據，凍結的截斷句禁止清單適用模型與教師修改，不能在前端解除。
