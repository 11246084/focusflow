# Backend 文件入口

最後更新：2026-04-15

## 先看哪一份

- 要確認 backend 現在到底怎麼跑、哪些能講、哪些不能講：看 [current-state.md](./current-state.md)
- 要做 demo 前檢查、跑 smoke、現場判讀 `/health`：看 [demo-runbook.md](./demo-runbook.md)
- 要交接、找跨組缺口、整理 demo 風險與暫時口徑：看 [handoff-known-issues.md](./handoff-known-issues.md)
- 要看下一步優先順序與這輪刻意不碰的範圍：看 [task-plan.md](./task-plan.md)
- 要追查這些內容是在哪一輪被新增或收斂：看 [implementation-log.md](./implementation-log.md)

## 每份文件的用途

- `README.md`
  - 只做入口頁，不重講 runtime 現況或 handoff 內容
- `current-state.md`
  - phase-1 backend 現況唯一真相頁
- `demo-runbook.md`
  - demo 前檢查、驗證路徑、現場說法與風險應對
- `handoff-known-issues.md`
  - backend 無法單獨定版、仍需跨組協作的問題與應對方式
- `implementation-log.md`
  - 每一輪文件或程式收斂的變更紀錄
- `task-plan.md`
  - 下一步規劃與優先順序

## 文件之間的關係

- `current-state.md` 是事實來源。其他文件若提到 runtime、ready 狀態或 phase-1 邊界，都以這份為準。
- `demo-runbook.md` 只負責把 `current-state.md` 的現況轉成 demo 與 smoke 流程，不另外定義新事實。
- `handoff-known-issues.md` 只整理尚未定版或需要外部配合的缺口，不重寫完整現況。
- `task-plan.md` 只保留接下來要做什麼，不重複現況與已知問題細節。
- `implementation-log.md` 只記錄變更，不充當狀態頁或交接頁。

## 維護原則

- runtime 事實變了，先改 `current-state.md`
- demo 流程或話術變了，改 `demo-runbook.md`
- 協作缺口或 demo 風險變了，改 `handoff-known-issues.md`
- 優先順序變了，改 `task-plan.md`
- 只是記錄這輪做了什麼，改 `implementation-log.md`
