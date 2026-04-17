# Handoff / Known Issues

最後更新：2026-04-15

這份文件只整理 backend 無法單獨定版、但目前已在 backend 內明確化的問題，以及交接與 demo 期間的暫時應對方式。

## 尚未解決但已明確化的問題

### DB / MongoDB 協作缺口

尚未定版：

- `video_segments_text` / `video_segments_video` 的 Atlas vector index name
- Atlas 可用的 filter fields 與 readiness 證據
- `videos` mixed collection 的 ownership 邊界
- shared DB 是否允許 smoke 痕跡，或是否提供專屬 demo DB

backend 目前已採取的行為：

- phase-1 正式 runtime 仍固定在 `QA_VECTOR_SEARCH_MODE=memory`
- `QA_VECTOR_SEARCH_MODE=atlas` 不再靜默回 memory
- 缺 index、mode 不相容或 aggregate 失敗會直接 fail-fast
- pipeline metadata 只拿來做 QA bridge，不當正式 app-owned video 使用

若未定版，demo 風險：

- 有人把 `.env` 切成 atlas mode 會直接 hard-fail
- 前後端可能誤把 pipeline metadata 當正式影片資料
- 共享 DB 若不能寫入，只能做部分 live smoke

### AI / Pipeline 協作缺口

尚未定版：

- query-side canonical embedding provider
- query embedding 與 pipeline 3072 維 vectors 的對齊方式
- `video_segments_text` 的 canonical segment key 與欄位口徑
- 哪些影片目前真的已有 searchable coverage
- `clips` 與 `video_segments_video` 的正式分工

backend 目前已採取的行為：

- phase-1 query embedding 仍是 mock
- 正式 retrieval 固定在 memory mode
- 無法做 vector scoring 時改走 lexical fallback，並在 `runtime.fallbacks` 留下訊號
- 若課程只有 metadata、沒有 searchable segments，回 `runtime.matchStatus=no_searchable_segments`

若未定版，demo 風險：

- QA 可用，但不能講成正式 semantic retrieval ready
- bridge course 可能看得到但問不到內容
- clip source 若被誤解為已定版，後續整合會出現錯誤期待

### LINE 協作缺口

尚未定版：

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- webhook URL / callback 設定完成證據
- live smoke 的實際測試時段與環境

backend 目前已採取的行為：

- backend 端 bind / switch / ask 流程已打通
- 缺 access token 時不再假裝 reply 已送出
- `/health` 會標示 `runtime.line.readiness=degraded` 與 `runtime.line.deliveryMode=backend_only`
- 若 LINE 問答流程撞到 QA runtime 問題，會回 `reason`、`errorCode`、`qaRuntime`

若未定版，demo 風險：

- backend route 看起來正常，但實際 LINE 不會回訊息
- 若只看 `handled=true`，很容易誤判為 live ready

### Frontend / Demo Consumer 協作缺口

尚未定版：

- bridge course 在 UI 上要隱藏、標示 `QA-only`，還是做 metadata-only 呈現
- 是否要把 degraded / backend-only 訊號直接顯示在畫面上
- demo 口徑是否接受 bridge course 只作 QA scope，不當完整影片課程

backend 目前已採取的行為：

- bridge course 會標示 `qaScopeOnly`、`bridgeMode`、`bridgeContract`
- `/api/v1/courses/:courseId/videos` 會回 `metadataOnly=true`
- metadata-only bridge video 的 processing API 會回 `409 VIDEO_METADATA_ONLY`

若未定版，demo 風險：

- 使用者可能看到課程卻問不到內容
- 若 UI 不標示 QA-only / metadata-only，會像壞掉的課程
- 若 UI 不揭露 degraded / backend-only，demo 口徑會與實際 runtime 脫節

## 若尚未定版時的應對方式

- DB / AI 口徑未 freeze 前：只講 memory mode 與 fallback，不講 semantic retrieval ready
- bridge coverage 未補齊前：說 `QA-only` 或 `metadata-only`；回 `no_searchable_segments` 照實說
- LINE 條件未到位前：只講 backend-only 驗證完成，不講 live reply ready
- 共享 DB 不可寫前：走 `/health`、acceptance smoke 與 route tests
