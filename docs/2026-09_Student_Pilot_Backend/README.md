# 2026 年 9 月學生試用版後端整合文件

本資料夾集中管理學生試用版後端的規格、施工單與驗收證據，讓需求、實作安排及完成證明維持清楚分層。

## 文件結構

```text
2026-09_Student_Pilot_Backend/
├── README.md
├── 2026-09_Student_Pilot_Backend_Spec.md
├── work-orders/
│   ├── work-order_README.md
│   └── 2026-08-27_spec-v1.0-work-order.md
└── evidence/
    ├── evidence_README.md
    ├── 2026-08-30_phase1-implementation-results.md
    ├── 2026-09-01_baseline_questions.md
    ├── 2026-09-01_baseline_questions.json
    ├── 2026-09-01_wo13-enrollment-revoke-before.json
    └── 2026-09-01_wo13-enrollment-revoke-after.json
```

| 位置 | 主要責任 |
|------|----------|
| [規格書](2026-09_Student_Pilot_Backend_Spec.md) | 定義需求、範圍、安全紅線、錯誤碼與驗收條件 |
| [施工單](work-orders/2026-08-27_spec-v1.0-work-order.md) | 將規格拆成可執行工作項、順序、測試與停止點 |
| [施工單說明](work-orders/work-order_README.md) | 說明施工單的撰寫、定版與維護方式 |
| [驗收證據說明](evidence/evidence_README.md) | 定義證據內容、命名、安全要求與保存方式 |

## 使用順序

```text
規格書定版
→ 施工單完成並核准
→ 依施工單實作
→ 執行驗收
→ 將證據存入 evidence/
```

本任務的判斷順序為：

```text
規格書 > 施工單 > 現有程式碼 > 實作者推論
```

若規格書、施工單與現有程式碼互相衝突，應記錄具體位置並停止該項工作，不得自行選擇版本。

## 目前進度

截至 2026-08-30，Phase 1 的 WO-01～WO-09 已完成本機實作與回歸測試：Backend 共 64 個 test suites、500 個 tests 全數通過。詳細項目、測試數字與未完成邊界見 [Phase 1 實作結果](evidence/2026-08-30_phase1-implementation-results.md)。

這不等於學生試用已通過正式驗收。Phase 2 的 [12＋2 baseline 題庫](evidence/2026-09-01_baseline_questions.md) 已於 2026-09-01 定版，並提供 [runner JSON 輸入](evidence/2026-09-01_baseline_questions.json)；Markdown 是人工定版與審查來源，JSON 只供 runner 執行。WO-13 已完成示範學生對「影像處理導論」的 Enrollment revoke，並保存[執行前](evidence/2026-09-01_wo13-enrollment-revoke-before.json)與[執行後](evidence/2026-09-01_wo13-enrollment-revoke-after.json)證據。`runtime.flag_snapshot`、raw JSON、人工複核表與正式 baseline 執行仍未完成；`final` 證據也尚未建立。

## 維護原則

- 需求與驗收條件只在規格書定義。
- 實作順序、檔案範圍與測試安排寫在施工單，不在施工單重新發明需求。
- 驗收證據只記錄實際執行結果，不用來補寫需求。
- 已保存的原始證據不得覆寫；需要重跑時新增一份。
- 文件與證據不得包含密碼、token、API 金鑰、資料庫連線字串或可識別學生的資料。
