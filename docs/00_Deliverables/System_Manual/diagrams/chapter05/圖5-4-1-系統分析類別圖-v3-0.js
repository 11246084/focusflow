// ============================================
// ooad-phase:   需求分析
// chapter:      5-4
// realizes:     UC-01～UC-09（全系統分析類別）
// source:       docs/00_Deliverables/System_Manual/chapters/05_需求模型.md（表5-4-1、表5-4-2）；backend/src/models/（查證關聯與多重性）
// verified:     2026-09-24
// status:       draft
// implemented:  partial
// ai-assisted:  yes / Claude Code / 依 models 查證修正：Course—Video 改為多對多掛載，補上 User—Question、User—Feedback、ShortScript—Question，重新排版以消除標籤重疊
//
// 產生方式：node 圖5-4-1-系統分析類別圖-v3-0.js
//   依賴 sharp（SVG → PNG）。僅需 SVG 時可移除 sharp 區段。
// ============================================

const fs = require('fs');
const path = require('path');
const { renderDiagram } = require('../tools/svgdiag.js');

const W = 200;
const A = 60;
const B = 340;
const C = 620;
const D = 900;
const E = 1180;

const classes = [
  { id: 'Notification', name: 'Notification', x: A, y: 80,  w: W,   attrs: ['已讀狀態', '通知來源'] },
  { id: 'FAQ',          name: 'FAQ',          x: C, y: 80,  w: W,   attrs: ['常見問題', '命中次數'] },
  { id: 'VideoBatch',   name: 'VideoBatch',   x: E, y: 80,  w: W,   attrs: ['批次狀態'] },

  { id: 'User',         name: 'User',         x: A, y: 270, w: W,   attrs: ['角色', '啟用狀態', 'LINE 綁定狀態'] },
  { id: 'Enrollment',   name: 'Enrollment',   x: B, y: 270, w: W,   attrs: ['授權狀態', '學習進度'] },
  { id: 'Course',       name: 'Course',       x: C, y: 270, w: W,   attrs: ['發布狀態'] },
  { id: 'Video',        name: 'Video',        x: E, y: 270, w: W,   attrs: ['來源類型', '處理狀態'] },

  { id: 'Conversation', name: 'Conversation', x: B, y: 470, w: W,   attrs: ['對話標題'] },
  { id: 'Question',     name: 'Question',     x: C, y: 470, w: W,   attrs: ['提問管道', '回答狀態'] },
  { id: 'VideoSegment', name: 'VideoSegment', x: E, y: 470, w: 210, attrs: ['時間區間', '片段文字'] },

  { id: 'Feedback',     name: 'Feedback',     x: A, y: 670, w: W,   attrs: ['類別與影響程度', '處理狀態'] },
  { id: 'Message',      name: 'Message',      x: B, y: 670, w: W,   attrs: ['角色（提問／回答）', '處理狀態', '引用來源'] },
  { id: 'UsageLog',     name: 'UsageLog',     x: C, y: 670, w: W,   attrs: ['事件類型'] },
  { id: 'ShortScript',  name: 'ShortScript',  x: D, y: 670, w: W,   attrs: ['腳本狀態', '腳本版本'] },
  { id: 'ShortAsset',   name: 'ShortAsset',   x: D, y: 860, w: W,   attrs: ['審核狀態', '發布狀態'] },
];

const edges = [
  // ── 帳號 ──
  { from: { id: 'Notification', side: 'bottom', t: 0.5, mult: '0..*' }, to: { id: 'User', side: 'top', t: 0.5, mult: '1' },
    mode: 'straight', label: '接收者', labelAt: { x: 170, y: 228 }, labelAnchor: 'start' },
  { from: { id: 'User', side: 'top', t: 0.85, mult: '1' }, to: { id: 'Course', side: 'top', t: 0.25, mult: '0..*' },
    mode: 'zv', via: 225, label: 'owner（教師）', labelAt: { x: 450, y: 225 } },
  { from: { id: 'User', side: 'right', t: 0.35, mult: '1' }, to: { id: 'Enrollment', side: 'left', t: 0.44, mult: '0..*' },
    mode: 'straight', label: '學生', labelAt: { x: 300, y: 330 } },
  { from: { id: 'User', side: 'bottom', t: 0.3, mult: '1' }, to: { id: 'Feedback', side: 'top', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '回報者', labelAt: { x: 128, y: 570 }, labelAnchor: 'start' },
  { from: { id: 'User', side: 'bottom', t: 0.8, mult: '1' }, to: { id: 'Conversation', side: 'left', t: 0.5, mult: '0..*' },
    mode: 'v', label: '擁有者', labelAt: { x: 280, y: 525 } },
  { from: { id: 'User', side: 'right', t: 0.9, mult: '1' }, to: { id: 'Question', side: 'top', t: 0.3, mult: '0..*' },
    mode: 'h', label: '提問者', labelAt: { x: 580, y: 383 } },

  // ── 課程 ──
  { from: { id: 'Enrollment', side: 'right', t: 0.44, mult: '0..*' }, to: { id: 'Course', side: 'left', t: 0.6, mult: '1' },
    mode: 'straight', label: '修課課程', labelAt: { x: 580, y: 330 } },
  { from: { id: 'Course', side: 'top', t: 0.7, mult: '1' }, to: { id: 'FAQ', side: 'bottom', t: 0.7, mult: '0..*' },
    mode: 'straight', label: '課程快取', labelAt: { x: 768, y: 228 }, labelAnchor: 'start' },
  { from: { id: 'Course', side: 'right', t: 0.6, mult: '1..*' }, to: { id: 'Video', side: 'left', t: 0.44, mult: '0..*' },
    mode: 'straight', label: '掛載', labelAt: { x: 1000, y: 301 } },
  { from: { id: 'Course', side: 'bottom', t: 0.5, mult: '1' }, to: { id: 'Question', side: 'top', t: 0.5, mult: '0..*' },
    mode: 'straight', label: '所屬課程', labelAt: { x: 728, y: 430 }, labelAnchor: 'start' },
  { from: { id: 'Conversation', side: 'top', t: 0.8, mult: '0..*' }, to: { id: 'Course', side: 'bottom', t: 0.1, mult: '1' },
    mode: 'zv', via: 430, label: '對話範圍', labelAt: { x: 570, y: 452 } },

  // ── 影片 ──
  { from: { id: 'VideoBatch', side: 'bottom', t: 0.5, mult: '0..1' }, to: { id: 'Video', side: 'top', t: 0.5, mult: '0..*' },
    mode: 'straight', label: '批次項目', labelAt: { x: 1290, y: 214 }, labelAnchor: 'start' },
  { from: { id: 'Video', side: 'bottom', t: 0.5, mult: '1' }, to: { id: 'VideoSegment', side: 'top', t: 0.476, mult: '0..*' },
    mode: 'straight', label: '可檢索片段', labelAt: { x: 1290, y: 420 }, labelAnchor: 'start' },

  // ── 問答 ──
  { from: { id: 'Question', side: 'right', t: 0.3, mult: '0..*' }, to: { id: 'VideoSegment', side: 'left', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '命中來源', labelAt: { x: 1000, y: 489 } },
  { from: { id: 'Question', side: 'bottom', t: 0.3, mult: '0..1' }, to: { id: 'UsageLog', side: 'top', t: 0.3, mult: '0..1' },
    mode: 'straight', label: '來源事件', labelAt: { x: 690, y: 620 }, labelAnchor: 'start' },
  { from: { id: 'Conversation', side: 'bottom', t: 0.5, mult: '1' }, to: { id: 'Message', side: 'top', t: 0.5, mult: '0..*' },
    mode: 'straight', label: '依序排列', labelAt: { x: 450, y: 610 }, labelAnchor: 'start' },
  { from: { id: 'Message', side: 'bottom', t: 0.5, mult: '0..*' }, to: { id: 'VideoSegment', side: 'bottom', t: 0.85, mult: '0..*' },
    mode: 'zv', via: 985, label: '引用快照', labelAt: { x: 900, y: 979 } },

  // ── 短影音 ──
  { from: { id: 'ShortScript', side: 'top', t: 0.2, mult: '0..*' }, to: { id: 'Question', side: 'right', t: 0.85, mult: '1..*' },
    mode: 'v', label: '來源提問', labelAt: { x: 948, y: 625 }, labelAnchor: 'start' },
  { from: { id: 'ShortScript', side: 'top', t: 0.8, mult: '0..*' }, to: { id: 'Course', side: 'bottom', t: 0.9, mult: '1' },
    mode: 'zv', via: 448, label: '所屬課程', labelAt: { x: 1068, y: 625 }, labelAnchor: 'start' },
  { from: { id: 'ShortScript', side: 'right', t: 0.5, mult: '0..*' }, to: { id: 'VideoSegment', side: 'bottom', t: 0.35, mult: '1..*' },
    mode: 'h', label: '凍結證據', labelAt: { x: 1176, y: 736 } },
  { from: { id: 'ShortScript', side: 'bottom', t: 0.5, mult: '1' }, to: { id: 'ShortAsset', side: 'top', t: 0.5, mult: '0..*' },
    mode: 'straight', label: '成品版本', labelAt: { x: 1010, y: 815 }, labelAnchor: 'start' },
];

const svg = renderDiagram({
  width: 1440,
  height: 1020,
  title: '系統分析類別圖',
  classes,
  edges,
});

const imagesDir = path.resolve(__dirname, '..', '..', 'images');
const baseName = '圖5-4-1-系統分析類別圖-v3-0';
fs.writeFileSync(path.join(imagesDir, baseName + '.svg'), svg, 'utf8');
console.log('svg ->', path.join(imagesDir, baseName + '.svg'));

try {
  const sharp = require('sharp');
  sharp(Buffer.from(svg), { density: 150 })
    .png()
    .toFile(path.join(imagesDir, baseName + '.png'))
    .then(info => console.log('png ->', info.width + 'x' + info.height))
    .catch(err => { console.error(err); process.exit(1); });
} catch (err) {
  console.warn('未安裝 sharp，僅輸出 SVG。安裝後可產生 PNG：npm i sharp');
}
