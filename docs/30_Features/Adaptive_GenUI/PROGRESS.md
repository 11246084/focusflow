# Adaptive GenUI 進度與 Session 恢復

架構與門檻見 [PLAN](Adaptive_GenUI_PLAN.md)，任務狀態唯一來源為 [tasks.json](tasks.json)，執行協定見 [HARNESS](HARNESS.md)。本檔不複製完整 task 狀態表。

## 最新 checkpoint

- 更新：2026-10-12；runId：`run-20261012-harness-01`；執行者：Codex。
- HEAD：`7a9dc63ae1566bf624f76fd25b5d9d198a868500`；仍須在恢復時重新查證。
- 本輪授權來源：使用者要求「只更新規劃與 Harness 文件，不實作功能、不部署、不推送程式碼」。沒有本地功能開發／provider／shared Atlas／部署授權。
- 工作區基準：本功能目錄在本輪開始時已是 untracked，含上一輪 PLAN；保留並增修，未 stage/commit。
- 本輪修改：PLAN 0.2、tasks.json、HARNESS.md、本檔；無功能程式碼變更。
- activeTask：無；35 個功能／驗收任務均 todo，尚未執行。建立 Harness 不算 M0 工程已完成。
- Loop：尚未啟動；目前只完成文件階段。未啟動服務、背景程序、scheduler 或自動喚醒。
- 下一步：收到本地開發授權後選 `M0-E01`；契約與 fixtures 到位後可繼續 M1–M5 工程，不等 M0 人工品質驗收。
- 待外部條件：品質任務需要批准教材／模型費用及人工審查者；隔離 DB／瀏覽器可用性由實作輪確認，不假設已具備。
- 本輪文件驗證：見下方 run；功能／provider／人工／部署結果均不存在。

## 執行紀錄（只追加，修正另加註）

### run-20261012-plan-01

- 範圍：建立 PLAN 0.1，基準 HEAD `7a9dc63`。
- 結果：架構、M0–M7、品質門檻及測試規劃；未實作功能。
- 歷史文件驗證：相對連結、`git diff --check`、新增檔案空白檢查通過（移自原 PLAN §12，非本輪功能測試）。
- 未執行：功能／provider／Atlas／瀏覽器／部署，因當輪僅授權文件。

### run-20261012-harness-01

- 範圍：規劃與 Harness 文件；無功能任務 ID。
- 結果：保留技術決策與 M0–M7，拆成 35 個具依賴／驗收／測試方式的任務；工程與品質分離；交付時序及 metric 分母明確；恢復與停止規則移至 HARNESS。
- 官方依據：HARNESS §8 的 OpenAI／Anthropic 官方文章；未將文章操作慣例覆蓋 AGENTS。
- 已執行文件驗證（repo 根目錄）：Python 標準庫 JSON／DFS 檢查 exit 0；35 個唯一 ID、M0–M7 完整、無循環、必填驗收與測試方法齊全、所有 task 均 todo；26 engineering／8 quality／1 release。驗證 M0–M5 工程祖先均為工程、M5/M6/M7 品質依賴未被繞過。
- 已執行連結／門檻檢查：27 個本地 Markdown 連結存在，程式碼 fences 成對；PLAN 原數值門檻保留。人工核對單次 JSON 交付、獨立 metric 分母與工程／品質狀態責任一致。
- 空白驗證：`git diff --check`；另因目錄仍為 untracked，逐檔執行 `git diff --no-index --check -- NUL <檔案>`，均 exit 0。未將普通 tracked diff 的空結果當作新增檔案已驗證。
- 未執行：功能測試、依賴安裝、啟服、模型評測、資料庫、部署；本輪純規劃。
- 下一步：開發授權後 M0-E01；所有功能與品質 task 保持 todo。

## 每輪追加模板

```text
### run-YYYYMMDD-NN
taskId／執行者／session：
授權來源與目標（沿用時指前一紀錄，不放 credentials）：
HEAD／開始時未提交檔案／實際變更檔案與 hash 或 diff 摘要：
目標／實作結果／設計偏離與原因：
驗收逐項對應：
測試 cwd／完整命令或人工程序／隔離判定：
exit code／分子分母／失敗與修正／最後一次結果：
evidence 路徑（本目錄相對）與 schema/catalog/prompt/model/case 版本：
本地工程／真實模型／人工／發布各層結果：
未執行驗證與原因：
阻擋／已嘗試方法／解除條件：
下一 task 或未完成的具體步驟：
程序／preview 狀態與清理需求：
```

完成後更新 checkpoint 及 tasks 狀態；不覆寫先前失敗紀錄。原始 logs 建議放 `evidence/<runId>/`；不要將 planned evidence 路徑當成已存在的證據。
