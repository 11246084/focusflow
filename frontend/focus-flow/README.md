# FocusFlow 前端安裝與使用

這份文件說明網頁的啟動方式與教師批次上傳操作。請先啟動後端，再設定前端連線；功能進度及驗收結果只看[目前狀態](../../docs/current-status.md)。

## 安裝與啟動

[套件鎖定檔](package-lock.json)中的 Vite（前端開發與打包工具）要求 Node.js 20.x 至少 20.19.0，或 22.12.0 以上。從 repo 根目錄執行：

```powershell
cd frontend\focus-flow
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
```

開啟終端機顯示的網址。既有 `.env` 不會被上述指令覆蓋；它是前端讀取的環境設定檔。

| 變數 | 用法 |
|---|---|
| `VITE_API_BASE_URL` | 後端 API 基底網址，例如 `http://127.0.0.1:4000/api/v1`；API 是網頁呼叫後端的介面。 |
| `VITE_LINE_BOT_URL` | LINE 加入好友網址；留空時不顯示一般加入好友連結。 |
| `VITE_DEV_PROXY_TARGET` | 選用的開發轉送目標；設定時可將 API 基底設為 `/api/v1`，由 Vite 轉送到指定後端，見[開發設定](vite.config.js)。 |

修改設定後重新啟動 Vite；打包版本則需重新執行 build。以上前端變數會提供給瀏覽器，不能放私密金鑰。

## 教師批次上傳

在上傳頁選課程及一支或多支影片，按上傳後查看每支影片的處理結果。[上傳程式](src/services/videoUpload.js)將檔案合成一次請求，取得 `batchId`（這一批上傳的識別碼）；[上傳頁](src/pages/TeacherUpload.jsx)每三秒查詢 `/video-batches/:batchId`。

頁面將追蹤資料存於瀏覽器本機儲存空間，網址也帶有批次識別碼；重新整理或返回頁面時會續查。失敗項目可按「重新處理」，呼叫該批次的 retry 介面；清除瀏覽器資料後不能保證保留追蹤資訊。

例：選取「第一課.mp4、第二課.mp4」→ 建立同一批次 → 分別顯示兩支影片的結果 → 對失敗項目按「重新處理」。

## 其他指令

在此前端目錄執行：`npm.cmd test` 檢查工具函式、`npm.cmd run lint` 檢查程式規則、`npm.cmd run build` 產生 `dist/`，再用 `npm.cmd run preview` 本機預覽。命令定義見 [package.json](package.json)；部署時須讓網頁子路徑回到 `index.html`，才能直接開啟或重新整理應用程式頁面。
