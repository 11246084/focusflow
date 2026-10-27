# 功能文件導覽

這份索引用來找功能規格與歷史證據，避免重複維護進度。請先到[目前狀態](../current-status.md)確認模組狀態，再按下表查閱相關文件；本頁不另列完成度或驗收結論。

| 要查的主題 | 文件用途與入口 |
|---|---|
| 學生試用 | [規格](Student_Pilot_Backend/specs/2026-09_Student_Pilot_Backend_Spec.md)、[文件入口](Student_Pilot_Backend/README.md)、[歷史證據](Student_Pilot_Backend/evidence/) |
| 短影片腳本 | [規格](Short_Script_Automation/specs/2026-09_Short_Script_Automation_Spec.md)、[操作與驗收文件](Short_Script_Automation/README.md) |
| 短影片產製參考 | [素材與模板](Short_Video/README.md)、[產製規格](Short_Video/specs/Phase2_Short_Video_Production_Spec_v1.md)；適用方向以狀態正本為準 |
| 自動產片原型操作 | [short_render 使用方式](../../short_render/README.md) |
| 問答品質評測 | [方法與題庫](QA_Evaluation/README.md)、[具日期的評測報告](QA_Evaluation/reports/) |
| 分層檢索 | [設計與資料契約](Hierarchical_Retrieval/README.md) |
| 教育開放資料補強（愛學網、學術名詞、教師統計；未入圍該組決賽，暫停） | [設計決策與待答題目](Open_Data/decisions.md) |
| 多模態檢索（文字、聲音、影像三路合併） | [設計決策與待答題目](Multimodal_Retrieval/decisions.md)、[參考文獻](Multimodal_Retrieval/references.md) |
| YouTube 上傳恢復與原片清理 | [設計決策](YouTube_Lifecycle/decisions.md)、[開發接手](YouTube_Lifecycle/HANDOFF.md)、[工作說明](YouTube_Lifecycle/work-orders/)、[額度與上傳可靠性技術研究](YouTube_Lifecycle/quota-upload-research.md)、[原片暫存播放研究](YouTube_Lifecycle/local-playback-research.md)、[共用資料契約](YouTube_Lifecycle/shared-data-contract.md) |
| 系統設定（後台調整模型、開關、門檻與學生額度） | [設計決策](System_Settings/decisions.md)、[開發接手](System_Settings/HANDOFF.md)、[工作說明](System_Settings/work-orders/)、[資安審查證據](System_Settings/evidence/2026-10-21_security-review.md) |
| recut 預覽與選段說明 | [體驗設計討論](Short_Video/decisions.md)、[產製設計決策](Short_Video/recut-design-decisions.md)、[開發接手](Short_Video/HANDOFF.md)、[工作說明](Short_Video/work-orders/)、[評估素材](Short_Video/evidence/2026-10-21_recut-teacher-ux/heuristic-evaluation.md) |
| httpOnly cookie 登入 | [設計決策（2026-10-24 全部定案）](HttpOnly_Cookie/decisions.md)；銜接系統設定的帳號驗證與撤銷機制 |
| Jev 問題守門與 LINE 意圖分類 | [設計決策與待答題目](Jev_Judgment/decisions.md) |
| LINE 帳號綁定 | [設計決策與待答題目](LINE_Binding/decisions.md)；回呼設計須等 cookie 方案定案 |
| 學生端播放介面（章節、分段時間軸、回到目前播放位置） | [設計決策與待答題目](Student_Player_UX/decisions.md) |
| 帳號、課程、影片、網頁與 LINE | [後端技術索引](../../backend/docs/current-state.md)、[網頁使用方式](../../frontend/focus-flow/README.md) |

例：想知道短影片能否交付 → 讀狀態正本的短影片模組 → 再查該功能的規格與驗收證據；不能把規格中的目標當成驗收結果。

更新進度時只修改[目前狀態](../current-status.md)，本頁與其他索引只維護連結；歷史證據保留原日期與環境。上述功能資料夾中的文件仍依各自用途閱讀，本輪不修改其內容。
