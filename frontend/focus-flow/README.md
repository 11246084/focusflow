# focus flow frontend

`frontend/focus-flow/` 是 focus flow MVP 的 React 19 + Vite 前端。

## 如何運行

在專案根目錄執行：

```powershell
cd frontend\focus-flow
npm install
Copy-Item .env.example .env
npm run dev
```

啟動後，Vite 會在終端機顯示本機網址，預設通常是：

```text
http://localhost:5173
```

如果 `5173` 已被占用，Vite 會自動改用其他 port。

## 環境變數

前端目前已提供 `.env.example`，可先複製成 `.env`：

```powershell
cd frontend\focus-flow
Copy-Item .env.example .env
```

目前提供的變數：

- `VITE_API_BASE_URL`: backend API base URL，預設建議為 `http://127.0.0.1:4000/api/v1`

說明：

- 目前前端仍偏展示型畫面，尚未正式串接 API
- 因此 `VITE_API_BASE_URL` 目前是先保留給後續 API integration 使用

## 其他常用指令

```powershell
cd frontend\focus-flow
npm run lint
npm run build
npm run preview
```

用途：

- `npm run dev`: 啟動 Vite 開發伺服器
- `npm run lint`: 執行 ESLint 檢查
- `npm run build`: 建立 production build
- `npm run preview`: 本機預覽 build 後的結果
