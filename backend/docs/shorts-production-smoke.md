# Shorts 正式環境唯讀 Smoke

這個流程用既有學生身分驗證正式環境的 Shorts 修課 feed、同步健康狀態、分頁，以及 YouTube 公開播放 metadata。它不建立帳號、不建立 Enrollment、不新增或修改 ShortAsset。

## 執行前提

- 執行端可以連到正式網址；目前校外網路可能被學校邊界設備擋住，應從校網或學校 VPN 執行。
- 正式資料已準備一個學生、Enrollment、published Course，以及 published/playable ShortAsset。
- 優先使用既有 bearer token。若改用帳號密碼，成功登入會依目前 Backend 行為新增一筆 login UsageLog，因此不算資料庫零寫入。

## 建議指令

```powershell
cd backend
$env:SHORTS_SMOKE_BASE_URL = 'https://focusflow.ntub.edu.tw'
$env:SHORTS_SMOKE_BEARER_TOKEN = '<existing student token>'
$env:SHORTS_SMOKE_EXPECTED_COURSE_ID = '<expected course ObjectId>'
$env:SHORTS_SMOKE_EXPECTED_VIDEO_ID = '<expected YouTube video id>'
npm.cmd run smoke:shorts:readonly
```

工具預設要求 feed 至少有一筆資料、`runtime.shortsSync` 已成功完成過同步週期且未 degraded，並透過 YouTube oEmbed 檢查前五筆影片。若只驗證沒有修課的新學生空狀態，可明確設定：

```powershell
$env:SHORTS_SMOKE_ALLOW_EMPTY = 'true'
```

## 完成證據

保存輸出的正式網址、第一／第二頁筆數、YouTube 檢查數，以及 `shortsSync.lastAttemptAt`、`lastSuccessAt`、`degraded`。輸出不包含 token、email 或密碼。

API smoke 通過後，仍需以瀏覽器登入同一名學生，確認：

- 只顯示該學生修課範圍內的 Short。
- 卡片課程名稱正確。
- 影片可播放與關閉。
- 瀏覽器 Console 沒有 Short API 或播放器錯誤。

### 校外瀏覽器替代驗收

若正式前端只能從校內或學校 VPN 連線，可用本機 Vite 前端搭配正式後端完成 UI 整合驗收。瀏覽器維持同源，由 Vite 代理轉送 `/api`，因此不需要放寬正式後端 CORS：

```powershell
cd frontend\focus-flow
$env:VITE_API_BASE_URL = '/api/v1'
$env:VITE_DEV_PROXY_TARGET = 'https://chevy-cradling-elevate.ngrok-free.dev'
npm.cmd run dev
```

`VITE_DEV_PROXY_TARGET` 未設定時不啟用代理，因此不影響一般開發或正式 build。代理會附加 ngrok browser-warning bypass header；該 header 只存在本機驗收代理，不會進入正式 frontend bundle。

完成後清除 shell 中的敏感環境變數：

```powershell
Remove-Item Env:SHORTS_SMOKE_BEARER_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:SHORTS_SMOKE_STUDENT_PASSWORD -ErrorAction SilentlyContinue
```
