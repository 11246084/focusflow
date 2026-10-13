'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, validateStructure, safeEvaluate } = require('../src/plan');
const { fixtures, clone } = require('./helpers');

const codes = (result) => result.errors.map((item) => item.code);

describe('recut plan 驗證：原型轉成的兩份 plan', () => {
  it('數字型 plan（plan1）通過全部驗證', () => {
    const result = validatePlan(fixtures.plan1(), { evidence: fixtures.evidence1() });
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  });

  it('概念型 plan（plan2）通過全部驗證', () => {
    const result = validatePlan(fixtures.plan2(), { evidence: fixtures.evidence5() });
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  });
});

describe('recut plan 驗證：結構（V0/V4/V8）', () => {
  it('缺 schemaVersion 與未知元件都會被擋', () => {
    const plan = clone(fixtures.plan1());
    delete plan.schemaVersion;
    plan.scenes[0].component = 'confetti';
    const found = validateStructure(plan).map((item) => item.code);
    assert.ok(found.includes('SCHEMA_VERSION'));
    assert.ok(found.includes('COMPONENT_PARAMS'));
  });

  it('字幕超過 20 字被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.subtitles[0].runs = [{ t: '這是一句非常非常非常非常非常長的字幕不應該通過' }];
    assert.ok(validateStructure(plan).some((item) => item.code === 'SUBTITLE_TOO_LONG'));
  });

  it('字幕出現簡體字被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.subtitles[0].runs = [{ t: '这个数据' }];
    assert.ok(validateStructure(plan).some((item) => item.code === 'SUBTITLE_SIMPLIFIED'));
  });

  it('cue 名稱不屬於該元件被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.scenes[0].cues.lit0 = { text: '四張' };
    assert.ok(validateStructure(plan).some((item) => item.code === 'CUE_UNKNOWN'));
  });

  it('場景沒有照 clip 順序涵蓋會被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.scenes[1].clips = ['p1'];
    assert.ok(validateStructure(plan).some((item) => item.code === 'SCENE_ORDER'));
  });
});

describe('recut plan 驗證：證據與錨點（V1/V2）', () => {
  it('引用證據外的 chunk 被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.clips[4].chunkIds = ['not_in_evidence'];
    const result = validatePlan(plan, { evidence: fixtures.evidence1() });
    assert.ok(codes(result).includes('EVIDENCE_MISSING'));
    assert.equal(result.valid, false);
  });

  it('chunk 屬於別支影片被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.source.videoId = 'another-video';
    assert.ok(codes(validatePlan(plan, { evidence: fixtures.evidence1() })).includes('SOURCE_MISMATCH'));
  });

  it('錨點文字不在所引用的 chunk 內被擋（捏造的句子）', () => {
    const plan = clone(fixtures.plan1());
    plan.clips[4].from = { text: '老師說這台伺服器花了一億' };
    assert.ok(codes(validatePlan(plan, { evidence: fixtures.evidence1() })).includes('ANCHOR_NOT_IN_EVIDENCE'));
  });

  it('要求第 n 次出現但證據裡不夠次數被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.clips[0].to = { text: '模型的話', nth: 3 };
    assert.ok(codes(validatePlan(plan, { evidence: fixtures.evidence1() })).includes('ANCHOR_NOT_IN_EVIDENCE'));
  });
});

describe('recut plan 驗證：數字對證（V3）', () => {
  it('畫面出現證據裡沒有的數字被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.scenes[0].params.value = 300;
    const result = validatePlan(plan, { evidence: fixtures.evidence1() });
    assert.ok(codes(result).includes('NUMBER_UNSUPPORTED'));
    assert.match(result.errors.find((item) => item.code === 'NUMBER_UNSUPPORTED').message, /300/);
  });

  it('derived 算式與宣稱的值不符被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.derived[0].value = 13000;
    assert.ok(codes(validatePlan(plan, { evidence: fixtures.evidence1() })).includes('DERIVED_MISMATCH'));
  });

  it('derived 的輸入數字不在證據裡被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.derived[0].expr = '70*200';
    plan.derived[0].value = 14000;
    assert.ok(codes(validatePlan(plan, { evidence: fixtures.evidence1() })).includes('DERIVED_INPUT'));
  });

  it('derived.shows 與推導值無關的數字被擋', () => {
    const plan = clone(fixtures.plan1());
    plan.derived[0].shows = ['12,000', '7.7'];
    assert.ok(codes(validatePlan(plan, { evidence: fixtures.evidence1() })).includes('DERIVED_SHOWS'));
  });

  it('萬／億的十進位換算（12000 萬 = 1.2 億）可接受', () => {
    const result = validatePlan(fixtures.plan1(), { evidence: fixtures.evidence1() });
    assert.equal(result.errors.filter((item) => item.code.startsWith('DERIVED')).length, 0);
  });
});

describe('recut plan 驗證：指涉畫面句（V7）', () => {
  it('引用文字含「你們看這邊」只給警告、不阻擋', () => {
    const evidence = fixtures.evidence1();
    evidence.find((item) => item.chunkId === 'fx1_c03').rawText += '你們看這邊這張投影片';
    const result = validatePlan(fixtures.plan1(), { evidence });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((item) => item.code === 'REFERENTIAL_PHRASE'));
  });
});

describe('safeEvaluate', () => {
  it('四則運算與括號', () => {
    assert.equal(safeEvaluate('60*200'), 12000);
    assert.equal(safeEvaluate('(1+2)*3-4/2'), 7);
    assert.equal(safeEvaluate('1.5*2'), 3);
  });

  it('不接受識別字、呼叫或殘留符號（不是 eval）', () => {
    assert.ok(Number.isNaN(safeEvaluate('process.exit()')));
    assert.ok(Number.isNaN(safeEvaluate('2**3')));
    assert.ok(Number.isNaN(safeEvaluate('1+')));
    assert.ok(Number.isNaN(safeEvaluate('1/0')));
    assert.ok(Number.isNaN(safeEvaluate('(1+2')));
  });
});
