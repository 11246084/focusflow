'use strict';

function draft(type = 'quiz') {
  const data = {
    quiz: {
      question: '哪一個選項符合規則？',
      options: [{ optionId: 'A', text: '候選一' }, { optionId: 'B', text: '候選二' }],
      correctOptionId: 'B', explanationClaimId: 'claim-1', contentOrigin: 'generatedExercise',
    },
    steps: { items: [{ stepId: 'step-1', title: '第一步', claimId: 'claim-1' }] },
    comparison: {
      concepts: [{ conceptId: 'a', label: '甲' }, { conceptId: 'b', label: '乙' }],
      aspects: [{ aspectId: 'aspect-1', label: '定義', cells: [
        { conceptId: 'a', claimId: 'claim-1' }, { conceptId: 'b', claimId: 'claim-2' },
      ] }],
    },
  }[type];
  return {
    schemaVersion: '1',
    blocks: [{ blockId: 'block-1', type, componentVersion: '1', data }],
    claims: Array.from({ length: type === 'comparison' ? 2 : 1 }, (_, i) => ({
      claimId: `claim-${i + 1}`, text: '固定合成教材規則', evidenceRefs: ['S1'], contentOrigin: 'courseDerived',
    })),
  };
}
function artifact(type = 'quiz') {
  const value = draft(type);
  const digest = 'a'.repeat(64);
  return {
    schemaVersion: '1', catalogVersion: '1', artifactVersion: 1,
    blocks: value.blocks,
    claims: value.claims.map(({ evidenceRefs, ...claim }) => ({ ...claim, sourceRefIds: [`ref-${digest}`] })),
    sourceRefs: [{ refId: `ref-${digest}`, videoId: 'video-1', segmentId: 'segment-1',
      startSec: 1.125, endSec: 2.5, contentVersion: `sha256:${digest}` }],
  };
}
function event() {
  return { clientEventId: 'event-1', messageId: 'message-1', artifactVersion: 1,
    blockId: 'block-1', action: 'submitAnswer', payload: { optionId: 'B' }, expectedStateRevision: 0 };
}
module.exports = { draft, artifact, event };
