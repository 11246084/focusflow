const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../../shared/adaptive-genui');
const { draft, artifact, event } = require('../../shared/adaptive-genui/tests/fixtures.cjs');
const mock = require('../../shared/adaptive-genui/tests/providerMocks.cjs');
const { LearningUiDraftSchema: Draft, LearningUiArtifactSchema: Artifact,
  LearningInteractionSchema: Event, InteractionContextSchema: Context } = contract;

function objectPaths(value, prefix = []) {
  if (!value || typeof value !== 'object') return [];
  const paths = Array.isArray(value) ? [] : [prefix];
  for (const [key, child] of Object.entries(value)) paths.push(...objectPaths(child, [...prefix, key]));
  return paths;
}
function at(value, path) { return path.reduce((parent, key) => parent[key], value); }
function rejects(schema, make, mutate) {
  const value = make();
  mutate(value);
  assert.equal(schema.safeParse(value).success, false);
}

describe('Adaptive GenUI 共用契約（純本地資料）', () => {
  for (const type of ['comparison', 'steps', 'quiz']) {
    it(`${type} Draft 與 Artifact 正例可 round-trip`, () => {
      assert.deepEqual(Draft.parse(JSON.parse(JSON.stringify(draft(type)))), draft(type));
      assert.deepEqual(Artifact.parse(JSON.parse(JSON.stringify(artifact(type)))), artifact(type));
    });
  }
  for (const [name, schema, make] of [
    ...['comparison', 'steps', 'quiz'].flatMap(type => [
      [`${type} Draft`, Draft, () => draft(type)], [`${type} Artifact`, Artifact, () => artifact(type)],
    ]),
    ['事件', Event, event],
    ['追問 context', Context, () => ({ messageId: 'm', artifactVersion: 1, blockId: 'b', eventId: 'e' })],
  ]) {
    it(`${name} 每層物件拒絕未知欄位與能力注入`, () => {
      assert.equal(schema.safeParse(make()).success, true);
      for (const path of objectPaths(make())) {
        for (const key of ['unknown', 'url', 'style', 'script', 'fetch', 'userId', '__proto__']) {
          const value = make();
          Object.defineProperty(at(value, path), key, { value: 'injected', enumerable: true });
          assert.equal(schema.safeParse(value).success, false, `${name} ${path.join('.')} ${key}`);
        }
      }
    });
  }
  it('必要欄位、版本、元件與 origin 不可缺少或猜測', () => {
    for (const [schema, make] of [[Draft, draft], [Artifact, artifact], [Event, event]]) {
      for (const key of Object.keys(make())) rejects(schema, make, value => { delete value[key]; });
    }
    for (const [key, value] of [['schemaVersion', '2'], ['catalogVersion', '2'], ['artifactVersion', 0]]) {
      rejects(Artifact, artifact, item => { item[key] = value; });
    }
    rejects(Draft, draft, value => { value.blocks[0].componentVersion = '2'; });
    rejects(Draft, draft, value => { value.blocks[0].type = 'html'; });
    rejects(Draft, draft, value => { value.claims[0].contentOrigin = 'teacherVerified'; });
  });
  it('識別碼拒絕保留名稱、URL、空值與超長字串', () => {
    for (const bad of ['__proto__', 'constructor', 'prototype', 'https://x', '', 'x'.repeat(65)]) {
      rejects(Draft, draft, value => { value.blocks[0].blockId = bad; });
      rejects(Event, event, value => { value.payload.optionId = bad; });
    }
  });
  it('claim 與來源參照必須非空、唯一且可解析', () => {
    for (const refs of [[], ['S0'], ['S01'], ['S1', 'S1'], ['video-1']]) {
      rejects(Draft, draft, value => { value.claims[0].evidenceRefs = refs; });
    }
    rejects(Draft, draft, value => { value.claims.push({ ...value.claims[0] }); });
    rejects(Draft, draft, value => { value.blocks[0].data.explanationClaimId = 'missing'; });
    rejects(Artifact, artifact, value => { value.claims[0].sourceRefIds = [`ref-${'b'.repeat(64)}`]; });
    rejects(Artifact, artifact, value => { value.sourceRefs.push({ ...value.sourceRefs[0] }); });
    rejects(Artifact, artifact, value => { value.claims[0].sourceRefIds.push(value.claims[0].sourceRefIds[0]); });
  });
  it('comparison 每個概念恰一格且面向、概念 ID 唯一', () => {
    const make = () => draft('comparison');
    rejects(Draft, make, value => { value.blocks[0].data.aspects[0].cells[1].conceptId = 'a'; });
    rejects(Draft, make, value => { value.blocks[0].data.aspects[0].cells[1].conceptId = 'missing'; });
    rejects(Draft, make, value => { value.blocks[0].data.concepts.push({ conceptId: 'c', label: '丙' }); });
    rejects(Draft, make, value => { value.blocks[0].data.concepts[1].conceptId = 'a'; });
    rejects(Draft, make, value => { value.blocks[0].data.aspects.push(value.blocks[0].data.aspects[0]); });
    rejects(Draft, make, value => { value.blocks[0].data.aspects[0].cells[0].claimId = 'missing'; });
  });
  it('steps 不能重複 ID 或引用不存在 claim', () => {
    rejects(Draft, () => draft('steps'), value => { value.blocks[0].data.items.push(value.blocks[0].data.items[0]); });
    rejects(Draft, () => draft('steps'), value => { value.blocks[0].data.items[0].claimId = 'missing'; });
  });
  it('quiz 選項唯一且正解存在', () => {
    rejects(Draft, draft, value => { value.blocks[0].data.options[1].optionId = 'A'; });
    rejects(Draft, draft, value => { value.blocks[0].data.correctOptionId = 'C'; });
  });
  it('來源要求 segment 或 chunk、有效時間及一致 hash 身分', () => {
    for (const bad of [-1, Infinity, NaN]) rejects(Artifact, artifact, value => { value.sourceRefs[0].startSec = bad; });
    rejects(Artifact, artifact, value => { value.sourceRefs[0].endSec = 0; });
    rejects(Artifact, artifact, value => { delete value.sourceRefs[0].segmentId; });
    rejects(Artifact, artifact, value => { value.sourceRefs[0].contentVersion = `sha256:${'b'.repeat(64)}`; });
    const chunk = artifact();
    delete chunk.sourceRefs[0].segmentId;
    chunk.sourceRefs[0].chunkId = 'chunk-1';
    assert.equal(Artifact.safeParse(chunk).success, true);
  });
  it('事件僅接受 submitAnswer，版本與 CAS revision 為安全整數', () => {
    assert.deepEqual(Event.parse(event()), event());
    for (const action of ['select', 'expand', 'seekSource', 'fetch']) rejects(Event, event, value => { value.action = action; });
    for (const bad of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      rejects(Event, event, value => { value.expectedStateRevision = bad; });
    }
    rejects(Event, event, value => { value.artifactVersion = 0; });
  });
  it('元件數量與每種元件大小上限不可越界', () => {
    rejects(Draft, draft, value => { value.blocks = []; });
    rejects(Draft, draft, value => { value.blocks.push(value.blocks[0]); });
    for (const count of [0, 9]) rejects(Draft, () => draft('steps'), value => {
      value.blocks[0].data.items = Array.from({ length: count }, (_, i) => ({ stepId: `s${i}`, title: '步驟', claimId: 'claim-1' }));
    });
    for (const count of [1, 5]) rejects(Draft, draft, value => {
      value.blocks[0].data.options = Array.from({ length: count }, (_, i) => ({ optionId: `o${i}`, text: '選項' }));
      value.blocks[0].data.correctOptionId = 'o0';
    });
    for (const count of [1, 4]) rejects(Draft, () => draft('comparison'), value => {
      value.blocks[0].data.concepts = Array.from({ length: count }, (_, i) => ({ conceptId: `c${i}`, label: '概念' }));
    });
  });
  it('文字以 Unicode code point 計，JSON 以 UTF-8 bytes 計', () => {
    const value = draft();
    value.claims[0].text = '😀'.repeat(1000);
    assert.equal(Draft.safeParse(value).success, true);
    value.claims[0].text += '😀';
    assert.equal(Draft.safeParse(value).success, false);
    for (const [schema, make] of [[Draft, draft], [Artifact, artifact]]) {
      rejects(schema, make, item => {
        item.claims = Array.from({ length: 12 }, (_, i) => ({ ...item.claims[0], claimId: `claim-${i + 1}`, text: '中'.repeat(1000) }));
      });
    }
  });
});

describe('provider payload 本地 mock（不代表 live 接受）', () => {
  for (const provider of ['openai', 'gemini']) for (const type of ['comparison', 'steps', 'quiz']) {
    it(`${provider}/${type} 由單一契約產生 payload，mock response 可解析`, () => {
      const payload = JSON.parse(JSON.stringify(mock.payload(provider, type)));
      const schema = provider === 'openai' ? payload.response_format.json_schema.schema : payload.generationConfig.responseSchema;
      assert.equal(mock.accepts(schema, draft(type)), true);
      const missing = draft(type);
      delete missing.claims;
      assert.equal(mock.accepts(schema, missing), false);
      const otherType = type === 'quiz' ? 'steps' : 'quiz';
      assert.equal(mock.accepts(schema, draft(otherType)), false);
      assert.deepEqual(mock.parseResponse(provider, mock.response(provider, draft(type))), draft(type));
      const injected = draft(type);
      injected.blocks[0].data.url = 'https://invalid.test';
      assert.throws(() => mock.parseResponse(provider, mock.response(provider, injected)));
      if (provider === 'openai') assert.equal(mock.accepts(schema, injected), false);
    });
  }
  it('未知 provider／元件拒絕，匯出結果修改不污染後續輸出', () => {
    assert.throws(() => mock.payload('other', 'quiz'));
    assert.throws(() => contract.draftJsonSchema('html'));
    const schema = contract.draftJsonSchema();
    schema.properties.schemaVersion.const = '2';
    assert.equal(contract.draftJsonSchema().properties.schemaVersion.const, '1');
  });
});
