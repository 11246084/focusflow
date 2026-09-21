// ============================================
// ooad-phase:   需求分析
// chapter:      5-4
// realizes:     UC-01～UC-09（全系統分析類別）
// source:       docs/00_Deliverables/System_Manual/chapters/05_需求模型.md（表5-4-1 主要分析類別）
// verified:     2026-09-21
// status:       draft
// implemented:  partial
// ai-assisted:  yes / Claude Opus 5 / 2026-09-21 併為整個系統一張，改用手工座標與直角走線取代自動排版
//
// 產生方式：node 圖5-4-1-系統分析類別圖-v2-0.js
//   依賴 sharp（SVG → PNG）。僅需 SVG 時可移除 sharp 區段。
// ============================================

const fs = require('fs');
const path = require('path');
const { renderDiagram } = require('../tools/svgdiag.js');

const W = 190;

const classes = [
  { id: 'Notification', name: 'Notification', x: 70,   y: 80,  w: W,   attrs: ['已讀狀態', '導向資訊'] },
  { id: 'User',         name: 'User',         x: 70,   y: 230, w: W,   attrs: ['角色', '啟用狀態'] },
  { id: 'Enrollment',   name: 'Enrollment',   x: 70,   y: 420, w: W,   attrs: ['授權狀態', '學習進度'] },
  { id: 'Conversation', name: 'Conversation', x: 70,   y: 610, w: W,   attrs: ['課程範圍'] },
  { id: 'Message',      name: 'Message',      x: 70,   y: 780, w: W,   attrs: ['角色（提問／回答）', '引用來源'] },

  { id: 'FAQ',          name: 'FAQ',          x: 450,  y: 80,  w: W,   attrs: ['命中次數'] },
  { id: 'Course',       name: 'Course',       x: 450,  y: 230, w: W,   attrs: ['發布狀態'] },
  { id: 'ShortScript',  name: 'ShortScript',  x: 450,  y: 610, w: W,   attrs: ['腳本狀態', '生成版本'] },
  { id: 'ShortAsset',   name: 'ShortAsset',   x: 450,  y: 790, w: W,   attrs: ['審核狀態', '發布狀態'] },

  { id: 'VideoBatch',   name: 'VideoBatch',   x: 800,  y: 80,  w: W,   attrs: ['批次狀態'] },
  { id: 'Video',        name: 'Video',        x: 800,  y: 230, w: W,   attrs: ['來源類型', '處理狀態'] },
  { id: 'Question',     name: 'Question',     x: 800,  y: 430, w: W,   attrs: ['回答狀態'] },
  { id: 'UsageLog',     name: 'UsageLog',     x: 800,  y: 610, w: W,   attrs: ['事件類型'] },

  { id: 'VideoSegment', name: 'VideoSegment', x: 1130, y: 420, w: 200, attrs: ['時間區間', '片段文字'] },
];

const edges = [
  // ── User 周邊 ──
  { from: { id: 'User', side: 'right', t: 0.369, mult: '1' }, to: { id: 'Course', side: 'left', t: 0.5, mult: '0..*' },
    mode: 'straight', label: 'owner（教師）', labelAt: { x: 355, y: 253 } },
  { from: { id: 'User', side: 'bottom', t: 0.3, mult: '1' }, to: { id: 'Enrollment', side: 'top', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '學生', labelAt: { x: 151, y: 372 }, labelAnchor: 'start' },
  { from: { id: 'User', side: 'top', t: 0.3, mult: '1' }, to: { id: 'Notification', side: 'bottom', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '接收者', labelAt: { x: 157, y: 202 }, labelAnchor: 'start' },
  { from: { id: 'User', side: 'left', t: 0.7, mult: '1' }, to: { id: 'Conversation', side: 'left', t: 0.5, mult: '0..*' },
    mode: 'rail', via: 38, label: '擁有者', labelAt: { x: 46, y: 470 }, labelAnchor: 'start' },

  // ── Course 樞紐 ──
  { from: { id: 'Course', side: 'bottom', t: 0.2, mult: '1' }, to: { id: 'Enrollment', side: 'right', t: 0.35, mult: '0..*' },
    mode: 'v' },
  { from: { id: 'Course', side: 'top', t: 0.3, mult: '1' }, to: { id: 'FAQ', side: 'bottom', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '課程快取', labelAt: { x: 537, y: 195 }, labelAnchor: 'start' },
  { from: { id: 'Course', side: 'right', t: 0.5, mult: '1' }, to: { id: 'Video', side: 'left', t: 0.369, mult: '0..*' },
    mode: 'straight', label: '掛載', labelAt: { x: 720, y: 253 } },
  { from: { id: 'Course', side: 'bottom', t: 0.55, mult: '1' }, to: { id: 'Question', side: 'left', t: 0.5, mult: '0..*' },
    mode: 'v', label: '所屬課程', labelAt: { x: 690, y: 455 } },
  { from: { id: 'Course', side: 'bottom', t: 0.85, mult: '1' }, to: { id: 'ShortScript', side: 'top', t: 0.5, mult: '0..*' },
    mode: 'v', label: '所屬課程', labelAt: { x: 620, y: 430 }, labelAnchor: 'start' },
  { from: { id: 'Conversation', side: 'top', t: 0.7, mult: '0..*' }, to: { id: 'Course', side: 'left', t: 0.85, mult: '1' },
    mode: 'zh', via: 360, label: '對話範圍', labelAt: { x: 368, y: 500 }, labelAnchor: 'start' },

  // ── 對話 ──
  { from: { id: 'Conversation', side: 'bottom', t: 0.3, mult: '1' }, to: { id: 'Message', side: 'top', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '依序排列', labelAt: { x: 157, y: 735 }, labelAnchor: 'start' },
  { from: { id: 'Message', side: 'right', t: 0.35, mult: '0..*' }, to: { id: 'VideoSegment', side: 'bottom', t: 0.5, mult: '0..*' },
    mode: 'zv', via: 920, label: '引用快照', labelAt: { x: 700, y: 914 } },

  // ── 影片與片段 ──
  { from: { id: 'VideoBatch', side: 'bottom', t: 0.3, mult: '1' }, to: { id: 'Video', side: 'top', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '批次項目', labelAt: { x: 887, y: 195 }, labelAnchor: 'start' },
  { from: { id: 'Video', side: 'bottom', t: 0.75, mult: '1' }, to: { id: 'VideoSegment', side: 'top', t: 0.3, mult: '0..*' },
    mode: 'zv', via: 370, label: '可檢索片段', labelAt: { x: 1060, y: 362 } },

  // ── 提問 ──
  { from: { id: 'Question', side: 'right', t: 0.5, mult: '0..*' }, to: { id: 'VideoSegment', side: 'left', t: 0.488, mult: '0..*' },
    mode: 'straight', label: '命中來源', labelAt: { x: 1060, y: 441 } },
  { from: { id: 'Question', side: 'bottom', t: 0.3, mult: '0..1' }, to: { id: 'UsageLog', side: 'top', t: 0.3, mult: '0..1' },
    mode: 'straight', label: '來源事件', labelAt: { x: 887, y: 565 }, labelAnchor: 'start' },

  // ── 短影音 ──
  { from: { id: 'ShortScript', side: 'bottom', t: 0.3, mult: '1' }, to: { id: 'ShortAsset', side: 'top', t: 0.3, mult: '0..*' },
    mode: 'straight', label: '對應腳本版本', labelAt: { x: 537, y: 755 }, labelAnchor: 'start' },
  { from: { id: 'ShortScript', side: 'top', t: 0.9, mult: '0..*' }, to: { id: 'Question', side: 'left', t: 0.85, mult: '1' },
    mode: 'v', label: '凍結來源', labelAt: { x: 700, y: 498 } },
  { from: { id: 'ShortScript', side: 'right', t: 0.75, mult: '0..*' }, to: { id: 'VideoSegment', side: 'bottom', t: 0.85, mult: '1' },
    mode: 'zv', via: 740, label: '凍結證據', labelAt: { x: 980, y: 734 } },
];

const svg = renderDiagram({
  width: 1460,
  height: 980,
  title: '系統分析類別圖',
  classes,
  edges,
});

const imagesDir = path.resolve(__dirname, '..', '..', 'images');
const baseName = '圖5-4-1-系統分析類別圖-v2-0';
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
