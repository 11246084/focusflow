'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, input } = require('./sentence.fixture');
const { buildRecutPlan, resolvePlan, validatePlan, validateStructure, calculateFixedGain, validateAudio, getComponentCatalog, getCardsResponseSchema, getAllowedIcons, describeComponent, ASSET_VERSIONS, SHORT_RENDER_VERSION } = require('../src/plan');
const { EXCLUDED_FLUENT, SYMBOL_ALLOWLIST, FLUENT_ALLOWLIST, validateIcon, iconSvg, validateInstalledAssets } = require('../src/plan/assets');

test('assembler uses immutable RC3 times and fills textual compatibility anchors', () => {
  const { plan, resolved, sentences, source } = fixture();
  assert.deepEqual(validatePlan(plan, { sentences, evidence: source }).errors, []);
  assert.equal(resolved.total, 30);
  assert.equal(resolved.clips[0].srcStart, 100);
  assert.deepEqual(resolved.scenes.map((s) => [s.t0, s.t1]), [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 30]]);
  assert.equal(plan.clips[0].textAnchors.from.text, '段落1說明');
  assert.equal(plan.versions.shortRender, SHORT_RENDER_VERSION);
  assert.deepEqual(plan.versions.assets, ASSET_VERSIONS);
});
test('same RC2 audio fields assemble without inventing measurements', () => {
  const args = input(); delete args.audio;
  const result = buildRecutPlan(args);
  assert.deepEqual(result.errors, []);
  assert.equal(result.plan.audio.gainDb, 4);
});
test('phrase lookup is sentence-local, unique, full-word and preserves decimals/code signs', () => {
  const { plan, sentences } = fixture();
  plan.scenes[0].cues.text.text = '段落2';
  assert.ok(resolvePlan(plan, { sentences }).errors.length);
  plan.scenes[0].cues.text.text = '段落';
  assert.ok(resolvePlan(plan, { sentences }).errors.length);
  plan.scenes[0].cues.text.text = '說明';
  assert.equal(resolvePlan(plan, { sentences }).resolved.scenes[0].cues.text, 2);
  const { phraseWords } = require('../src/plan/sentences');
  for (const [actual, wrong] of [['1.5', '15'], ['-1', '1'], ['C#', 'C']]) {
    assert.throws(() => phraseWords({ id: 's', words: [{ text: actual }] }, wrong));
  }
  assert.throws(() => phraseWords({ id: 's', words: [{ text: '說明' }, { text: '說明' }] }, '說明'));
});
test('trimmed out words, stale resolved, repeated source sentences and unsafe identifiers fail', () => {
  const { plan, sentences, resolved, source } = fixture();
  const stale = structuredClone(resolved); stale.clips[0].srcStart = 42;
  assert.ok(validatePlan(plan, { sentences, evidence: source, resolved: stale }).errors.some((e) => e.code === 'RESOLVED_MISMATCH'));
  plan.scenes[0].id = 'x";alert(1);//';
  assert.ok(validateStructure(plan).some((e) => e.code === 'SCENE_ID'));
  plan.scenes[0].id = 'card1';
  plan.clips.push({ ...plan.clips[0], id: 'c2' });
  assert.ok(resolvePlan(plan, { sentences }).errors.length);
});
test('cards cover selected sentences exactly at sentence boundaries and last 3-12 seconds', () => {
  const { plan, sentences } = fixture();
  plan.scenes[0].to = 's3';
  assert.ok(resolvePlan(plan, { sentences }).errors.length);
  plan.scenes[0].to = 's1'; plan.scenes.shift();
  assert.ok(resolvePlan(plan, { sentences }).errors.length);
});
test('invalid measurements, too quiet source, wrong gain, missing and mismatched versions fail closed', () => {
  const { plan } = fixture();
  plan.audio.gainDb = 6;
  assert.ok(validateStructure(plan).some((e) => e.code === 'AUDIO_INVALID'));
  assert.deepEqual(calculateFixedGain({ integratedLufs: -20, truePeakDbtp: -2 }), { gainDb: 0.5, inputIntegratedLufs: -20, inputTruePeakDbtp: -2, targetLufs: -16, maxTruePeakDbtp: -1.5 });
  assert.ok(validateAudio(calculateFixedGain({ integratedLufs: -25, truePeakDbtp: -2 })).includes('RECUT_SOURCE_TOO_QUIET'));
  for (const mutate of [(p) => { delete p.versions; }, (p) => { p.versions.shortRender = 'old'; }, (p) => { p.versions.assets['@phosphor-icons/core'] = 'latest'; }]) {
    const p = fixture().plan; mutate(p);
    assert.ok(validateStructure(p).some((e) => e.code === 'VERSION_MISMATCH'));
  }
  assert.deepEqual(validateInstalledAssets(), []);
});
test('approved policy yields 1341 defaults, exact 51 exclusions and 28 symbols, handles aliases and traffic lights', () => {
  assert.equal(FLUENT_ALLOWLIST.length, 1341);
  assert.equal(EXCLUDED_FLUENT.length, 51); assert.equal(SYMBOL_ALLOWLIST.length, 28);
  for (const name of EXCLUDED_FLUENT) assert.equal(validateIcon(`fluent:${name}`), false);
  for (const name of ['fluent:woman-with-headscarf', 'fluent:person-with-skullcap', 'fluent:man-wearing-turban', 'fluent:woman-wearing-turban', 'fluent:person-wearing-turban', 'fluent:horizontal-traffic-light', 'fluent:backhand-index-pointing-right']) assert.equal(validateIcon(name), true, name);
  for (const name of ['fluent:waving-hand-dark', 'fluent:rainbow-flag', 'fluent:japanese-here-button', 'phosphor:../../secret', 'fluent:toolbox?x', 'https://x']) assert.equal(validateIcon(name), false);
  assert.match(iconSvg('fluent:backhand-index-pointing-right'), /scale\(-1,1\)/);
  assert.match(iconSvg('phosphor:arrow-right'), /currentColor/);
  assert.equal(getAllowedIcons().length, 1354);
});
test('all rich item icon positions reject non-allowlisted assets', () => {
  const catalog = getComponentCatalog();
  for (const c of catalog) {
    const params = JSON.parse(c.example); params.icon = 'fluent:beer-mug';
    assert.ok(describeComponent(c.name, params).errors.some((e) => e.includes('allowlist')), c.name);
  }
  assert.deepEqual(describeComponent('compare', { left: { text: '工具', icon: 'fluent:toolbox' }, right: { text: '模型', icon: 'fluent:brain' } }).errors, []);
});
test('AI catalogue includes independently reviewed relation cards and excludes RC6-only code', () => {
  assert.equal(getComponentCatalog().length, 13);
  const ai = getComponentCatalog({ aiOnly: true });
  assert.equal(ai.length, 12);
  for (const name of ['not-fit', 'not-merge', 'nested']) {
    assert.ok(ai.some((card) => card.name === name));
    assert.equal(getComponentCatalog().find((card) => card.name === name).review, 'independent-mobile-reviewed-20261104');
  }
  assert.equal(ai.some((card) => card.name === 'code'), false);
  assert.equal(getComponentCatalog().find((card) => card.name === 'code').review, 'rc6-only');
  const schema = getCardsResponseSchema();
  const scene = schema.properties.scenes.items.properties;
  for (const name of ['not-fit', 'not-merge', 'nested']) assert.ok(scene.component.enum.includes(name));
  assert.equal(scene.component.enum.includes('code'), false);
  assert.equal(scene.params.properties.lines, undefined);
  for (const cue of ['object', 'container', 'attempt', 'reject', 'layer0', 'layer1', 'layer2']) assert.ok(scene.cues.items.properties.key.enum.includes(cue));
  const walk = (value) => { if (!value || typeof value !== 'object') return; if (value.type === 'OBJECT') assert.ok(value.properties && Object.keys(value.properties).length); Object.values(value).forEach(walk); };
  walk(schema);
  for (const entry of getComponentCatalog()) { assert.ok(entry.purpose); assert.ok(entry.doNotUse); assert.deepEqual(describeComponent(entry.name, JSON.parse(entry.example)).errors, [], entry.name); }
});
test('RC6 code limits, exact variable names, intentional errors and source metadata', () => {
  const p = { language: 'python', lines: [{ text: 'x = 1', source: '畫面原樣', originalText: 'x = 1' }], requiredVariables: ['x'], boxes: [{ line: 1, text: 'x' }] };
  assert.deepEqual(describeComponent('code', p).errors, []);
  for (const mutate of [(v) => { v.lines[0].text = 'x'.repeat(37); }, (v) => { v.lines = Array(13).fill(v.lines[0]); }, (v) => { v.requiredVariables = ['xx']; }, (v) => { v.lines[0] = { text: 'x=1', originalText: 'x==1', source: 'AI 修正', intentionalError: true }; }, (v) => { v.boxes[0].line = 2; }]) {
    const value = structuredClone(p); mutate(value); assert.ok(describeComponent('code', value).errors.length);
  }
});
test('all sentence-v1 entry points reject unknown fields and direct executable presentation payloads', () => {
  for (const mutate of [(p) => { p.html = '<script>x</script>'; }, (p) => { p.scenes[0].css = 'url(https://remote)'; }, (p) => { p.scenes[0].params.url = 'https://remote'; }, (p) => { p.scenes[0].cues.text.offset = 1; }, (p) => { p.audio.filter = 'loudnorm'; }, (p) => { p.subtitles[0].runs[0].onclick = 'x'; }]) {
    const { plan, sentences } = fixture(); mutate(plan);
    assert.ok(validateStructure(plan).some((e) => e.code === 'FIELD_UNKNOWN'));
    assert.ok(resolvePlan(plan, { sentences }).errors.length);
  }
  const { plan, sentences } = fixture(); plan.clips[0].textAnchors.from.text = '偽造';
  assert.ok(resolvePlan(plan, { sentences }).errors.length);
});
