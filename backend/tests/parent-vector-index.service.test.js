const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  DEFAULT_PARENT_VECTOR_INDEX_NAME,
  PARENT_REGULAR_INDEXES,
  buildParentVectorSearchIndexDefinition,
  ensureParentRegularIndexes,
  ensureParentVectorSearchIndex,
} = require('../src/services/parentVectorIndex.service');

function createFakeDb({ searchIndexes = [], regularIndexes = [] } = {}) {
  const commands = [];
  const createdIndexes = [];

  return {
    commands,
    createdIndexes,
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
        async indexes() {
          return regularIndexes;
        },
        async createIndex(key, options) {
          createdIndexes.push({ key, options });
          return options.name;
        },
      };
    },
    async command(command) {
      commands.push(command);
      return { ok: 1 };
    },
  };
}

describe('parent vector index service', () => {
  it('builds the Atlas vector search definition for video_segments_parent', () => {
    const definition = buildParentVectorSearchIndexDefinition();

    assert.deepEqual(definition.fields, [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: 3072,
        similarity: 'cosine',
      },
      {
        type: 'filter',
        path: 'courseId',
      },
      {
        type: 'filter',
        path: 'videoId',
      },
      {
        type: 'filter',
        path: 'generationVersion',
      },
      {
        type: 'filter',
        path: 'isActive',
      },
    ]);
  });

  it('uses the canonical parent embedding index name by default', async () => {
    const db = createFakeDb();

    const result = await ensureParentVectorSearchIndex(db, {
      collectionName: 'video_segments_parent',
      dryRun: true,
    });

    assert.equal(result.indexName, DEFAULT_PARENT_VECTOR_INDEX_NAME);
    assert.equal(result.created, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.command.indexes[0].type, 'vectorSearch');
    assert.equal(result.command.indexes[0].name, DEFAULT_PARENT_VECTOR_INDEX_NAME);
  });

  it('does not create the vector index when it already exists', async () => {
    const db = createFakeDb({
      searchIndexes: [{ name: 'parent_embedding_index', status: 'READY' }],
    });

    const result = await ensureParentVectorSearchIndex(db, {
      collectionName: 'video_segments_parent',
      indexName: 'parent_embedding_index',
    });

    assert.equal(result.created, false);
    assert.equal(result.status, 'READY');
    assert.equal(db.commands.length, 0);
  });

  it('creates the Atlas search index when missing', async () => {
    const db = createFakeDb();

    const result = await ensureParentVectorSearchIndex(db, {
      collectionName: 'video_segments_parent',
      indexName: 'parent_embedding_index',
    });

    assert.equal(result.created, true);
    assert.equal(db.commands.length, 1);
    assert.equal(db.commands[0].createSearchIndexes, 'video_segments_parent');
    assert.equal(db.commands[0].indexes[0].type, 'vectorSearch');
    assert.equal(db.commands[0].indexes[0].name, 'parent_embedding_index');
  });

  it('declares unique parentId as the first regular index', () => {
    assert.equal(PARENT_REGULAR_INDEXES[0].options.unique, true);
    assert.deepEqual(PARENT_REGULAR_INDEXES[0].key, { parentId: 1 });
  });

  it('creates all regular indexes when the collection is empty', async () => {
    const db = createFakeDb();

    const result = await ensureParentRegularIndexes(db, {
      collectionName: 'video_segments_parent',
    });

    assert.equal(result.createdIndexNames.length, PARENT_REGULAR_INDEXES.length);
    assert.equal(db.createdIndexes.length, PARENT_REGULAR_INDEXES.length);
    assert.equal(db.createdIndexes[0].options.unique, true);
  });

  it('skips regular index creation when indexes already exist', async () => {
    const db = createFakeDb({
      regularIndexes: PARENT_REGULAR_INDEXES.map((spec) => ({ name: spec.options.name })),
    });

    const result = await ensureParentRegularIndexes(db, {
      collectionName: 'video_segments_parent',
    });

    assert.equal(result.createdIndexNames.length, 0);
    assert.equal(db.createdIndexes.length, 0);
    assert.match(result.message, /already exist/);
  });

  it('reports missing regular indexes without creating them on dry-run', async () => {
    const db = createFakeDb();

    const result = await ensureParentRegularIndexes(db, {
      collectionName: 'video_segments_parent',
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.missingIndexNames.length, PARENT_REGULAR_INDEXES.length);
    assert.equal(db.createdIndexes.length, 0);
  });
});
