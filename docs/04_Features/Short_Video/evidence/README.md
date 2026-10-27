# 短影片驗收證據

短影片驗收證據：目前保留此入口。自動腳本的既有證據仍在相鄰 Short_Script_Automation/evidence，不複製結果。

## recut 設計比較圖（2026-10-17）

以下是 [recut 設計決策](../recut-design-decisions.md) 的佐證圖，由 repo 外的原型資料夾複製；圖中不含教師肖像，Fluent Emoji 與 Phosphor 圖示皆為 MIT 授權。

| 圖 | 內容 | 對應決策 |
|---|---|---|
| [Gemini 畫圖與程式組圖](2026-10-17_illustration-gemini-vs-program.png) | 同一比喻分別由程式＋Phosphor 與 Gemini 畫成；Gemini 把大方塊畫成橫跨兩桌，意思相反 | 第 13 項 |
| [四種色系](2026-10-17_theme-palette-comparison.png) | A 暖白奶油、B 淺紫漸層、C 深梅紫、D 品牌漸層 | 第 20 項（後改為 N2） |
| [四種素材來源](2026-10-17_asset-source-comparison.png) | Fluent 原色、Fluent 改主題色、Phosphor、Fluent＋Open Peeps | 第 22 項 |
| [四種底色](2026-10-17_background-color-comparison.png) | Fluent 原色物件放在 B、N1、N2、G 底色上 | 第 20 項 |
| [單一畫面示意](2026-10-17_frame-mockup-n2.png) | N2 藍紫夜、全版動畫、一張流程圖卡＋字幕；手刻靜態畫面，非正式排版 | 第 10、20、29 項 |

## 判斷模型測評（2026-10-19）

- [Jev 獨立測評證據](2026-10-19_jev-independent-evaluation.md)：整理 Jev 與 Gemini Flash 等模型的第三方測評、廠商評測偏誤與試跑比較方法，對應第 44 項；第 46 項據此取消 recut 的 Jev 比較。
- [合成語音引擎選項查證](2026-10-27_tts-options.md)：比較開源可自架模型與雲端免費額度的授權、台灣口音、資料外送與硬體需求，對應待答 R9（第 78～80 項的合成語音版）。

## recut 教師體驗評估素材（2026-10-21 建立，2026-10-23 第六輪修訂）

第 57、73～75 項的評估素材，放在 [2026-10-21_recut-teacher-ux](2026-10-21_recut-teacher-ux/)；既有五張 PNG 已按「先審講稿，再審影片成品」重製，新增成品審閱與同頁原音查核兩張狀態圖；第二輪移除教學框、更新流程圖示與修改中狀態，AI 建議移到上方分頁提案。第五輪依現有教師頁的深梅紫漸層、深色卡片、品牌標誌、導覽與膠囊按鈕重做，並依 design-critique 自評；第四輪淺色稿面已否決。第六輪精簡常駐小字與重複資訊，課程來源按需展開，原音及時長集中於審閱操作區，設計版本／自評收進原型工具。七張圖不是七個必經步驟。資料夾與原檔名保留，PNG 為虛構靜態畫面，HTML 可切換本機示意狀態；沒有實際音訊、MP4、後端或已填寫的使用者評估結果。使用者已將第六輪定為本輪設計與評估基準；Q3 試聽、Q12 資訊配置、Q13 視覺方向與 Q4 素材確認依[體驗決策 UX-19](../decisions.md#本輪已定案明細2026-10-23)定案，實際操作仍待驗證。

- [啟發式評估檢查表](2026-10-21_recut-teacher-ux/heuristic-evaluation.md)：七張圖的入口、Nielsen 十大原則檢查問題與問題紀錄表，對應第 57 項①。
- [代理使用者測試腳本](2026-10-21_recut-teacher-ux/proxy-user-test.md)：六個任務（讀稿、修改查核、取消、部分採納建議、兩階段審核、成品試聽）、記錄表與繁體中文 SUS 問卷，對應第 57 項②；待可操作版本完成後執行。
- [HTML 原始檔](2026-10-21_recut-teacher-ux/preview-mockup.html)與[PNG 截圖工具](2026-10-21_recut-teacher-ux/render-mockups.cjs)：離線開啟／重製方式見檢查表，不啟動服務或呼叫模型。
- [設計方案與自評](2026-10-21_recut-teacher-ux/design-review.md)：2026-10-23 第五輪依現有教師頁重做，第六輪依瀏覽器回饋精簡資訊，再依 frontend-design／design-critique 檢查風格與可用性；提案與已定產品規則分開記錄。
