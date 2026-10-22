'use strict';

const fs = require('node:fs');
const path = require('node:path');

// plan + resolved → HyperFrames 組合檔（單一 index.html）。
// 純字串產生，沒有任何模型參與：同一份 plan 與 resolved 一定產出同一份 HTML。
// 元件的鍵名必須與 src/plan/components.js 的宣告一致。

const STYLE_PATH = path.join(__dirname, 'style.css');

// 各 token 樣式的最大字級（px）。實際字級會依整列寬度等比縮小，避免折行。
const TOKEN_MAX_PX = {
  huge: 190, display: 130, mid: 64, text: 56, num: 84, op: 70, unit: 56, blank: 120,
};
const ROW_WIDTH_PX = 620;

const round3 = (value) => Math.round(value * 1000) / 1000;
const num = (value) => round3(value).toFixed(3);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 估算字串寬度（以「一個全形字 = 1em」計）。 */
function widthEm(text) {
  let total = 0;
  for (const character of String(text)) {
    if (/\s/.test(character)) total += 0.3;
    else if (/[\x21-\x7e]/.test(character)) total += 0.6;
    else total += 1;
  }
  return total;
}

function createBuilder() {
  const statements = [];
  return {
    statements,
    pop(selector, at, { y = 24, d = 0.45, ease = 'power3.out' } = {}) {
      statements.push(`tl.fromTo("${selector}", {opacity:0, y:${y}}, {opacity:1, y:0, duration:${d}, ease:"${ease}"}, ${num(at)});`);
    },
    scalePop(selector, at, d = 0.45) {
      statements.push(`tl.fromTo("${selector}", {opacity:0, scale:0.6}, {opacity:1, scale:1, duration:${d}, ease:"back.out(1.8)"}, ${num(at)});`);
    },
    fade(selector, at, d = 0.3) {
      statements.push(`tl.fromTo("${selector}", {opacity:0}, {opacity:1, duration:${d}}, ${num(at)});`);
    },
    slideIn(selector, at) {
      statements.push(`tl.fromTo("${selector}", {opacity:0, x:-40}, {opacity:1, x:0, duration:0.4, ease:"power3.out"}, ${num(at)});`);
    },
    fadeOut(selector, at, d = 0.25) {
      statements.push(`tl.to("${selector}", {opacity:0, duration:${d}, ease:"power2.in"}, ${num(at)});`);
    },
    raw(statement) {
      statements.push(statement);
    },
  };
}

// 每個元件回傳 { html, classes }，並把動畫寫進 builder。
// cue(name, fallbackOffset)：有解析出的時間就用，沒有就用「場景開始 + 偏移」。
const RENDERERS = {
  stat(scene, params, cue, b) {
    const id = scene.id;
    const parts = [];
    if (params.label) {
      parts.push(`<div class="lbl" id="${id}-label">${escapeHtml(params.label)}</div>`);
      b.pop(`#${id}-label`, cue('label', 0.3), { y: 12, d: 0.35 });
    }
    if (params.kicker) {
      parts.push(`<div class="kick" id="${id}-kick">${escapeHtml(params.kicker)}</div>`);
      b.scalePop(`#${id}-kick`, cue('kicker', 0.8));
    }
    const isNumber = typeof params.value === 'number';
    parts.push(`<div class="bignum"><span id="${id}-num">${isNumber ? 0 : escapeHtml(params.value)}</span>${params.unit ? `<span class="unit" id="${id}-unit">${escapeHtml(params.unit)}</span>` : ''}</div>`);
    const valueAt = cue('value', 1.4);
    if (isNumber) {
      const decimals = Number.isInteger(params.value) ? 0 : 1;
      b.raw(`(function(){var o={v:0};tl.fromTo("#${id}-num",{opacity:0},{opacity:1,duration:0.2},${num(valueAt)});tl.to(o,{v:${params.value},duration:1.0,ease:"power2.out",onUpdate:function(){document.getElementById("${id}-num").textContent=o.v.toFixed(${decimals});}},${num(valueAt)});})();`);
    } else {
      b.scalePop(`#${id}-num`, valueAt);
    }
    if (params.unit) b.pop(`#${id}-unit`, cue('unit', 2.4), { y: 10, d: 0.3 });
    if (params.badge) {
      parts.push(`<div class="chipstack" id="${id}-badge"><div class="chip c3"></div><div class="chip c2"></div><div class="chip c1">${escapeHtml(params.badge)}</div></div>`);
      b.scalePop(`#${id}-badge`, cue('badge', 3.2));
    }
    return parts.join('');
  },

  slots(scene, params, cue, b) {
    const id = scene.id;
    const slots = Array.from({ length: params.count }, (_, i) => `<div class="slot" id="${id}-slot${i}"><span>${escapeHtml(params.badge)}</span></div>`).join('');
    const show = cue('show', 0.8);
    const parts = [];
    if (params.label) {
      parts.push(`<div class="lbl" id="${id}-label">${escapeHtml(params.label)}</div>`);
      b.pop(`#${id}-label`, show - 0.2, { y: 12, d: 0.35 });
    }
    parts.push(`<div class="server" id="${id}-server">${slots}</div>`);
    b.pop(`#${id}-server`, show, { y: 40, d: 0.6 });
    for (let i = 0; i < params.count; i += 1) {
      const at = cue(`lit${i}`, 1.6 + i * 0.35);
      b.raw(`tl.to("#${id}-slot${i}", {backgroundColor:"#FFC93C", color:"#25101F", boxShadow:"0 0 28px rgba(255,201,60,.8)", duration:0.25}, ${num(at)});`);
    }
    return parts.join('');
  },

  rows(scene, params, cue, b) {
    const id = scene.id;
    let order = 0;
    const rows = params.rows.map((row, r) => {
      const widths = row.tokens.map((token) => widthEm(token.t) * TOKEN_MAX_PX[token.style || 'text']);
      const total = widths.reduce((sum, w) => sum + w, 0) + (row.tokens.length - 1) * 16;
      const scale = Math.min(1, ROW_WIDTH_PX / total);
      const tokens = row.tokens.map((token, t) => {
        const style = token.style || 'text';
        const size = Math.max(28, Math.floor(TOKEN_MAX_PX[style] * scale));
        const at = cue(`r${r}t${t}`, 0.3 + order * 0.35);
        order += 1;
        b.pop(`#${id}-r${r}t${t}`, at, { y: 16, d: 0.35 });
        return `<span class="tok tok-${style}" id="${id}-r${r}t${t}" style="font-size:${size}px">${escapeHtml(token.t)}</span>`;
      });
      return `<div class="rowx">${tokens.join('')}</div>`;
    });
    const parts = [rows.join('')];
    if (params.note) {
      parts.push(`<div class="note" id="${id}-note">${escapeHtml(params.note)}</div>`);
      b.pop(`#${id}-note`, cue('note', 0.3 + order * 0.35), { y: 10, d: 0.3 });
    }
    return parts.join('');
  },

  'quote-reveal'(scene, params, cue, b) {
    const id = scene.id;
    const parts = [];
    if (params.label) {
      parts.push(`<div class="lbl" id="${id}-label">${escapeHtml(params.label)}</div>`);
      b.pop(`#${id}-label`, cue('label', 0.3), { y: 10, d: 0.3 });
    }
    parts.push(`<div class="bubble" id="${id}-bub"><span id="${id}-txt">${escapeHtml(params.text)}</span></div>`);
    const textAt = cue('text', 1.0);
    const reveal = Math.max(0.8, Math.min(2.4, scene.t1 - textAt - 0.3));
    b.raw(`tl.fromTo("#${id}-bub", {opacity:0, scale:0.9}, {opacity:1, scale:1, duration:0.3, ease:"power2.out"}, ${num(textAt - 0.1)});`);
    b.raw(`tl.fromTo("#${id}-txt", {clipPath:"inset(0 100% 0 0)"}, {clipPath:"inset(0 0% 0 0)", duration:${round3(reveal)}, ease:"none"}, ${num(textAt)});`);
    return parts.join('');
  },

  chips(scene, params, cue, b) {
    const id = scene.id;
    const parts = [];
    if (params.note) {
      parts.push(`<div class="note2" id="${id}-note">${escapeHtml(params.note)}</div>`);
      b.pop(`#${id}-note`, cue('note', 0.6), { y: 10, d: 0.3 });
    }
    parts.push(`<div class="chips">${params.chips.map((text, k) => `<div class="chipw" id="${id}-ch${k}">${escapeHtml(text)}</div>`).join('')}</div>`);
    const enter = cue('enter', 0.2);
    params.chips.forEach((_, k) => {
      b.raw(`tl.fromTo("#${id}-ch${k}", {opacity:0, y:20}, {opacity:1, y:0, duration:0.3, ease:"power3.out"}, ${num(enter + 0.12 * k)});`);
    });
    for (const k of params.highlight || []) {
      const at = cue(`hl${k}`, 1.0);
      b.raw(`tl.to("#${id}-ch${k}", {backgroundColor:"#FFC93C", color:"#25101F", borderColor:"#FFC93C", scale:1.12, duration:0.25}, ${num(at)});`);
    }
    if (params.dimKeep !== undefined) {
      const at = cue('dim', 1.5);
      params.chips.forEach((_, k) => {
        if (k !== params.dimKeep) b.raw(`tl.to("#${id}-ch${k}", {opacity:0.18, duration:0.3}, ${num(at)});`);
      });
      b.raw(`tl.to("#${id}-ch${params.dimKeep}", {backgroundColor:"#FFC93C", color:"#25101F", borderColor:"#FFC93C", scale:1.3, duration:0.3}, ${num(at)});`);
    }
    if (params.question) {
      parts.push(`<div class="qmark" id="${id}-q">？</div>`);
      b.scalePop(`#${id}-q`, cue('q', 2.2));
    }
    if (params.caption) {
      parts.push(`<div class="cap2" id="${id}-cap">${escapeHtml(params.caption)}</div>`);
      b.pop(`#${id}-cap`, cue('caption', 2.5), { y: 10, d: 0.3 });
    }
    return parts.join('');
  },

  compare(scene, params, cue, b) {
    const id = scene.id;
    const side = (key, value) => {
      const classes = ['loc'];
      if (value.highlight) classes.push('hl');
      if (value.bad) classes.push('bad');
      return `<div class="${classes.join(' ')}" id="${id}-${key}">${value.label ? `<div class="ll">${escapeHtml(value.label)}</div>` : ''}<div class="lv">${escapeHtml(value.value)}</div></div>`;
    };
    const link = params.link && params.link !== '→'
      ? `<div class="lk" id="${id}-link"><div class="lkl">${escapeHtml(params.link)}</div><div class="lkline"></div></div>`
      : `<div class="arrow" id="${id}-link">→</div>`;
    const parts = [`<div class="locs">${side('left', params.left)}${link}${side('right', params.right)}</div>`];
    const leftAt = cue('left', 0.4);
    const rightAt = cue('right', 1.4);
    b.pop(`#${id}-left`, leftAt, { y: 20, d: 0.4 });
    b.fade(`#${id}-link`, cue('link', (rightAt - scene.t0) - 0.5), 0.3);
    b.pop(`#${id}-right`, rightAt, { y: 20, d: 0.4 });
    if (params.mark && params.mark !== 'none') {
      parts.push(`<div class="mark ${params.mark === '✓' ? 'ok' : 'no'}" id="${id}-mark">${params.mark}</div>`);
      b.scalePop(`#${id}-mark`, cue('mark', (rightAt - scene.t0) + 1.2), 0.35);
    }
    return parts.join('');
  },

  checklist(scene, params, cue, b) {
    const id = scene.id;
    const plain = params.mark === 'none' || params.mark === undefined;
    const parts = [];
    if (params.head) {
      parts.push(`<div class="mid2" id="${id}-head">${escapeHtml(params.head)}</div>`);
      b.pop(`#${id}-head`, cue('head', 0.3), { y: 14, d: 0.35 });
    }
    const items = params.items.map((text, k) => `<div class="item${plain ? ' plain' : ''}" id="${id}-item${k}">${plain ? '' : `<span class="x${params.mark === '✓' ? ' ok' : ''}">${params.mark}</span>`}<span class="nm">${escapeHtml(text)}</span></div>`);
    parts.push(`<div class="items${plain ? ' single' : ''}">${items.join('')}</div>`);
    params.items.forEach((_, k) => b.slideIn(`#${id}-item${k}`, cue(`item${k}`, 0.8 + k * 0.5)));
    if (params.banner) {
      parts.push(`<div class="banner" id="${id}-banner">${escapeHtml(params.banner)}</div>`);
      b.scalePop(`#${id}-banner`, cue('banner', 0.8 + params.items.length * 0.5));
    }
    return parts.join('');
  },

  'place-values'(scene, params, cue, b) {
    const id = scene.id;
    const cells = params.digits.map((digit, k) => `<div class="cell" id="${id}-d${k}"><div class="dg">${digit}</div><div class="pl">${escapeHtml(params.labels[k])}</div></div>`);
    const parts = [`<div class="digits">${cells.join('')}</div>`];
    params.digits.forEach((_, k) => b.scalePop(`#${id}-d${k}`, cue(`d${k}`, 0.3 + (params.digits.length - 1 - k) * 0.4), 0.35));
    if (params.note) {
      parts.push(`<div class="note" id="${id}-note">${escapeHtml(params.note)}</div>`);
      b.pop(`#${id}-note`, cue('note', 0.3 + params.digits.length * 0.4), { y: 10, d: 0.3 });
    }
    return parts.join('');
  },

  relation(scene, params, cue, b) {
    const id = scene.id;
    const words = params.words.map((text, k) => `<div class="chipw${k === 2 ? ' hl' : ''}" id="${id}-w${k}">${escapeHtml(text)}</div>`);
    const row = `${words[0]}<div class="lnk" id="${id}-l0"></div>${words[1]}<div class="lnk" id="${id}-l1"></div>${words[2]}`;
    const parts = [`<div class="relrow">${row}</div>`];
    params.words.forEach((_, k) => b.pop(`#${id}-w${k}`, cue(`w${k}`, 0.3 + k * 0.5), { y: 14, d: 0.3 }));
    [0, 1].forEach((k) => b.raw(`tl.fromTo("#${id}-l${k}", {width:0}, {width:46, duration:0.35, ease:"power2.out"}, ${num(cue(`l${k}`, 1.8 + k * 0.4))});`));
    if (params.note) {
      parts.push(`<div class="note" id="${id}-note">${escapeHtml(params.note)}</div>`);
      b.pop(`#${id}-note`, cue('note', 2.8), { y: 10, d: 0.3 });
    }
    return parts.join('');
  },
};

function buildHtml(plan, resolved, { css = null, teacherSrc = 'teacher.mp4' } = {}) {
  const styles = css ?? fs.readFileSync(STYLE_PATH, 'utf8');
  const b = createBuilder();
  const sceneTimes = Object.fromEntries(resolved.scenes.map((scene) => [scene.id, scene]));

  const sceneHtml = plan.scenes.map((scene) => {
    const timing = sceneTimes[scene.id];
    const context = { id: scene.id, t0: timing.t0, t1: timing.t1 };
    const cue = (name, fallback = 0.3) => (timing.cues[name] !== undefined ? timing.cues[name] : round3(timing.t0 + fallback));
    const inner = RENDERERS[scene.component](context, scene.params, cue, b);
    let stamp = '';
    if (scene.stamp) {
      stamp = `<div class="stamp" id="${scene.id}-stamp">${escapeHtml(scene.stamp.text)}</div>`;
      const at = cue('stamp', 1.0);
      b.raw(`tl.fromTo("#${scene.id}-stamp", {opacity:0, scale:2.0, rotation:-12}, {opacity:1, scale:1, rotation:-7, duration:0.3, ease:"power4.in"}, ${num(at)});`);
    }
    b.fadeOut(`#${scene.id}`, timing.t1 - 0.28, 0.25);
    // 有印章的場景把主要內容往上讓出右下角，避免蓋到最後一列
    return `<div class="scene sc-${scene.component}${scene.stamp ? ' has-stamp' : ''} clip" id="${scene.id}" data-start="${num(timing.t0)}" data-duration="${num(timing.t1 - timing.t0)}">${inner}${stamp}</div>`;
  });

  const subtitleHtml = resolved.subtitles.map((timing, k) => {
    const subtitle = plan.subtitles[timing.index];
    const runs = subtitle.runs.map((run) => (run.hl ? `<b>${escapeHtml(run.t)}</b>` : escapeHtml(run.t))).join('');
    b.raw(`tl.fromTo("#sub${k}", {opacity:0, y:14}, {opacity:1, y:0, duration:0.18, ease:"power2.out"}, ${num(timing.t0 + 0.02)});`);
    return `<div class="sub clip" data-start="${num(timing.t0)}" data-duration="${num(timing.t1 - timing.t0)}"><span id="sub${k}">${runs}</span></div>`;
  });

  const end = resolved.endCard;
  b.raw(`tl.fromTo("#endcard", {opacity:0}, {opacity:1, duration:0.4}, ${num(end.t0)});`);
  b.raw(`tl.fromTo("#end1", {opacity:0, y:20}, {opacity:1, y:0, duration:0.5, ease:"power3.out"}, ${num(end.t0 + 0.2)});`);
  b.raw(`tl.fromTo("#end2", {opacity:0, y:12}, {opacity:1, y:0, duration:0.5, ease:"power3.out"}, ${num(end.t0 + 0.5)});`);
  b.raw('tl.fromTo("#hdr", {opacity:0, y:-16}, {opacity:1, y:0, duration:0.5, ease:"power3.out"}, 0.05);');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=720, height=1280" />
<title>${escapeHtml(plan.title.text)}</title>
<script src="vendor/gsap.min.js"></script>
<style>
${styles}
</style>
</head>
<body>
<div id="root" data-composition-id="recut" data-start="0" data-width="720" data-height="1280" data-duration="${num(resolved.total)}">
  <div class="panel"></div>
  <div class="hdr" id="hdr"><div class="tag">${escapeHtml(plan.title.tag)}</div><div class="ttl">${escapeHtml(plan.title.text)}</div><div class="logo">FocusFlow</div></div>
  <div class="stage">
    ${sceneHtml.join('\n    ')}
  </div>
  <div class="band">
    ${subtitleHtml.join('\n    ')}
  </div>
  <div class="rule"></div>
  <video id="teacher" src="${teacherSrc}" playsinline data-has-audio="true" data-start="0" data-duration="${num(resolved.speechTotal)}" data-track-index="1"></video>
  <div id="endcard" class="endcard"><div class="e1" id="end1">${escapeHtml(plan.endCard.line1)}</div><div class="e2" id="end2">${escapeHtml(plan.endCard.line2 || '')}</div></div>
</div>
<script>
const tl = gsap.timeline({ paused: true });
${b.statements.join('\n')}
window.__timelines["recut"] = tl;
</script>
</body>
</html>
`;
}

module.exports = { buildHtml, escapeHtml, widthEm };
