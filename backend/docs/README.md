# Backend 文件入口

最後更新：2026-07-18（ShortAsset feed/sync 與前端串接方案）

> 跨服務進度（frontend / pipeline / 跨組缺口）見 [docs/current-status.md](../../docs/current-status.md)。

## 先看哪一份

- 要確認 backend 現在到底怎麼跑、哪些能講、哪些不能講：看 [current-state.md](./current-state.md)
- 要交接、找跨組缺口、整理 demo 風險與暫時口徑：看 [handoff-known-issues.md](./handoff-known-issues.md)
- 要看下一步優先順序與這輪刻意不碰的範圍：看 [todo.md](./todo.md)
- 要追查這些內容是在哪一輪被新增或收斂：看 [implementation-log.md](./implementation-log.md)（較舊的紀錄已歸檔到 [implementation-log.archive.md](./implementation-log.archive.md)）
- 要查 API spec：看 [openapi.yaml](./openapi.yaml)（執行時掛在 `/docs`）；已涵蓋 stats/admin/watched、courses/videos PATCH/DELETE、QA `citations` / `answerStatus` 與 student Shorts feed，但 internal processing webhook 等少數內部端點以 route files 為準
- 要查 Phase 2 回傳語意：看 [phase2-api-contract.md](./phase2-api-contract.md)（QA citations/no-answer、Video 顯示狀態、已實作的 ShortAsset feed/sync 與仍待實作的 Clip/發布產線）
- 要了解影片上傳後如何自動觸發 STT pipeline、環境設定與後續 YouTube 整合待辦：看 [handoff-stt-pipeline-integration.md](./handoff-stt-pipeline-integration.md)
- 要審核學生 Short 修課過濾的前端串接方案（JWT、課程顯示、空狀態、分頁與 modal 保留方式）：看 [handoff-shorts-frontend-plan.md](./handoff-shorts-frontend-plan.md)；本輪只有方案，尚未修改前端
- 2026-05-06 已修：student dashboard questions 統計改用 `userId`、`tests/qa.routes.test.js` 與 `tests/course-video.routes.test.js` expected 同步至 demo 權限模型 + `matches[].videoTitle`
- 要確認最新待補：看 [todo.md](./todo.md)（YouTube 真實 OAuth smoke、caption / OCR / frame description、Clip / Shorts 正式 routes 等上線前 / Phase 2 項目）

## 每份文件的用途

- `README.md`
  - 只做入口頁，不重講 runtime 現況或 handoff 內容
- `current-state.md`
  - phase-1 backend 現況唯一真相頁
- `handoff-known-issues.md`
  - backend 無法單獨定版、仍需跨組協作的問題與應對方式
- `implementation-log.md`
  - 每一輪文件或程式收斂的變更紀錄；2026-04-15 以前的紀錄收在 `implementation-log.archive.md`
- `todo.md`
  - 下一步規劃與優先順序
- `openapi.yaml`
  - REST API 規格來源（Swagger UI 由此生成）；包含 QA `citations` / `answerStatus` 與 student Shorts feed，並保留 internal processing webhook 等少數內部端點以 route files 為準
- `phase2-api-contract.md`
  - Phase 2 API contract 補充文件：QA、video display states、已實作的 ShortAsset feed/sync，以及尚未實作的 Clip/發布 worker
- `handoff-shorts-frontend-plan.md`
  - 學生 Short 修課過濾的前端串接方案；記錄既有 authenticated helper、預計 UI 改動、小改動判準與待確認契約，本輪不含前端程式碼修改

## 文件之間的關係

- `current-state.md` 是事實來源。其他文件若提到 runtime、ready 狀態或 phase-1 邊界，都以這份為準。
- `handoff-known-issues.md` 只整理尚未定版或需要外部配合的缺口，不重寫完整現況。
- `todo.md` 只保留接下來要做什麼，不重複現況與已知問題細節。
- `implementation-log.md` 只記錄變更，不充當狀態頁或交接頁。

## 維護原則

- runtime 事實變了，先改 `current-state.md`
- 協作缺口或 demo 風險變了，改 `handoff-known-issues.md`
- 優先順序變了，改 `todo.md`
- 只是記錄這輪做了什麼，改 `implementation-log.md`
- 外部交接紀錄只能作為待驗證來源；正式文件需以 route files、models、services、tests 與實際 DB 狀態為準
