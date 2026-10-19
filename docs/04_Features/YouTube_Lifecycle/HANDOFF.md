# YouTube 恢復與清理：開發接手說明

這份文件讓任何接手的人或 AI（Claude Code、Codex）在額度用完、換 session 時，不必重讀原始對話就能繼續開發。設計決策只看 [decisions.md](decisions.md)，功能狀態只看[目前狀態](../../current-status.md)；這裡只記錄開發進行到哪、下一步怎麼做。功能完成時，在同一個 PR 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-10-20

## 必守規則

- **作者只有 Weihao**：本機 Git 身分 `Weihao <11246062@ntub.edu.tw>`；不加 `Co-Authored-By`、`Claude-Session`、`Generated with` 等任何 AI 署名。
- **小步 commit**：一個可獨立說明的修改一筆，每筆都要能通過相關測試。
- **不 push、不合併 `main`**：push 與合併 `main` 由使用者決定。推到 `main` 會自動部署到 VM。
- **複評（10/22～10/23）結束前**不刪除 VM 或 Atlas 的任何資料；測試只用暫存目錄與測試替身。
- 新分支用 `wip/…` 或 `feat/…`，不用 `claude/…`。
- 時程：11/13 前開發與驗收完成；11/16～11/27 佈展與評分期間凍結部署。不為了趕時程縮減功能，用平行開發與自動化測試補足。

## 分支現況

基底分支是 `feat/youtube-lifecycle`，各塊從它切出，完成後合併回它。

| 塊 | 分支（本機，未 push） | worktree | 狀態（10/20） |
|---|---|---|---|
| 設計文件 | `feat/youtube-lifecycle` | — | decisions.md、本文件、work-orders |
| A 核心 | `feat/youtube-lifecycle-a-core` | `.claude/worktrees/yt-a-core-d304b6` | 開發中；已有一筆大 commit `3a98d27`，可能正在拆成小 commit |
| C 補回原片 | `claude/yt-c-restore-ac99e4` | `.claude/worktrees/yt-c-restore-ac99e4` | 開發中；已有 `fff6547`、`a5975f1` |
| E 前端 | `claude/yt-e-frontend-540a69` | `.claude/worktrees/yt-e-frontend-540a69` | **完成**：8 筆 commit（`e59bf1d..abbd593`），前端測試 101 項通過、build 成功，已確認作者正確 |
| B 管理員 API | 尚未建立，預定 `wip/yt-b-admin` | — | 等 A 合併後派給 Codex，說明見 [work-orders/B-admin-api.md](work-orders/B-admin-api.md) |
| D 短片 | 尚未建立，預定 `wip/yt-d-shorts` | — | 等 A 合併後派給 Codex，說明見 [work-orders/D-short-assets.md](work-orders/D-short-assets.md) |

`claude/` 開頭的兩條分支是在改分支前綴之前建立的；合併進 `feat/youtube-lifecycle` 後刪除，不要 push。

Claude 接手時可參考的 session（用 Claude Desktop 打開後說「繼續」即可）：A `local_6b455304-cfeb-4b45-bd6d-cf5253271203`、C `local_cfc00d53-8a5c-448a-9c0f-f855a29b6004`、E `local_976a39e8-31fb-4d65-896c-47d23a78ff5f`。

## 下一步（依序）

1. **確認 A、C 完成**：worktree 內 `git status --short` 為空；`backend/` 執行 `npm.cmd test` 全套通過。若 session 因額度中斷，未提交的修改仍在 worktree 裡，接手者先檢查再依小步規則提交。
2. **檢查身分**，每條分支合併前都要跑，輸出只能有 Weihao，第二行要是 0：
   ```bash
   git log --format="%h %an <%ae> | %cn <%ce> | %s" feat/youtube-lifecycle..<分支>
   git log --format=%B feat/youtube-lifecycle..<分支> | grep -i -c "co-authored\|claude-session\|generated with"
   ```
3. **合併順序**：A → C → E，合併到 `feat/youtube-lifecycle`（用 `git merge --no-ff`，保留各塊的小 commit）。A 和 C 都會在 Video schema 新增 `youtubeUpload.localSourceRestoredAt`，衝突時保留同一份定義。每合併一條，就在 `backend/` 跑 `npm.cmd test`、`npm.cmd run docs:lint`，在 `frontend/focus-flow/` 跑 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`。
4. **派 B、D 給 Codex**（兩者可同時進行）：
   ```bash
   git worktree add .claude/worktrees/yt-b-admin -b wip/yt-b-admin feat/youtube-lifecycle
   cd .claude/worktrees/yt-b-admin/backend && npm.cmd ci && cd -
   codex exec -C .claude/worktrees/yt-b-admin -s workspace-write --add-dir .git -o yt-b-result.md - < docs/04_Features/YouTube_Lifecycle/work-orders/B-admin-api.md
   ```
   D 同樣做法，分支 `wip/yt-d-shorts`，工作說明換成 `D-short-assets.md`。`npm.cmd ci` 要先由接手者執行，因為 Codex 的沙箱預設不能連網路。完成後依第 2 步檢查身分，再依第 3 步合併（B、D 都改 `shortAssetPublish.service.js` 的不同函式，衝突時兩邊都保留）。
5. **前後端對齊**：E 依 work-orders/B 的「回應格式」實作；B 合併後在瀏覽器實測管理員頁與教師頁，不一致的地方以 B 的實際回應為準修正前端。
6. **文件同步**：功能開關、`.env.example`、OpenAPI、API 設計規範錯誤碼、API 契約、`backend/docs/` 的 todo／implementation-log／README（清單見 decisions.md「實作切分」最後一段）。
7. **獨立 code review**（10/26～11/6）：交給 Codex 審 Claude 寫的部分、Claude 審 Codex 寫的部分；工作說明屆時另寫並先給使用者看。
8. **10/24 之後**的合併 `main`、部署、開啟恢復與清理，每一步都要使用者明確授權，驗收方式見 decisions.md #33 與時程表。

## 額度用完時

- **Claude 用完**：Codex 的額度另外計算，可以繼續第 4 步；使用者也可以讓 Codex 讀本文件，接手第 1～6 步的合併與測試。
- **Codex 用完**：B、D 改開 Claude session，用同一份 work-orders 當工作說明。
- **任何接手者都先做**：讀本文件與 decisions.md → `git worktree list`、各分支 `git log` 對照上表 → 從「下一步」第一個未完成的項目開始 → 完成一步就更新本文件的「分支現況」與日期，並 commit 到 `feat/youtube-lifecycle`。
