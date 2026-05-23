# Backend 文件入口

最後更新：2026-05-23（Phase 1 收尾：文件對齊現況 + OpenAPI 補齊 stats/admin/watched/PATCH/DELETE）

> 跨服務進度（frontend / pipeline / 跨組缺口）見 [docs/current-status.md](../../docs/current-status.md)。

## 先看哪一份

- 要確認 backend 現在到底怎麼跑、哪些能講、哪些不能講：看 [current-state.md](./current-state.md)
- 要交接、找跨組缺口、整理 demo 風險與暫時口徑：看 [handoff-known-issues.md](./handoff-known-issues.md)
- 要看下一步優先順序與這輪刻意不碰的範圍：看 [todo.md](./todo.md)
- 要追查這些內容是在哪一輪被新增或收斂：看 [implementation-log.md](./implementation-log.md)（較舊的紀錄已歸檔到 [implementation-log.archive.md](./implementation-log.archive.md)）
- 要查 API spec：看 [openapi.yaml](./openapi.yaml)（執行時掛在 `/docs`）；已涵蓋 stats/admin/watched 與 courses/videos 的 PATCH/DELETE，但仍非 100% 完整契約（internal processing webhook 等少數端點以 route files 為準）
- 要了解影片上傳後如何自動觸發 STT pipeline、環境設定與後續 YouTube 整合待辦：看 [handoff-stt-pipeline-integration.md](./handoff-stt-pipeline-integration.md)
- 2026-05-06 已修：student dashboard questions 統計改用 `userId`、`tests/qa.routes.test.js` 與 `tests/course-video.routes.test.js` expected 同步至 demo 權限模型 + `matches[].videoTitle`
- 要確認最新待補：看 [todo.md](./todo.md)（CORS 收緊、dangling DB scripts、YouTube Data API 等上線前 / Phase 2 項目）

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
  - REST API 規格來源（Swagger UI 由此生成）；2026-05-23 已補 stats/admin/watched/PATCH/DELETE，仍標註為非 100% 完整契約

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
