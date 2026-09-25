// ============================================
// ooad-phase:   需求分析
// chapter:      5-2
// realizes:     UC-02, UC-03, UC-08, UC-09；FR-04～FR-11, FR-18, FR-19, FR-21～FR-23
// source:       chapters/05_需求模型.md 表5-2-1、表5-2-2；backend/src/routes/course.routes.js、video.routes.js、admin.routes.js、short-script.routes.js（角色守衛）
// verified:     2026-09-25
// status:       draft
// implemented:  yes
// ai-assisted:  yes / Claude Code / 由原圖5-2-1 v1-0（draw.io）依角色拆出教師與管理員功能：補上 Admin 與 UC-02、UC-03 的關聯與 UC-09「處理問題回報」延伸，「建立與發布課程」改為「變更課程發布狀態」
//
// 產生方式：node 圖5-2-1b-教師與管理員功能使用個案圖-v2-0.js（依賴 sharp 輸出 PNG）
// ============================================

const { renderDiagram, writeOutputs } = require('./usecase-svg.js');

const svg = renderDiagram({
  width: 1240,
  height: 1130,
  boundary: { x: 250, y: 40, w: 970, h: 1060, title: 'FocusFlow 系統' },
  groups: [
    { x: 285, y: 95, w: 900, h: 215, title: '短影音（教師）' },
    { x: 285, y: 340, w: 900, h: 440, title: '課程與影片管理（教師、管理員）' },
    { x: 285, y: 810, w: 900, h: 260, title: '系統維運（管理員）' },
  ],
  actors: [
    { id: 'teacher', x: 110, y: 330, label: ['Teacher', '教師'] },
    { id: 'admin', x: 110, y: 800, label: ['Admin', '管理員'] },
  ],
  usecases: [
    { id: 'uc08', x: 510, y: 215, rx: 150, lines: ['UC-08', '產生腳本並提交短影音成品'] },
    { id: 'revise', x: 990, y: 170, rx: 120, lines: ['退回腳本修改'] },
    { id: 'review', x: 990, y: 260, rx: 120, lines: ['成品審核'] },

    { id: 'uc02', x: 510, y: 480, rx: 150, lines: ['UC-02', '管理課程與修課名單'] },
    { id: 'publish', x: 990, y: 400, rx: 120, lines: ['變更課程發布狀態'] },
    { id: 'import', x: 990, y: 480, rx: 120, lines: ['匯入修課名單'] },
    { id: 'revoke', x: 990, y: 560, rx: 120, lines: ['撤銷修課資格'] },

    { id: 'uc03', x: 510, y: 690, rx: 150, lines: ['UC-03', '加入影片並追蹤處理'] },
    { id: 'attach', x: 990, y: 650, rx: 120, lines: ['掛載影片至其他課程'] },
    { id: 'retry', x: 990, y: 730, rx: 120, lines: ['重試失敗影片'] },

    { id: 'uc09', x: 510, y: 950, rx: 150, lines: ['UC-09', '維運系統'] },
    { id: 'users', x: 990, y: 870, rx: 120, lines: ['管理使用者帳號'] },
    { id: 'notice', x: 990, y: 950, rx: 120, lines: ['發送系統公告'] },
    { id: 'feedback', x: 990, y: 1030, rx: 120, lines: ['處理問題回報'] },
  ],
  links: [
    { type: 'assoc', from: 'teacher', to: 'uc08' },
    { type: 'assoc', from: 'teacher', to: 'uc02' },
    { type: 'assoc', from: 'teacher', to: 'uc03' },
    { type: 'assoc', from: 'admin', to: 'uc02' },
    { type: 'assoc', from: 'admin', to: 'uc03' },
    { type: 'assoc', from: 'admin', to: 'uc09' },

    { type: 'extend', from: 'revise', to: 'uc08', labelDy: -2 },
    { type: 'include', from: 'uc08', to: 'review', labelDy: 2 },
    { type: 'extend', from: 'publish', to: 'uc02', labelDy: -4 },
    { type: 'extend', from: 'import', to: 'uc02' },
    { type: 'extend', from: 'revoke', to: 'uc02', labelDy: 4 },
    { type: 'extend', from: 'attach', to: 'uc03', labelDy: -2 },
    { type: 'extend', from: 'retry', to: 'uc03', labelDy: 2 },
    { type: 'extend', from: 'users', to: 'uc09', labelDy: -4 },
    { type: 'extend', from: 'notice', to: 'uc09' },
    { type: 'extend', from: 'feedback', to: 'uc09', labelDy: 4 },
  ],
});

writeOutputs(svg, '圖5-2-1b-教師與管理員功能使用個案圖-v2-0', __dirname);
