# Backend Task Plan

最後更新：2026-04-15

## 這份文件只保留什麼

- 下一步規劃
- 優先順序
- 本輪刻意不碰的範圍

runtime 現況看 [current-state.md](./current-state.md)，協作缺口看 [handoff-known-issues.md](./handoff-known-issues.md)。

## 下一步優先順序

1. 跟 DB / MongoDB、AI / Pipeline 組 freeze phase-1 契約
   - Atlas index name
   - filter fields
   - `videos` ownership 邊界
   - query embedding provider 與 3072 維對齊方式
2. 決定 demo 環境策略
   - 是否提供專屬 demo DB
   - 共享 DB 是否只允許只讀 smoke
3. 跟 Frontend 確認 bridge course 呈現
   - 隱藏
   - 標示 `QA-only`
   - 或 metadata-only 呈現
4. 若需要 live LINE demo
   - 先拿到 secret、access token、callback 設定證據
   - 再安排 live smoke
5. 後續再處理 phase-2 以前不必現在擴的項目
   - `video_segments_video` 正式接手 clip source
   - Atlas 真正上線
   - 完整前端產品化流程

## 本輪刻意不碰

- backend 主線程式
- `database/`
- `frontend/`
- `STT_Whisper/`
- MongoDB 實際資料

## 規劃前提

- phase-1 正式 runtime 仍是 `mock + memory + gemini + explicit seed`
- demo 口徑應以 `/health` 與 API runtime 訊號為準，不用理想版敘事補空白
- 未 freeze 的跨組議題先用文件口徑管住，不提前擴功能
