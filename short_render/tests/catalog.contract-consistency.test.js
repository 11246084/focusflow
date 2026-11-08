'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./sentence.fixture');
const { validatePlan, getComponentCatalog, getCardsResponseSchema, describeComponent } = require('../src/plan');
const { PARAM_SCHEMAS, checkParamFields } = require('../src/plan/catalog');

const strip = (schema) => JSON.parse(JSON.stringify(schema, (key, value) => (key === 'description' ? undefined : value)));
const aiNames = () => getComponentCatalog({ aiOnly: true }).map((card) => card.name);

test('model-facing params hold exactly one strict sub-schema per AI component and nothing else', () => {
  const params = getCardsResponseSchema().properties.scenes.items.properties.params;
  assert.deepEqual(Object.keys(params.properties).sort(), aiNames().sort());
  assert.equal(params.required, undefined);
  for (const name of aiNames()) assert.deepEqual(params.properties[name], strip(PARAM_SCHEMAS[name]), name);
});

// The merged superset let not-merge.left/right ({text, icon}) overwrite compare.left/right.
test('compare.left/right keep their own nested fields and not-merge keeps its own', () => {
  const params = getCardsResponseSchema().properties.scenes.items.properties.params.properties;
  assert.deepEqual(Object.keys(params.compare.properties.left.properties), ['text', 'value', 'label', 'icon', 'highlight', 'bad']);
  assert.deepEqual(Object.keys(params.compare.properties.right.properties), ['text', 'value', 'label', 'icon', 'highlight', 'bad']);
  assert.deepEqual(Object.keys(params['not-merge'].properties.left.properties), ['text', 'icon']);
  const ok = { left: { text: 'CPU', value: '慢', highlight: true }, right: { text: 'GPU', bad: true } };
  assert.deepEqual(checkParamFields('compare', ok), []);
  assert.deepEqual(describeComponent('compare', ok).errors, []);
  assert.equal(checkParamFields('not-merge', { left: { text: 'a', value: 'x' }, right: { text: 'b' }, result: { text: 'c' } })[0].code, 'FIELD_UNKNOWN');
});

test('no component is offered a field that belongs only to another component', () => {
  const params = getCardsResponseSchema().properties.scenes.items.properties.params.properties;
  for (const name of aiNames()) {
    const offered = Object.keys(params[name].properties);
    assert.deepEqual(offered, Object.keys(PARAM_SCHEMAS[name].properties), name);
    if (name === 'stat') assert.equal(offered.includes('words'), false, 'stat must not be offered relation.words');
  }
});

test('schema required fields match what the component validator enforces', () => {
  for (const card of getComponentCatalog()) {
    const example = JSON.parse(card.example);
    const required = new Set(PARAM_SCHEMAS[card.name].required || []);
    for (const key of Object.keys(example)) {
      const params = structuredClone(example); delete params[key];
      const enforced = describeComponent(card.name, params).errors.length > 0 || checkParamFields(card.name, params).length > 0;
      assert.equal(enforced, required.has(key), `${card.name}.${key}`);
    }
  }
});

test('nested objects and arrays are validated at every level', () => {
  assert.match(checkParamFields('checklist', { items: [{ text: 'a', extra: 1 }] })[0].message, /checklist" items\[\] allows only: text, icon; required: text/);
  assert.match(checkParamFields('rows', { rows: [{ tokens: [{ t: 'a' }], extra: 1 }] })[0].message, /rows" rows\[\] allows only: tokens; required: tokens/);
  assert.match(checkParamFields('not-fit', { object: { text: 'a', size: 2 }, container: { text: 'b' } })[0].message, /not-fit" object allows only: text, icon/);
});

test('cue names are dynamic per params and CUE_UNKNOWN lists the valid ones for that card', () => {
  assert.deepEqual(describeComponent('slots', { count: 2, badge: 'b' }).cues.filter((c) => c.startsWith('lit')), ['lit0', 'lit1']);
  assert.deepEqual(describeComponent('slots', { count: 4, badge: 'b' }).cues.filter((c) => c.startsWith('lit')), ['lit0', 'lit1', 'lit2', 'lit3']);
  const { plan, sentences, source } = fixture();
  const bad = structuredClone(plan);
  const index = bad.scenes.findIndex((s) => s.component === 'stat' || s.component === 'quote-reveal');
  bad.scenes[index].cues = { lit5: { sentenceId: bad.scenes[index].from } };
  const error = validatePlan(bad, { sentences, evidence: source }).errors.find((e) => e.code === 'CUE_UNKNOWN');
  assert.equal(error.path, `scenes[${index}].cues.lit5`);
  const valid = describeComponent(bad.scenes[index].component, bad.scenes[index].params).cues;
  assert.match(error.message, new RegExp(`accepts only: ${valid.join(', ')}$`));
});
