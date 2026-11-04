# YouTube 恢復與清理：開發接手說明

這份文件讓任何接手的人或 AI（Claude Code、Codex）在額度用完、換 session 時，不必重讀原始對話就能繼續開發。設計決策只看 [decisions.md](decisions.md)，功能狀態只看[目前狀態](../../current-status.md)；這裡只記錄開發進行到哪、下一步怎麼做。功能完成時，在同一個 PR 內把本文件移到 `docs/90_Archive/`。

最後更新：2026-10-27（第三輪契約與 F0～F2 介面銜接）

獨立審查：[2026-10-25 Codex 審查報告](evidence/2026-10-25_codex-review.md)。包含決策第 1～34 條的問題、已確認項目、重現結果與測試限制；修正與後續驗收請先參照此報告。

## 必守規則

- **作者只有 Weihao**：本機 Git 身分 `Weihao <11246062@ntub.edu.tw>`；不加 `Co-Authored-By`、`Claude-Session`、`Generated with` 等任何 AI 署名。
- **小步 commit**：一個可獨立說明的修改一筆，每筆都要能通過相關測試。
- **不 push、不合併 `main`**：push 與合併 `main` 由使用者決定。推到 `main` 會自動部署到 VM。
- **複評（10/22～10/23）結束前**不刪除 VM 或 Atlas 的任何資料；測試只用暫存目錄與測試替身。
- 新分支用 `wip/…` 或 `feat/…`，不用 `claude/…`。
- 時程：11/13 前開發與驗收完成；11/16～11/27 佈展與評分期間凍結部署。不為了趕時程縮減功能，用平行開發與自動化測試補足。

## 分支現況

基底分支是 `feat/youtube-lifecycle`，各塊從它切出，完成後合併回它。

| 塊 | 分支（本機，未 push） | 狀態（10/20） |
|---|---|---|
| 整合 | `feat/youtube-lifecycle`（worktree `.claude/worktrees/yt-integration`） | A～E 全部合併並補齊缺口；合併進 `dev` 後由使用者 push |
| A 核心 | `feat/youtube-lifecycle-a-core` | 已合併 |
| B 管理員 API | `wip/yt-b-admin-claude-c0e4f3`（Claude 接手） | 已合併 |
| C 補回原片 | `claude/yt-c-restore-ac99e4` | 已合併 |
| D 短片 | `wip/yt-d-shorts-claude-a064be`（Claude 接手） | 已合併 |
| E 前端 | `claude/yt-e-frontend-540a69` | 已合併 |
| 已達重試上限（#34）＋部署前提文件 | `wip/yt-retry-limit-aa6b07`（worktree `.claude/worktrees/yt-retry-limit-aa6b07`，從 `dev` 切出） | 完成後直接合併進本機 `dev` |

`wip/yt-b-admin`、`wip/yt-d-shorts` 是 Codex 額度用完時留下的未提交草稿（worktree 仍在），已被 Claude 接手的分支取代，不合併。各塊分支與 worktree 由使用者決定何時清理。

`claude/` 開頭的兩條分支是在改分支前綴之前建立的；合併進 `feat/youtube-lifecycle` 後刪除，不要 push。

Claude 接手時可參考的 session（用 Claude Desktop 打開後說「繼續」即可）：A `local_6b455304-cfeb-4b45-bd6d-cf5253271203`、C `local_cfc00d53-8a5c-448a-9c0f-f855a29b6004`、E `local_976a39e8-31fb-4d65-896c-47d23a78ff5f`。

## 下一步（依序）

第 1～6 步已於 10/20 完成；第 8 步的合併部署與開啟恢復已於 10/22 提前完成（見[上線紀錄](../../10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)），正式站管理員頁已實際開啟確認。接下來做第 7 步，以及第 8 步剩下的上傳驗收與開啟清理。

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
8. **部署與開啟**：10/22 已合併 `main`（`88e3454`）並部署，恢復已開啟、憑證含 `youtube.force-ssl`。剩下兩項，每一步都要使用者明確授權：
   - **上傳驗收**：團隊下次實際上傳課程影片時，確認影片上傳 YouTube 成功，結果補進[上線紀錄](../../10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)。
   - **開啟清理**（11/9～11/13）：VM 的 `YOUTUBE_UPLOAD_CLEANUP_ENABLED` 目前是 `false`，先改成 `true` 並重啟後端，再由管理員在「YouTube 上傳管理」頁看預告清單（須為 0 支）後啟用；驗收方式見 decisions.md #33 與時程表。

## 新工作：上傳額度用完的處理與原片暫存播放（規格已定案，待實作）

2026-10-22 複評時評審問到 YouTube 每日上傳上限，現有程式沒有處理（約 10～15 分鐘用完 3 次重試）。討論中另發現正式站學生看不到還沒上 YouTube 的原片，一併納入「原片暫存與授權播放」。**尚未實作、尚未開實作分支**。

- 狀態（2026-10-26）：規格定案為 [decisions.md](decisions.md) #35～#64（第三輪原題號 R3-1～R3-14 對應 #51～#64，對既有決策的修改見該文件「第三輪對既有決策的修改」）；[共用資料契約](shared-data-contract.md)已核可；[工作說明](work-orders/Q-quota-playback-plan.md) Q-A～Q-F 可交付。
- **開始條件**：F0～F2 已本機合併且通過驗收，證據見[最終報告](evidence/2026-10-27_f0-f2-final-review.md)；F3、F4 仍未實作，沿用先完成這兩項再開始 Q 的門檻，並由使用者另行授權。此次只整合規格文件，不重跑 F0～F2 驗收，也不代表可修改程式或部署；現況見[目前狀態](../../current-status.md)。
- F0～F2 已有持久備份歸屬、cleanup intent、attempt heartbeat 與交易式刪課待辦；不是只靠單行程鎖。Q-A～Q-F 依[契約 §2.1](shared-data-contract.md#21-youtubeupload-子文件)沿用，不能拿全站上傳閘門取代既有來源／備份保護。
- 接手先讀：decisions.md #35～#64 → 共用資料契約 → 工作說明 → [額度研究](quota-upload-research.md)、[原片暫存播放研究](local-playback-research.md)。
- 部署前條件：正式 VM 唯讀查證（`nginx -T`、`pm2 jlist`、`ffprobe -version`、`nproc`、`free -h`、`df -h`）、nginx 設定變更與驗收、`LOCAL_PLAYBACK_ENABLED` 與 `privacy_guard` 的開啟，都需使用者授權，清單在工作說明 Q-F。
- 清理開啟時程改變：#58 改了清理條件，#33 的「11/9～11/13 開啟清理」要等 #58 的就緒判定在正式環境驗收通過後。
- 時程：11/10 前實作完成為目標；11/16～11/27 凍結部署。

## 額度用完時

- **Claude 用完**：Codex 的額度另外計算，可以繼續第 4 步；使用者也可以讓 Codex 讀本文件，接手第 1～6 步的合併與測試。
- **Codex 用完**：B、D 改開 Claude session，用同一份 work-orders 當工作說明。
- **任何接手者都先做**：讀本文件與 decisions.md → `git worktree list`、各分支 `git log` 對照上表 → 從「下一步」第一個未完成的項目開始 → 完成一步就更新本文件的「分支現況」與日期，並 commit 到 `feat/youtube-lifecycle`。
