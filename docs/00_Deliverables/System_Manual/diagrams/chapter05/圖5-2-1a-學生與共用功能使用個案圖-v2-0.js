// ============================================
// ooad-phase:   需求分析
// chapter:      5-2
// realizes:     UC-01, UC-04, UC-05, UC-06, UC-07；FR-01～FR-04, FR-07, FR-12～FR-18, FR-20, FR-23
// source:       chapters/05_需求模型.md 表5-2-1、表5-2-2；backend/src/routes/*.routes.js（角色守衛）；frontend components/DashboardApp.jsx（問題回報限學生、教師）
// verified:     2026-09-25
// status:       draft
// implemented:  yes
// ai-assisted:  yes / Claude Code / 由原圖5-2-1 v1-0（draw.io）依角色拆出學生與共用功能，改以抽象行為者「使用者」一般化三種角色，並補上 UC-06 的「回報問題」延伸
//
// 產生方式：node 圖5-2-1a-學生與共用功能使用個案圖-v2-0.js（依賴 sharp 輸出 PNG）
// ============================================

const { renderDiagram, writeOutputs } = require('./usecase-svg.js');

const svg = renderDiagram({
  width: 1180,
  height: 1070,
  boundary: { x: 250, y: 40, w: 900, h: 1000, title: 'FocusFlow 系統' },
  groups: [
    { x: 285, y: 95, w: 830, h: 410, title: '學生功能' },
    { x: 285, y: 545, w: 830, h: 460, title: '權限控管（三種角色共用）' },
  ],
  actors: [
    { id: 'student', x: 110, y: 330, label: ['Student', '學生'] },
    { id: 'user', x: 110, y: 720, label: ['使用者', '（抽象）'] },
    { id: 'teacher', x: 60, y: 960, label: ['Teacher', '教師'] },
    { id: 'admin', x: 170, y: 960, label: ['Admin', '管理員'] },
  ],
  usecases: [
    { id: 'uc04', x: 490, y: 190, lines: ['UC-04', '在網頁觀看與提問'] },
    { id: 'uc05', x: 490, y: 315, lines: ['UC-05', '綁定 LINE 並提問'] },
    { id: 'uc07', x: 490, y: 440, lines: ['UC-07', '查看短影音'] },
    { id: 'answer', x: 930, y: 252, rx: 140, lines: ['取得回答與', '影片時間段'] },

    { id: 'uc01', x: 490, y: 650, lines: ['UC-01', '註冊與登入'] },
    { id: 'uc06', x: 490, y: 860, lines: ['UC-06', '維護個人資料與通知'] },
    { id: 'lock', x: 930, y: 650, rx: 120, lines: ['帳號鎖定'] },
    { id: 'reset', x: 930, y: 800, rx: 120, lines: ['忘記密碼重設'] },
    { id: 'report', x: 930, y: 940, rx: 120, lines: ['回報問題'] },
  ],
  links: [
    { type: 'assoc', from: 'student', to: 'uc04' },
    { type: 'assoc', from: 'student', to: 'uc05' },
    { type: 'assoc', from: 'student', to: 'uc07' },
    { type: 'assoc', from: 'user', to: 'uc01' },
    { type: 'assoc', from: 'user', to: 'uc06' },
    { type: 'generalize', from: 'student', to: 'user' },
    { type: 'generalize', from: 'teacher', to: 'user' },
    { type: 'generalize', from: 'admin', to: 'user' },

    { type: 'include', from: 'uc04', to: 'answer' },
    { type: 'include', from: 'uc05', to: 'answer' },
    { type: 'extend', from: 'lock', to: 'uc01', condition: '[連續登入失敗達門檻]' },
    { type: 'extend', from: 'reset', to: 'uc06', condition: '[忘記密碼]', labelDy: -4 },
    { type: 'extend', from: 'report', to: 'uc06', condition: '[學生或教師回報]', labelDy: 4 },
  ],
});

writeOutputs(svg, '圖5-2-1a-學生與共用功能使用個案圖-v2-0', __dirname);
