const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  DEFAULT_VIDEO_VECTOR_INDEX_NAME,
  buildVideoVectorSearchIndexDefinition,
  ensureVideoVectorSearchIndex,
} = require('../src/services/videoVectorIndex.service');

function createFakeDb(searchIndexes = []) {
  const commands = [];

  return {
    commands,
    collection(name) {
      return {
        name,
        aggregate() {
          return {
            async toArray() {
              return searchIndexes;
            },
          };
        },
      };
    },
    async command(command) {
      commands.push(command);
      return { ok: 1 };
    },
  };
}

describe('video vector index service', () => {
  it('builds the Atlas vector search definition for video_segments_video', () => {
    const definition = buildVideoVectorSearchIndexDefinition();

    assert.deepEqual(definition.fields, [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: 3072,
        similarity: 'cosine',
      },
      {
        type: 'filter',
        path: 'video_id',
      },
    ]);
  });

  it('uses the canonical video embedding index name by default', async () => {
    const db = createFakeDb();

    const result = await ensureVideoVectorSearchIndex(db, {
      collectionName: 'video_segments_video',
      dryRun: true,
    });

    assert.equal(result.indexName, DEFAULT_VIDEO_VECTOR_INDEX_NAME);
    assert.equal(result.created, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.command.indexes[0].type, 'vectorSearch');
    assert.equal(result.command.indexes[0].name, DEFAULT_VIDEO_VECTOR_INDEX_NAME);
  });

  it('does not create the index when it already exists', async () => {
    const db = createFakeDb([
      { name: 'video_embedding_index', status: 'READY' },
    ]);

    const result = await ensureVideoVectorSearchIndex(db, {
      collectionName: 'video_segments_video',
      indexName: 'video_embedding_index',
    });

    assert.equal(result.created, false);
    assert.equal(result.status, 'READY');
    assert.equal(db.commands.length, 0);
  });

  it('creates the Atlas search index when missing', async () => {
    const db = createFakeDb();

    const result = await ensureVideoVectorSearchIndex(db, {
      collectionName: 'video_segments_video',
      indexName: 'video_embedding_index',
    });

    assert.equal(result.created, true);
    assert.equal(db.commands.length, 1);
    assert.equal(db.commands[0].createSearchIndexes, 'video_segments_video');
    assert.equal(db.commands[0].indexes[0].type, 'vectorSearch');
    assert.equal(db.commands[0].indexes[0].name, 'video_embedding_index');
  });
});
