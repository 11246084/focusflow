---
name: FocusFlow
description: AI 教學影片問答系統的教師與學生介面
colors:
  ember-orange: "#F14F21"
  deep-ember: "#D83A0E"
  deep-ember-pressed: "#BF330C"
  night-ink: "#0A0E27"
  plum-night: "#260C1E"
  sidebar-dusk: "rgba(18, 5, 14, 0.92)"
  chalk-white: "#FFFFFF"
  chalk-body: "rgba(255, 255, 255, 0.8)"
  chalk-muted: "rgba(255, 255, 255, 0.55)"
  hairline: "rgba(255, 255, 255, 0.09)"
  divider: "rgba(255, 255, 255, 0.05)"
  field-fill: "rgba(255, 255, 255, 0.055)"
  field-stroke: "rgba(255, 255, 255, 0.12)"
  status-ok: "#4ADE80"
  status-wait: "#FACC15"
  status-error: "#F87171"
  status-info: "#A5B4FC"
typography:
  stat:
    fontFamily: "Space Grotesk, Noto Sans TC, sans-serif"
    fontSize: "34px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Space Grotesk, Noto Sans TC, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  action:
    fontFamily: "Noto Sans TC, sans-serif"
    fontSize: "14px"
    fontWeight: 700
  label:
    fontFamily: "Noto Sans TC, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.1em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  card: "22px"
  pill: "50px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "22px"
  page: "26px"
components:
  button-primary:
    backgroundColor: "{colors.deep-ember}"
    textColor: "{colors.chalk-white}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "14px 34px"
  button-primary-pressed:
    backgroundColor: "{colors.deep-ember-pressed}"
  button-outline:
    textColor: "{colors.chalk-body}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "14px 34px"
  button-small:
    padding: "9px 16px"
    rounded: "{rounded.pill}"
  card:
    backgroundColor: "{colors.plum-night}"
    rounded: "{rounded.card}"
    padding: "22px"
  card-small:
    backgroundColor: "{colors.plum-night}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.field-fill}"
    textColor: "{colors.chalk-white}"
    rounded: "{rounded.lg}"
    padding: "14px 18px"
---

# Design System: FocusFlow

這份是給設計工具與 AI agent 讀的視覺基準（Impeccable 的 DESIGN.md），記錄 2026-11-11 前端已經在用的樣式，供新頁面沿用。產品事實在 [PRODUCT.md](PRODUCT.md)。

**適用範圍**：既有頁面維持原樣，不因這份文件改寫；從 recut 教師介面開始，新頁面照這份文件做。與既有頁面不同的地方只有兩處，都是為了符合 WCAG 2.1 AA：實心按鈕改用加深的橘（Deep Ember），以及文字不使用低於 55% 的白。新頁面使用的 CSS 變數在 `frontend/focus-flow/src/styles/tokens.css`。

## Overview

**Creative North Star: "夜間備課桌"**

像老師晚上在桌前整理教材：深紫褐的桌面、安靜的版面，只有這一步該按的地方亮起橘色。畫面不搶戲，資訊照工作順序排好，讓教師專注在講稿與影片本身。

介面密度中等，以大卡片分區、卡片內用細分隔線排列項目；狀態用小色塊標示，不用大面積警示色。標題用幾何感的 Space Grotesk，內文用 Noto Sans TC。

**Key Characteristics:**
- 深色底（Night Ink、Plum Night），白色文字依重要性降低透明度。
- 單一強調色 Ember Orange，只用在主要動作、選取狀態與數字重點。
- 大圓角卡片（22px）與膠囊形按鈕（50px）。
- 狀態一律是「圖示＋文字」的小色塊，不只靠顏色表達。

## Colors

深夜色調：深藍紫的頁面底、深紫褐的卡片，加上一個溫暖的橘。

### Primary
- **Ember Orange**：品牌強調色。用在強調文字、數字、選取標示、進度條、焦點框，以及既有頁面的實心按鈕。作為卡片上的文字對比 5.1:1。
- **Deep Ember**：新頁面的實心按鈕底色。比 Ember Orange 深一階，白字對比 4.63:1，符合 AA。
- **Deep Ember Pressed**：Deep Ember 按鈕的按下與滑過狀態。

### Neutral
- **Night Ink**：整個網站的頁面底色。
- **Plum Night**：卡片與面板的底色。
- **Sidebar Dusk**：側邊欄的半透明底。
- **Chalk White**：標題與最重要的文字。
- **Chalk Body**：內文（對比約 11.7:1）。
- **Chalk Muted**：次要說明、時間、輔助資訊（對比約 6.1:1）。
- **Hairline**：卡片外框。
- **Divider**：卡片內項目之間的分隔線，不承載文字。
- **Field Fill / Field Stroke**：輸入框的底與框線。

### Status
- **Status OK / Wait / Error / Info**（綠、黃、紅、藍紫）：狀態小色塊的文字色，底色用同色 14% 透明度。四色在卡片上的對比都超過 6.5:1。

### Named Rules
**The One Ember Rule.** 一個畫面上只有目前這一步的主要動作用實心橘色按鈕；其他動作用外框按鈕或文字按鈕。

**The 55% Floor Rule.** 新頁面的文字最淡只到 55% 白（Chalk Muted）。既有頁面裡 28%～45% 的白字對比不到 4.5:1，不要在新頁面沿用。

## Typography

**Display Font:** Space Grotesk（後備 Noto Sans TC）
**Body Font:** Noto Sans TC（後備 Microsoft JhengHei、微軟正黑體）

**Character:** 幾何感的英數標題配上方正清楚的中文內文；數字醒目，中文好讀。

注意：目前只從 Google Fonts 載入 Noto Sans TC，Space Grotesk 沒有載入，沒有安裝的電腦會顯示成後備字體。

### Hierarchy
- **Stat**（900，34px，行高 1）：儀表板的大數字，橘色。手機縮成 22px。
- **Title**（700，15px）：卡片與區塊標題。
- **Body**（400，13px，行高 1.7）：內文、講稿、說明。講稿這類長文每行不超過約 40 個中文字。
- **Action**（700，14px）：按鈕文字；小按鈕 12.5px。
- **Label**（600，11px，字距 0.1em）：英文大寫的區塊小標。

### Named Rules
**The Readable Chinese Rule.** 中文文字不小於 12px；11px 只給英文大寫小標。

## Layout

- 教師與學生後台是「側邊欄＋主內容」：主內容頁面內距 26px，卡片之間間距 12～18px，卡片內距 22px。
- 列表在卡片內用 Divider 分隔，不另外套卡片。
- 響應式斷點：1100px、1024px、768px、480px。768px 以下：四欄統計變兩欄，兩欄版面變單欄，統計卡內距縮成 14px 16px。
- 新頁面在手機上也要能走完整個流程：主要動作固定在可觸及的位置，觸控目標至少 44×44px。

## Elevation & Depth

以色調分層表達深度：頁面（Night Ink）→ 卡片（Plum Night）→ 卡片內的輸入框與小區塊（白色 5%～8% 疊加）。平常不使用陰影；只有主要按鈕滑過時出現橘色光暈（`0 8px 24px rgba(241, 79, 33, 0.35)`）。彈出視窗用半透明黑底加 6px 模糊遮住背景。

### Named Rules
**The Flat-At-Rest Rule.** 元件靜止時是平的，陰影只在滑過或彈出時出現。

## Shapes

圓潤但不幼稚：卡片 22px、小卡 14px、輸入框 13～14px、一般小元件 8～10px，按鈕與狀態色塊是膠囊形（50px）。框線一律是 1px 的低透明度白；拖放上傳區用 2px 虛線橘框。

## Components

### Buttons
- **Shape:** 膠囊形（50px）。
- **Primary:** 新頁面用 Deep Ember 底、白字、14px 粗體，內距 14px 34px；小按鈕內距 9px 16px、12.5px。
- **Hover / Pressed:** 底色換成 Deep Ember Pressed，上移 1px 並出現橘色光暈；減少動態效果時不移動。
- **Outline:** 透明底、Chalk Body 文字、1.5px 的 16% 白框線；滑過時底色加 6% 白。
- **Danger Outline:** 文字 `#ff8b72`、紅色框線，用於刪除、撤回這類不可逆動作。
- **Disabled:** 降低不透明度並顯示原因文字，不只是變灰。

### Chips（狀態色塊）
- **Style:** 膠囊形，內距 3px 9px，11px 粗體；底色是狀態色 14% 透明度，文字是狀態色。
- **Content:** 一律搭配圖示或文字說明，不只靠顏色。

### Cards / Containers
- **Corner Style:** 22px（小卡 14px）。
- **Background:** Plum Night。
- **Shadow Strategy:** 無陰影，見 Elevation & Depth。
- **Border:** 1px Hairline。
- **Internal Padding:** 22px。

### Inputs / Fields
- **Style:** Field Fill 底、1px Field Stroke 框、13px 圓角、內距 14px 18px。
- **Focus:** 框線變成 55% 透明度的橘，底色稍微變亮。
- **Placeholder:** 既有頁面是 28% 白；新頁面的提示文字改放在欄位上方的說明，不只依賴 placeholder。

### Navigation
- **Sidebar:** Sidebar Dusk 底，項目 14px 圓角、內距 11px 13px；目前頁面以橘色標示。
- **Focus:** 2px 的 70% 透明度橘色外框，外推 2px。

### Status Flow（短影片流程列）
既有短影片頁用一列細長的步驟標示目前狀態（腳本頁的狀態分頁與狀態色塊）。recut 審閱流程沿用同樣的語言：已完成、目前這一步、還沒到，三種狀態都要有文字，不只是顏色。

## Do's and Don'ts

### Do:
- **Do** 每個畫面只放一個 Deep Ember 實心主要按鈕（The One Ember Rule）。
- **Do** 文字最淡用 Chalk Muted（55% 白），中文不小於 12px。
- **Do** 所有可操作元素都有看得見的焦點框（2px 橘色或白色外框）。
- **Do** 背景工作用文字說明「正在做什麼、大約要多久、完成會通知你」。
- **Do** 尊重 `prefers-reduced-motion`：關掉位移與淡入動畫，只保留必要的狀態變化。

### Don't:
- **Don't** 在新頁面用 Ember Orange 當白字按鈕的底色（對比 3.57:1）。
- **Don't** 用 28%～45% 的白當文字色。
- **Don't** 只用顏色表示狀態或錯誤。
- **Don't** 在面向教師的畫面出現技術名詞（chunk、RRF、worker、payload 等）。
- **Don't** 預先勾選 AI 揭露或同意的確認框。
