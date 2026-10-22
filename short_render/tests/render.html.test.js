'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePlan } = require('../src/plan');
const { buildHtml, escapeHtml, widthEm } = require('../src/render/html');
const { buildCutArgs } = require('../src/render/cut');
const { fixtures, clone, wordsByClipFor } = require('./helpers');

function resolvedFor(plan, windows, pick) {
  const { resolved, errors } = resolvePlan(plan, { wordsByClip: wordsByClipFor(plan, windows, pick) });
  assert.deepEqual(errors, []);
  return resolved;
}

const cases = [
  ['數字型 plan1', () => {
    const plan = fixtures.plan1();
    return [plan, resolvedFor(plan, fixtures.words1(), (clip) => (clip.id.startsWith('p') ? 'hook' : 'main'))];
  }],
  ['概念型 plan2', () => {
    const plan = fixtures.plan2();
    return [plan, resolvedFor(plan, fixtures.words5(), () => 'main')];
  }],
];

for (const [name, build] of cases) {
  describe(`buildHtml：${name}`, () => {
    const [plan, resolved] = build();
    const html = buildHtml(plan, resolved);

    it('每個場景與字幕都輸出成帶時間的 clip，id 不重複', () => {
      for (const scene of plan.scenes) {
        assert.equal(html.split(`id="${scene.id}"`).length - 1, 1, `scene ${scene.id}`);
      }
      assert.equal((html.match(/class="sub clip"/g) || []).length, plan.subtitles.length);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      assert.equal(new Set(ids).size, ids.length, 'duplicate id found');
    });

    it('符合 HyperFrames 組合檔契約：根節點尺寸、單一 timeline、無外部網址', () => {
      assert.match(html, /data-composition-id="recut"[^>]*data-width="720"[^>]*data-height="1280"/);
      assert.match(html, /window\.__timelines\["recut"\] = tl;/);
      assert.equal((html.match(/gsap\.timeline\(/g) || []).length, 1);
      assert.equal(/https?:\/\//.test(html), false, 'html must not reference remote URLs');
      assert.equal((html.match(/<script src=/g) || []).length, 1);
    });

    it('老師影片用原音、時間長度等於說話總長（不是含結尾卡的總長）', () => {
      assert.match(html, /<video id="teacher" src="teacher\.mp4"[^>]*data-has-audio="true"/);
      assert.ok(html.includes(`data-duration="${resolved.speechTotal.toFixed(3)}" data-track-index="1"`));
      assert.ok(html.includes(`data-duration="${resolved.total.toFixed(3)}">`));
    });

    it('不使用 Math.random 或 Date.now（渲染必須是確定性的）', () => {
      assert.equal(/Math\.random|Date\.now|performance\.now/.test(html), false);
    });

    it('同樣輸入產生完全相同的輸出', () => {
      assert.equal(buildHtml(plan, resolved), html);
    });
  });
}

describe('buildHtml：安全與版面', () => {
  it('plan 內的 HTML 特殊字元會被跳脫（LLM 輸出不能注入標記）', () => {
    const plan = clone(fixtures.plan2());
    plan.subtitles[0].runs = [{ t: '<img src=x onerror=alert(1)>' }];
    plan.title.text = '"><script>x</script>';
    const resolved = resolvedFor(plan, fixtures.words5(), () => 'main');
    const html = buildHtml(plan, resolved);
    assert.equal(html.includes('<img src=x'), false);
    assert.equal(html.includes('<script>x</script>'), false);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  it('有印章的場景加上 has-stamp（內容讓出右下角），沒有的不加', () => {
    const plan = fixtures.plan2();
    const resolved = resolvedFor(plan, fixtures.words5(), () => 'main');
    const html = buildHtml(plan, resolved);
    assert.equal((html.match(/class="scene [^"]*has-stamp[^"]*"/g) || []).length, 1);
    assert.match(html, /id="s4-stamp"/);
  });

  it('escapeHtml 與 widthEm', () => {
    assert.equal(escapeHtml('a&b<"c">'), 'a&amp;b&lt;&quot;c&quot;&gt;');
    assert.ok(widthEm('A100') < widthEm('四張百'));
  });

  it('rows 的字級會依整列寬度縮小，長字串不會折行', () => {
    const plan = fixtures.plan1();
    const resolved = resolvedFor(plan, fixtures.words1(), (clip) => (clip.id.startsWith('p') ? 'hook' : 'main'));
    const html = buildHtml(plan, resolved);
    const sizes = [...html.matchAll(/class="tok tok-huge" id="s8-r1t0" style="font-size:(\d+)px"/g)].map((match) => Number(match[1]));
    assert.equal(sizes.length, 1);
    assert.ok(sizes[0] < 190 && sizes[0] >= 28);
  });
});

describe('buildCutArgs', () => {
  const plan = fixtures.plan2();
  const resolved = resolvedFor(plan, fixtures.words5(), () => 'main');
  const args = buildCutArgs({
    sourcePath: 'in.mp4', resolved, region: plan.source.teacherRegion, outPath: 'out.mp4',
  });
  const graph = args[args.indexOf('-filter_complex') + 1];

  it('每個 clip 都有 trim、裁老師視窗與 concat', () => {
    assert.equal((graph.match(/trim=start=/g) || []).length, resolved.clips.length * 2);
    assert.ok(graph.includes('crop=359:268:1520:272'));
    assert.ok(graph.includes(`concat=n=${resolved.clips.length}:v=1:a=1`));
  });

  it('不加速、不改音高（模板 06：聲音不能動）', () => {
    assert.equal(/atempo|setpts=PTS\/|setpts=0\./.test(graph), false);
  });

  it('每秒一個關鍵格，渲染器逐格 seek 不會停格', () => {
    assert.ok(args.includes('-g') && args[args.indexOf('-g') + 1] === '30');
  });
});
