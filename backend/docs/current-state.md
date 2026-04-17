# Backend 目前狀態

最後更新：2026-04-15

## 文件角色

這份文件是 phase-1 backend 現況唯一真相頁。要回答的只有五件事：

1. 目前正式 runtime 是什麼
2. phase-1 已完成到哪裡
3. `ready`、`degraded`、`hard_fail` 應怎麼解讀
4. 哪些邊界不能講錯
5. 目前已知限制是什麼

## Phase-1 runtime 現況

目前 backend 應正確描述為：

- `QA_QUERY_EMBEDDING_PROVIDER=mock`
- `QA_VECTOR_SEARCH_MODE=memory`
- `QA_ANSWER_PROVIDER=gemini`
- `DEMO_SEED_ENABLED=false`

這代表：

- phase-1 正式 query embedding 仍是 mock，不是已對齊 pipeline 3072 維的正式向量檢索
- phase-1 正式 retrieval 仍是 memory mode，不是 Atlas semantic retrieval
- answer generation 正式模式是 Gemini
- demo 資料不是自動建立，仍需明確執行 `npm run seed`
- 若要先清掉 demo-owned / demo-derived 痕跡再重建，使用 `npm run seed -- --reset`

目前 QA bridge contract 仍是：

`course.videoIds -> videos._id -> videos.video_id -> video_segments_text.video_id|videoId`

目前另有一條 pipeline-style demo bridge baseline，目的是讓 bridge 課程展示可重現；它不是已與真實 pipeline fully synchronized 的正式產品狀態。

## 已完成項目

- auth / JWT / RBAC 主線已可用
- courses / videos / processing 狀態流程已可用
- `/api/v1/qa/ask` 已能回 answer、matches、時間資訊與 runtime 訊號
- QA misconfig、Atlas not ready、fallback 與 `no_searchable_segments` 已可明確觀測
- `POST /api/v1/line/bind-token`、webhook verify、bind、switch course、ask question routing 已完成
- LINE non-live、backend-only、QA hard-fail 訊號已補齊
- `GET /health` 已能直接顯示 `runtime.qa` 與 `runtime.line`
- backend-only acceptance smoke 已存在，可在不碰共享 MongoDB 的前提下重驗主線
- demo baseline 已可用 `npm run seed` 收斂，並可用 `npm run seed -- --reset` 保守清除 demo-owned / demo-derived 痕跡後重建

## readiness / degraded / hard_fail 怎麼解讀

### `/health`

- `runtime.qa.readiness=ready`
  - phase-1 允許的 QA runtime 已就緒，可以接受提問
- `runtime.qa.readiness=hard_fail`
  - QA runtime 設定不合法，或缺少必要條件
  - 常見原因是 provider 缺 key、Atlas mode 缺 index、或 mode 不相容
- `runtime.line.readiness=ready`
  - backend 與 live LINE 所需條件都已補齊
- `runtime.line.readiness=degraded`
  - backend routing 仍可驗證，但 live delivery 尚未 ready
  - 最常見的 phase-1 形態是 `deliveryMode=backend_only`
- `runtime.line.readiness=hard_fail`
  - LINE 必要條件不成立，例如驗簽或 channel 設定無法成立

### `/api/v1/qa/ask`

- `runtime.status=ready`
  - 問答主線正常完成，沒有額外降級訊號
- `runtime.status=degraded`
  - 問答仍可回應，但走到了 fallback、bridge 限制或非理想檢索條件
- `runtime.matchStatus=matched`
  - 有找到可回答的片段
- `runtime.matchStatus=no_relevant_match`
  - 有可搜尋資料，但沒有足夠相關片段
- `runtime.matchStatus=no_searchable_segments`
  - 目前只有 bridge metadata，沒有可搜尋文字片段

## 不能誤稱的邊界

- 不能說 Atlas vector retrieval 已 ready
- 不能說 `QA_VECTOR_SEARCH_MODE=atlas` 已可安全切換上線
- 不能說 query embedding 已與 pipeline 3072 維 vectors 對齊
- 不能說 bridge course 的所有影片都已有 searchable segments
- 不能說 live LINE 已完成完整外部驗證
- 不能說 `video_segments_video` 已經是正式 clip source

## 已知限制

- `videos` 仍是 mixed collection，app-owned video 與 pipeline metadata 的 ownership 尚未定版
- `video_segments_text` 仍是 mixed shape，canonical 欄位與搜尋覆蓋率尚未完全 freeze
- `FocusFlow Pipeline Bridge Course` 可能只有 metadata、沒有 searchable segments
- `FocusFlow Pipeline Bridge Course` 目前是 pipeline-style demo baseline，不應誤稱為 live pipeline 已完整同步
- `clips` 目前仍是 cache / helper，`video_segments_video` 尚未接成正式片段來源
- 共享 MongoDB 不適合直接做全 live smoke，因為會留下 usage logs、bind tokens 等痕跡
- Atlas index naming、filter fields、query embedding provider、live LINE 條件仍需跨組協作定版

## 一句話結論

截至 2026-04-15，backend 已穩定收斂在 `mock + memory + gemini + explicit seed` 這條 phase-1 主線；misconfig 與 Atlas not ready 會明確 fail-fast，QA / LINE 的 degraded 與 backend-only 狀態也都能從 `/health` 或 API response 直接觀察。
