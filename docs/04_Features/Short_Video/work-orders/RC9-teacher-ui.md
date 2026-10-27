# 工作說明：recut RC9（教師審閱介面）

分支 `wip/recut-rc9-teacher-ui`，從 `feat/recut` 切出（RC8 的 OpenAPI 已定稿）。先讀 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」。

**第一步**（決策第 89 項）：先另開子 agent 依 Nielsen 十大原則評估示意圖與評估素材，產出問題清單與嚴重度；依清單修正設計後再實作，清單附在回報，並標明是 AI 評估。

## 先讀

1. [體驗設計決策](../decisions.md)全部（UX-1～UX-19 與已定案明細）與[評估素材](../evidence/2026-10-21_recut-teacher-ux/heuristic-evaluation.md)、示意圖原始檔 `preview-mockup.html`。
2. [recut 設計決策](../recut-design-decisions.md)第 16、19、38、50、51、54、57、58、68、69、73、75～78、81、89、90 項。
3. 現有前端：`frontend/focus-flow/src/pages/TeacherShortScripts.jsx`、`frontend/focus-flow/src/services/shortScript.js`、`frontend/focus-flow/src/components/navigationConfig.js`、`frontend/focus-flow/README.md`；RC8 的 OpenAPI 端點。

## 要做

1. **選產片方式**（第 2、76、78、81 項）：選題後並列「recut」與「數位分身」，寫出預估時間與特性；選 recut 時顯示「將使用：您的原音／合成語音」並可改選。聲音同意的後端由 RC10 提供；RC10 未合併時先接假資料並在回報說明。
2. **處理中畫面**（第 16 項）：排隊、執行中、完成通知、失敗原因、取消。
3. **講稿審閱**（第 73 項、UX-2、UX-9、UX-14～UX-18）：細長流程列、完整講稿閱讀、修改入口；「選段說明」預設收起（第 50 項）；整句加回或移除、即時總長、套用修改、取消回到原版（第 51、54、68、69 項）；片頭重點句的提示（UX-11）；選填修改原因標籤（第 77 項）；AI 檢查建議預設收起、可勾選套用（第 19 項、UX-3）。
4. **輔助預覽**（第 6、38 項）：用 RC5 的預覽網頁即時播放，動畫跟著聲音；不是必經核准。
5. **成品審閱**（第 73、75 項）：看實際 MP4、核准發布或修改，依回審規則導向講稿或成品。
6. **風格**（UX-17）：延續 FocusFlow 現有教師頁的深色風格與共用 CSS；不預設教師有資訊背景，圖示搭配文字；尊重減少動態效果偏好。UX-4 的 Animate UI 2 只做局部比較，不整站更換，安裝新依賴前先在回報中說明影響。

## 測試

在 `frontend/focus-flow/` 跑 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`。至少涵蓋：未套用修改時核准停用並顯示原因；重新配圖中核准停用、可取消；總長超出時不能套用；兩段審閱的順序；成品回審的兩種路徑；鍵盤可操作主要動作。畫面完成後以本機假資料截圖七個示意狀態，附在回報中。

## 完成時回報

commit 清單、測試結果、AI 啟發式評估的問題清單與處理方式、和示意圖不同的地方與原因、截圖，以及第 58、76 項操作紀錄的資料位置（第 90 項以操作紀錄取代代理使用者測試）。
