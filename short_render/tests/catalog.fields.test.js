'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./sentence.fixture');
const { validatePlan, getComponentCatalog, describeComponent } = require('../src/plan');
const { PARAM_SCHEMAS, checkParamFields } = require('../src/plan/catalog');

test('every component lists its own fields, required fields and example cues from PARAM_SCHEMAS', () => {
  for (const entry of getComponentCatalog()) {
    const schema = PARAM_SCHEMAS[entry.name];
    assert.deepEqual(entry.fields, Object.keys(schema.properties), entry.name);
    assert.deepEqual(entry.required, schema.required || [], entry.name);
    for (const nested of entry.nestedFields) {
      assert.ok(nested.allowed.length, `${entry.name} ${nested.path}`);
      assert.ok(nested.required.every((key) => nested.allowed.includes(key)), `${entry.name} ${nested.path}`);
    }
    assert.ok(entry.exampleCues.includes('stamp'), entry.name);
  }
  const rows = getComponentCatalog().find((entry) => entry.name === 'rows');
  assert.deepEqual(rows.nestedFields.map((v) => v.path), ['rows[]', 'rows[].tokens[]']);
  assert.deepEqual(rows.nestedFields[1], { path: 'rows[].tokens[]', allowed: ['t', 'style', 'icon'], required: ['t'] });
});

test('every catalog example is valid for its own component and lists only its own fields', () => {
  for (const entry of getComponentCatalog()) {
    const example = JSON.parse(entry.example);
    assert.deepEqual(describeComponent(entry.name, example).errors, [], entry.name);
    assert.deepEqual(checkParamFields(entry.name, example), [], entry.name);
    assert.ok(entry.required.every((key) => Object.hasOwn(example, key)), `${entry.name} example covers required fields`);
  }
});

test('FIELD_UNKNOWN names the component, the level and the allowed fields', () => {
  const [top] = checkParamFields('quote-reveal', { text: '重點', unit: '秒' }, 'scenes[0].params');
  assert.equal(top.code, 'FIELD_UNKNOWN');
  assert.equal(top.path, 'scenes[0].params.unit');
  assert.match(top.message, /component "quote-reveal" params allows only: text, label, icon; required: text/);
  const [nested] = checkParamFields('rows', { rows: [{ tokens: [{ t: 'a', color: 'red' }] }] }, 'scenes[1].params');
  assert.equal(nested.path, 'scenes[1].params.rows[0].tokens[0].color');
  assert.match(nested.message, /component "rows" rows\[\]\.tokens\[\] allows only: t, style, icon; required: t/);
  const [side] = checkParamFields('compare', { left: { text: 'A', unit: 'x' }, right: { text: 'B' } }, 'p');
  assert.match(side.message, /component "compare" left allows only: text, value, label, icon, highlight, bad/);
});

test('unknown params still fail the whole plan and are not removed', () => {
  const { plan, sentences, source } = fixture();
  const bad = structuredClone(plan);
  const index = bad.scenes.findIndex((scene) => scene.component === 'quote-reveal' || scene.component === 'stat');
  assert.ok(index >= 0);
  bad.scenes[index].params.unknownExtra = '不在契約內';
  const result = validatePlan(bad, { sentences, evidence: source });
  assert.equal(result.valid, false);
  const error = result.errors.find((e) => e.code === 'FIELD_UNKNOWN');
  assert.equal(error.path, `scenes[${index}].params.unknownExtra`);
  assert.match(error.message, new RegExp(`component "${bad.scenes[index].component}" params allows only: `));
  assert.equal(bad.scenes[index].params.unknownExtra, '不在契約內');
});

test('timing feedback names the scene duration, sentence spans and the ambiguous phrase', () => {
  const { resolvePlan } = require('../src/plan');
  const { plan, sentences } = fixture();
  const short = structuredClone(plan);
  // Merge every scene into one: total speech is 30s, so it exceeds 12s.
  short.scenes = [{ ...short.scenes[0], to: short.scenes.at(-1).to, clips: [...new Set(short.scenes.flatMap((s) => s.clips))], basedOn: [...new Set(short.scenes.flatMap((s) => s.basedOn))], cues: {} }];
  const long = resolvePlan(short, { sentences });
  assert.equal(long.resolved, null);
  assert.match(long.errors[0].message, /lasts 30s but must last 3-12 seconds; regroup sentences at sentence boundaries\. Playback seconds per selected sentence: /);
  const ambiguous = structuredClone(plan);
  ambiguous.scenes[0].cues = { stamp: { sentenceId: ambiguous.scenes[0].from, text: '不存在的片語' } };
  ambiguous.scenes[0].stamp = { text: '注意' };
  const result = resolvePlan(ambiguous, { sentences });
  assert.match(result.errors[0].message, /anchor absent or ambiguous in .+: 不存在的片語; use a phrase copied from that sentence that occurs exactly once \(sentence: /);
});
