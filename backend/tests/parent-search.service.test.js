const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  createUnavailableParentRepository,
  searchParents,
} = require('../src/services/parentSearch.service');
const { createFakeParentRepository } = require('./helpers/fakeParentRepository');

const validHit = {
  parentId: 'video-1_parent_0001',
  courseId: 'course-1',
  videoId: 'video-1',
  childChunkIds: ['video-1_chunk_0001', 'video-1_chunk_0002'],
  score: 0.91,
  startSec: 10,
  endSec: 40,
  order: 1,
  hierarchyLevel: 1,
  documentType: 'parent_chunk',
};

function run(repository, overrides = {}) {
  return searchParents({
    repository,
    queryEmbedding: [0.1, 0.2],
    courseId: 'course-1',
    limit: 5,
    timeoutMs: 50,
    ...overrides,
  });
}

describe('parent search service', () => {
  it('returns validated mock parent hits and forwards scoped input', async () => {
    const repository = createFakeParentRepository({ hits: [validHit] });
    const hits = await run(repository);
    assert.deepEqual(hits[0].childChunkIds, validHit.childChunkIds);
    assert.equal(repository.calls[0].courseId, 'course-1');
    assert.deepEqual(repository.calls[0].queryEmbedding, [0.1, 0.2]);
  });

  it('accepts an empty parent result', async () => {
    assert.deepEqual(await run(createFakeParentRepository()), []);
  });

  it('classifies timeout without exposing repository details', async () => {
    await assert.rejects(
      run(createFakeParentRepository({ delayMs: 100 }), { timeoutMs: 5 }),
      (error) => error.code === 'PARENT_SEARCH_TIMEOUT' && !error.message.includes('mongodb'),
    );
  });

  it('preserves safe repository error codes such as index missing', async () => {
    const error = Object.assign(new Error('secret internal index payload'), { code: 'PARENT_INDEX_MISSING' });
    await assert.rejects(
      run(createFakeParentRepository({ error })),
      (caught) => caught.code === 'PARENT_INDEX_MISSING' && caught.message === 'Parent search failed.',
    );
  });

  it('rejects invalid parent documents', async () => {
    await assert.rejects(
      run(createFakeParentRepository({ hits: [{ ...validHit, childChunkIds: [] }] })),
      (error) => error.code === 'PARENT_DOCUMENT_INVALID',
    );
  });

  it('requires explicit course and Parent document contract fields', async () => {
    await assert.rejects(
      run(createFakeParentRepository({ hits: [{ ...validHit, courseId: null }] })),
      (error) => error.code === 'PARENT_DOCUMENT_INVALID',
    );
    await assert.rejects(
      run(createFakeParentRepository({ hits: [{ ...validHit, hierarchyLevel: 'parent' }] })),
      (error) => error.code === 'PARENT_DOCUMENT_INVALID',
    );
    await assert.rejects(
      run(createFakeParentRepository({ hits: [{ ...validHit, hierarchyLevel: '1' }] })),
      (error) => error.code === 'PARENT_DOCUMENT_INVALID',
    );
  });

  it('rejects course and video scope mismatch', async () => {
    await assert.rejects(
      run(createFakeParentRepository({ hits: [{ ...validHit, courseId: 'foreign' }] })),
      (error) => error.code === 'PARENT_SCOPE_MISMATCH',
    );
    await assert.rejects(
      run(createFakeParentRepository({ hits: [validHit] }), { videoId: 'video-2' }),
      (error) => error.code === 'PARENT_SCOPE_MISMATCH',
    );
  });

  it('accepts a mounted-video Parent through the allowed video scope', async () => {
    const mountedHit = { ...validHit, courseId: 'primary-course' };
    const hits = await run(
      createFakeParentRepository({ hits: [mountedHit] }),
      { allowedVideoIds: ['video-1'] },
    );
    assert.equal(hits[0].videoId, 'video-1');

    await assert.rejects(
      run(createFakeParentRepository({ hits: [mountedHit] }), { allowedVideoIds: ['foreign-video'] }),
      (error) => error.code === 'PARENT_SCOPE_MISMATCH',
    );
  });

  it('keeps an explicit unavailable stub for fallback-only tests', async () => {
    await assert.rejects(
      run(createUnavailableParentRepository()),
      (error) => error.code === 'PARENT_REPOSITORY_UNAVAILABLE',
    );
  });
});
