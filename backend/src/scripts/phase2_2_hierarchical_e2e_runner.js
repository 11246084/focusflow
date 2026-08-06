const mongoose = require('mongoose');
const env = require('../config/env');
const VideoSegment = require('../models/videoSegment.model');
const VideoSegmentParent = require('../models/videoSegmentParent.model');
const { embedQuery, GEMINI_EMBEDDING_MODEL } = require('../services/queryEmbedding.service');
const { createParentSearchRepository } = require('../services/parentSearchAdapter.service');
const { searchParents } = require('../services/parentSearch.service');
const { expandParentHits } = require('../services/childExpansion.service');
const { assembleLeafContext } = require('../services/leafContextAssembly.service');
const { generateAnswer } = require('../services/answerGeneration.service');
const { buildCitations } = require('../services/qa.service');
const { buildSegmentLookupQuery } = require('../services/bridgeScope.service');

const WRITE_COMMANDS = new Set([
  'insert', 'update', 'delete', 'findandmodify', 'bulkwrite', 'create',
  'createindexes', 'dropindexes', 'drop', 'dropdatabase', 'collmod', 'renamecollection',
]);
const READ_COMMANDS = new Set([
  'find', 'aggregate', 'getmore', 'explain', 'ping', 'count', 'distinct',
  'listcollections', 'listindexes', 'listsearchindexes',
]);

class IsolatedE2EError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'IsolatedE2EError';
    this.code = code;
  }
}

function createCommandMonitor() {
  const state = { mongoReads: 0, mongoWrites: 0, writeCommands: [] };

  return {
    observe(event = {}) {
      const commandName = String(event.commandName || '').toLowerCase();
      if (WRITE_COMMANDS.has(commandName)) {
        state.mongoWrites += 1;
        state.writeCommands.push(commandName);
      } else if (READ_COMMANDS.has(commandName)) {
        state.mongoReads += 1;
      }
    },
    assertNoWrites() {
      if (state.mongoWrites) {
        throw new IsolatedE2EError(
          'The isolated E2E runner detected a forbidden MongoDB write command.',
          'WRITE_OPERATION_DETECTED',
        );
      }
    },
    snapshot() {
      return {
        mongoReads: state.mongoReads,
        mongoWrites: state.mongoWrites,
        writeDetected: state.mongoWrites > 0,
      };
    },
  };
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new IsolatedE2EError(`${flag} must be a positive integer.`, 'E2E_CLI_INVALID');
  }
  return parsed;
}

function parseCliArgs(argv = []) {
  const options = {
    question: '',
    courseId: '',
    videoId: '',
    allowedVideoIds: [],
    withAnswer: false,
    maxParents: env.hierarchicalParentLimit,
    maxChildren: env.hierarchicalChildExpansionLimit,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--with-answer') options.withAnswer = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--question') options.question = argv[++index] || '';
    else if (flag === '--course-id') options.courseId = argv[++index] || '';
    else if (flag === '--video-id') options.videoId = argv[++index] || '';
    else if (flag === '--allowed-video-id') options.allowedVideoIds.push(argv[++index] || '');
    else if (flag === '--max-parents') options.maxParents = parsePositiveInteger(argv[++index], flag);
    else if (flag === '--max-children') options.maxChildren = parsePositiveInteger(argv[++index], flag);
    else throw new IsolatedE2EError(`Unsupported option: ${flag}`, 'E2E_CLI_INVALID');
  }

  options.question = String(options.question).trim();
  options.courseId = String(options.courseId).trim();
  options.videoId = String(options.videoId).trim();
  options.allowedVideoIds = [...new Set(options.allowedVideoIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!options.allowedVideoIds.includes(options.videoId)) options.allowedVideoIds.push(options.videoId);

  if (!options.question || !/^[0-9a-f]{24}$/i.test(options.courseId)
      || !/^[0-9a-f]{24}$/i.test(options.videoId)) {
    throw new IsolatedE2EError(
      '--question, a canonical --course-id, and --video-id are required.',
      'E2E_CLI_INVALID',
    );
  }
  return options;
}

function safeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Number(score.toFixed(6)) : null;
}

function hasIxscan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (plan.stage === 'IXSCAN') return true;
  return Object.values(plan).some((value) => value && typeof value === 'object' && hasIxscan(value));
}

function collectIndexNames(plan, names = new Set()) {
  if (!plan || typeof plan !== 'object') return names;
  if (plan.stage === 'IXSCAN' && plan.indexName) names.add(String(plan.indexName));
  for (const value of Object.values(plan)) {
    if (value && typeof value === 'object') collectIndexNames(value, names);
  }
  return names;
}

function buildLeafLookupQuery(childChunkIds, scope) {
  const identity = {
    $or: [
      { chunkId: { $in: childChunkIds } },
      { segmentId: { $in: childChunkIds } },
    ],
  };
  const scopeQuery = buildSegmentLookupQuery(scope);
  return Object.keys(scopeQuery).length ? { $and: [identity, scopeQuery] } : identity;
}

async function runIsolatedE2E(options, dependencies) {
  const {
    preflight,
    embed = embedQuery,
    parentRepositoryFactory,
    leafRepositoryFactory,
    verifyChildLookupPlan,
    answer = generateAnswer,
    citationBuilder = buildCitations,
    commandMonitor = createCommandMonitor(),
  } = dependencies;

  commandMonitor.assertNoWrites();
  const preflightResult = await preflight(options);
  commandMonitor.assertNoWrites();

  const queryVector = await embed(options.question);
  if (!Array.isArray(queryVector) || queryVector.length !== 3072
      || queryVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new IsolatedE2EError('Query embedding does not match the Parent index.', 'E2E_QUERY_EMBEDDING_INVALID');
  }

  const parentHits = await searchParents({
    repository: parentRepositoryFactory(),
    queryEmbedding: queryVector,
    courseId: options.courseId,
    videoId: options.videoId,
    allowedVideoIds: options.allowedVideoIds,
    limit: options.maxParents,
    timeoutMs: env.hierarchicalParentTimeoutMs,
  });
  if (!parentHits.length) {
    throw new IsolatedE2EError('Parent search returned no hits.', 'E2E_PARENT_NO_HITS');
  }

  const requestedIds = [...new Set(parentHits.flatMap((hit) => hit.childChunkIds))];
  const lookupPlan = await verifyChildLookupPlan(requestedIds, preflightResult.scope);
  if (!lookupPlan.usesIxscan || !(lookupPlan.indexNames || []).includes('chunkId_1')) {
    throw new IsolatedE2EError('The canonical chunkId index is not queryable.', 'E2E_CHUNK_ID_INDEX_NOT_READY');
  }

  const expansion = await expandParentHits({
    parentHits,
    leafRepository: leafRepositoryFactory(),
    scope: preflightResult.scope,
    courseId: options.courseId,
    videoId: options.videoId,
    limit: options.maxChildren,
  });
  const context = assembleLeafContext({
    leaves: expansion.leaves,
    maxLeaves: env.hierarchicalContextMaxLeaves,
    maxCharacters: env.hierarchicalContextMaxCharacters,
  });
  const citations = citationBuilder(context.matches);

  let answerResult = { executed: false, provider: null, status: 'skipped' };
  if (options.withAnswer) {
    const generated = await answer(options.question, context.matches);
    answerResult = {
      executed: true,
      provider: generated.provider,
      status: generated.fallback ? 'fallback' : 'success',
      length: String(generated.text || '').length,
    };
  }

  commandMonitor.assertNoWrites();
  const safety = commandMonitor.snapshot();
  return {
    runMode: 'phase2_2_isolated_e2e',
    writesAllowed: false,
    gate: { sharedValue: false, isolatedValue: true },
    query: {
      length: options.question.length,
      embeddingProvider: env.qaQueryEmbeddingProvider,
      embeddingModel: env.qaQueryEmbeddingProvider === 'gemini' ? GEMINI_EMBEDDING_MODEL : env.qaQueryEmbeddingProvider,
      dimension: queryVector.length,
      apiCalls: 1,
    },
    parentSearch: {
      hitCount: parentHits.length,
      parentIds: parentHits.map((hit) => hit.parentId),
      scores: parentHits.map((hit) => safeScore(hit.score)),
      lineage: parentHits.map((hit) => ({
        parentId: hit.parentId,
        childChunkIds: [...hit.childChunkIds],
      })),
    },
    childExpansion: {
      requested: expansion.diagnostics.requestedChildCount,
      found: expansion.leaves.length,
      missing: expansion.diagnostics.missingChildCount,
      duplicate: expansion.diagnostics.duplicateChildCount,
      scopeMismatch: expansion.diagnostics.scopeMismatchCount,
      truncated: expansion.diagnostics.truncatedChildCount,
    },
    context: {
      leafCount: context.matches.length,
      chunkIds: context.matches.map((match) => match.chunkId),
      videoIds: [...new Set(context.matches.map((match) => match.videoId))],
      contextTruncated: context.diagnostics.contextTruncated,
    },
    answer: answerResult,
    citations: {
      count: citations.length,
      chunkIds: citations.map((citation) => citation.chunkId),
      segmentIds: citations.map((citation) => citation.segmentId),
      videoIds: [...new Set(citations.map((citation) => citation.videoId))],
      timestamps: citations.map((citation) => citation.timestamp),
    },
    safety: {
      ...safety,
      externalCalls: options.withAnswer ? 2 : 1,
      sensitiveOutput: false,
    },
  };
}

async function createLiveDependencies(commandMonitor) {
  if (env.hierarchicalRetrievalEnabled) {
    throw new IsolatedE2EError(
      'The shared Hierarchical Retrieval Gate must remain disabled.',
      'E2E_SHARED_GATE_NOT_DISABLED',
    );
  }
  if (!env.hierarchicalRetrievalFallbackToLeaf) {
    throw new IsolatedE2EError('Leaf fallback must remain enabled.', 'E2E_FALLBACK_NOT_ENABLED');
  }
  if (env.faqCacheEnabled) {
    throw new IsolatedE2EError('FAQ cache must be disabled for the isolated runner.', 'E2E_FAQ_CACHE_NOT_DISABLED');
  }

  const connection = await mongoose.createConnection(env.mongodbUri, {
    autoCreate: false,
    autoIndex: false,
    monitorCommands: true,
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  connection.getClient().on('commandStarted', (event) => commandMonitor.observe(event));

  const leafModel = connection.model('Phase22RunnerLeaf', VideoSegment.schema, env.videoSegmentCollection);
  const parentModel = connection.model(
    'Phase22RunnerParent',
    VideoSegmentParent.schema,
    env.videoSegmentParentCollection,
  );
  const leafCollection = connection.db.collection(env.videoSegmentCollection);
  const parentCollection = connection.db.collection(env.videoSegmentParentCollection);
  const videoCollection = connection.db.collection('videos');
  const courseCollection = connection.db.collection('courses');

  return {
    commandMonitor,
    async preflight(options) {
      const requiredCollections = [
        env.videoSegmentCollection, env.videoSegmentParentCollection, 'videos', 'courses',
      ];
      const courseObjectId = new mongoose.Types.ObjectId(options.courseId);
      const videoObjectId = new mongoose.Types.ObjectId(options.videoId);
      const [collections, indexes, searchIndexes, video, course] = await Promise.all([
        connection.db.listCollections({ name: { $in: requiredCollections } }).toArray(),
        leafCollection.listIndexes().toArray(),
        parentCollection.listSearchIndexes(env.videoSegmentParentVectorIndexName).toArray(),
        videoCollection.findOne(
          { _id: videoObjectId },
          { projection: { _id: 1, courseId: 1, deletedAt: 1 } },
        ),
        courseCollection.findOne(
          { _id: courseObjectId },
          { projection: { _id: 1, videoIds: 1, status: 1, deletedAt: 1 } },
        ),
      ]);
      commandMonitor.assertNoWrites();
      if (collections.length !== requiredCollections.length) {
        throw new IsolatedE2EError('Required Parent or Leaf collection is unavailable.', 'E2E_COLLECTION_NOT_READY');
      }
      const courseContainsVideo = Array.isArray(course?.videoIds)
        && course.videoIds.some((id) => String(id) === options.videoId);
      const directCourseRelation = String(video?.courseId || '') === options.courseId;
      const allowedMountedRelation = courseContainsVideo && options.allowedVideoIds.includes(options.videoId);
      if (!video || video.deletedAt != null || !course || course.deletedAt != null
          || course.status !== 'published' || (!directCourseRelation && !allowedMountedRelation)) {
        throw new IsolatedE2EError('The requested course and video scope is not publishable.', 'E2E_SCOPE_INVALID');
      }
      const chunkIndex = indexes.find((index) => index.name === 'chunkId_1'
        && index.key?.chunkId === 1 && Object.keys(index.key).length === 1);
      if (!chunkIndex || chunkIndex.hidden) {
        throw new IsolatedE2EError('The canonical chunkId index is unavailable.', 'E2E_CHUNK_ID_INDEX_NOT_READY');
      }
      const vectorIndex = searchIndexes.find((index) => index.name === env.videoSegmentParentVectorIndexName);
      if (!vectorIndex || vectorIndex.status !== 'READY' || vectorIndex.queryable === false) {
        throw new IsolatedE2EError('The Parent vector index is unavailable.', 'E2E_PARENT_INDEX_NOT_READY');
      }
      return {
        scope: {
          allowedCourseIds: new Set([options.courseId]),
          allowedVideoIds: new Set(options.allowedVideoIds),
        },
      };
    },
    parentRepositoryFactory: () => createParentSearchRepository({ model: parentModel }),
    leafRepositoryFactory: () => ({
      async findLeavesByChunkIds(chunkIds, { scope }) {
        return leafModel.find(buildLeafLookupQuery(chunkIds, scope)).lean();
      },
    }),
    async verifyChildLookupPlan(childChunkIds, scope) {
      const explain = await leafCollection.find(buildLeafLookupQuery(childChunkIds, scope)).explain('executionStats');
      commandMonitor.assertNoWrites();
      const indexNames = [...collectIndexNames(explain.queryPlanner?.winningPlan)];
      return {
        usesIxscan: hasIxscan(explain.queryPlanner?.winningPlan),
        indexNames,
        docsExamined: explain.executionStats?.totalDocsExamined ?? null,
        keysExamined: explain.executionStats?.totalKeysExamined ?? null,
      };
    },
    async close() {
      await connection.close();
    },
  };
}

function safeFailure(error) {
  return {
    success: false,
    code: error?.code || 'E2E_RUNNER_FAILED',
    message: error instanceof IsolatedE2EError
      ? error.message
      : 'The isolated E2E runner failed safely.',
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const commandMonitor = createCommandMonitor();
  let dependencies;
  try {
    dependencies = await createLiveDependencies(commandMonitor);
    const result = await runIsolatedE2E(options, dependencies);
    console.log(JSON.stringify(result, null, options.json ? 2 : 0));
  } catch (error) {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  } finally {
    if (dependencies?.close) await dependencies.close();
  }
}

if (require.main === module) main();

module.exports = {
  IsolatedE2EError,
  WRITE_COMMANDS,
  buildLeafLookupQuery,
  createCommandMonitor,
  createLiveDependencies,
  collectIndexNames,
  hasIxscan,
  main,
  parseCliArgs,
  runIsolatedE2E,
  safeFailure,
};
