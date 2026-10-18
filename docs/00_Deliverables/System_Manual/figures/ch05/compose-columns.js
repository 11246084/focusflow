// 將兩段 PlantUML 活動圖（以連接點 A 銜接）並排成一張兩欄圖，並加上圖內標題。
// 用法：node compose-columns.js "<圖內標題>" <輸出.png> <第一欄.png> <第二欄.png>
// 依賴 sharp。第一欄以連接點 (A) 結束，第二欄以 (A) 開始，讀者由左欄讀到右欄。

const sharp = require('sharp');

const GAP = 70;
const TITLE_H = 70;
const PAD = 20;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const [title, out, left, right] = process.argv.slice(2);
  if (!title || !out || !left || !right) {
    console.error('usage: node compose-columns.js "<title>" <out.png> <left.png> <right.png>');
    process.exit(1);
  }
  const [lm, rm] = await Promise.all([sharp(left).metadata(), sharp(right).metadata()]);
  const width = PAD + lm.width + GAP + rm.width + PAD;
  const height = TITLE_H + Math.max(lm.height, rm.height) + PAD;
  const sepX = PAD + lm.width + GAP / 2;

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<text x="${width / 2}" y="48" text-anchor="middle" font-family="Microsoft JhengHei, sans-serif" font-size="34" font-weight="bold" fill="#000">${esc(title)}</text>`
    + `<line x1="${sepX}" y1="${TITLE_H}" x2="${sepX}" y2="${height - PAD}" stroke="#999999" stroke-width="1.5" stroke-dasharray="8,6"/>`
    + '</svg>',
  );

  await sharp({ create: { width, height, channels: 3, background: '#FFFFFF' } })
    .composite([
      { input: left, left: PAD, top: TITLE_H },
      { input: right, left: PAD + lm.width + GAP, top: TITLE_H },
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toFile(out);
  console.log('png ->', out, `${width}x${height}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
