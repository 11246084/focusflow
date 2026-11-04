# 原片暫存與授權播放：技術研究

影片在 YouTube 可以播放之前，伺服器上的原片是學生唯一能看的版本；這份文件保存「怎麼讓有權限的學生安全觀看、又不讓原片無限累積」的技術依據。設計決策只記在 [decisions.md](decisions.md) 的 #61～#64；額度與上傳可靠性的研究見[額度研究](quota-upload-research.md)。目標是過渡期的安全播放，不是建立永久的影片儲存平台。

最後查證：2026-10-26；FocusFlow 對照 `dev` @ `c52682f`。證據等級標註同[額度研究](quota-upload-research.md#證據等級)。

## 1. 現況

| 項目 | 內容 | 來源 |
|---|---|---|
| 原片存放 | multer 存到 `UPLOAD_DIR`，檔名為 `時間戳-原始檔名`，單檔上限 500 MB；先寫檔、再進入服務處理 | [upload.middleware.js L13-L40](../../../backend/src/middleware/upload.middleware.js#L13) |
| 播放網址 | 上傳時把 `sourceUrl` 與 `videoUrl` 設成 `/uploads/<檔名>` | [video.service.js L452](../../../backend/src/services/video.service.js#L452) |
| 公開路徑 | `app.use('/uploads', express.static(env.uploadDir))`，不需登入 | [app.js L45](../../../backend/src/app.js#L45) |
| 正式站 | nginx 沒有轉送 `/uploads`，回前端首頁；學生看不到未上 YouTube 的影片 | [cookie 上線紀錄](../../10_Operations/deployment/2026-10-25_httpOnly_cookie認證上線紀錄.md) |
| 前端 | 只有學生頁用 `/uploads/` 播放原片；教師與短片頁不用 | [StudentCourses.jsx L104](../../../frontend/focus-flow/src/pages/StudentCourses.jsx#L104) |
| 登入 | 瀏覽器用 HttpOnly cookie；GET／HEAD 不檢查 CSRF，所以 `<video src>` 的同來源請求可直接驗證 | [auth.middleware.js L13-L34](../../../backend/src/middleware/auth.middleware.js#L13)、[安全規範](../../../.claude/rules/security.md) |
| 課程權限 | `canAccessCourse`：admin 全部、教師限自己的課、學生需課程已發布且有效選課 | [courseAccess.service.js L59-L77](../../../backend/src/services/courseAccess.service.js#L59) |
| 版本 | Express 4.22.1、send 0.19.2（`sendFile` 預設接受單一 Range） | `backend/node_modules`（2026-10-26 查詢） |
| 空間 | 正式 VM `/opt/focusflow/backend/uploads` 所在磁碟 48 GB、已用 18 GB、可用 30 GB（2026-10-22 `df -h`）；`fs.statfs` 已用於清理與 `/health` | [YouTube 上線紀錄](../../10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)、[youtubeLifecycle.service.js L74](../../../backend/src/services/youtubeLifecycle.service.js#L74) |
| 轉檔工具 | VM 已安裝 `ffmpeg` 7.1.5（語音轉文字流程使用）；後端目前不呼叫 `ffprobe` | [VM 資安檢查報告](../../10_Operations/deployment/2026-10-23_VM資安檢查報告.md) |
| 容器檢查 | 上傳時已檢查 MP4／MOV 的 `ftyp`、`mdat`、`moov` 是否存在，以及 MKV 結構；不檢查編碼 | [mediaIntegrity.service.js](../../../backend/src/services/mediaIntegrity.service.js) |
| nginx | 設定在 `/etc/nginx/conf.d/focusflow.conf`，另有 `upload_size.conf` 設定 `client_max_body_size`；`proxy_request_buffering` 與暫存目錄未記錄 | [部署與連線排錯](../../10_Operations/deployment/部署與連線排錯.md) |
| CPU／記憶體 | 未記錄 | 待驗證 |

## 2. 官方依據

- nginx `internal`：只接受內部請求，外部直接請求回 404；內部請求包含上游回應的 `X-Accel-Redirect` 標頭（**官方**，[ngx_http_core_module](https://nginx.org/en/docs/http/ngx_http_core_module.html#internal)）。
- nginx `sendfile`、`aio`、`directio` 適合大型影片檔；`max_ranges` 預設不限制 Range 數量（**官方**，同上）。
- nginx `proxy_request_buffering` 預設 `on`：先讀完整個請求內容再轉給後端；超過緩衝區的部分寫入暫存檔（**官方**，[proxy 模組](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering)、[core 模組 `client_body_buffer_size`](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_body_buffer_size)）。
- nginx 關閉 `proxy_request_buffering` 時，請求內容一收到就轉給後端；但用戶端以 HTTP/1.1 chunked 傳送時，除非對後端也用 HTTP/1.1，否則仍會緩衝（**官方**，同上）。
- Node.js 22 的 `server.requestTimeout` 預設 300000 毫秒（5 分鐘），超過就中斷請求；`server.js` 沒有另外設定（**測試**，本機 Node 22.23.4 讀取預設值，2026-10-26）。500 MB 檔案在低於約 14 Mbps 的上傳速度下會超過 5 分鐘。
- 原生 HLS：Safari（macOS 6+、iOS 3.2+）、Chrome 桌面版 142+ 與 Android 支援；Firefox 桌面版不支援，需靠 Media Source Extensions 加 hls.js（**官方資料彙整**，[caniuse](https://caniuse.com/http-live-streaming)，2026-10-26 查詢）。MPEG-DASH 沒有瀏覽器原生支援，需 dash.js（推論，依各瀏覽器文件）。
- 編碼相容性：MP4 容器加 H.264（AVC）與 AAC 是所有主要瀏覽器都支援的組合；HEVC 依作業系統與硬體而定，Windows 上的 Chrome 需要硬體解碼（**官方**，[MDN 視訊編碼指南](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs)）。教師可上傳 `.mov`、`.mkv`、`.webm`（[youtubeUpload.service.js L138-L144](../../../backend/src/services/youtubeUpload.service.js#L138)），其中 MKV 與 iPhone 錄的 HEVC 不保證能在瀏覽器播放。
- Express `sendFile` 由 `send` 模組處理：支援單一 Range，多段 Range 當成一般回應；以串流讀檔（**開源**，`node_modules/send/index.js` L605-L680）。

## 3. 方案比較

| 方案 | 權限 | Range／拖曳 | Node 負擔 | 新元件 | 判斷 |
|---|---|---|---|---|---|
| A 開放 nginx `/uploads` | 無 | nginx | 無 | 無 | 不可：任何人猜到檔名就能下載 |
| B Express 驗權限後 `res.sendFile` | 每次請求 | `send` 支援單一 Range | 影片資料全部經過 Node | 無 | 本機開發用 |
| **C Express 驗權限 → `X-Accel-Redirect` → nginx `internal` 送檔** | 每次請求 | nginx 原生 | 只處理驗證，不經手資料 | 無（沿用 nginx） | **正式環境採用** |
| D 簽名網址＋nginx `secure_link` | 簽發時一次 | nginx | 最少 | nginx 模組設定與簽章密鑰 | 不採用：撤銷選課要等網址過期；設定較多 |
| E nginx `auth_request` 子請求 | 每次請求 | nginx | 每次多一個子請求 | 無 | 可行，但要把影片 ID 對應到檔案，比 C 複雜 |

## 4. 負載與儲存（推論）

- 瀏覽器播放 `<video>` 時，開始播放與每次拖曳各發一次 Range 請求，其餘資料在同一個回應中串流；每次請求都會經過一次權限驗證（約 4～5 次資料庫查詢：使用者、登入紀錄、影片、課程、選課）。
- C 方案中 Node 不經手影片資料，同時觀看人數主要受 VM 對外頻寬與磁碟讀取限制，不受 Node 記憶體限制。
- 切換到 YouTube 後停止對學生提供原片（#61），伺服器只承擔過渡期的播放。
- 原片累積：單檔 500 MB、可用約 30 GB，大約 60 支未上 YouTube 的影片就會用完；所以 #63 在空間不足時停止收件，而不是刪除。

## 5. 待驗證（播放與儲存）

| 項目 | 類型 | 驗證方式 |
|---|---|---|
| nginx 以 `X-Accel-Redirect` 送檔時，上游的 `Cache-Control`、`Content-Disposition` 是否保留 | 推論 | 正式設定前在本機或 VM 用 `curl -I` 確認；不保留就在 `internal` 位置用 `add_header` 設定（注意 `add_header` 的繼承範圍，見[部署與連線排錯](../../10_Operations/deployment/部署與連線排錯.md)） |
| VM 對外頻寬與同時觀看上限 | 未驗證 | 經授權後於維護時段，以 20 個並行的 Range 請求測試回應時間；結果記入上線紀錄 |
| 拖曳時的權限驗證延遲是否可接受 | 推論 | 本機以學生帳號拖曳播放，記錄每次 Range 請求的延遲 |
| nginx 設定變更 | 需授權 | 新增 `internal` 位置屬正式環境變更，先 `nginx -t`，部署時由使用者授權 |
| VM 的 CPU 核心數、記憶體 | 未驗證 | 在 VM 執行 `nproc`、`free -h`（唯讀）；#64 重新評估 HLS 時需要 |
| nginx 請求暫存目錄是否和 `uploads/` 同一個磁碟、目前 `proxy_request_buffering` 設定 | 未驗證 | 在 VM 執行 `nginx -T`（唯讀）找 `client_body_temp_path` 與 `proxy_request_buffering`，再 `df -h` 該目錄；決定 #63 的 `UPLOAD_SPACE_FACTOR` |
| VM 是否有 `ffprobe` | 推論（`ffmpeg` 通常附帶） | 在 VM 執行 `ffprobe -version`；沒有就依 #64 的退路處理 |
| 正式 VM 的 nginx 逾時設定（`client_body_timeout`、`proxy_send_timeout`、`proxy_read_timeout`，官方預設皆 60 秒，只計兩次讀寫之間） | 未驗證 | `nginx -T`（唯讀）；#63 建議上傳路由 `proxy_read_timeout 300s` |
| 目前是否已有上傳因 5 分鐘的 `requestTimeout` 失敗 | 未驗證 | 查 VM 的 pm2 log 是否有 408 或上傳中斷紀錄（唯讀）；#63 會明確設定上傳路由的逾時 |
| nginx 關閉 request buffering 後的相容性 | 未驗證 | Q-F 驗收：經 nginx 上傳 500 MB、上傳中途斷線、空間不足回 507、`nginx -t`、可退回原設定 |
| 刪除正在被 nginx 讀取的檔案時，已開始的回應能否送完 | 推論（Linux 檔案在仍開啟時刪除，內容可讀到關閉為止） | 本機以 nginx 容器或 Linux 環境實測 |

## 6. 傳輸方式比較

三種方案都以「Express 驗權限、nginx 送檔」為前提，比較的是送出去的內容形式。資源數字是**推論**，VM 尚無實測。

| 面向 | A 漸進式下載＋Range（採用） | B HLS | C MPEG-DASH |
|---|---|---|---|
| 轉碼與切片 | 不需要；相容的原片直接送 | 需要切片；要自適應畫質就得轉成多種畫質 | 同 HLS |
| CPU | 幾乎為零（`sendfile`） | 只切片不轉碼時低；多畫質轉碼高，與 Whisper 搶 CPU | 同 HLS |
| 記憶體 | nginx 小量緩衝 | 轉碼程序另需記憶體 | 同 HLS |
| 暫存空間 | 原片本身（本來就要留到上 YouTube） | 另存片段，多畫質約原片的 1.3～2 倍，過渡期內暫存 | 同 HLS |
| 頻寬 | 每位觀看者等於原片位元率 | 網路差的學生可自動降畫質 | 同 HLS |
| 拖曳 | Range 直接跳；`moov` 在檔尾時起播較慢 | 以片段為單位跳 | 同 HLS |
| 瀏覽器 | `<video>` 原生，限相容編碼 | Safari、Chrome 142+ 原生；Firefox 需 hls.js | 全部需 dash.js |
| 權限驗證 | 起播與每次拖曳各一次請求 | 播放清單加每 4～6 秒一個片段，每個都要驗 | 同 HLS |
| 清理與切換 | 刪一個檔案；切換只換播放器 | 要刪整個片段目錄；轉碼未完成時的狀態要另外管理 | 同 HLS |
| 整合成本 | 一個端點、一個 nginx `internal` 位置 | 轉碼排程、片段儲存、播放清單驗權限、前端播放器套件 | 同 HLS，套件更大 |

**判斷**：原片只播到 YouTube 可播放為止，之後由 YouTube 提供自適應畫質。B、C 的主要收益（網路差時自動降畫質）只發生在這段過渡期，卻要增加轉碼、儲存、驗權限次數與前端整合四項成本，也讓清理更複雜。A 的主要風險是編碼不相容與高位元率，前者用 `ffprobe` 檢查擋下（#64），後者在試用期間量測。重新評估的量化條件寫在 #64。

## 7. 防繞過與競態分析

| 風險 | 對策（#62、#63） | 驗證 |
|---|---|---|
| 直接猜檔名下載 | 移除 `express.static('/uploads')`；nginx 不轉送 `/uploads`；播放網址不含檔名 | 請求 `/uploads/...` 回 404 |
| 直接請求內部路徑 | nginx `internal`：外部請求回 404（官方） | 請求 `/_protected-uploads/...` 回 404 |
| 路徑穿越 | 只依資料庫 `filePath`、`realpath` 確認在 `UPLOAD_DIR` 內、`X-Accel-Redirect` 只放編碼後的檔名；`alias` 與 `location` 結尾斜線一致（避免 nginx 的 alias 穿越） | `..`、`%2e%2e`、`%2F`、反斜線、中文與空白檔名、符號連結的測試 |
| 共享快取留存 | `Cache-Control: private, no-store`；該位置不啟用 `proxy_cache` | `curl -I` 檢查標頭（是否保留待驗證，見 §5） |
| 權限撤銷 | 每個 Range 請求重新驗證；已送出中的單一回應無法中途撤回 | 撤銷選課後拖曳 → 403 |
| 多段 Range 濫用 | `max_ranges 1` | 送多段 Range → 回整段 |
| 其他路由被利用送出 `X-Accel-Redirect` | 只有播放端點設定這個標頭；其他回應不得帶使用者可控制的標頭值 | 程式審查加一條檢查 |
| 播放中切換或清理 | 已開始的回應送完；下一個請求被拒時前端重新取得影片資料並切換 | §5 的刪檔實測、前端測試 |
