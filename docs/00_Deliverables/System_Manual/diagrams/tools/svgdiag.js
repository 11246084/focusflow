// 手工排版的 UML 類別圖產生器：輸出 SVG（可再轉 PNG）
// 設計目標：直角走線、方框座標可控、留白充足，貼近教科書 UML 版面

const FONT_CN = "'DFKai-SB','標楷體',serif";
const FONT_EN = "'Times New Roman',serif";
const FONT_STACK = `${FONT_EN},${FONT_CN}`;

const HEADER_H = 32;
const ATTR_H = 22;
const PAD_Y = 8;

function boxHeight(c) {
  if (!c.attrs || c.attrs.length === 0) return HEADER_H + 10;
  return HEADER_H + c.attrs.length * ATTR_H + PAD_Y;
}

function makeModel(classes) {
  const map = new Map();
  for (const c of classes) {
    const h = boxHeight(c);
    map.set(c.id, { ...c, h, x2: c.x + c.w, y2: c.y + h });
  }
  return map;
}

// 取得方框邊緣上的錨點；t 為 0~1 的相對位置
function anchor(model, id, side, t = 0.5) {
  const c = model.get(id);
  if (!c) throw new Error('unknown class: ' + id);
  switch (side) {
    case 'left': return { x: c.x, y: c.y + c.h * t };
    case 'right': return { x: c.x2, y: c.y + c.h * t };
    case 'top': return { x: c.x + c.w * t, y: c.y };
    case 'bottom': return { x: c.x + c.w * t, y: c.y2 };
    default: throw new Error('bad side: ' + side);
  }
}

// 直角路徑：依 mode 產生轉折點
function routePoints(a, b, mode, via) {
  if (mode === 'straight') return [a, b];
  if (mode === 'h') return [a, { x: b.x, y: a.y }, b];          // 先水平再垂直
  if (mode === 'v') return [a, { x: a.x, y: b.y }, b];          // 先垂直再水平
  if (mode === 'zh') {                                           // 水平中段折
    const mx = via != null ? via : (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (mode === 'zv') {                                           // 垂直中段折
    const my = via != null ? via : (a.y + b.y) / 2;
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  }
  if (mode === 'rail') {                                         // 繞外側軌道
    return [a, { x: via, y: a.y }, { x: via, y: b.y }, b];
  }
  throw new Error('bad mode: ' + mode);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderClassBox(c) {
  const parts = [];
  parts.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#FFFFFF" stroke="#000000" stroke-width="1.2"/>`);
  parts.push(`<line x1="${c.x}" y1="${c.y + HEADER_H}" x2="${c.x2}" y2="${c.y + HEADER_H}" stroke="#000000" stroke-width="1.2"/>`);
  const cx = c.x + c.w / 2;
  if (c.stereotype) {
    parts.push(`<text x="${cx}" y="${c.y + 14}" text-anchor="middle" font-family="${FONT_STACK}" font-size="12" font-style="italic" fill="#000">«${esc(c.stereotype)}»</text>`);
    parts.push(`<text x="${cx}" y="${c.y + 28}" text-anchor="middle" font-family="${FONT_STACK}" font-size="15" font-weight="bold" fill="#000">${esc(c.name)}</text>`);
  } else {
    parts.push(`<text x="${cx}" y="${c.y + 21}" text-anchor="middle" font-family="${FONT_STACK}" font-size="15" font-weight="bold" fill="#000">${esc(c.name)}</text>`);
  }
  (c.attrs || []).forEach((a, i) => {
    const ty = c.y + HEADER_H + 16 + i * ATTR_H;
    parts.push(`<text x="${c.x + 10}" y="${ty}" font-family="${FONT_STACK}" font-size="13" fill="#000">- ${esc(a)}</text>`);
  });
  return parts.join('\n');
}

function renderEdge(model, e) {
  const a = anchor(model, e.from.id, e.from.side, e.from.t);
  const b = anchor(model, e.to.id, e.to.side, e.to.t);
  const pts = routePoints(a, b, e.mode || 'straight', e.via);
  const d = pts.map(p => `${p.x},${p.y}`).join(' ');
  const parts = [];
  const dash = e.dashed ? ' stroke-dasharray="6,4"' : '';
  const marker = e.arrow ? ' marker-end="url(#arrow)"' : '';
  parts.push(`<polyline points="${d}" fill="none" stroke="#000000" stroke-width="1.1"${dash}${marker}/>`);

  // 多重性標籤：貼在兩端錨點外側
  const off = 13;
  const place = (p, side, text, anchorPos) => {
    if (!text) return;
    let x = p.x, y = p.y, ta = 'middle';
    if (side === 'left') { x = p.x - 6; y = p.y - 6; ta = 'end'; }
    if (side === 'right') { x = p.x + 6; y = p.y - 6; ta = 'start'; }
    if (side === 'top') { x = p.x + 6; y = p.y - 6; ta = 'start'; }
    if (side === 'bottom') { x = p.x + 6; y = p.y + off; ta = 'start'; }
    parts.push(`<text x="${x}" y="${y}" text-anchor="${ta}" font-family="${FONT_STACK}" font-size="12" fill="#000">${esc(text)}</text>`);
  };
  place(a, e.from.side, e.from.mult);
  place(b, e.to.side, e.to.mult);

  // 關聯名稱：放在指定的中段位置
  if (e.label) {
    const lp = e.labelAt || pts[Math.floor(pts.length / 2)];
    const lx = lp.x + (e.labelDx || 0);
    const ly = lp.y + (e.labelDy || -6);
    parts.push(`<text x="${lx}" y="${ly}" text-anchor="${e.labelAnchor || 'middle'}" font-family="${FONT_STACK}" font-size="12.5" fill="#000">${esc(e.label)}</text>`);
  }
  return parts.join('\n');
}

function renderDiagram({ width, height, title, classes, edges }) {
  const model = makeModel(classes);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  out.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#000"/></marker></defs>`);
  out.push(`<rect width="${width}" height="${height}" fill="#FFFFFF"/>`);
  if (title) {
    out.push(`<text x="${width / 2}" y="34" text-anchor="middle" font-family="${FONT_STACK}" font-size="19" font-weight="bold" fill="#000">${esc(title)}</text>`);
  }
  for (const e of edges) out.push(renderEdge(model, e));
  for (const c of model.values()) out.push(renderClassBox(c));
  out.push('</svg>');
  return out.join('\n');
}

module.exports = { renderDiagram, anchor, makeModel };
