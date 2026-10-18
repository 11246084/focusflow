@AGENTS.md

規則以 AGENTS.md 為準。本檔以下為待遷移的技術參考；與其他文件衝突時，以程式與對應文件為準。

請依需要查閱下列技術內容；功能進度、部署現況、驗收結果與相關日期只看[目前狀態](docs/current-status.md)，技術內容的遷移目標見[待遷移清單](docs/md-audit.md#claudemd-待遷移清單)。

## 接手讀取順序

Claude Code 接手任何 FocusFlow 任務時，先建立上下文，再開始修改：

1. 先讀 [AGENTS.md](AGENTS.md)，確認跨 agent 入口、專案服務與文件索引。
2. 依 `AGENTS.md` 的「按任務選讀」選擇任務相關文件。
3. 依任務類型讀 `.claude/rules` 對應規則。
4. 再讀實際程式碼與測試，避免只根據單一文件或舊會議紀錄推論現況。

注意：
- 功能狀態只看[目前狀態](docs/current-status.md)；資料流與程式入口見[後端技術索引](backend/docs/current-state.md)。
- 執行學生試用相關任務時，依[專用文件入口](docs/04_Features/Student_Pilot_Backend/README.md)查閱規格與任務規則；驗收結果由[目前狀態](docs/current-status.md)追查。
- `docs/20_Architecture/database/archive/MongoDB_契約定版_v1_已過期.md` 僅供歷史參考，不可當成目前資料庫真相。
- `CLAUDE.local.md` 是個人本機偏好，不是團隊共用規範。

## 專屬規則

進行對應任務前，先閱讀規則檔：

| 任務類型 | 規則檔 |
|----------|--------|
| API route / controller / response / error code | `@.claude/rules/api-design.md` |
| Mongoose schema / index / data access | `@.claude/rules/database.md` |
| 測試或 test harness | `@.claude/rules/testing.md` |
| JWT / password / validation / CORS | `@.claude/rules/security.md` |

## 專案概述

**FocusFlow** 是 AI 教學影片問答系統；試用、部署及驗收資訊統一見[目前狀態](docs/current-status.md)。

教師上傳本機影片 → 後端觸發 STT（語音轉文字）處理流程 → 產生文字片段與 embedding（比較內容相似度的數字向量）→ 學生在網頁或 LINE 提問 → 回傳答案與影片時間戳。YouTube 輸入及自動上傳的呼叫與設定條件見[整合流程](backend/docs/stt-integration.md)及[功能開關](backend/docs/feature-flags.md)。

三個服務：

- `backend/` — Node.js / Express REST API，預設 port `4000`
- `frontend/focus-flow/` — React 19 + Vite SPA，預設 port `5173`
- `STT_Whisper/` — Python 影片處理指令工具；執行時可能呼叫模型、資料庫及後端

技術細節見[後端技術索引](backend/docs/current-state.md)。

## 常用指令

### Backend

首次設定：

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

常用指令：

```powershell
npm start
npm run seed
npm run seed:reset
npm run db:sync-atlas
npm test
node --test --experimental-test-isolation=none --test-concurrency=1 tests\<file>.test.js
npm run docs:lint
```

注意：

- `npm run seed` 是 converge baseline，不清除既有資料。
- `npm run seed:reset` 會保守清除 demo-owned / demo-derived 痕跡後重建。
- `db:ensure-questions`（建立 `questions` 並同步 indexes）、`db:backfill-questions`（預設 dry-run，加 `-- --write` 才寫入）的 script 檔都存在；兩者都會寫共享 DB，對 Atlas 執行前需確認目標。
- Swagger UI 掛在 `/docs`，raw spec 掛在 `/docs/openapi.yaml`，repo 規格檔在 `backend/docs/openapi.yaml`。
- OpenAPI 是 `/api/v1/*` 與 `/health` 的公開 API contract，涵蓋每一個實際註冊的 route；`tests/docs.routes.test.js` 從 runtime router 盤點並比對 missing／stale／method／path 參數／重複註冊，新增或刪除 route 沒同步 `openapi.yaml` 會讓 `npm test` 失敗。刻意不收錄的端點列在該測試的 `UNDOCUMENTED_BY_DESIGN`（internal processing webhook ×3、`GET /api/v1/line/webhook`），每筆要附理由。
- `npm run docs:lint` 以 Redocly（devDependency 固定 2.54.2，設定在 `backend/redocly.yaml`）檢查 spec 結構與 example 是否符合 schema；不併入 `npm test`。逐筆例外寫在 `backend/.redocly.lint-ignore.yaml` 並附理由。

### Frontend

```powershell
cd frontend\focus-flow
npm install
Copy-Item .env.example .env
npm run dev
```

以下是前端檢查指令；是否執行由 [AGENTS.md 的驗證規則](AGENTS.md#驗證依變更影響選擇)依變更影響決定：

```powershell
npm test
npm run lint
npm run build
```

### AI Pipeline

```powershell
cd STT_Whisper
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python src/main.py --limit 1
```

Backend 自動觸發 pipeline 時會優先使用 `STT_Whisper/.venv/Scripts/python.exe`。YouTube URL MVP 需要 `yt-dlp`，已列在 `STT_Whisper/requirements.txt`。

## Backend 架構

遵循 `routes -> controllers -> services -> models`：

```text
backend/src/
├── server.js          # 連 DB、seed、啟動 Express
├── app.js             # Express 設定、middleware、docs、route mount
├── routes/            # auth、course、video、qa、line、stats、admin、health、internal-video
├── controllers/       # HTTP request/response layer
├── services/          # 業務邏輯
├── models/            # Mongoose schema
├── middleware/        # auth、role、upload、LINE signature、error handling
├── config/            # env.js、database.js
├── constants/         # enum / lifecycle constants
├── utils/             # apiResponse、AppError、ObjectId helpers
└── scripts/           # seedDemoUsers、syncLocalMongoToAtlas、syncQuestionsToAtlas
```

Controllers 不放主要業務邏輯；新增或修改行為時，優先把規則寫進 service，controller 只負責輸入、呼叫 service、回應。

## Runtime 與環境變數

設定名稱與預設值見[環境設定程式](backend/src/config/env.js)及[範例檔](backend/.env.example)。以下是設定組合範例，不代表部署環境的實際值：

```env
QA_QUERY_EMBEDDING_PROVIDER=gemini
QA_VECTOR_SEARCH_MODE=atlas
QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index
QA_ATLAS_FILTER_MODE=bridge_course_or_video
QA_ANSWER_PROVIDER=gemini
GEMINI_CHAT_MODEL=gemini-3.5-flash
QA_MATCH_LIMIT=15
DEMO_SEED_ENABLED=false
```

重要邊界：

- Atlas 是雲端 MongoDB 服務；查詢前需核對 `video_segments_text` 的向量維度、`text_embedding_index` 定義與可用性。缺少索引時，先回報並依 AGENTS.md 的資料庫授權邊界處理；查證結果只寫在[目前狀態](docs/current-status.md)。
- 本機無 API key smoke 可改成：

```env
QA_QUERY_EMBEDDING_PROVIDER=mock
QA_ANSWER_PROVIDER=template
QA_VECTOR_SEARCH_MODE=memory
```

- `QA_ANSWER_PROVIDER=gemini` 時必須設定 `GEMINI_API_KEY`；缺 key 不會 fallback，會直接回設定錯誤。
- `QA_VECTOR_SEARCH_MODE=atlas` 搭配 `QA_QUERY_EMBEDDING_PROVIDER=mock` 是不合法設定。
- `QA_MATCH_LIMIT` 控制檢索片段數量；比較設定或回答提示詞的效果前，要區分重新生成與快取命中。清除課程快取的介面為 `DELETE /api/v1/courses/:courseId/faqs`，執行前確認授權與目標課程；相關限制與查證結論見[目前狀態](docs/current-status.md)。
- `/health` 是判斷 `runtime.qa`、`runtime.line`、`runtime.youtubeUpload` 是否 ready 的入口，不要只看 `.env` 推測狀態。YouTube 憑證是否有效、scope 夠不夠轉 private，都要看 `/health.runtime.youtubeUpload`，不要憑 `.env` 有填就當作可用。

## 部署與對外連線（VM）

VM 是執行服務的虛擬主機；本節保留部署與排錯參考，實際主機、網址、憑證、連線結果與驗收日期只看[目前狀態](docs/current-status.md)。

[部署流程設定](.github/workflows/deploy.yml)在 push 到 `main` 時觸發：進入 `/opt/focusflow` 拉取程式 → 安裝後端套件 → 打包前端 → 執行 `restorecon` 還原檔案的安全標記 → 以 PM2 重啟後端並讓 nginx 重讀設定；PM2 管理 Node.js 程序，nginx 提供網頁與 API 轉送。流程也傳入部分環境設定並進行服務檢查；不能由設定檔存在推定實際部署成功。

- `.env` 不隨 Git 同步；主機上的設定檔與部署流程傳入的環境變數都需核對，診斷時以程序實際設定與 `/health` 回應為依據。
- nginx 參考位置為 `/etc/nginx/conf.d/focusflow.conf`；需檢查前端檔案位置、`/api/` 轉送、`upload_size.conf` 與 `client_max_body_size`，上傳收到 413 時先核對大小限制。這些主機檔案的實際內容須另行查證。
- 檢查 HTTPS 回應標頭時，注意 nginx 的 `add_header` 繼承範圍；若在 `location` 區塊自行設定，不能假設仍沿用外層全部標頭。
- 憑證操作參考包含 `/etc/nginx/ssl/focusflow.crt`、`focusflow.key`、`/opt/acme.sh` 與 TLS-ALPN-01（透過加密連線驗證網域控制權的方式）；操作前查閱[憑證申請與回復步驟](docs/40_Operations/deployment/2026-09-10_Lets_Encrypt憑證申請紀錄.md)。核對執行帳號、續約排程及是否會暫停 nginx，不能把舊設定當成目前排程。
- 查 HTTP 連線可用 `curl -v http://<主機>`，避免只用會自動改成 HTTPS 的瀏覽器；若需判斷封包是否到達主機，可在授權環境用 `tcpdump -ni <網卡> 'tcp[tcpflags] & tcp-syn != 0 and dst host <主機IP> and (dst port 80 or dst port 443)'` 觀察。tcpdump 是封包檢查工具，須先確認網卡、篩選條件及權限。
- LINE 回報網址若使用 ngrok（將外部連線轉送至本機服務的工具），需核對 `ngrok.service`、轉送目標與 LINE 平台設定；不要把暫時網址當成固定部署網址。
- CORS 是限制瀏覽器跨網站請求的規則；檢查允許與不允許的來源所收到的 `Access-Control-Allow-Origin` 回應，不由設定名稱推定結果。
- 在主機內可用 `curl localhost:4000/health`，或由管理員「系統服務」頁呼叫 `GET /api/v1/admin/system-status`；外部 `/health` 是否轉送須核對 nginx 設定。

## QA / Video / LINE 邊界

### QA Provider

支援：

- `QA_QUERY_EMBEDDING_PROVIDER`: `mock` | `openai` | `gemini`
- `QA_ANSWER_PROVIDER`: `template` | `openai` | `gemini`
- `QA_VECTOR_SEARCH_MODE`: `memory` | `atlas`

QA 與 LINE Bot 提問都會寫入 `questions` collection，並保留 matches、runtime 與 `sourceUsageLogId`。

### FAQ 快取

`askQuestion` 內建兩層 FAQ 快取（`faqs` collection + `faqCache.service.js`，API 與 LINE 共用）：正規化文字完全相同直接命中（零 token）；否則以 query embedding 對課程 FAQ 比 cosine 相似度 ≥ `FAQ_CACHE_SIMILARITY_THRESHOLD`（預設 0.95）命中，跳過向量搜尋與 LLM。命中時 `runtime.faqCache.hit=true`、`answerProviderUsed='faq_cache'`，仍照常寫 `usage_logs` 與 `questions`。只快取 runtime ready 且無對話歷史的回答；影片刪除／重新處理完成／課程刪除會自動清該課程快取。修改 QA 回應格式時，快取命中路徑（`respondFromFaqCache`）需同步；測試要走非快取路徑可設 `FAQ_CACHE_ENABLED=false` 或避免同題重問。

自動失效時機（`faqs` 無 TTL，只有事件驅動失效）：影片刪除、影片重新處理完成、課程刪除、影片掛載到課程（`attachVideoToCourse`）、影片自課程移除（`detachVideoFromCourse`）。另有容量淘汰：單一課程超過 `FAQ_CACHE_MAX_ENTRIES_PER_COURSE` 時砍 `hitCount` 最低的。

「答不出來」的回覆不會被快取：`answerGeneration.service.js` 的 `isNoAnswerReply()` 比對兩個罐頭字串（`NO_ANSWER_INSUFFICIENT` / `NO_ANSWER_UNDETERMINED`），命中時 `shouldSaveFaq` 為 false。修改 prompt 的罐頭文案時改常數，不要改 prompt 內的字面字串。

[回答提示詞](backend/src/services/answerGeneration.service.js)只插入 `NO_ANSWER_INSUFFICIENT` 一句，且觸發條件收斂成「所有片段都沒有提到問題的主題」；`NO_ANSWER_UNDETERMINED` 留在 `isNoAnswerReply()` 只為了辨識改版前留下的舊答案，不要再把它寫回 prompt。

調整設定、模型或 prompt（提供模型的回答指示）後，測試時需排除舊快取影響；清除操作見前述介面，相關缺口與改善進度只看[目前狀態](docs/current-status.md)。

### Video Model

`videos` collection 是 mixed collection：

- App-owned video：有 `courseId`、`uploadedBy`、`title`、`processing.status`
- Pipeline metadata：有 `video_id` 或 `videoId`，但不是 app-owned

文字片段查詢的權限範圍由[範圍服務](backend/src/services/bridgeScope.service.js)建立：

```text
課程可存取影片 -> String(videos._id) -> video_segments_text.videoId
```

`videoId`／`video_id` 可參與影片資料的查找，但文字片段的允許集合由 `addVideoIdentifiers` 只加入影片 `_id`；不能把影像片段的識別碼規則套到文字查詢。實際欄位分布與資料涵蓋範圍只由[目前狀態](docs/current-status.md)追查。

影像片段以 `video_segments_video.video_id = String(videos._id)` 綁定課程影片；[影像工具](STT_Whisper/src/video_multimodal_pipeline.py)使用 `--video-path`、`--video-id` 與 `--upload`，舊 `video_001` 類識別碼另有檔名／路徑配對邏輯。並行檢索、文字查無結果的影像備援及來源引用限制見[功能開關](backend/docs/feature-flags.md)，不另記功能完成度。

### Processing State Machine

影片處理由 `videoProcessing.service.js` 強制狀態轉換：

| 操作 | 前置狀態 | 目標狀態 |
|------|----------|----------|
| retry | `failed` | `queued` |
| start webhook | `queued` | `processing` |
| complete webhook | `processing` | `completed` |
| fail webhook | `queued` 或 `processing` | `failed` |

非法轉換回 `409 VIDEO_PROCESSING_TRANSITION_INVALID`。

### LINE Bot

LINE Bot 在 `User` 上維護：

- `lineConversationState`
- `lineConversationHistory`：依 `MAX_CONVERSATION_TURNS × 2` 保留近期訊息，見[截取邏輯](backend/src/services/line.service.js)及[設定定義](backend/src/config/env.js)
- `activeCourseId`

切換課程時，[LINE 服務](backend/src/services/line.service.js)只列有效修課且課程為 `published` 的選項，選單最多顯示 4 筆；課程已發布不等於使用者有修課權限。

LINE 的回報網址與憑證依部署環境設定；連線與驗收結果只看[目前狀態](docs/current-status.md)。

## 測試規範

驗證範圍依 [AGENTS.md](AGENTS.md) 的「驗證依變更影響選擇」；以下為工具指令，不表示每次修改都跑全套。純文件只檢查文件，單一行為先跑受影響測試；跨模組、共用 harness 或發布準備跑全套，保留 CI 與任務驗收門檻。

### Backend

測試位於 `backend/tests/`，使用 Node 內建 `node:test`。route tests 透過 `tests/helpers/backendTestHarness.js` 的 in-memory store，不依賴真實 MongoDB。

跨模組或發布準備時執行 Backend 全套：

```powershell
cd backend
npm test
```

單一模組修改使用對應測試；若無其他受影響範圍，不必再重跑全套：

```powershell
node --test --experimental-test-isolation=none --test-concurrency=1 tests\<file>.test.js
```

### Frontend

測試位於 `frontend/focus-flow/tests/`，使用 `node:test`。Frontend 完整驗證指令（依影響選擇）：

```powershell
cd frontend\focus-flow
npm test
npm run lint
npm run build
```

### AI Pipeline

測試位於 `STT_Whisper/tests/`（unittest）。Pipeline 完整驗證指令（依影響選擇）：

```powershell
cd STT_Whisper
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
```

若變更依賴 FFmpeg、外部模型或 API key，回覆中需說明是否實際驗證。

## 開發原則

- 變更範圍、程式結構與刪除授權依 [AGENTS.md 的工作邊界](AGENTS.md#工作邊界)。
- 新增 API 時維持 request/response 格式一致，補基本輸入驗證與清楚錯誤碼。
- 修改 schema、index、資料存取前，先讀 `.claude/rules/database.md`。
- 涉及 JWT、密碼、CORS、LINE signature、外部 webhook secret 前，先讀 `.claude/rules/security.md`。
- 建立 git commit 時，作者一律使用本人的 git 身分，不要加 `Co-Authored-By: Claude`、`Claude-Session` 等 AI trailer（雲端 session 也適用）；AI 協助的揭露統一記在系統手冊的 AI 使用紀錄（`docs/01_系統手冊/README.md` 的「AI 輔助產出說明」），不放在 commit 訊息。

## 文件更新

修改功能時，檢查是否需要同步：

- [README.md](README.md)
- [docs/current-status.md](docs/current-status.md)
- [backend/docs/current-state.md](backend/docs/current-state.md)
- [backend/docs/openapi.yaml](backend/docs/openapi.yaml)
- `backend/.env.example`
- `frontend/focus-flow/README.md`
- `STT_Whisper/README.md`

是否更新文件與回報理由，依 [AGENTS.md 的文件規則](AGENTS.md#文件規則)；上列文件依各自用途維護，不重複記錄功能進度。

## 不能誤稱的邊界

功能完成度、部署狀況、資料查證與歷史驗收只看[目前狀態](docs/current-status.md)；本節只保留技術限制。

- Atlas 查詢需要核對索引、模型與資料契約；檢查 `listSearchIndexes` 的結果及 `/health` 診斷，不把環境變數有值視為服務可用。
- 腳本與上傳受不同開關控制；關閉腳本介面不會關閉學生短片牆，詳見[功能開關](backend/docs/feature-flags.md)。
- OAuth 是授權系統使用 YouTube 帳戶的機制；上傳需核對 `YOUTUBE_UPLOAD_ENABLED` 與憑證，刪除後轉為私人影片還需符合[上傳服務](backend/src/services/youtubeUpload.service.js)的權限檢查。`youtube.force-ssl` 是程式接受的權限之一，只有 `youtube.upload` 不足以轉私人影片；完整權限清單以服務內的 `PRIVACY_CAPABLE_SCOPES` 為準。帳戶授權、權杖及外部驗證結果由狀態正本追查，不由本檔推定。
- `privatizeVideoOnDelete` 只處理 `youtubeUpload.status === 'uploaded'` 的影片；轉私人影片失敗會記錄錯誤，但不中斷系統刪除，所以不能保證刪除資料後 YouTube 影片必定下架。
- `unlisted` 是知道連結即可觀看的 YouTube 隱私設定；課程頁的存取權限不能阻止取得連結的人轉貼。上傳隱私設定與播放限制見[YouTube 契約](backend/docs/phase2-api-contract.md#4-youtube-系統帳號上傳流程)。
- 影像查詢與文字生成的分工見[功能開關](backend/docs/feature-flags.md)，實際資料涵蓋與驗收由狀態正本追查。
- [路由規格測試](backend/tests/docs.routes.test.js)比對方法與路徑；Redocly 檢查規格格式與範例，不能代替請求／回應與實作的一致性驗證。內部處理通知不列入公開 OpenAPI。

例：調整問答設定 → 核對程序設定與診斷回應 → 在授權環境測試並排除快取影響 → 將驗證日期與結果寫入狀態正本。
