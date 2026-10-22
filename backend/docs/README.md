# 後端文件使用入口

這份索引幫助你找到後端的安裝、介面與操作說明，避免從歷史交接判斷現況。請依下表選讀；所有功能進度及驗收結果都以[目前狀態](../../docs/current-status.md)為準。

| 要做的事 | 閱讀入口 |
|---|---|
| 安裝與啟動 | [後端 README](../README.md) |
| 查資料流與功能開關 | [技術索引](current-state.md) |
| 理解環境、資料與播放限制 | [已知問題](handoff-known-issues.md) |
| 查 API，也就是前端呼叫後端的介面 | [OpenAPI 規格](openapi.yaml)、[回應語意](phase2-api-contract.md)；啟動後由 `/docs` 閱讀 |
| 操作影片處理與續跑 | [Pipeline 使用方式](../../STT_Whisper/README.md) |
| 查學生短片牆的接線與操作 | [前端完成交接](handoff-shorts-frontend-done.md) |
| 查待辦或追溯變更 | [待辦](todo.md)、[實作紀錄](implementation-log.md)、[較早紀錄](implementation-log.archive.md)；保留原日期，不當目前狀態 |
| 追溯語音轉文字交接 | [STT 交接](handoff-stt-pipeline-integration.md)；使用方式請回到上方 Pipeline README |

例：教師上傳失敗 → 先查技術索引的影片流程 → 依 Pipeline README 查對應處理日誌。不要因舊交接寫「尚未實作」就判定功能不存在。

修改 API 規格後，在 `backend/` 執行 `npm.cmd run docs:lint`；這是檢查規格格式的指令，不能代替功能驗收。進度更新寫入狀態正本，本索引只維護文件用途與連結。
