import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import contract, { LearningUiDraftSchema, LearningUiArtifactSchema, LearningInteractionSchema,
  draftJsonSchema } from '../../../shared/adaptive-genui/index.mjs';
import fixtures from '../../../shared/adaptive-genui/tests/fixtures.cjs';

const require = createRequire(import.meta.url);
const commonJs = require('../../../shared/adaptive-genui');

describe('前端 ESM 與後端 CJS 共用相同契約物件', () => {
  it('兩入口 schema identity 完全相同，沒有重複契約', () => {
    assert.equal(contract, commonJs);
    assert.equal(LearningUiDraftSchema, commonJs.LearningUiDraftSchema);
    assert.equal(LearningUiArtifactSchema, commonJs.LearningUiArtifactSchema);
    assert.equal(LearningInteractionSchema, commonJs.LearningInteractionSchema);
    assert.deepEqual(draftJsonSchema(), commonJs.draftJsonSchema());
  });
  for (const type of ['comparison', 'steps', 'quiz']) {
    it(`${type} JSON 往返與未知欄位拒絕一致`, () => {
      const draft = fixtures.draft(type);
      const artifact = fixtures.artifact(type);
      assert.deepEqual(LearningUiDraftSchema.parse(draft), commonJs.LearningUiDraftSchema.parse(draft));
      assert.deepEqual(LearningUiArtifactSchema.parse(artifact), commonJs.LearningUiArtifactSchema.parse(artifact));
      artifact.blocks[0].data.script = 'injected';
      assert.equal(LearningUiArtifactSchema.safeParse(artifact).success, false);
    });
  }
  it('事件拒絕 client 自報分數，且不需要 Node Buffer', () => {
    const event = fixtures.event();
    assert.deepEqual(LearningInteractionSchema.parse(event), event);
    event.payload.score = 1;
    assert.equal(LearningInteractionSchema.safeParse(event).success, false);
    const original = globalThis.Buffer;
    try {
      globalThis.Buffer = undefined;
      assert.equal(LearningUiDraftSchema.safeParse(fixtures.draft()).success, true);
    } finally {
      globalThis.Buffer = original;
    }
  });
});
