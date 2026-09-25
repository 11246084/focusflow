// 第 5 章使用個案圖用的 SVG 產生器（手工座標）
// 元素：系統邊界、功能區塊、行為者（火柴人）、使用個案（橢圓）、
//       關聯（實線）、«include»／«extend»（虛線開放箭頭）、行為者一般化（空心三角形）
// 座標全部手動指定，以控制版面與走線；輸出 SVG，可再以 sharp 轉 PNG。

const FONT = "'Times New Roman','DFKai-SB','標楷體',serif";

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 行為者的關聯錨點：依目標在左或右，取肩膀位置
function actorAnchor(a, target) {
  const dir = target.x >= a.x ? 1 : -1;
  return { x: a.x + dir * 26, y: a.y - 12 };
}

// 由橢圓中心朝 p 方向與橢圓邊界的交點
function ellipsePoint(u, p) {
  const dx = p.x - u.x;
  const dy = p.y - u.y;
  const t = 1 / Math.sqrt((dx / u.rx) ** 2 + (dy / u.ry) ** 2);
  return { x: u.x + dx * t, y: u.y + dy * t };
}

function renderActor(a) {
  const { x, y } = a;
  const parts = [
    `<circle cx="${x}" cy="${y - 44}" r="14" fill="#FFFFFF" stroke="#000" stroke-width="1.4"/>`,
    `<line x1="${x}" y1="${y - 30}" x2="${x}" y2="${y + 10}" stroke="#000" stroke-width="1.4"/>`,
    `<line x1="${x - 24}" y1="${y - 16}" x2="${x + 24}" y2="${y - 16}" stroke="#000" stroke-width="1.4"/>`,
    `<line x1="${x}" y1="${y + 10}" x2="${x - 18}" y2="${y + 42}" stroke="#000" stroke-width="1.4"/>`,
    `<line x1="${x}" y1="${y + 10}" x2="${x + 18}" y2="${y + 42}" stroke="#000" stroke-width="1.4"/>`,
  ];
  (a.label || []).forEach((line, i) => {
    parts.push(`<text x="${x}" y="${y + 64 + i * 19}" text-anchor="middle" font-family="${FONT}" font-size="15" fill="#000">${esc(line)}</text>`);
  });
  return parts.join('\n');
}

function renderUseCase(u) {
  const parts = [`<ellipse cx="${u.x}" cy="${u.y}" rx="${u.rx}" ry="${u.ry}" fill="#FFFFFF" stroke="#000" stroke-width="1.3"/>`];
  const lines = u.lines;
  const lh = 20;
  const top = u.y - ((lines.length - 1) * lh) / 2 + 5;
  lines.forEach((line, i) => {
    parts.push(`<text x="${u.x}" y="${top + i * lh}" text-anchor="middle" font-family="${FONT}" font-size="15.5" fill="#000">${esc(line)}</text>`);
  });
  return parts.join('\n');
}

function renderLabel(x, y, lines) {
  const w = Math.max(...lines.map((l) => l.length)) * 7.6 + 10;
  const h = lines.length * 16 + 4;
  const parts = [`<rect x="${x - w / 2}" y="${y - h / 2 - 1}" width="${w}" height="${h}" fill="#FFFFFF"/>`];
  lines.forEach((line, i) => {
    parts.push(`<text x="${x}" y="${y - h / 2 + 13 + i * 16}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#000">${esc(line)}</text>`);
  });
  return parts.join('\n');
}

function renderLink(model, l) {
  const from = model.get(l.from);
  const to = model.get(l.to);
  if (!from || !to) throw new Error(`unknown element in link ${l.from} -> ${l.to}`);

  if (l.type === 'generalize') {
    // 由子行為者指向父行為者，空心三角形箭頭；依上下位置取頭頂或標籤下緣
    const labelBottom = (act) => act.y + 58 + (act.label ? act.label.length * 19 : 0);
    const childAbove = from.y < to.y;
    const a = childAbove ? { x: from.x, y: labelBottom(from) } : { x: from.x, y: from.y - 62 };
    const b = childAbove ? { x: to.x, y: to.y - 62 } : { x: to.x, y: labelBottom(to) + 4 };
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="1.2" marker-end="url(#hollow)"/>`;
  }

  if (l.type === 'assoc') {
    const a = from.kind === 'actor' ? actorAnchor(from, to) : ellipsePoint(from, to);
    const b = to.kind === 'actor' ? actorAnchor(to, from) : ellipsePoint(to, a);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="1.2"/>`;
  }

  // include / extend：虛線 + 開放箭頭，箭頭指向 to
  const a = ellipsePoint(from, to);
  const b = ellipsePoint(to, from);
  const parts = [`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#000" stroke-width="1.1" stroke-dasharray="6,4" marker-end="url(#open)"/>`];
  const mx = (a.x + b.x) / 2 + (l.labelDx || 0);
  const my = (a.y + b.y) / 2 + (l.labelDy || 0);
  const lines = [l.type === 'include' ? '«include»' : '«extend»'];
  if (l.condition) lines.push(l.condition);
  parts.push(renderLabel(mx, my, lines));
  return parts.join('\n');
}

function renderDiagram({ width, height, boundary, groups = [], actors = [], usecases = [], links = [] }) {
  const model = new Map();
  actors.forEach((a) => model.set(a.id, { ...a, kind: 'actor' }));
  usecases.forEach((u) => model.set(u.id, { rx: 135, ry: 34, ...u, kind: 'usecase' }));

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  out.push('<defs>'
    + '<marker id="open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto"><path d="M 0 0 L 11 6 L 0 12" fill="none" stroke="#000" stroke-width="1.3"/></marker>'
    + '<marker id="hollow" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="13" markerHeight="13" orient="auto"><path d="M 0 0 L 13 7 L 0 14 z" fill="#FFFFFF" stroke="#000" stroke-width="1.2"/></marker>'
    + '</defs>');
  out.push(`<rect width="${width}" height="${height}" fill="#FFFFFF"/>`);

  if (boundary) {
    out.push(`<rect x="${boundary.x}" y="${boundary.y}" width="${boundary.w}" height="${boundary.h}" fill="#FFFFFF" stroke="#000" stroke-width="1.4"/>`);
    out.push(`<text x="${boundary.x + boundary.w / 2}" y="${boundary.y + 30}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="bold" fill="#000">${esc(boundary.title)}</text>`);
  }
  groups.forEach((g) => {
    out.push(`<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" fill="#FFFFFF" stroke="#000" stroke-width="1.2"/>`);
    out.push(`<text x="${g.x + g.w / 2}" y="${g.y + 26}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="bold" fill="#000">${esc(g.title)}</text>`);
  });

  // 線先畫，橢圓與行為者後畫，讓線段止於外框
  links.filter((l) => l.type === 'assoc' || l.type === 'generalize').forEach((l) => out.push(renderLink(model, l)));
  usecases.forEach((u) => out.push(renderUseCase(model.get(u.id))));
  actors.forEach((a) => out.push(renderActor(a)));
  links.filter((l) => l.type === 'include' || l.type === 'extend').forEach((l) => out.push(renderLink(model, l)));

  out.push('</svg>');
  return out.join('\n');
}

function writeOutputs(svg, baseName, dirname) {
  const fs = require('fs');
  const path = require('path');
  const imagesDir = path.resolve(dirname, '..', '..', 'images');
  fs.writeFileSync(path.join(imagesDir, `${baseName}.svg`), svg, 'utf8');
  console.log('svg ->', path.join(imagesDir, `${baseName}.svg`));
  try {
    const sharp = require('sharp');
    sharp(Buffer.from(svg), { density: 150 })
      .png()
      .toFile(path.join(imagesDir, `${baseName}.png`))
      .then((info) => console.log('png ->', `${info.width}x${info.height}`))
      .catch((err) => { console.error(err); process.exit(1); });
  } catch (err) {
    console.warn('未安裝 sharp，僅輸出 SVG。安裝後可產生 PNG：npm i sharp');
  }
}

module.exports = { renderDiagram, writeOutputs };
