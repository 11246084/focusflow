# v3.0 截圖原始紀錄

圖 01、02、03 用到的網站截圖都來自這裡的原始擷取檔。原始檔保留下來，之後要重裁或改圖時可以直接使用。

## 擷取條件

- 日期：2026-09-27
- 網站：`https://focusflow.ntub.edu.tw`，帳號為 Demo Student（`@focusflow.local` 測試帳號），課程〈影片處理工具 - OpenCV〉
- 對話：`conversations` `6ab8d58ed2df5d6e221eb8a0`，追問紀錄為 `questions` `6ab8d5ddd2df5d6e221eb8b7`
- 方式：Claude 桌面版內建瀏覽器顯示頁面，以 PowerShell `Graphics.CopyFromScreen` 擷取螢幕（螢幕 1920×1080，縮放 125%）
- 內容沒有經過修改；引用卡片內文是語音轉寫原文，保留「OvenCV」等轉寫錯字

## 原始檔

| 檔案 | 內容 |
|---|---|
| `raw-01-page-player-1m10.png` | 點選追問回答中的〈第十講 1:08–1:26〉引用後，播放器暫停在 1:10 的整個網站窗格（1385×872）。已裁掉窗格外的桌面與工作列 |
| `raw-02-chat-scroll-0.png`～`3.png` | 對話區（`.qa-message-list`）捲動到 `scrollTop` = 840、1000、1160、1212（CSS px）時的擷取，各 439×256 |
| `raw-03-shorts-playing-user.png` | 使用者在對話中提供的截圖（2026-09-27）：學生端「教學短片」牆點開〈open cv 跟 yolo 的關係是甚麼?〉播放中，畫面為「怎麼選？OpenCV（CPU）／YOLO（GPU）」與教師數位分身，374×634 |
| `raw-04-shorts-wall-user.png` | 使用者提供的截圖（2026-09-27）：「教學短片」牆列表。兩支短片都沒有預覽圖，原因是 shortassets 的 `thumbnail` 為 null（上架與同步流程都沒有寫入），不是截圖問題，433×538 |

## 由原始檔產生的素材（`source/v3-0/assets/`）

座標以原始檔的像素為準（x, y, 寬, 高）。

| 素材 | 來源與裁切 |
|---|---|
| `screen-player.png` | `raw-01` 的 (352, 86, 498, 390)：播放器與下方「第十講」列 |
| `top-logo.png` | `raw-01` 的 (42, 52, 216, 60)：側欄 Logo |
| `screen-answer.png` | `raw-02-0`～`3` 依序貼在 y = 0、200、400、465（實體 px，等於 CSS 位移 ×1.25），高 721；再裁掉右側 11 px 捲軸，成為 428×721。接合前以像素比對確認 200 px 位移的差異最小（平均 6.8，最大 11；位移 ±1 以上時平均 47 以上） |
| `top-question.png` | `screen-answer.png` 的 (74, 4, 350, 82)：追問泡泡 |
| `top-answer.png` | `screen-answer.png` 的 (0, 84, 428, 100)：回答前兩行 |
| `screen-shorts.png` | `raw-03-shorts-playing-user.png` 原圖，未裁切 |
| `top-citation.png` | `screen-answer.png` 的 (10, 346, 414, 114)：〈第十講 1:08–1:26〉引用卡片 |

各素材的 SHA-256 記在 `records/v3-0/manifest-v3-0.json` 的 `assets` 欄位。
