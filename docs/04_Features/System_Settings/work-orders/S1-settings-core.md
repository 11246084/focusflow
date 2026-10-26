# 工作說明：系統設定 S1（設定核心）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/system-settings-s1-core`，從 `feat/system-settings` 切出。先讀 repo 根目錄的 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」並遵守。

## 先讀

1. [decisions.md](../decisions.md)：第 1～9、22～24、37～40 項，以及「已由 httpOnly cookie 功能完成或修訂的項目」。
2. 現有設定機制（要擴充，不要另起一套）：`backend/src/models/runtimeSetting.model.js`、`backend/src/services/youtubeLifecycleSettings.service.js`（`SWITCH_DEFINITIONS` 的寫法）。
3. `backend/src/config/env.js`、`backend/src/routes/admin.routes.js`、`backend/src/controllers/admin.controller.js`（`assertStepUp` 的用法）、`backend/src/services/stepUp.service.js`、`backend/src/services/adminAudit.service.js`、`backend/src/models/adminAuditLog.model.js`、`backend/src/routes/health.routes.js`、`backend/src/services/runtimeDiagnostics.service.js`、`backend/src/services/systemStatus.service.js`。
4. 前端：`frontend/focus-flow/src/components/DashboardApp.jsx`（admin 分頁）、`frontend/focus-flow/src/pages/AdminOverview.jsx`。
5. `.claude/rules/api-design.md`、`.claude/rules/security.md`、`.claude/rules/testing.md`。

## 要做

1. **定義表與讀取函式**（第 5、7、8 項）：新增 `systemSettings.service.js`（名稱可依 repo 慣例調整）。
   - 定義表每個 key 宣告：型別、合法範圍或選項、程式預設值、對應的環境變數、中文名稱、一句說明、調高與調低的影響、單位、風險等級（是否需要 step-up、是否必填理由）、所屬分區（AI 問答／短影片／學生使用額度）。
   - 第一版的 key：第 2 項的四個開關與兩個門檻、`QA_MAX_QUESTION_LENGTH`、三個功能的模型（第 3 項，值為 `{ provider, model }`，S2 才會真正使用）、第 40 項 recut 的兩個呼叫上限。額度相關 key 由 S3 加入。
   - 開關用兩層開關（環境變數允許＋資料庫在範圍內切換）；數值用「資料庫 → 環境變數 → 程式預設值」。
   - `getSetting(key)` 同步回傳記憶體中的生效值；啟動時載入、寫入後同程序立即更新、每 60 秒重讀；載入失敗時退回環境變數並記錄錯誤。**不修改 `env` 物件。**
   - 環境變數 `SYSTEM_SETTINGS_DB_ENABLED=false` 時完全忽略資料庫的值（第 38 項），加進 `env.js` 與 `.env.example`。
2. **把白名單內的參數改成透過 `getSetting` 讀取**：找出所有讀這些 `env.xxx` 的地方逐一替換（例：`faqCache.service.js`、`short-script.routes.js`、`qa.routes.js`、`askLimits.service.js`、`qa.service.js`）。行為在資料庫沒有值時必須和現在完全相同。
3. **修改紀錄**（第 6、9 項）：擴充 `adminAuditLogs`（目前只有 `userId/event/result/reason`），新增對象、舊值、新值、理由、操作者當時的 Email 等欄位，維持只能新增、`autoCreate: false`、`autoIndex: false`。設定修改與恢復預設都寫入。
4. **admin API**（第 23 項，全部掛在 admin router 下）：`GET /admin/settings`、`PATCH /admin/settings/:key`（`{ value, reason }`）、`DELETE /admin/settings/:key`、`GET /admin/settings/changes`（分頁、可依 key 篩選）。寫入用 `typeof` 嚴格驗證，不認得的 key 回 400；風險等級高的 key 先呼叫 `assertStepUp(req)`（第 29 項）；模型與開關的理由必填。新增錯誤碼要補進 `.claude/rules/api-design.md`。
5. **狀態顯示**（第 24 項）：`/health` 新增 `runtime.systemSettings`（是否從資料庫載入、最後載入時間、載入錯誤、被改過的鍵名，**不含值**）；`runtime.qa` 中被白名單覆蓋的欄位改回報生效值；管理員總覽的系統服務（`systemStatus.service.js`）顯示同樣的載入狀態。
6. **前端「系統設定」分頁**（第 4、22 項）：在 admin 分頁加入「系統設定」，分成 AI 問答、短影片、學生使用額度、修改紀錄四區；每一項顯示中文名稱、說明、影響、範圍、目前值與來源；環境變數名稱收在「技術資訊」；每一項各自儲存，存檔前確認視窗顯示「舊值 → 新值」與影響範圍；只有改過的項目顯示「已修改」與「恢復預設」；開關旁寫「開啟／關閉」文字。高風險項目存檔時走既有的 step-up 畫面。模型欄位在 S2 前先顯示目前值、唯讀。
7. **文件**（第 37 項）：`backend/docs/openapi.yaml`（`tests/docs.routes.test.js` 要通過）、`backend/docs/phase2-api-contract.md`、`backend/docs/feature-flags.md` 加「後台可改」欄、`backend/.env.example`。

## 測試

用 `node:test` 與 `tests/helpers/backendTestHarness.js`。至少涵蓋：資料庫無值時行為與現在相同；三層優先順序；兩層開關（環境變數關閉時後台開不了）；型別與範圍驗證、未知 key 400、巢狀物件被拒；理由必填；高風險 key 沒有 step-up 時被拒；寫入後下一次 `getSetting` 立即生效；資料庫載入失敗時退回環境變數；`SYSTEM_SETTINGS_DB_ENABLED=false`；修改紀錄寫入且含舊值與新值；教師與學生呼叫設定 API 得 403；`/health` 不含任何設定值。前端：分頁渲染、確認視窗、恢復預設只出現在改過的項目。

## 完成時回報

commit 清單、測試結果（已執行與未執行分開列）、和本工單不同的地方與原因，以及給 S2、S3 使用的介面（定義表怎麼新增 key、`getSetting` 與寫入函式的簽名、修改紀錄的寫法）。
