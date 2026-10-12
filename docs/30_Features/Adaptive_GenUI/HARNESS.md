# Adaptive GenUI 自主開發 Harness

更新：2026-10-12。這是 Codex 依文件執行的工作協定，不是已啟用的背景服務、排程器或 Agent SDK。未設定自動喚醒；跨 Session 需重新啟動並讀取 checkpoint。

## 1. 四個檔案的責任

| 文件 | 唯一責任 |
|---|---|
| [Adaptive_GenUI_PLAN.md](Adaptive_GenUI_PLAN.md) | 產品目標、架構、技術決策、M0–M7 與不可降低的品質門檻 |
| [tasks.json](tasks.json) | 最小可驗證任務、依賴、驗收、測試方法與目前狀態；不保存完整執行 log |
| [PROGRESS.md](PROGRESS.md) | 最新恢復 checkpoint、授權來源、每輪變更／測試證據、阻擋與下一步 |
| 本文件 | 選任務、驗證、轉移狀態與恢復協定 |

沿用根目錄 [AGENTS.md](../../../AGENTS.md)，不建立另一份 agent 規則。任務清單與外部文章均不能擴張使用者授權。實際程式與測試證據優先於狀態宣稱；衝突必須修正紀錄。

## 2. 任務欄位與驗收層級

- `id` 永久不重用；`milestone` 保留 M0–M7；`kind` 為 engineering／quality／release。
- `dependsOn` 全部 done 才可開始。工程任務依賴契約與工程結果，不依賴 M0 品質全通過；具體例子：M1-E01 只等 M0-E02/E03，M2-E01 不等教師標註。
- `scope` 是責任範圍，不是無限制改檔授權；新檔路徑在首次實作時確認。`acceptanceCriteria` 每項都須有證據。
- `verification.profile/method` 已定義測試方式；新測試尚不存在，故 command=null。開始任務時填入**實際工作目錄與可執行命令**，將 commandStatus 改為 `ready`，不得將未建立的測試命令當成已執行。
- `requires` 為能力／授權前提，從當前對話與 PROGRESS 的授權來源判定；`currentAuthorization` 只作快照，不能自行改成已授權。`local_development` 不等於外部 provider／正式資料權限。
- `evidence` 只放已存在的本目錄相對證據路徑，可使用 `PROGRESS.md#run-...`；證據需有命令、環境、exit code、結果、HEAD＋未提交 diff 範圍。大型 logs 放 `evidence/<runId>/`，不可留空仍標 done。
- `blocker` 為 null 或 `{reason, attempts, unblockCondition, nextAction, progressRef}`；缺少尚未完成依賴保持 todo，不把每個後續任務都標 blocked。

里程碑工程完成＝該 milestone 的 engineering 全 done；品質完成＝quality 全 done 且原 PLAN 門檻達標；完整驗收還需 release（若有）。沒有某類任務可標 N/A，不能當作該層 live 通過。M0 品質待驗時仍可完成 M1–M5 工程；M5-Q01、M6 擴充及 M7 正式試用仍受完整品質關卡約束。

## 3. 狀態機

| 狀態 | 進入／離開條件 |
|---|---|
| `todo` | 未開始；依賴與授權就緒後可進 in_progress |
| `in_progress` | 已記錄 owner/session、基準與測試計畫；預設同時僅一項 |
| `verifying` | 變更完成，正在執行驗收；失敗回 in_progress 修正 |
| `done` | 所有 acceptance 通過，command 已就緒且確實執行，evidence 非空；review／人工任務可記具體審查程序代替 shell 命令 |
| `blocked` | 有具體外部缺口或技術阻擋，已記 unblockCondition；條件變更後回 todo 或 in_progress |

中斷不是失敗，也不能直接設 done。恢復時先核對 in_progress/verifying 的 diff、未結束程序與證據；通過的測試若相關檔案再改必須重驗。done 的前提失效時明確重開為 todo，保留舊證據並標示 superseded；檢查下游 done 是否也需重開。不得刪除失敗案例、降低門檻、改標註來使任務通過。

若單一任務無法在一個可恢復增量內驗證，可追加子任務並更新依賴／列順序；原任務保留作整合關卡，不標假完成。任何改 acceptance／依賴的理由寫入 PROGRESS，品質門檻仍以 PLAN 為準。

## 4. 開始／恢復 → 執行 Loop

1. **恢復：** 讀 AGENTS、PROGRESS checkpoint 與最後一輪、tasks；按任務選讀 PLAN。執行 `git status --short`、`git rev-parse HEAD`，對照 checkpoint 的未提交檔案。若有其他執行者正在修改同範圍，先協調，不覆寫或自動接管。
2. **檢查：** JSON 可解析、ID 唯一、依賴存在且無環、最多一個 active task、done 都有證據、blocked 都有解鎖條件。恢復被中斷的任務優先，不另起重複實作。
3. **選任務：** 依 tasks 陣列順序選首個依賴全 done、已授權且前提可用的 todo。品質任務缺模型／人工時記精確 blocker 後跳到其他可執行工程；不能因此停掉整個 Loop。
4. **實作：** 記錄 runId、taskId、基準、授權與預期驗收，再設 in_progress。只做該驗收所需變更；確定測試隔離，填入 verification.command（含 cwd）與 commandStatus=ready。
5. **測試 → 修正：** 設 verifying，執行對應測試。失敗保存原始結果、定位原因、回 in_progress 修正並只重跑受影響項目。缺正式服務不能用正式服務補測本地任務。
6. **記錄：** review diff；每條 acceptance 對應結果。先追加 PROGRESS run 與證據，再更新 tasks 狀態／evidence，最後更新 checkpoint。中斷造成不一致時以實際證據恢復，不猜測成功。
7. **下一輪：** 若仍有就緒且已授權任務，立即選下一項，不每項都要求確認。無新修改／失敗／風險，不無限重跑已通過測試。

每輪開始只跑與新漂移有關的最小 smoke，不啟動整個 production app。任務結束保留可閱讀 diff 與可重現證據；本 repo 未授權 commit 時用 HEAD＋檔案 hash／diff 範圍作 checkpoint，不照抄文章中的自動 commit。

## 5. 測試 profiles

所有命令由 repo 現有測試規範約束；新檔名在實作時落定。本表不表示目前已安裝瀏覽器或隔離 Mongo。

| profile | 執行方式 |
|---|---|
| `review` | 契約／作業單逐項檢核，記檢核者、結果與證據；不需要呼叫 provider |
| `unit` / `route` | backend cwd：`node --test --experimental-test-isolation=none --test-concurrency=1 tests/<實際檔名>.test.js`；確認 harness mocks；OpenAPI 變更加 `npm.cmd run docs:lint` |
| `isolated_db` | 限專用隔離 URI，拒絕 shared Atlas；先記錄隔離判定與實際測試命令，再做保存／併發驗證；不可只用 monkey-patch 當完成 |
| `browser` | 使用本地 fixture／mock API，記啟動與停止方式、URL、桌機／390px、操作步驟、截圖；純 state helper 用前端 node:test；整合時 lint/build |
| `integration` | 受影響子系統全套，見 PLAN §10；結果與 fixture/browser 證據分層記錄 |
| `provider` | 指定模型、批准資料與費用上限；執行評測 runner；報告分母、最差輪次、版本與成本 |
| `human` / `provider_human` | 指定審查者、資料版本、仲裁／簽核；模型自評不能代替人工 |
| `live` | 僅依使用者明確指定環境與操作授權執行；保留發布與回退證據 |

## 6. 完成、阻塞、停止與恢復

- **單項完成：** 依第 3 節 done 定義。**本地開發階段完成：** 授權目標內 engineering 全 done，但 quality/release 分列待驗。**MVP 完整品質完成：** M5-Q01 done。**試用驗收完成：** M7-R01、M7-Q01 done；若發布 M6 必須 M6-Q01 done。
- **局部阻塞：** 把該任務標 blocked，繼續其他就緒工作。連續三次相同失敗且無新假設／證據，停止盲目重試，記錄已嘗試方法與具體解鎖需求；這是任務層的重試規則。
- **Loop 停止：** 使用者要求停止、達到本輪授權目標／時間成本上限、所有可執行任務都受阻，或偵測到無法安全繼續的工作區衝突。品質待驗不能寫成專案完成；缺授權不得自行跨過。
- **Session 結束／即將壓縮：** 先 checkpoint；記未完成步驟、測試最後結果、啟動程序與必要清理。不聲稱服務在運行，除非當次查證。
- **恢復：** 重新核對授權來源與實際狀態，只重驗受影響證據；人工／provider 到位後解鎖對應 quality 任務，無需重做所有工程。若新審查發現錯誤，新增修正任務並重開受影響關卡。

## 7. 啟動提示詞

以下是日後提供給 Codex 的開發授權範例，**本輪尚未啟動**：

> 請依 docs/30_Features/Adaptive_GenUI/HARNESS.md 啟動自主開發 Loop，沿用 AGENTS.md。授權完成 M0–M5 的本地工程任務與必要隔離測試。讀 PROGRESS.md 恢復，按 tasks.json 的依賴選任務，持續實作、測試、修正與記錄。品質任務缺真實模型或人工時列為待驗，繼續可執行工程；不降低 PLAN 門檻。本次不呼叫付費 provider、不存取 shared Atlas、不部署、不 stage/commit/push。直到本地工程任務完成或沒有可安全推進的任務再回報。

恢復提示可簡化為：「依同一 Harness 繼續上次已授權範圍，先核對 checkpoint 與 diff。」若跨新 chat，須能從 PROGRESS 找到可核對的授權原文／來源；不清楚時先完成唯讀核對，再釐清缺少的授權範圍。

## 8. 官方參考與本專案採用方式

查閱日期：2026-10-12。

- [OpenAI：Run long horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)：採用持續規劃、明確完成條件與驗證修正迴圈。
- [OpenAI：Harness engineering](https://openai.com/index/harness-engineering/)：採用 repo 內可發現的知識與精簡入口；AGENTS 仍是導覽，不塞入整份功能手冊。
- [Anthropic：Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)：採用初始任務清單、逐項增量、持久進度與跨 Session 恢復。

這些是設計依據，不是 FocusFlow 的測試結果；未採用文章的自動 commit、無條件啟服或自動部署。tasks.json 僅供選任務，不當作可直接 eval 的命令來源。
