const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const env = require('../src/config/env');
const VideoSegmentParent = require('../src/models/videoSegmentParent.model');
const {
  buildParentSearchPipeline,
  classifyRepositoryError,
  createParentSearchRepository,
} = require('../src/services/parentSearchAdapter.service');

const courseId = '507f191e810c19729de860eb';
const queryEmbedding = Array.from({ length: 3072 }, (_, index) => index / 3072);

describe('parent search Atlas adapter', () => {
  it('intersects the authorized scope with rollout-supported videos', () => {
    const pipeline = buildParentSearchPipeline({
      queryEmbedding,
      courseId: courseId,
      allowedVideoIds: ['video-authorized', 'video-supported'],
      restrictedVideoIds: ['video-supported'],
      limit: 3,
      indexName: 'parent_embedding_index',
    });
    assert.deepEqual(
      pipeline[0].$vectorSearch.filter.$and[2],
      { videoId: { $in: ['video-supported'] } },
    );
  });
  it('builds the scoped Atlas pipeline from env-backed index contract', () => {
    const pipeline = buildParentSearchPipeline({
      queryEmbedding,
      courseId,
      videoId: '507f191e810c19729de860ed',
      allowedVideoIds: ['507f191e810c19729de860ed', '507f191e810c19729de860ef'],
      limit: 5,
      indexName: env.videoSegmentParentVectorIndexName,
    });
    const vectorSearch = pipeline[0].$vectorSearch;
    assert.equal(vectorSearch.index, env.videoSegmentParentVectorIndexName);
    assert.equal(vectorSearch.path, 'embedding');
    assert.equal(vectorSearch.queryVector.length, 3072);
    assert.equal(String(vectorSearch.filter.$and[0].$or[0].courseId), courseId);
    assert.deepEqual(
      vectorSearch.filter.$and[0].$or[1].videoId.$in,
      ['507f191e810c19729de860ed', '507f191e810c19729de860ef'],
    );
    assert.deepEqual(vectorSearch.filter.$and[1], {
      generationVersion: 'text_search_generation_v2',
      isActive: true,
    });
    assert.equal(vectorSearch.filter.$and[2].videoId, '507f191e810c19729de860ed');
    assert.equal(pipeline[1].$project.generationVersion, 1);
    assert.equal(pipeline[1].$project.isActive, 1);
    assert.equal(vectorSearch.numCandidates, 25);
    assert.deepEqual(pipeline[1].$project.score, { $meta: 'vectorSearchScore' });
  });

  it('runs aggregate through the injected Parent model', async () => {
    const expected = [{ parentId: 'parent-1' }];
    const calls = [];
    let aggregateOptions;
    const repository = createParentSearchRepository({
      model: {
        aggregate(pipeline) {
          calls.push(pipeline);
          return {
            option(options) {
              aggregateOptions = options;
              return Promise.resolve(expected);
            },
          };
        },
      },
      indexName: 'custom_parent_index',
    });

    const result = await repository.searchParents({ queryEmbedding, courseId, limit: 3, timeoutMs: 750 });
    assert.equal(result, expected);
    assert.equal(calls[0][0].$vectorSearch.index, 'custom_parent_index');
    assert.deepEqual(aggregateOptions, { maxTimeMS: 750 });
  });

  it('rejects non-canonical course scope and wrong embedding dimensions', async () => {
    const repository = createParentSearchRepository({ model: { aggregate: async () => [] } });
    await assert.rejects(
      repository.searchParents({ queryEmbedding, courseId: 'course-1', limit: 5 }),
      (error) => error.code === 'PARENT_SCOPE_INVALID',
    );
    await assert.rejects(
      repository.searchParents({ queryEmbedding: [0.1, 0.2], courseId, limit: 5 }),
      (error) => error.code === 'PARENT_EMBEDDING_DIMENSION_MISMATCH',
    );
  });

  it('maps MongoDB collection and index failures to safe fallback codes', async () => {
    const collectionError = classifyRepositoryError(Object.assign(new Error('private namespace'), { code: 26 }));
    assert.equal(collectionError.code, 'PARENT_COLLECTION_MISSING');
    assert.equal(collectionError.message.includes('private'), false);

    const indexError = classifyRepositoryError(new Error('Atlas Search index named x was not found'));
    assert.equal(indexError.code, 'PARENT_INDEX_MISSING');
    assert.equal(indexError.message.includes('named x'), false);

    const alternateIndexError = classifyRepositoryError(new Error('index not found with name x'));
    assert.equal(alternateIndexError.code, 'PARENT_INDEX_MISSING');

    const timeoutError = classifyRepositoryError(Object.assign(new Error('operation details'), { code: 50 }));
    assert.equal(timeoutError.code, 'PARENT_SEARCH_TIMEOUT');
  });

  it('sanitizes unexpected MongoDB errors', async () => {
    const secret = 'mongodb+srv://user:password@example.invalid';
    const repository = createParentSearchRepository({
      model: { async aggregate() { throw new Error(secret); } },
    });
    await assert.rejects(
      repository.searchParents({ queryEmbedding, courseId, limit: 5 }),
      (error) => error.code === 'PARENT_SEARCH_FAILED' && !error.message.includes(secret),
    );
  });

  it('rejects unpublished Parent documents with missing course scope or invalid embeddings', () => {
    const validDocument = {
      parentId: '507f191e810c19729de860ed_parent_0001',
      videoId: '507f191e810c19729de860ed',
      courseId,
      hierarchyLevel: 1,
      documentType: 'parent_chunk',
      startSec: 0,
      endSec: 20,
      text: 'parent text',
      childChunkIds: ['507f191e810c19729de860ed_chunk_0001'],
      childCount: 1,
      order: 1,
      embedding: queryEmbedding,
      embeddingDimension: 3072,
    };
    assert.equal(new VideoSegmentParent(validDocument).validateSync(), undefined);
    assert.ok(new VideoSegmentParent({ ...validDocument, courseId: undefined }).validateSync()?.errors.courseId);
    assert.ok(new VideoSegmentParent({
      ...validDocument,
      embedding: [0.1, 0.2],
      embeddingDimension: 2,
    }).validateSync()?.errors.embedding);
  });
});
