# 03 GitHub 工程實踐分析

查詢日期：2026-11-01。只讀：本機 `git log`（已 `git fetch` 更新遠端參考，未改分支、未提交）＋ GitHub 公開 REST API（未登入）。沒有 GitHub MCP／`gh` CLI，GitHub 網頁上的 Projects、Insights、分支保護設定未讀取。API 快照存在 [02_Notion_GitHub_證據/github_api_snapshot_20261101/](../02_Notion_GitHub_證據/github_api_snapshot_20261101/)。

## 一、Repository 確認

帳號 `11246084` 名下有 4 個公開 repo：`focusflow`、`study`、`toeic-cards`、`Work-Track`。只有 **`11246084/focusflow`** 屬於 FocusFlow AI（其餘名稱與內容無關，未分析）。

| 項目 | 內容 |
|---|---|
| URL | https://github.com/11246084/focusflow |
| 建立 | 2026-03-24（第一個 commit 2026-03-25「Initial commit」） |
| 預設分支 | `main`（部署分支）；開發分支 `dev`（約 2026-09-21 起使用） |
| 頂層結構 | `backend/`（Node.js API）、`frontend/focus-flow/`（React＋Vite）、`STT_Whisper/`（Python AI Pipeline）、`database/`、`docs/`、`short_render/`、`tools/`、`.github/` |
| 文件 | README、PROJECT、ARCHITECTURE、AGENTS／CLAUDE（AI 協作規則）、`backend/docs/openapi.yaml`（92 個 API 路徑，Swagger）、`docs/current-status.md`（唯一狀態正本）、各功能 `docs/04_Features/<功能>/decisions.md` |

## 二、Commit 歷程

`origin/dev` 至 2026-10-30：**699 commits**（全部分支 700）；`origin/main` 647。合併 commit 48 次。

| 月份 | commits | 主要內容 |
|---|---|---|
| 2026-03 | 20 | 會議紀錄、架構圖、Keras 報告 |
| 2026-04 | 86 | MVP 主線：後端、LINE、Atlas、前端初版 |
| 2026-05 | 47 | 初評、部署（05-28 建立 GitHub Actions） |
| 2026-06 | 4 | 期末考 |
| 2026-07 | 37 | Phase 2 後端、Shorts、YouTube 上傳 |
| 2026-08 | 67 | Phase 2-2、模型遷移、批次、修課權限、課程隔離 |
| 2026-09 | 188 | 學生試用版 Phase 1～4、上線、短影片 |
| 2026-10 | 251 | 複評後：YouTube 生命週期、cookie 認證、VM 資安、文件 |

**作者**（依 commit email 的學號推定姓名，需組員確認）

| Git 作者 | email | commits | 推定 |
|---|---|---|---|
| Weihao | 11246062@…／個人 gmail | 483 | 邱偉豪（PR 作者 `Hao-weii`） |
| 11246084 | 11246084@… | 149 | repo 擁有者；以排除法推定為鍾百陶 |
| zty930925 | 11246064@… | 44 | 張庭語 |
| 4ISHo0o0 | 11246085@… | 24 | 張家瑜（與 Notion 帳號同學號） |

Notion「說明書審查」頁（08-17）記 69／56／10／7 次，那是 08-17 前的數字；目前約 69%／21%／6%／3%，比例相近但絕對值已不同。

**Commit 訊息品質**：多數是中文完整句，說明做了什麼與測試結果。例：`166dd26`「Backend 完整回歸通過，共 66 suites、514 tests」、`44e9108`「Baseline 確認 Atlas Leaf-only、0 fallback、0 DB write」。commit 訊息**沒有引用 Notion 任務或 Issue 編號**。

## 三、Branch 與 Pull Request

**分支策略演變**

| 期間 | 做法 | 證據 |
|---|---|---|
| 03～09 月中 | 多數直接 commit 到 `main`（first-parent 有 331 筆），少數功能走 PR | `git log origin/main --first-parent` |
| 09-21 後 | 開 `dev`，功能在 `dev` 或 `feat/*`、`wip/*`、`fix/*` 分支，再合併 `dev → main` 部署 | PR #7、#8；`wip/httponly-cookie-auth`、`feat/youtube-lifecycle` 等合併 |

遠端目前只有 `main`、`dev` 兩個分支；功能分支多在本機合併後刪除，只留在 merge commit 名稱中。

**Pull Requests：共 10 個，全部已合併**

| PR | 日期 | 作者 | 分支 | 標題 |
|---|---|---|---|---|
| [#1](https://github.com/11246084/focusflow/pull/1) | 03-27 | Hao-weii | Meeting-minutes-branch → main | 變更會議記錄與上傳系統架構圖 |
| [#2](https://github.com/11246084/focusflow/pull/2) | 03-28 | Hao-weii | Hao-branch → main | Keras_Learning_Reports |
| [#3](https://github.com/11246084/focusflow/pull/3) | 04-11 | Hao-weii | codex/github-copy-agents-doc → main | Document repo-local github-copy skill usage |
| [#4](https://github.com/11246084/focusflow/pull/4) | 07-13 | Hao-weii | codex/backend-before-shorts-20260714 → main | 整合 Phase 2 後端功能與 Shorts 頁面 |
| [#5](https://github.com/11246084/focusflow/pull/5) | 08-02 | Hao-weii | codex/phase2-parent-search-integration → main | 完成 Phase 2-2 Parent Search 整合 |
| [#6](https://github.com/11246084/focusflow/pull/6) | 08-08 UTC（台灣 08-09 00:27） | Hao-weii | codex/stable-embedding-migration → main | 完成 Gemini stable embedding 遷移與相容性檢查 |
| [#7](https://github.com/11246084/focusflow/pull/7) | 09-22 | 11246084 | dev → main | 新增自建「回報問題」功能，取代 Google 表單 |
| [#8](https://github.com/11246084/focusflow/pull/8) | 09-28 | Hao-weii | dev → main | 管理員設定個別學生每日提問上限 |
| [#9](https://github.com/11246084/focusflow/pull/9) | 10-18 | Hao-weii | docs/cleanup-2026-10 → dev | 整理 docs 結構 |
| [#10](https://github.com/11246084/focusflow/pull/10) | 10-18 | Hao-weii | docs/restructure-2026-10 → dev | 依常用程度重整 docs |

觀察：PR 數量少、多數由同一人建立並自行合併；看不到 review 意見（API 未讀 review 內容，可再查）。程式審查改以 repo 內「獨立審查報告」文件進行（例如 YouTube 生命週期、cookie 認證的審查紀錄）。

## 四、Issues

**0 個 Issue。** 團隊沒有使用 GitHub Issues，需求與缺陷追蹤全部在 Notion 看板與 repo 文件（decisions.md、工作說明）。「Notion 需求 → GitHub Issue」這一環**不存在**，簡報不能畫出 Issue 節點。

## 五、GitHub Actions

只有一個 workflow：`Deploy to VM`（[.github/workflows/deploy.yml](../../../../../.github/workflows/deploy.yml)），觸發條件 `push` 到 `main`，執行在學校 VM 的 self-hosted runner。

**執行紀錄（API，155 次）**：成功 148、失敗 4、取消 3；第一次 2026-05-28，最近一次 2026-10-25（`d3de1ef`，cookie 認證上線）。

| 月份 | 成功 | 失敗／取消 |
|---|---|---|
| 05 | 1 | 2（05-28 初次建立 workflow） |
| 06 | 6 | 0 |
| 07 | 26 | 0 |
| 08 | 41 | 0 |
| 09 | 71 | 2 失敗、3 取消 |
| 10 | 3 | 0 |

失敗案例：`da1b422`「Validate production Atlas QA」（09-09，部署後的正式問答驗證失敗，隨即 `df40434` 診斷修正）、`1daf4e3`（09-10）。10 月只部署 3 次：改為在 `dev` 累積、驗證後才合併 `main`。

**workflow 內容演變**

| 日期 | commit | 加入的檢查 |
|---|---|---|
| 05-28 | `fe7fd98` | 拉程式、安裝、build、重啟 PM2、reload nginx（純部署） |
| 09-09 | `979cabd` | **部署後健康檢查**：輪詢 `/health` 直到 `readyForAsk=true`、Atlas 向量索引已設定、資料契約相容；nginx `/api` 代理回 401 |
| 09-09 | `da1b422`／`df40434` | 一次性正式環境 Atlas 問答驗證與診斷（以 commit 訊息觸發） |
| 10-24 | `5611fe5` | 前端 build 同來源檢查（dist 不得含 localhost 或絕對 API 網址），在重啟服務前執行 |

### 現況定位（以 workflow 檔為準）

| 項目 | 狀態 | 依據 |
|---|---|---|
| 持續部署（CD） | ✅ 有，push main 自動部署 | deploy.yml、148 次成功 |
| 部署後 Health Check | ✅ **2026-09-09 起已有**（v9 寫「尚未有」是 09-01 時點） | `979cabd` |
| 部署前 build 檢查 | ✅ 10-24 起有同來源掃描 | `5611fe5` |
| CI Gate（自動跑單元測試，失敗擋部署） | ❌ 沒有。workflow 不執行 `npm test`，也沒有 PR 觸發的 workflow | deploy.yml 無 test 步驟 |
| 自動回滾 | ❌ 沒有。健康檢查失敗只會讓 run 失敗，服務已重啟；退回靠上線紀錄寫好的「退回目標版本」人工執行 | deploy.yml；cookie 上線紀錄 |
| 分支保護、必要審查 | 未查（需登入讀設定） | — |

## 六、自動化測試

三端都有測試，但**都在本機手動執行**，不在 Actions 中。

| 子系統 | 框架 | 測試檔 | 執行方式 |
|---|---|---|---|
| Backend | `node:test` | 112 檔 | `npm test`；隔離 Mongo 另有腳本 |
| Frontend | `node --test` | 19 檔 | `npm test`、`lint`、`build` |
| AI Pipeline（STT_Whisper） | `unittest` | 16 檔 | `.venv` 執行 discover |

**Backend 全套測試數成長**（同一指令、不同日期；每一筆都是當天的全套數字，**彼此不可相加**）

| 日期 | 通過／總數 | 來源 |
|---|---|---|
| 04-06 | 40／40 | Notion 任務「Atlas 串接」 |
| 08-02 | 336（PR 當下）→ 342／342 | Notion Phase 2-2 報告 |
| 08-09 | 371／371 | Notion 模型切換任務 |
| 08-12 | 429／429 | Notion 批次任務 |
| 08-14 | 447／447 | Notion 批次任務（＝v9 數字） |
| 08-30 | 491 → 500 | commit `e4f1163`、`296ca01` |
| 09-01 | 514／514 | commit `166dd26`（＝v9 數字） |
| 10-22 | 1,123 | current-status（YouTube 上線） |
| 10-25 | 1,154／1,154 | current-status（cookie 上線） |
| 10-27 | 1,199～1,208 | current-status |
| 10-29 | 1,280（1,278 過、1 失敗、1 跳過） | current-status；失敗為舊開關斷言，修正後該檔 13／13 |

Frontend：11（08-12）→ 14（08-14）→ 107（10-22）→ 116（10-25）→ 158（10-29）。Pipeline：162（08-12）→ 168（08-14）→ 177（Notion 後續摘要）。

**本輪未重新執行任何測試**（第一階段只讀資料）。finals 準備文件原訂 11/1 程式凍結後重跑三端測試，簡報數字需以重跑結果為準。

## 七、測試以外的驗證層級（不可混為一談）

| 層級 | 例子 | 證據 |
|---|---|---|
| 自動化測試通過 | Backend 514／514（09-01） | commit `166dd26` |
| 隔離環境驗證 | 隔離 MongoDB 7 E2E：2 支影片 1 成功 1 失敗＝partial，重播 attempts 不變，他人 403 | Notion 批次任務 08-13 |
| 外部服務真實驗證 | 09-09 部署後正式 Atlas 問答驗證（第一次失敗、診斷後通過） | Actions run 34314687301／34315105403 |
| 問答品質驗證 | 12＋2 題 baseline（09-01）：0 PASS／11 WEAK／3 FAIL；09-06 非正式整合驗證 13 PASS／1 WEAK／0 FAIL（Q09 已改寫、原始結果未存檔，只有 commit 訊息） | `44e9108`；`915dcf1` |
| 正式驗收 | cookie 認證 2026-10-25 正式站驗收 | `docs/10_Operations/deployment/2026-10-25_httpOnly_cookie認證上線紀錄.md` |

## 八、AI 輔助開發（評審可能問）

分支名 `codex/*`、repo 內 `AGENTS.md`／`CLAUDE.md`、Notion 會議（03-24「ChatGPT 規劃 → Codex 實作」、04-24 任務「理解初評階段 AI 生成的程式碼」）都顯示大量使用 AI 工具。系統手冊 README 有揭露。建議主動說明「人定義完成條件與驗收、AI 依工作說明實作」，並準備證據（decisions.md 逐題定案、獨立審查報告）。
