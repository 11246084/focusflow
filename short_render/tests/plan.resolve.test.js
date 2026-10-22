'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  locateAnchor, snapStart, snapEnd, resolvePlan, validatePlan, compareCutText,
} = require('../src/plan');
const { fixtures, clone, wordsByClipFor } = require('./helpers');

const word = (w, s, e) => ({ w, s, e });

describe('locateAnchor', () => {
  const words = [word('我', 0, 0.2), word('想', 0.2, 0.4), word('買', 0.4, 0.6), word('便當', 0.6, 1.0), word('你', 1.2, 1.4), word('買', 1.4, 1.6), word('便當', 1.6, 2.0)];

  it('完全相同時回傳第 n 次出現的字詞範圍', () => {
    const first = locateAnchor(words, { text: '買便當' });
    const second = locateAnchor(words, { text: '買便當', nth: 2 });
    assert.deepEqual([first.startWord, first.endWord, first.exact], [2, 3, true]);
    assert.deepEqual([second.startWord, second.endWord], [5, 6]);
  });

  it('要求的次數多於實際出現次數時失敗，不會悄悄換成別處', () => {
    assert.equal(locateAnchor(words, { text: '買便當', nth: 3 }), null);
  });

  it('標點與空白不影響比對', () => {
    const found = locateAnchor([word('Siri,', 0, 1), word('說', 1, 2)], { text: 'siri 說' });
    assert.equal(found.exact, true);
  });

  it('ASR 錯字時退到模糊比對，且標示非完全相同', () => {
    const noisy = [word('大野', 0, 1), word('模型', 1, 2), word('的話', 2, 3)];
    const found = locateAnchor(noisy, { text: '大語言模型的話' });
    assert.equal(found.exact, false);
    assert.ok(found.score >= 0.7 && found.score < 1);
    assert.deepEqual([found.startWord, found.endWord], [0, 2]);
  });

  it('差太多就不模糊命中', () => {
    assert.equal(locateAnchor([word('完全不同的內容', 0, 1)], { text: '大語言模型' }), null);
  });
});

describe('snapStart / snapEnd', () => {
  it('切入點落在語音前剛結束的靜音之後，並退一小段', () => {
    assert.equal(snapStart(10.0, [[8.0, 9.7]]), 9.6);
  });

  it('靜音覆蓋字開頭（字詞時間偏早）時，下刀點仍在靜音之內、且不晚於字開頭', () => {
    assert.equal(snapStart(10.0, [[9.5, 10.4]]), 9.98);
  });

  it('字開頭在靜音結束之前很多（靜音早已結束）不採用', () => {
    assert.equal(snapStart(10.0, [[5.0, 6.0]]), 9.9);
  });

  it('沒有靜音可吸附時只留一點前後空隙', () => {
    assert.equal(snapStart(10.0, []), 9.9);
    assert.equal(snapEnd(12.0, []), 12.2);
  });

  it('切出點落在語音後開始的靜音，並留一口氣', () => {
    assert.equal(snapEnd(12.0, [[12.3, 14.0]]), 12.5);
  });

  it('語音結束前就結束的靜音不採用（靜音之後還有語音，避免切掉尾音）', () => {
    assert.equal(snapEnd(12.0, [[11.0, 11.4]]), 12.2);
  });

  it('字尾被 ASR 拉長進靜音（實測「做」被標成 1 秒）：改切在靜音開始處', () => {
    // wordEnd 690.73 實際語音在 690.05 就結束；下一個字詞 690.73 才開頭，後面還有一段更晚的靜音不能選
    const silences = [[690.048, 690.886], [691.444, 692.055]];
    assert.equal(snapEnd(690.73, silences, 690.73), 690.248);
  });

  it('候選靜音晚於下一個字詞的開頭就不採用，避免帶進下一句的第一個字', () => {
    assert.equal(snapEnd(12.0, [[12.6, 14.0]], 12.1), 12.2);
  });
});

function resolveFixture(plan, windows, pick) {
  return resolvePlan(plan, { wordsByClip: wordsByClipFor(plan, windows, pick) });
}

describe('resolvePlan：用原型實際對齊的字詞', () => {
  it('數字型 plan：所有錨點都能對到，時間軸單調', () => {
    const plan = fixtures.plan1();
    const words = fixtures.words1();
    const { resolved, errors } = resolveFixture(plan, words, (clip) => (clip.id.startsWith('p') ? 'hook' : 'main'));
    assert.deepEqual(errors, []);

    let cursor = 0;
    for (const clip of resolved.clips) {
      assert.ok(clip.dur > 0.8, `clip ${clip.id} too short`);
      assert.equal(clip.outStart, Math.round(cursor * 1000) / 1000);
      cursor = clip.outEnd;
    }
    assert.ok(resolved.speechTotal > 50 && resolved.speechTotal < 65, `speechTotal ${resolved.speechTotal}`);
    assert.equal(resolved.total, Math.round((resolved.speechTotal + 3.6) * 1000) / 1000);
  });

  it('概念型 plan：解析成功並通過含對齊時間的完整驗證', () => {
    const plan = fixtures.plan2();
    const { resolved, errors } = resolveFixture(plan, fixtures.words5(), () => 'main');
    assert.deepEqual(errors, []);

    const result = validatePlan(plan, { evidence: fixtures.evidence5(), resolved });
    assert.deepEqual(result.errors, []);
  });

  it('字幕時間依說話順序遞增，最後一張到講話結束', () => {
    const plan = fixtures.plan2();
    const { resolved } = resolveFixture(plan, fixtures.words5(), () => 'main');
    const times = resolved.subtitles.map((item) => item.t0);
    assert.deepEqual([...times].sort((a, b) => a - b), times);
    assert.equal(resolved.subtitles.at(-1).t1, resolved.speechTotal);
  });

  it('cue 時間落在所屬場景內', () => {
    const plan = fixtures.plan2();
    const { resolved } = resolveFixture(plan, fixtures.words5(), () => 'main');
    for (const scene of resolved.scenes) {
      for (const [name, time] of Object.entries(scene.cues)) {
        assert.ok(time >= scene.t0 && time <= scene.t1, `${scene.id}.${name}=${time} outside ${scene.t0}-${scene.t1}`);
      }
    }
  });

  it('模糊命中的 clip 會被標記（提醒檢查）', () => {
    const plan = fixtures.plan1();
    const { resolved } = resolveFixture(plan, fixtures.words1(), (clip) => (clip.id.startsWith('p') ? 'hook' : 'main'));
    const fuzzy = resolved.clips.filter((clip) => !clip.anchorsExact).map((clip) => clip.id);
    assert.ok(fuzzy.includes('p1'), `expected p1 to be fuzzy-matched, got ${fuzzy}`);
  });
});

describe('resolvePlan：失敗情境', () => {
  it('錨點在對齊結果裡找不到時回報位置', () => {
    const plan = clone(fixtures.plan2());
    plan.clips[0].from = { text: '完全不存在的一句話' };
    const { resolved, errors } = resolveFixture(plan, fixtures.words5(), () => 'main');
    assert.equal(resolved, null);
    assert.equal(errors[0].code, 'ANCHOR_NOT_FOUND');
    assert.equal(errors[0].path, 'clips[0].from');
  });

  it('結尾錨點早於起點錨點被擋', () => {
    const plan = clone(fixtures.plan2());
    plan.clips[0].to = { text: '最經典' };
    plan.clips[0].from = { text: '附近有哪些餐廳' };
    const { errors } = resolveFixture(plan, fixtures.words5(), () => 'main');
    assert.equal(errors[0].code, 'ANCHOR_ORDER');
  });

  it('缺少某個 clip 的對齊字詞時回報', () => {
    const plan = fixtures.plan2();
    const { errors } = resolvePlan(plan, { wordsByClip: {} });
    assert.ok(errors.every((item) => item.code === 'ALIGN_MISSING'));
  });

  it('總長超出上限時完整驗證擋下', () => {
    const plan = fixtures.plan2();
    const { resolved } = resolveFixture(plan, fixtures.words5(), () => 'main');
    resolved.total = 90;
    const result = validatePlan(plan, { evidence: fixtures.evidence5(), resolved });
    assert.ok(result.errors.some((item) => item.code === 'DURATION'));
  });
});

describe('compareCutText（V6）', () => {
  it('剪後再轉錄的文字與預期相近就通過', () => {
    assert.equal(compareCutText('其中最重要的字是餐廳', '其中最重要的字是餐廳嘛').ok, true);
  });

  it('剪掉開頭幾個字會被擋', () => {
    assert.equal(compareCutText('其中最重要的字是餐廳', '的字是餐廳').ok, false);
  });
});
