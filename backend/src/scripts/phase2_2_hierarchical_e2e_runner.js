const mongoose = require('mongoose');
const env = require('../config/env');
const VideoSegment = require('../models/videoSegment.model');
const VideoSegmentParent = require('../models/videoSegmentParent.model');
const { embedQuery } = require('../services/queryEmbedding.service');
const { buildGeminiTextSearchContract } = require('../services/embeddingContract.service');
const { createParentSearchRepository } = require('../services/parentSearchAdapter.service');
const { searchParents } = require('../services/parentSearch.service');
const { expandParentHits } = require('../services/childExpansion.service');
const { assembleLeafContext } = require('../services/leafContextAssembly.service');
const { generateAnswer } = require('../services/answerGeneration.service');
const { buildCitations } = require('../services/qa.service');
const { buildSegmentLookupQuery } = require('../services/bridgeScope.service');
const {
  evaluateActiveDataEvidence,
} = require('../services/hierarchicalDataReadiness.service');

// This runner is an isolated, read-only acceptance harness. Command monitoring
// rejects MongoDB writes, and answer generation stays disabled unless requested.

const WRITE_COMMANDS = new Set([
  'insert', 'update', 'delete', 'findandmodify', 'bulkwrite', 'create',
  'createindexes', 'dropindexes', 'drop', 'dropdatabase', 'collmod', 'renamecollection',
]);
const READ_COMMANDS = new Set([
  'find', 'aggregate', 'getmore', 'explain', 'ping', 'count', 'distinct',
  'listcollections', 'listindexes', 'listsearchindexes', 'connectionstatus',
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

function assertStrictReadOnlyRoles(authenticatedUserRoles, databaseName) {
  const roles = Array.isArray(authenticatedUserRoles) ? authenticatedUserRoles : [];
  const expectedDatabase = String(databaseName || '').trim();
  const isStrictReadOnly = expectedDatabase
    && roles.length === 1
    && roles[0]?.role === 'read'
    && roles[0]?.db === expectedDatabase;

  if (!isStrictReadOnly) {
    throw new IsolatedE2EError(
      'The isolated E2E runner requires a dedicated MongoDB user with only the read role on the target database.',
      'E2E_DATABASE_ROLE_NOT_READ_ONLY',
    );
  }

  return { verified: true, role: 'read', database: expectedDatabase };
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
    preflightOnly: false,
    maxParents: env.hierarchicalParentLimit,
    maxChildren: env.hierarchicalChildExpansionLimit,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--with-answer') options.withAnswer = true;
    else if (flag === '--preflight-only') options.preflightOnly = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--question') options.question = argv[++index] || '';
    else if (flag === '--course-id') options.courseId = argv[++index] || '';
    else if (flag === '--video-id') options.videoId = argv[++index] || '';
    else if (flag === '--allowed-video-id') options.allowedVideoIds.push(argv[++index] || '');
    else if (flag === '--max-parents') options.maxParents = parsePositiveInteger(argv[++index], flag);
    else if (flag === '--max-children') options.maxChildren = parsePositiveInteger(argv[++index], flag);
    else throw new IsolatedE2EError('Unsupported CLI option.', 'E2E_CLI_INVALID');
  }

  options.question = String(options.question).trim();
  options.courseId = String(options.courseId).trim();
  options.videoId = String(options.videoId).trim();
  options.allowedVideoIds = [...new Set(options.allowedVideoIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!options.allowedVideoIds.includes(options.videoId)) options.allowedVideoIds.push(options.videoId);

  if ((!options.preflightOnly && !options.question) || !/^[0-9a-f]{24}$/i.test(options.courseId)
      || !/^[0-9a-f]{24}$/i.test(options.videoId)) {
    throw new IsolatedE2EError(
      '--question (except preflight-only), a canonical --course-id, and --video-id are required.',
      'E2E_CLI_INVALID',
    );
  }
  if (options.preflightOnly && options.withAnswer) {
    throw new IsolatedE2EError(
      '--preflight-only cannot be combined with --with-answer.',
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

function hasRequiredCollections(collections, requiredCollections) {
  const available = new Set((collections || []).map((item) => String(item?.name || '')).filter(Boolean));
  return requiredCollections.every((name) => available.has(name));
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

  if (options.preflightOnly) {
    return {
      runMode: 'phase2_2_readonly_preflight',
      writesAllowed: false,
      gate: { sharedValue: false, isolatedValue: false },
      activeDataReadiness: preflightResult.activeDataReadiness || null,
      execution: {
        queryEmbedding: false,
        parentSearch: false,
        childExpansion: false,
        answerGeneration: false,
        externalCalls: 0,
      },
      safety: {
        ...commandMonitor.snapshot(),
        databaseAccess: preflightResult.databaseAccess || null,
        externalCalls: 0,
        sensitiveOutput: false,
      },
    };
  }

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
    expectedContract: buildGeminiTextSearchContract(env.geminiEmbeddingModelName),
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
  const queryContract = env.qaQueryEmbeddingProvider === 'gemini'
    ? buildGeminiTextSearchContract(env.geminiEmbeddingModelName)
    : {
      provider: env.qaQueryEmbeddingProvider,
      model: env.qaQueryEmbeddingProvider,
      instructionVersion: null,
      generationVersion: null,
      normalizationVersion: null,
      contractVersion: null,
      schemaVersion: null,
      taskType: null,
    };
  return {
    runMode: 'phase2_2_isolated_e2e',
    writesAllowed: false,
    gate: { sharedValue: false, isolatedValue: true },
    activeDataReadiness: preflightResult.activeDataReadiness || null,
    query: {
      length: options.question.length,
      embeddingProvider: queryContract.provider,
      embeddingModel: queryContract.model,
      instructionVersion: queryContract.instructionVersion,
      generationVersion: queryContract.generationVersion,
      normalizationVersion: queryContract.normalizationVersion,
      contractVersion: queryContract.contractVersion,
      schemaVersion: queryContract.schemaVersion,
      taskType: queryContract.taskType,
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
      databaseAccess: preflightResult.databaseAccess || null,
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

  const readOnlyMongoUri = String(process.env.PHASE2_2_READONLY_MONGODB_URI || '').trim();
  if (!readOnlyMongoUri) {
    throw new IsolatedE2EError(
      'PHASE2_2_READONLY_MONGODB_URI is required for the isolated E2E runner.',
      'E2E_READONLY_DATABASE_URI_REQUIRED',
    );
  }

  const connection = await mongoose.createConnection(readOnlyMongoUri, {
    autoCreate: false,
    autoIndex: false,
    monitorCommands: true,
    readPreference: 'secondaryPreferred',
    retryWrites: false,
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  connection.getClient().on('commandStarted', (event) => commandMonitor.observe(event));

  let databaseAccess;
  try {
    const connectionStatus = await connection.db.admin().command({
      connectionStatus: 1,
      showPrivileges: false,
    });
    databaseAccess = assertStrictReadOnlyRoles(
      connectionStatus?.authInfo?.authenticatedUserRoles,
      connection.name,
    );
    commandMonitor.assertNoWrites();
  } catch (error) {
    await connection.close();
    throw error;
  }

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
        // Atlas does not consistently accept `$in` in a listCollections name filter.
        // Read name-only metadata and enforce the required set in application code.
        connection.db.listCollections({}, { nameOnly: true }).toArray(),
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
      if (!hasRequiredCollections(collections, requiredCollections)) {
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
      const parents = await parentCollection.find(
        { videoId: { $in: options.allowedVideoIds }, isActive: true },
        { projection: {
          _id: 0, videoId: 1, childChunkIds: 1, isActive: 1,
          embeddingProvider: 1, embeddingModel: 1, embeddingDimension: 1,
          embeddingTaskType: 1, embeddingInstructionVersion: 1, generationVersion: 1,
          normalizationVersion: 1, embeddingContractVersion: 1, embeddingSchemaVersion: 1,
        } },
      ).toArray();
      const leaves = await leafCollection.find(
        { videoId: { $in: options.allowedVideoIds } },
        { projection: {
          _id: 0, chunkId: 1, videoId: 1,
          embeddingProvider: 1, embeddingModel: 1, embeddingDimension: 1,
          embeddingTaskType: 1, embeddingInstructionVersion: 1, generationVersion: 1,
          normalizationVersion: 1, embeddingContractVersion: 1, embeddingSchemaVersion: 1,
        } },
      ).toArray();
      const activeDataReadiness = {
        ...evaluateActiveDataEvidence({
        allowedVideoIds: options.allowedVideoIds,
        parents,
        leaves,
        leafIndexes: indexes,
        parentSearchIndexes: searchIndexes,
        parentIndexName: env.videoSegmentParentVectorIndexName,
        }),
        checkedAt: new Date().toISOString(),
        source: 'live_read_only',
      };
      if (!activeDataReadiness.ready) {
        throw new IsolatedE2EError(
          'Active Parent or Leaf data does not satisfy the stable generation contract.',
          'E2E_ACTIVE_DATA_NOT_READY',
        );
      }
      return {
        activeDataReadiness,
        databaseAccess,
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
  const commandMonitor = createCommandMonitor();
  let dependencies;
  try {
    const options = parseCliArgs(argv);
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
  assertStrictReadOnlyRoles,
  buildLeafLookupQuery,
  createCommandMonitor,
  createLiveDependencies,
  collectIndexNames,
  hasIxscan,
  hasRequiredCollections,
  main,
  parseCliArgs,
  runIsolatedE2E,
  safeFailure,
};
