# YouTube Q 本機整合驗證

這份文件記錄 F3／F4 複驗與 Q-A～Q-F 的本機證據。完成範圍以[目前狀態](../../../current-status.md)為準；本輪沒有連正式 Atlas、VM 或 YouTube，也沒有 push、部署或啟用正式開關。

## 基底與分工

F3／F4 以 `b2feceb` 提交，獨立複驗 61 項通過後，以 `6cd381b` 合併至 dev。Q 使用 `wip/yt-q-integration` 共用整合分支，按模組劃定檔案所有權，避免切換多個工作樹覆蓋尚未提交成果；分塊提交由主 agent 統一處理。

- 主 agent：Q-0 schema、跨模組接口、Q-D 管理 API／OpenAPI、Q-F 整合與文件。
- Sol worker：Q-A 上傳可靠性、租約、等待、傳送階段與隔離恢復。
- Sol worker：Q-B 就緒判定、隱私保護與清理條件。
- Terra worker：Q-C 受保護播放／容量與 Q-E 前端。
- 未參與實作的 Sol reviewer：F3／F4 複驗，後續 Q 獨立差異審查。

## 契約差異處理

- 上傳狀態查詢沿用較新的 #57 與 Q-0 保守界線：只有 201＋影片 ID 且通過自家頻道驗證才自動套用。較早 #49 的裸 200＋ID 描述不擴大本輪自動套用；200＋override 308 仍為未完成。
- 恢復佇列保留 #45 的影片先、短片後；各來源按 queuedAt／_id 排序，管理員試傳從全部 waiting 選最早一支。
- 舊清理 fixture 明確建立 ready／已切換與 readyAt；沒有為了通過舊測試放寬正式刪檔條件。

## 隔離邊界與重播

Node `v22.23.4`。Mongo 使用本機快取 `mongo:7`、本輪專用容器 `focusflow-youtube-q-20261028`，只綁 `127.0.0.1:27131`、replica set `ffQ`。每個 suite 使用隨機 `focusflow_youtube_test_*` 資料庫，`autoIndex/autoCreate=false`，顯式建立必要測試索引並在 finally 清除。`directConnection:true` 避免連向容器 advertised 的 localhost:27017。YouTube 只使用注入的假 fetch；檔案只使用自建暫存來源。

```powershell
$env:YOUTUBE_TEST_MONGODB_URI='mongodb://127.0.0.1:27131'
npm.cmd run test:youtube-mongo
npm.cmd run test:youtube-q-mongo
npm.cmd test
npm.cmd run docs:lint
```

Frontend 在 `frontend/focus-flow` 執行 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`。原始日誌放在本機 `backend/q-*.log` 與外部工作目錄，不將測試暫存檔提交。

## 驗證結果

| 驗證 | 結果與範圍 |
|---|---|
| F3／F4 獨立複驗 | Backend 35／35、Frontend 26／26；原作者全套及瀏覽器證據沿用。 |
| F0～F4 與 Q-A 隔離 Mongo | 78／78；含原 68 項及 Q-A 10 項，沒有 skip。 |
| Q-B 隔離 Mongo | 7／7；四個獨立 Backend 對 16 支公開影片只送出 10 次隱私更新，舊 null／缺省、過期結果及切換不覆蓋 guard。 |
| Q-C 隔離 Mongo | 7／7；容量 CAS、中斷、ENOSPC、批次第二次 rename 失敗、持續傳輸／閒置與 heartbeat 釋放交錯。固定可用空間 provider 避免同機 Docker 寫入造成 fixture 波動，Mongo 與檔案真實。 |
| Q-F 完整生命週期 | 2／2；原片播放→額度等待→session_saved 中斷安全接手（換 attempt、不扣次數）→單支試傳→processing→ready→預告／同輪重查／清理；另做 public→private 讀回／稽核→admin unlisted→ready。 |
| Frontend | 158／158；lint 零錯誤／警告、build 通過。既有 bundle 超過 500 KB 提示仍在。 |
| 本機瀏覽器 | Chrome、Edge 各完成教師／管理員／學生、相容 H.264 起播與拖曳到 3 秒、不相容提示、原片 409 後假 YouTube 同位置續播，以及 100／101／150 訊息；播放器競態各 7／7。 |
| 媒體篩選 | 本機 ffmpeg 產生 H.264 與 HEVC MP4，實際 ffprobe 得 compatible=true/h264 與 false/hevc，均 moovFirst=true。 |
| 獨立審查 | 未參與實作的 Sol reviewer 複驗三項 P2 修復，Backend 26／26、Frontend 10／10，未找到新增 P1／P2。 |

最後完整 Backend `npm.cmd test` 執行 **1280** 項：**1278 pass／1 fail／1 skip**，耗時約 20 分 38 秒。唯一失敗是 `system-status-security.test.js` 仍斷言 switches.length=3；改按 key 檢查正式四開關後，該檔 **13／13 pass**（`q-system-status-final.log`），沒有未解失敗。沒有為只改一個契約斷言而第三次重跑其餘已通過測試；不能將此紀錄寫成單次完整命令零失敗。skip 是 Windows 不允許建立 file symlink，已以 junction 驗越界拒絕。

`q-backend-final.log` 為最後全套原始輸出，`q-system-status-final.log` 為最後失敗複驗，`q-f-integration-final.log` 為 78 項隔離 Mongo，`q-storage-final.log` 為 7 項儲存，`q-full-lifecycle-final.log` 為最後完整生命週期。第一次整合為 1248 pass／24 fail／1 skip：失敗為既有測試仍預期公開 uploads、三個開關、未就緒即上架／清理及目錄計數；逐項保留測試原本目的並按 Q 契約更新，對應四檔 85／85 通過。全套重新驗證不將第一次失敗隱藏。

儲存新整合重播曾因 fixture 改為禁止外連後連 loopback 都被假 fetch 擋下，及實際主機磁碟波動造成五項失敗；改為精確 loopback fetch 與固定可用空間後，受影響七項全數通過。這兩項是測試隔離問題，沒有放寬正式容量守衛。

## 獨立審查修復

1. 等待 Mongo 容量預約時客戶端已斷線：先監聽 aborted，token 到手立即釋放、不啟動 multer。審查者同一個真 loopback 重現由 releaseCount=0 變為 1。
2. upload／recovery 關閉時每日隱私檢查停掉：改為獨立的 remote state scheduler，interval=0 仍每五分鐘排程；processing 每輪檢查、已就緒每日檢查，privacy_guard 只控制自動改隱私。驗證 stop、restart、舊 tick 與 inFlight 不重入。
3. 播放錯誤的延遲回應跨課程覆寫同 index：播放選取使用物件世代，每次 HEAD／GET／catch 及狀態 updater 再核對；課程列表另用 request epoch，A→B→A 舊回應也拒絕。

## 瀏覽器證據與重播

可維護腳本：[三角色與播放](../../../../frontend/focus-flow/integration/youtubeQ.browser.py)、[延遲回應競態](../../../../frontend/focus-flow/integration/youtubeQPlaybackRace.browser.py)。原始截圖、JSON、日誌與自建媒體保存在 `D:/AI-workspace/04_Workbench/youtube-q-20261029`；沒有把二進位媒體或 scratch 加進 Git。主 agent 目視檢查管理員與學生畫面。

重播先於本機啟動 Vite `npm.cmd run dev -- --host 127.0.0.1 --port 5193`，使用已具 Playwright 的 Python 環境；設定 `YOUTUBE_Q_OUTPUT_DIR` 指向含 compatible.mp4 的上述目錄，`QE_BROWSER` 指向本機 Chrome 或 Edge executable，`QE_BROWSER_LABEL` 設 chrome 或 edge，再從 repo 根目錄執行兩支 Python。腳本攔截所有 API／媒體，非 loopback 請求全部拒絕；不啟動真後端或連 YouTube。

`backend/docs/implementation-log.md` 是 repo 明確忽略的個人檔，本輪只在本機連至狀態正本，沒有將個人日誌升為團隊文件；維護中的入口與驗證證據已同步。


## 本機提交

| 內容 | Commit |
|---|---|
| F3／F4 實作 | `b2feceb` |
| F3／F4 合併至 dev | `6cd381b` |
| Q 共用 schema／預設關閉設定 | `3dc8c92` |
| Q-A～Q-D 後端、API 與測試 | `ae8d22b` |
| Q-E 前端與瀏覽器重播腳本 | `5a0ee05` |

提交使用本機 Weihao 的 author／committer，沒有 AI trailer；最終文件提交與 dev merge 以 Git 紀錄追溯，沒有 push。主 checkout 的 `.claude/launch.json`、並行的 Multimodal_Retrieval 與 LINE_Binding 文件／HANDOFF 未加入本次提交。整合前 dev 另有 `6e1b825` 的 grilling skill 提交，屬獨立工作，使用正常 merge 保留，不重寫分支。

真實 STT／語音模型未重跑：本輪未改 Pipeline，重新處理排程依 F3 隔離證據；FFmpeg／ffprobe 只用於本機自建測試媒體。Windows file symlink 因權限限制 skip，已用真實 junction 驗證越界拒絕；Linux nginx 的檔案傳送仍待正式環境授權。

## 正式環境與設備待驗

依[Q 工單](../work-orders/Q-quota-playback-plan.md)與[部署程序](../../../10_Operations/deployment/部署與連線排錯.md#youtube-q-原片暫存播放與部署順序)逐項另行授權。正式 YouTube insert 隱私讀回、嵌入起播與拖曳、nginx internal／500 MB／中斷／507／20 個 Range、VM 容量及程序設定、Edge／Firefox／iOS Safari 的實機媒體矩陣均需獨立記錄。Windows junction 已可測；無符號連結權限的 file symlink 不偽列通過。
