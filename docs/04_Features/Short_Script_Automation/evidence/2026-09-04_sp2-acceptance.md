# SP-2 停止點驗收紀錄

| 項目 | 內容 |
|------|------|
| 日期 | 2026-09-04 |
| 對應 | 施工單批次 B（WO-05～WO-07）完成後的停止點 SP-2 |
| 依據 | 規格書 7.2 階段 B 驗收條件 |
| 結果 | **通過** |

## 核准

| 角色 | 姓名 | 日期 | 意見 |
|------|------|------|------|
| 專題負責人 | | 2026-09-04 | 核准（要求先補完路由涵蓋度後記錄） |

> 第一次跑檢查表時第 7 項未達成，補完 23 個測試後重跑全數通過，見第 2 節。

---

## 1. 規格書 7.2 檢查表

| # | 檢查項 | 結果 | 依據測試 |
|---|--------|------|----------|
| 1 | 注入含捏造 chunkId 的假生成結果，驗證器整份退回 | ✅ | `引用證據包外的 chunkId 時整份退回…` |
| 2 | 證據包無轉折句時回 `SHORT_SCRIPT_ARC_NOT_APPLICABLE` | ✅ | `模型判定證據沒有轉折句時…不硬生成` |
| 3 | `template` 只出現在結尾收尾拍 | ✅ | `template 出現在非最後一拍時視為驗證失敗` |
| 4 | provider 未設定時 fail-fast，不得靜默 fallback | ✅ | `provider 未設定時 fail-fast…` |
| 5 | 版本可逐版取出並比對差異 | ✅ | `版本逐版保留，可比對前後兩版` |
| 6 | `retrieval` 回饋重新凍結證據並標記已更換 | ✅ | `retrieval 回饋重生時會重新凍結證據` |
| 7 | 每條路由涵蓋成功、未授權、無權限、資源不存在 | ✅ | 見第 2 節（補完後達成） |
| 8 | 重跑兩次選出同一題，且記錄被淘汰者 | ✅ | `同樣資料重跑兩次結果完全相同` + `rejectedForEvidence` |
| 9 | 候選全過濾時回 `SHORT_SCRIPT_NO_CANDIDATE` | ✅ | service 與 route 各一 |
| 10 | 全套測試通過且測試數不減少 | ✅ | 批次 A 前 549 → **708**，0 fail |

## 2. 第 7 項：補完的路由涵蓋度

### 補完前的實際狀況

首次自查發現規格書要求「**每條**路由涵蓋四種情境」，但 401 與 403 只在單一路由上測過，其餘路由是靠「它們共用同一組 guard」推論。

**共用 middleware 是實作細節**：若日後有人把某條路由的 guard 拿掉，靠推論的測試抓不到。權限漏洞正是最不該靠推論的地方，因此判定該項未達成，不予打勾。

### 補完後的涵蓋矩陣

六條路由各自獨立驗證，不共用斷言：

| 路由 | 成功 | 401 | 403 | 404／錯誤碼 |
|------|:----:|:---:|:---:|:-----------:|
| `GET /courses/:courseId/short-scripts/candidates` | ✅ | ✅ | ✅ | ✅ `COURSE_MANAGE_DENIED` |
| `GET /courses/:courseId/short-scripts` | ✅ | ✅ | ✅ | — |
| `POST /courses/:courseId/short-scripts/auto` | ✅ | ✅ | ✅ | ✅ `SHORT_SCRIPT_NO_CANDIDATE`／`COURSE_MANAGE_DENIED` |
| `GET /short-scripts/:scriptId` | ✅ | ✅ | ✅ | ✅ `SHORT_SCRIPT_NOT_FOUND`／`INVALID_ID` |
| `POST /short-scripts/:scriptId/generate` | ✅ | ✅ | ✅ | ✅ `SHORT_SCRIPT_NOT_FOUND`／`COURSE_MANAGE_DENIED` |
| `POST /short-scripts/:scriptId/review` | ✅ | ✅ | ✅ | ✅ `SHORT_SCRIPT_NOT_FOUND`／`VALIDATION_ERROR` |

另對每條路由驗證 **feature flag 關閉時回 404**（共 6 個測試）。

路由測試由 12 個增至 **35 個**。

## 3. 批次 B 期間攔下的一個嚴重錯誤

WO-07 首次實作時，短影片路由使用 `router.use(guard)` 掛載 guard。該 router 掛在 `'/'` 之下，**router 層級的 middleware 會攔截所有經過的請求**，因此 feature flag 預設關閉的狀態下，**整個 API 都變成 404**——包含影片上傳、課程建立等既有功能。

39 個既有測試立即轉紅，錯誤才沒有進入版控。

**修法**：guard 改為掛在每一條路由上，未匹配的路徑完全不經過該 middleware。

**教訓**：掛在 `'/'` 的 router 不得使用 router 層級 middleware。此點已寫入 `short-script.routes.js` 的程式註解。

## 4. 批次 B 的實作範圍

| 工作項 | 內容 | 測試數 |
|--------|------|--------|
| WO-05 | 腳本生成與引用驗證、弧線適用性判定（DR-12 第 4 層） | 17 |
| WO-06 | 審核迴圈、回饋分流、狀態機、成本紀錄 | 15 |
| WO-07 | 六條教師端路由、feature flag | 35 |

生成階段的測試全部以 mock `fetch` 執行，**不呼叫真實 LLM**，因此零成本、零延遲、結果確定。

## 5. 執行環境

| 設定 | 值 |
|------|-----|
| `SHORT_SCRIPT_AUTOMATION_ENABLED` | `false`（預設關閉，測試中個別開啟） |
| `SHORT_SCRIPT_GENERATION_RETRY_LIMIT` | 2（共 3 次生成） |
| `SHORT_SCRIPT_MATCH_LIMIT` | 6 |
| `SHORT_SCRIPT_TOPIC_SIMILARITY_THRESHOLD` | 0.90 |
| 生成 provider | Gemini（測試中以 mock `fetch` 取代） |

## 6. 遺留事項（不擋 SP-2，但須追蹤）

- ~~尚未以真實 LLM 執行過任何一次生成~~ → **已於同日補做**，見 [真實 LLM 生成試跑紀錄](2026-09-04_real-llm-generation-trial.md)。三次試跑各暴露一類 mock 測試看不到的缺陷（捏造引用、簡體字、字幕複製口白與 CTA），均已修正並補測試；第四次一次通過，敘事骨架與手寫腳本 V5 幾乎重合。
  - 仍未驗證：其他主題與課程的表現、弧線不適用情境在真實資料上是否正確觸發。
- 生成品質沒有判準（P-02），本階段不驗收品質。
- 前端未串接（規格書 3.2 明確排除本輪）。
- OpenAPI 尚未補上六條新路由。
- 教師數位分身的書面同意書格式（P-03）仍待決，擋 SP-3。
