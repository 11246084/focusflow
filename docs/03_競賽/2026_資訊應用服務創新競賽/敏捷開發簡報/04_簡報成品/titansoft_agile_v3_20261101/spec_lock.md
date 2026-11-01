<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock

## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## communication
- primary_language: zh-Hant-TW
- audience: 鈦坦敏捷開發特別獎決賽評審，重視團隊實際怎麼調整、證據是否透明、技術處理是否確實
- objective: 用兩個真實案例說明團隊遇到外部變動和品質問題時怎麼小步調整、留下紀錄、驗證結果，讓評審相信流程真實可查並看到團隊誠實說出缺口
- core_message: 需求一直在變，我們靠看板和每週進度檢視小步調整，每一步都留下可追溯的紀錄
- consumption_mode: presentation

## mode
- mode: custom
- mode_references: narrative, showcase
- mode_behavior: 一頁一句話的案例敘事；開場三頁用產品發表節奏，每章以深青章節開場頁重置，章內頁面是同一場景的連續狀態，每頁只往前推一步；標題就是講者那句話，說明放講稿。

## visual_style
- visual_style: custom
- visual_style_references: editorial, swiss-minimal
- visual_style_behavior: 米白紙面編輯式排版，大號粗體標題靠左、kicker 小標與左上短琥珀線、細線規分隔；直角或 6px 小圓角平面色塊，無陰影無漸層；深青滿版只用在封面、章節開場與結尾；案例頁共用橫向日期軸，目前節點琥珀並逐頁前移；大數字只用於有紀錄的數字；右下 E 編號小標籤；產品截圖細框原樣置入。

## colors
- background: #FBF8F2
- secondary_bg: #F5EFE3
- primary: #1B4D5C
- accent: #E8A93C
- secondary_accent: #5E8F9C
- body_text: #15171A
- secondary_text: #5A6066
- divider: #D9D1C1
- negative: #B5482E
- positive: #3E7D5A

## typography
- font_family: Microsoft JhengHei, sans-serif
- title_family: Microsoft JhengHei, sans-serif
- body_family: Microsoft JhengHei, sans-serif
- body: 28
- title: 48
- subtitle: 34
- annotation: 22
- lead: 30
- footnote: 18
- kicker: 20
- statement: 60
- cover_title: 76
- hero_number: 150

## icons
- library: tabler-outline
- stroke_width: 2
- inventory: tabler-outline/layout-kanban, tabler-outline/calendar-event, tabler-outline/git-merge, tabler-outline/test-pipe, tabler-outline/alert-triangle, tabler-outline/circle-check, tabler-outline/circle-x, tabler-outline/lock, tabler-outline/search, tabler-outline/users, tabler-outline/message-circle, tabler-outline/rocket, tabler-outline/shield-check, tabler-outline/refresh, tabler-outline/list-check, tabler-outline/flag, tabler-outline/player-play, tabler-outline/clock, tabler-outline/database, tabler-outline/server, tabler-outline/cpu, tabler-outline/school, tabler-outline/file-text, tabler-outline/arrow-right, tabler-outline/bug

## images
- lockup_color: images/lockup-color.png | source=user | crop=no-crop
- lockup_white: images/lockup-white.png | source=user | crop=no-crop
- mark_color: images/mark-color.png | source=user | crop=no-crop
- mark_white: images/mark-white.png | source=user | crop=no-crop
- p03_jump: images/p03_jump.png | source=user | crop=no-crop
- p07_kanban: images/p07_kanban.png | source=user | crop=no-crop
- p25_report_form: images/p25_report_form.png | source=user | crop=no-crop

## page_rhythm
- P01: anchor
- P02: breathing
- P03: dense
- P04: breathing
- P05: dense
- P06: dense
- P07: dense
- P08: dense
- P09: breathing
- P10: breathing
- P11: breathing
- P12: anchor
- P13: dense
- P14: dense
- P15: dense
- P16: dense
- P17: dense
- P18: anchor
- P19: dense
- P20: breathing
- P21: dense
- P22: breathing
- P23: dense
- P24: dense
- P25: dense
- P26: dense
- P27: dense
- P28: dense
- P29: dense
- P30: anchor
- P31: dense
- P32: dense
- P33: dense
- P34: dense
- P35: dense
- P36: dense
- P37: dense
- P38: dense

## pptx_structure
- mode: flat

## forbidden
- `mask`, `<style>`, `class`, external CSS, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<set>`, `<script>` / event attributes, `<iframe>`
- HTML named entities in text; write typography as raw Unicode and escape XML reserved characters
- 請不要自行用假畫面、AI 生成畫面或示意圖冒充真實系統證據 (user)
