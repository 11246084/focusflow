'use strict';

// One runtime contract for both entry points. No app, environment or I/O imports.
const { z } = require('zod/v4');
const MAX_JSON_BYTES = 32768;
const reservedIds = new Set(['__proto__', 'prototype', 'constructor']);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
  .refine(value => !reservedIds.has(value), 'Reserved identifier');
const text = z.string().min(1)
  .refine(value => [...value].length <= 1000, 'Text exceeds 1000 code points');
const version = z.literal('1');
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const origin = z.enum(['courseDerived', 'generatedExercise']);
const evidenceRef = z.string().regex(/^S[1-9][0-9]*$/);
const sourceRefId = z.string().regex(/^ref-[a-f0-9]{64}$/);
const contentVersion = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const object = shape => z.strictObject(shape);

const comparisonData = object({
  concepts: z.array(object({ conceptId: id, label: text })).min(2).max(3),
  aspects: z.array(object({
    aspectId: id, label: text,
    cells: z.array(object({ conceptId: id, claimId: id })).min(2).max(3),
  })).min(1).max(6),
});
const stepsData = object({
  items: z.array(object({ stepId: id, title: text, claimId: id })).min(1).max(8),
});
const quizData = object({
  question: text,
  options: z.array(object({ optionId: id, text })).min(2).max(4),
  correctOptionId: id,
  explanationClaimId: id,
  contentOrigin: origin,
});
const block = z.discriminatedUnion('type', [
  object({ blockId: id, type: z.literal('comparison'), componentVersion: version, data: comparisonData }),
  object({ blockId: id, type: z.literal('steps'), componentVersion: version, data: stepsData }),
  object({ blockId: id, type: z.literal('quiz'), componentVersion: version, data: quizData }),
]);
const claimFields = { claimId: id, text, contentOrigin: origin };
const draftShape = object({
  schemaVersion: version,
  blocks: z.array(block).length(1),
  claims: z.array(object({ ...claimFields, evidenceRefs: z.array(evidenceRef).min(1) })).min(1),
});
const sourceRef = object({
  refId: sourceRefId,
  videoId: id,
  segmentId: id.optional(),
  chunkId: id.optional(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  contentVersion,
});
const artifactShape = object({
  schemaVersion: version,
  catalogVersion: version,
  artifactVersion: positiveInteger,
  blocks: z.array(block).length(1),
  claims: z.array(object({ ...claimFields, sourceRefIds: z.array(sourceRefId).min(1) })).min(1),
  sourceRefs: z.array(sourceRef).min(1),
});

function issue(ctx, path, message) {
  ctx.addIssue({ code: 'custom', path, message });
}
function unique(values, ctx, path) {
  if (new Set(values).size !== values.length) issue(ctx, path, 'Duplicate identifier/reference');
}
function boundedJson(value, ctx) {
  // TextEncoder is available in modern browsers and Node; no Buffer dependency.
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_JSON_BYTES) {
    issue(ctx, [], 'JSON exceeds 32768 UTF-8 bytes');
  }
}
function validateGraph(value, ctx) {
  boundedJson(value, ctx);
  unique(value.blocks.map(item => item.blockId), ctx, ['blocks']);
  unique(value.claims.map(item => item.claimId), ctx, ['claims']);
  const claims = new Set(value.claims.map(item => item.claimId));
  const reference = (claimId, path) => {
    if (!claims.has(claimId)) issue(ctx, path, 'Unknown claim reference');
  };
  value.blocks.forEach((item, b) => {
    const path = ['blocks', b, 'data'];
    const data = item.data;
    if (item.type === 'steps') {
      unique(data.items.map(step => step.stepId), ctx, [...path, 'items']);
      data.items.forEach((step, i) => reference(step.claimId, [...path, 'items', i, 'claimId']));
    } else if (item.type === 'comparison') {
      const concepts = data.concepts.map(concept => concept.conceptId);
      unique(concepts, ctx, [...path, 'concepts']);
      unique(data.aspects.map(aspect => aspect.aspectId), ctx, [...path, 'aspects']);
      data.aspects.forEach((aspect, a) => {
        const cells = aspect.cells.map(cell => cell.conceptId);
        unique(cells, ctx, [...path, 'aspects', a, 'cells']);
        if (cells.length !== concepts.length || cells.some(cell => !concepts.includes(cell))) {
          issue(ctx, [...path, 'aspects', a, 'cells'], 'Each concept needs exactly one cell');
        }
        aspect.cells.forEach((cell, c) => reference(cell.claimId, [...path, 'aspects', a, 'cells', c, 'claimId']));
      });
    } else {
      const options = data.options.map(option => option.optionId);
      unique(options, ctx, [...path, 'options']);
      if (!options.includes(data.correctOptionId)) issue(ctx, [...path, 'correctOptionId'], 'Unknown option');
      reference(data.explanationClaimId, [...path, 'explanationClaimId']);
    }
  });
}

const LearningUiDraftSchema = draftShape.superRefine((value, ctx) => {
  validateGraph(value, ctx);
  value.claims.forEach((claim, i) => unique(claim.evidenceRefs, ctx, ['claims', i, 'evidenceRefs']));
});
const LearningUiArtifactSchema = artifactShape.superRefine((value, ctx) => {
  validateGraph(value, ctx);
  unique(value.sourceRefs.map(ref => ref.refId), ctx, ['sourceRefs']);
  const refs = new Set(value.sourceRefs.map(ref => ref.refId));
  value.sourceRefs.forEach((ref, i) => {
    if (!ref.segmentId && !ref.chunkId) issue(ctx, ['sourceRefs', i], 'Segment or chunk required');
    if (ref.endSec < ref.startSec) issue(ctx, ['sourceRefs', i, 'endSec'], 'Reversed time range');
    if (ref.refId !== `ref-${ref.contentVersion.slice(7)}`) issue(ctx, ['sourceRefs', i, 'refId'], 'Content identity mismatch');
  });
  value.claims.forEach((claim, i) => {
    unique(claim.sourceRefIds, ctx, ['claims', i, 'sourceRefIds']);
    claim.sourceRefIds.forEach((ref, r) => {
      if (!refs.has(ref)) issue(ctx, ['claims', i, 'sourceRefIds', r], 'Unknown source reference');
    });
  });
});
const LearningInteractionSchema = object({
  clientEventId: id,
  messageId: id,
  artifactVersion: positiveInteger,
  blockId: id,
  action: z.literal('submitAnswer'),
  payload: object({ optionId: id }),
  expectedStateRevision: revision,
});
const InteractionContextSchema = object({
  messageId: id, artifactVersion: positiveInteger, blockId: id, eventId: id,
});

// Structural provider schema is derived, never handwritten. Refinements remain
// mandatory after parsing: JSON Schema cannot prove graph/provenance semantics.
function draftJsonSchema(componentType) {
  let schema = draftShape;
  if (componentType !== undefined) {
    const selected = block.options.find(option => option.shape.type.value === componentType);
    if (!selected) throw new TypeError('Unsupported component type');
    schema = draftShape.extend({ blocks: z.array(selected).length(1) });
  }
  return z.toJSONSchema(schema, { target: 'draft-7' });
}

module.exports = {
  MAX_JSON_BYTES,
  LearningUiDraftSchema,
  LearningUiArtifactSchema,
  LearningInteractionSchema,
  InteractionContextSchema,
  draftJsonSchema,
};
