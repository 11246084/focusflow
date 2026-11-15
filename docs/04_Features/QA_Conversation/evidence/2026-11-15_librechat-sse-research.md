# LibreChat 的 SSE 做法研究（2026-11-15）

這份紀錄整理開源專案 LibreChat 怎麼把回答過程即時推送給瀏覽器，供[對話功能優化](../decisions.md)第 9、10 項的進度提示參考。研究只讀 LibreChat 的原始碼，沒有執行它，也沒有修改本專案的程式。讀者要做的事：設計本專案的進度提示 API 時，採用下面「可直接採用」的寫法，避開「不採用」的部分。

SSE（Server-Sent Events）是瀏覽器標準：一個 HTTP 回應不立刻結束，伺服器持續寫入一段一段的文字事件，瀏覽器收到一段就處理一段。

## 研究對象

- 專案：[danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)，MIT 授權，`main` 分支 `5473f91`（2026-11-14）。
- 讀過的檔案：`packages/api/src/utils/events.ts`（寫入事件）、`packages/api/src/stream/keepalive.ts`（保持連線）、`api/server/routes/agents/index.js`（訂閱路由）、`api/server/controllers/agents/request.js`（送出問題）、`client/package.json`。
- 沒有讀的部分：前端 `client/src/hooks/SSE/` 的內容、斷線續傳的實作細節、Redis 相關程式。

## LibreChat 的做法

1. **兩段式。** 瀏覽器先 `POST` 送出問題，伺服器立刻回一個 `streamId`；瀏覽器再用 `GET /chat/stream/:streamId` 訂閱事件。回答的產生交給背景工作，和訂閱的連線分開，所以斷線後可以重新訂閱、補收漏掉的事件，也能多個分頁同時看。背景工作的狀態存在記憶體或 Redis。
2. **回應標頭。** 訂閱路由設定 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`、`Content-Encoding: identity`，然後呼叫 `res.flushHeaders()` 立刻送出標頭。`X-Accel-Buffering: no` 是告訴 nginx 不要把內容累積起來再送。
3. **事件格式。** 每個事件寫成 `event: message\ndata: <JSON>\n\n`；錯誤寫成 `event: error` 後結束回應。
4. **寫入前先檢查。** 寫入前檢查回應是否已結束或已被銷毀（`res.writableEnded`、`res.destroyed`），是的話就不寫。瀏覽器關閉分頁後再寫入會丟出 `ERR_STREAM_WRITE_AFTER_END`。
5. **保持連線。** 每隔一段時間寫入一行 SSE 註解 `:\n\n`。瀏覽器會忽略它，但中間的代理伺服器看得到資料流動，不會因為太久沒資料而切斷連線。
6. **斷線處理。** 監聽 `req.on('close')`，瀏覽器斷線時取消訂閱；背景的回答工作不受影響，繼續做完。
7. **前端。** 用 `sse.js` 套件接收；這個套件支援用 `POST` 與自訂標頭建立 SSE 連線，瀏覽器內建的 `EventSource` 只能用 `GET`。

## 對本專案的判斷

| LibreChat 的做法 | 是否採用 | 理由 |
|---|---|---|
| 回應標頭五項與 `flushHeaders()` | 採用 | 正式站在 nginx 後面，沒有 `X-Accel-Buffering: no` 時事件會被累積到最後才一次送出，進度提示就失去作用 |
| 事件格式、寫入前檢查、錯誤事件 | 採用 | 寫法簡單，直接解決已知的錯誤情況 |
| 保持連線的註解行 | 採用 | 本專案的回答逾時是 20 秒（`QA_ANSWER_TIMEOUT_MS`）並會重試一次，「撰寫回答」這一步可能有數十秒沒有事件 |
| 瀏覽器斷線後回答繼續做完並存檔 | 採用 | 學生的提問額度已經扣了、模型費用已經花了，回答應該留在對話紀錄裡 |
| 兩段式與背景工作管理 | 不採用 | 它是為了斷線續傳與多分頁同步，需要另外管理工作狀態；本專案一題只有一次模型呼叫、通常數秒到數十秒完成，一個 `POST` 直接回 SSE 就夠 |
| Redis | 不採用 | 本專案沒有 Redis，而且只有一個後端程序 |
| `sse.js` 套件 | 不採用 | 本專案前端可以直接用 `fetch` 讀取回應的資料流，不必加套件；登入用的 cookie 也照現有的 `apiFetch` 設定帶上 |

LibreChat 送出問題的控制器單一檔案就有 3,700 多行，大部分在處理本專案不需要的情況（續傳、接手進行中的回答、排隊）。參考價值在上面幾個小寫法，不在整體架構。

## 本專案要另外確認的事

- 正式站 nginx 設定裡的 `proxy_read_timeout` 在[部署與連線排錯](../../../10_Operations/deployment/部署與連線排錯.md)的範例中是註解掉的，實際值要當次在 VM 上查。nginx 預設是 60 秒，有保持連線的註解行就不會被它切斷。
- 後端 `app.js` 目前沒有壓縮中介層；日後若加上，SSE 路由要排除，否則事件會被壓縮程式累積。
