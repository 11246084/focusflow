# FocusFlow 使用與安裝

FocusFlow 是教學影片問答系統，讓學生從課程影片取得回答與時間位置。這份文件提供本機安裝入口；請依序設定後端、影片處理環境與前端，功能進度只看[目前狀態](docs/current-status.md)。

## 環境需求

- Node.js 22.23.4 以上的 22 版（團隊與正式站統一使用），或 24.22.1 以上的 24 版；npm 10 以上。套件本身只要求 20.19.0／22.12.0 以上（見[前端鎖定檔](frontend/focus-flow/package-lock.json)的 Vite 與[後端鎖定檔](backend/package-lock.json)的 Redocly），但 Node.js 20 已於 2026-04-30 停止支援，22.23.4 是 2026-10 的安全修補版，原因見 [VM 資安檢查報告](docs/10_Operations/deployment/2026-10-23_VM資安檢查報告.md)。正式站 VM 已在 2026-10-23 升到同一版本。

  檢查方式：輸入 `node -v`，顯示 `v22.23.4` 或更新的 22 版即可；顯示 `v22.23.2` 這類較舊版本時，Windows 用 winget 安裝者執行 `winget upgrade --id OpenJS.NodeJS.22 --exact`，用 nvm 安裝者執行 `nvm install 22.23.4`，再重開終端機確認。
- 後端需要 MongoDB 資料庫；開發請指定自己的本機資料庫。
- 影片處理需要 Python 與 FFmpeg（影音處理工具），安裝方式見 [Pipeline README](STT_Whisper/README.md)。Pipeline 是把影片依序轉成逐字稿與搜尋資料的處理流程。

## 本機啟動順序

| 順序 | 操作 | 說明 |
|---|---|---|
| 1 | [設定並啟動後端](backend/README.md) | 安裝套件、設定資料庫與金鑰，再啟動 API；API 是前端呼叫後端的介面。 |
| 2 | [設定影片處理環境](STT_Whisper/README.md) | 要上傳影片時，先建立 Python 虛擬環境並設定模型及資料庫。 |
| 3 | [啟動前端](frontend/focus-flow/README.md) | 設定後端網址，執行開發伺服器並開啟終端機顯示的網址。 |

已有 `.env` 時保留原設定，不要直接覆蓋。此檔保存環境設定與金鑰；後端範例包含 Atlas（雲端 MongoDB）連線格式，啟動前請先確認目標，不能把共用資料庫當本機測試庫。

## 網頁操作

1. 教師登入後建立課程、指派學生，再從上傳頁選擇本機影片。
2. 學生登入後開啟已修課且已發布的課程，觀看影片並提問。
3. 若要使用 LINE，在網頁 LINE 頁取得綁定碼，傳給機器人後選擇課程。

例：教師上傳「第一課.mp4」→ 系統處理影片 → 學生問「這一課的重點？」→ 系統依可搜尋資料回傳回答與影片來源，資料不足時提示查無依據。

本機預設後端為 `http://localhost:4000`，介面說明位於 `/docs`，健康檢查位於 `/health`。實際試用環境與驗收資訊請由[狀態正本](docs/current-status.md)查閱；文件用法與其他入口見[文件索引](docs/README.md)。
