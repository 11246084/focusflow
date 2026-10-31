<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock

## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## communication
- primary_language: zh-Hant-TW
- audience: 鈦坦敏捷開發特別獎決賽評審團（產、官、學代表；熟悉敏捷，重視證據與誠實）
- objective: 說明團隊實際的敏捷方式並用案例 A（外部模型停用）與案例 B（測試回饋）佐證，讓評審看懂問題→決策→行動→改善、相信紀錄可追溯，並看到團隊清楚自己的不足
- core_message: 我們如何運用敏捷開發，讓每一次需求變動、技術問題與測試回饋，都成為下一次產品改善的起點
- consumption_mode: presentation

## mode
- mode: custom
- mode_references: narrative, pyramid
- mode_behavior: 以案例敘事推進，每頁標題寫成判斷句；案例頁固定走「問題 → 決策 → 行動 → 改善」四拍，證據代號只放在節點角落的小標籤，限制說明以小字留在同一頁。

## visual_style
- visual_style: custom
- visual_style_references: swiss-minimal, editorial
- visual_style_behavior: 瑞士網格直角平面與大留白做骨架，搭配編輯式細線規、kicker 小標與大號數字；扁平卡片、看板狀態欄、橫向時間軸與堆疊長條，卡片近乎直角無陰影，只有被強調的一張卡片用深藍綠實底反白；琥珀只標決策點、關鍵數字與警示；右上 Logo 標識與頁碼，左上短琥珀線為跨頁母題。

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
- font_family: Microsoft JhengHei, Segoe UI, sans-serif
- title_family: Microsoft JhengHei, Segoe UI, sans-serif
- body_family: Microsoft JhengHei, Segoe UI, sans-serif
- body: 28
- title: 46
- subtitle: 34
- lead: 30
- annotation: 22
- footnote: 18
- kicker: 20
- cover_title: 72
- hero_number: 96

## icons
- library: phosphor-duotone
- inventory: phosphor-duotone/kanban, phosphor-duotone/git-pull-request, phosphor-duotone/git-commit, phosphor-duotone/calendar-check, phosphor-duotone/warning, phosphor-duotone/check-circle, phosphor-duotone/x-circle, phosphor-duotone/magnifying-glass, phosphor-duotone/users-three, phosphor-duotone/chat-circle-dots, phosphor-duotone/clipboard-text, phosphor-duotone/rocket-launch, phosphor-duotone/shield-check, phosphor-duotone/flask, phosphor-duotone/arrows-clockwise, phosphor-duotone/lock-key, phosphor-duotone/robot, phosphor-duotone/list-checks, phosphor-duotone/target, phosphor-duotone/flag-pennant, phosphor-duotone/gauge, phosphor-duotone/chalkboard-teacher, phosphor-duotone/student, phosphor-duotone/git-branch, phosphor-duotone/test-tube, phosphor-duotone/cloud-arrow-up

## images
- lockup: images/lockup-color.png | source=user | crop=no-crop
- mark: images/mark-color.png | source=user | crop=no-crop
- p03_kanban: images/image_001.png | source=user | crop=no-crop
- p14_contrib: images/image_005.png | source=user | crop=no-crop

## page_rhythm
- P01: anchor
- P02: dense
- P03: dense
- P04: breathing
- P05: dense
- P06: dense
- P07: dense
- P08: breathing
- P09: dense
- P10: anchor
- P11: dense
- P12: dense
- P13: dense
- P14: dense
- P15: breathing

## pptx_structure
- mode: flat

## forbidden
- `mask`, `<style>`, `class`, external CSS, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<set>`, `<script>` / event attributes, `<iframe>`
- HTML named entities in text; write typography as raw Unicode and escape XML reserved characters
