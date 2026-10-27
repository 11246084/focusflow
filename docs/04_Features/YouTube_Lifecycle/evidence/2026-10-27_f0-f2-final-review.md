# F0～F2 收尾審查與驗證（2026-10-27）

本文件記錄對現有未提交修復的收尾檢查、最後一項待辦恢復修正與驗收證據。依使用者要求採風險導向驗證，沿用仍有效的結果，不以增加案例或另開審查循環作為結案條件。結案與整合狀態只看[目前狀態](../../../current-status.md)。

## 審查基準

- 唯一修改工作樹：`D:/AI-workspace/focusflow-youtube-lifecycle-review`，`fix/youtube-lifecycle-review`，HEAD `455c1eb322f64fd1650a0babb81bade84e5539f3`；包含前輪未提交 FR／NR 修復。
- 已讀 [10/26 審查](2026-10-26_f0-f2-review.md)、[FR 修復交接](2026-10-27_fr01-fr06-fixes.md)、[NR 修復交接](2026-10-27_nr01-nr02-fixes.md)、實際 source／schema／測試與 Git diff。前輪獨立報告已搬到 `D:/AI-workspace/04_Workbench/focusflow-youtube-review-2026-10-26/fr-independent-20261027/review.md`，本輪已讀取，沒有更動原報告。
- Node `v22.23.4`；新建 Mongo 7 replica set 僅綁定 `127.0.0.1:27128`。fixture 停用 dotenv、真實 fetch，測試使用隨機 DB 與自建原片；沒有啟動正式 server。
- 本輪審查與修復由同一主代理完成，沒有另派代理；不宣稱是未接觸修復過程的另一位審查者。使用者已授權本輪完成必要修復與結案判定。

## FR01～FR06 判定依據

| 項目 | 本輪程式判定 | 關鍵證據 |
|---|---|---|
| FR01 備份唯一歸屬 | PASS | `youtubebackups._id` 原子佔用，跨 Video／ShortAsset 唯一內容歸屬；不同內容／代數拒用，同內容可續做；跨課程 attach／detach 與共用匯入 URL 仍成立。完整 Mongo 既有案例通過。 |
| FR02 清理與回 draft | PASS | intent 先原子換 owner／來源版本、轉 recovering，再觀察檔案；取消／補寫須符合新 owner，沒有解鎖空窗。unlink 後 ShortAsset 保留 localCleanupAt，真正 rollback 不得恢復為有原片的 draft。 |
| FR03 舊工作上架 | PASS | 最終 published CAS 核對代數、核准、來源、備份、attempt、非 archived／published 與無清理 intent；最後上架前換代／封存仍受保護。 |
| FR04 活躍上傳 | PASS | Mongo heartbeat 判斷與 attempt 條件更新保留；另一行程恢復不隔離健康工作，缺省／過期 heartbeat 隔離而不重傳，失去 owner 中止傳輸。 |
| FR05 刪檔後收尾 | PASS | 缺檔先經新 owner 補寫，Video filePath 清空，真正 restore 可補回；不受清理關閉或空間恢復阻擋。DB 失敗與恢復者死亡均保留可再次接管的 intent。 |
| FR06 最後空間檢查 | PASS | 所有非破壞性 await 後才同步檢查空間、實體身份與期限並 unlink；空間恢復或 statfs 失敗保留原片。 |

NR01 原 P1 與 NR02 原 P2 的負向對照、交易故障與跨行程障壁見 [NR 交接](2026-10-27_nr01-nr02-fixes.md)。本輪完整套件再次驗證，不再重建已有 3 fail／11 fail 證據的舊版對照。

## 本輪新增並修正的 P2

**問題：** [courseDeletionJobs](../../../../backend/src/services/courseDeletionJobs.service.js) 雖有持久待辦與租約，外部呼叫卻沒有完成期限。第一筆 token／HTTP 或 JSON 本文一直不返回時，`runCourseDeletionJobs` 與 scheduledRun 一直未結束，單一 Backend 的後續待辦沒有機會重試；租約只讓另一行程可接管，不能解除本行程卡住的 await。

**負向重現：** 兩筆真正交易提交的待辦，讓第一筆 fetch 或本文停在障壁。等待 1 秒後後續工作仍未完成，兩案皆 fail（`final-deadline-before.log`：0 pass／2 fail）。測試最後釋放障壁完成清理，沒有遺留背景工作。

**最小修正：** 整段 token、轉私人與 response body 合計 30 秒。超時同時 abort HTTP 與結束等待，保留 pending／nextAttemptAt，繼續下一筆；逾時後的後續 HTTP 呼叫先核對 signal，不會根據遲到結果完成待辦。即使遠端已生效，下一輪重做相同 private 即可，並保留原 attempt 條件確認。沒有修改清理、上傳 heartbeat、單支影片刪除或 feature flag。

兩個回歸以短期限注入測試，不等待正式 30 秒；檢查取消訊號、第一筆 pending、第二筆 completed。`final-deadline-after.log`：2／2 PASS；也納入最終完整 Mongo suite。此次功能修改只在此待辦服務，另補既有 integration suite 與相關技術文件。

## 最終驗證與沿用證據

| 驗證 | 證據 |
|---|---|
| Backend 全套 | **1199／1199**，0 failed／cancelled／skipped，約 541 秒。`backend/final-backend.log` |
| 完整隔離 Mongo | **62／62**；14 個 F0～F2＋25 個 FR＋23 個 NR／期限案例，0 failed／cancelled／skipped，約 112 秒。`backend/final-mongo.log` |
| OpenAPI | `npm.cmd run docs:lint` 通過；1 個原有 explicitly ignored，沒有新增忽略。`backend/final-docs-lint.log` |
| 真實 120 秒租約 | 沿用同一份未修改的清理程式所產生 **58／58**（`backend/nr-mongo-final.log`），原 NR01 Video／ShortAsset 均實際等待到期；本輪不重等同一租約情境。 |
| standalone 拒絕 | 沿用 **1／1**（`backend/nr-standalone.log`）：不支援交易回 503，資料不變。本輪沒有修改 transaction 或 standalone 路徑。 |
| 文件／差異 | 本輪連結目標存在；`git diff --check` 通過，staged files=0。 |

Backend 全套與 Mongo 套件各集中執行一次最終驗收；先跑的 2 個負向／正向期限回歸用於確認修正有效，沒有反覆重跑已通過的整套。測試指令見 [Backend README](../../../../backend/README.md)。所有 logs 為 worktree 內被 Git 忽略的本機輸出；持續維護的證據是 regression suite 與本文件摘要。

受測版本 SHA-256：`courseDeletionJobs.service.js=86A887EE7D771483710D974C3FD9AF11A549910D67205100A0064C359464D580`；`youtube-recovery-atomicity.mongo.js=D884DD3DAF7AEA9C2D97B9D6F3ADAB3F76CD970B0C6DDBAEF9DF62788608D8E5`。兩檔均於最終套件開始前完成修改。

Mongo 結束已確認僅剩 admin／config／local；本輪 `focusflow-youtube-final-20261027` 容器已停止並移除。未接觸其他容器、Atlas、VM、真實 YouTube，未 Commit、Push、Merge 或部署。

## 殘餘限制與合併影響

- **無未解決的已知 P1／P2：** NR01 的 post-unlink 接管不再遺失 intent；NR02 的清理衝突／DB 失敗以整筆交易回滾，外部副作用採交易內待辦、提交後向前完成。新增的外部無回應問題也已修正。
- **交易部署前提：** 需要支援交易的 Mongo、適當權限與容量。standalone 明確拒絕，不是部分刪除；正式 topology、長交易容量、replica failover 未測，屬部署前驗證，不單獨阻擋程式合併。
- **外部完成時間：** 200 只確認 DB 已提交；開關關閉、憑證不足或服務離線時待辦保留，YouTube 不保證立即下架。完成工作與備份歸屬保留，沒有自動回收政策。
- **既定協定邊界：** 所有相關 writer 須升級；storage identity／正常時鐘假設不變。任意外部 DB／檔案替換與未參與交易的既有 pipeline 寫入未擴大重構。歷史重複備份仍需授權盤點，沒有自動修正式資料。
- Frontend／瀏覽器、STT／FFmpeg、正式服務人工驗收未執行：本輪沒有介面／pipeline 變更或正式操作授權。F3／F4、Q-A～Q-F 保持範圍外。

## Git 整合建議（未執行）

1. 授權提交後，僅在本修復 worktree 檢查並提交必要 source／models／tests／package／契約與證據；包含目前未追蹤的兩個 model、待辦服務、integration fixtures／workers／suites，不能只提交 tracked diff。沿用本機 Git 身分，不加入 AI trailer；logs 不需強制納入。
2. 在乾淨的目標分支整合工作樹合併修復分支。本機 `dev` 與 HEAD 共有基底 `c52682f`，目前為 dev 額外 8／修復分支額外 3 個既有 commit，並非 fast-forward。這是本機 refs 的判斷，未查遠端。
3. 主工作目錄已有未提交的第三輪規格與其他文件，保持原狀；整合時保留目標分支的最新規格，不能拿修復分支的舊文件整份覆蓋。
4. 合併／衝突解決後若變更程式或依賴，再執行受影響回歸及 CI 所需完整驗收。正式部署前另確認交易能力、所有 writer 升級與既有啟用門檻；本輪未獲部署授權。
