const env = require('../config/env');
const AppError = require('../utils/appError');
const { buildCostControlSnapshot } = require('./costControl.service');
const {
  DEFAULT_VIDEO_VECTOR_INDEX_NAME,
  buildVideoVectorSearchIndexDefinition,
} = require('./videoVectorIndex.service');
const {
  GEMINI_EMBEDDING_DIMENSIONS,
  buildGeminiTextSearchContract,
  compareEmbeddingContracts,
  isStableGeminiEmbeddingModel,
  parseActiveEmbeddingContract,
} = require('./embeddingContract.service');
const {
  contractHash,
  getHierarchicalDataReadinessSnapshot,
} = require('./hierarchicalDataReadiness.service');

const QA_QUERY_EMBEDDING_PROVIDERS = ['mock', 'openai', 'gemini'];
const QA_VECTOR_SEARCH_MODES = ['memory', 'atlas'];
const QA_ANSWER_PROVIDERS = ['template', 'openai', 'gemini'];
const QA_ATLAS_FILTER_MODES = ['bridge_course_or_video'];
// 由 Pipeline／Database 在資料完成驗證後宣告；沒有宣告時不能假設現有資料相容。
const DATA_CONTRACT_ENV_KEYS = {
  leaf: {
    key: 'qaActiveLeafEmbeddingContractJson',
    source: 'QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_JSON',
  },
  parent: {
    key: 'qaActiveParentEmbeddingContractJson',
    source: 'QA_ACTIVE_PARENT_EMBEDDING_CONTRACT_JSON',
  },
};

function buildDiagnostic(code, message) {
  return { code, message };
}

function expectedQueryEmbeddingDimensions(provider) {
  if (provider === 'gemini') return GEMINI_EMBEDDING_DIMENSIONS;
  if (provider === 'mock') return env.qaMockEmbeddingDimensions;

  if (provider === 'openai') {
    if (env.openaiEmbeddingModel === 'text-embedding-3-large') return 3072;
    if (['text-embedding-3-small', 'text-embedding-ada-002'].includes(env.openaiEmbeddingModel)) {
      return 1536;
    }
  }

  return null;
}

function buildQueryContract() {
  if (env.qaQueryEmbeddingProvider === 'gemini') {
    return buildGeminiTextSearchContract(env.geminiEmbeddingModelName);
  }

  return {
    provider: env.qaQueryEmbeddingProvider,
    model: env.qaQueryEmbeddingProvider === 'openai'
      ? env.openaiEmbeddingModel
      : 'mock',
    dimension: expectedQueryEmbeddingDimensions(env.qaQueryEmbeddingProvider),
    instructionVersion: null,
    generationVersion: null,
    normalizationVersion: null,
    contractVersion: null,
    schemaVersion: null,
    taskType: null,
  };
}

// 同為 3072 維仍可能來自不同模型或 instruction，因此必須比較完整向量契約。
function buildDataContractCompatibility(expected) {
  return Object.entries(DATA_CONTRACT_ENV_KEYS).reduce((result, [kind, definition]) => {
    const parsed = parseActiveEmbeddingContract(env[definition.key], definition.source);
    const mismatches = parsed.error
      ? ['invalid_json']
      : parsed.declared
        ? compareEmbeddingContracts(expected, parsed.contract)
        : [];

    result[kind] = {
      expected,
      active: parsed.contract,
      source: parsed.source,
      status: !parsed.declared
        ? 'not_declared'
        : mismatches.length
          ? 'incompatible'
          : 'compatible',
      mismatches,
      error: parsed.error,
    };
    return result;
  }, {});
}

function isParentQueryEmbeddingCompatible(snapshot) {
  return snapshot.dataContractCompatibility.parent.status === 'compatible';
}

function isLeafQueryEmbeddingCompatible(snapshot) {
  return snapshot.dataContractCompatibility.leaf.status === 'compatible';
}

function buildHierarchicalRolloutContractStatus(dataContractCompatibility) {
  const parent = dataContractCompatibility?.parent;
  if (!parent || parent.status === 'not_declared') return 'not_declared';
  if (parent.error) return 'incompatible';
  // Parent artifact schema/role representation may differ from the Query schema,
  // while the stable embedding-space contract fields must remain identical.
  const contractMismatches = (parent.mismatches || []).filter(
    (field) => field !== 'schemaVersion',
  );
  return contractMismatches.length ? 'incompatible' : 'compatible';
}

function hasStableGeminiModelFailure(snapshot) {
  return snapshot.queryEmbeddingProvider === 'gemini'
    && !isStableGeminiEmbeddingModel(snapshot.queryEmbeddingContract.model);
}

function buildQaHardFailures(snapshot) {
  const hardFailures = [];

  if (!QA_QUERY_EMBEDDING_PROVIDERS.includes(snapshot.queryEmbeddingProvider)) {
    hardFailures.push(buildDiagnostic(
      'QA_QUERY_EMBEDDING_PROVIDER_UNSUPPORTED',
      `QA_QUERY_EMBEDDING_PROVIDER "${snapshot.queryEmbeddingProvider}" is not supported.`,
    ));
  }

  if (!QA_VECTOR_SEARCH_MODES.includes(snapshot.vectorSearchMode)) {
    hardFailures.push(buildDiagnostic(
      'QA_VECTOR_SEARCH_MODE_UNSUPPORTED',
      `QA_VECTOR_SEARCH_MODE "${snapshot.vectorSearchMode}" is not supported.`,
    ));
  }

  if (!QA_ANSWER_PROVIDERS.includes(snapshot.answerProvider)) {
    hardFailures.push(buildDiagnostic(
      'QA_ANSWER_PROVIDER_UNSUPPORTED',
      `QA_ANSWER_PROVIDER "${snapshot.answerProvider}" is not supported.`,
    ));
  }

  if (!QA_ATLAS_FILTER_MODES.includes(snapshot.atlasFilterMode)) {
    hardFailures.push(buildDiagnostic(
      'QA_ATLAS_FILTER_MODE_UNSUPPORTED',
      `QA_ATLAS_FILTER_MODE "${snapshot.atlasFilterMode}" is not supported.`,
    ));
  }

  if (hasStableGeminiModelFailure(snapshot)) {
    hardFailures.push(buildDiagnostic(
      'GEMINI_EMBEDDING_MODEL_CONTRACT_INVALID',
      'GEMINI_EMBEDDING_MODEL_NAME must be stable gemini-embedding-2; preview and taskType contracts are not supported.',
    ));
  }

  if (snapshot.queryEmbeddingProvider === 'openai' && !snapshot.openaiConfigured) {
    hardFailures.push(buildDiagnostic(
      'OPENAI_API_KEY_MISSING_FOR_QUERY_EMBEDDING',
      'OPENAI_API_KEY is required when QA_QUERY_EMBEDDING_PROVIDER=openai.',
    ));
  }

  if (snapshot.queryEmbeddingProvider === 'gemini' && !snapshot.geminiConfigured) {
    hardFailures.push(buildDiagnostic(
      'GEMINI_API_KEY_MISSING_FOR_QUERY_EMBEDDING',
      'GEMINI_API_KEY is required when QA_QUERY_EMBEDDING_PROVIDER=gemini.',
    ));
  }

  if (snapshot.answerProvider === 'openai' && !snapshot.openaiConfigured) {
    hardFailures.push(buildDiagnostic(
      'OPENAI_API_KEY_MISSING_FOR_ANSWER_PROVIDER',
      'OPENAI_API_KEY is required when QA_ANSWER_PROVIDER=openai.',
    ));
  }

  if (snapshot.answerProvider === 'gemini' && !snapshot.geminiConfigured) {
    hardFailures.push(buildDiagnostic(
      'GEMINI_API_KEY_MISSING',
      'GEMINI_API_KEY is required when QA_ANSWER_PROVIDER=gemini.',
    ));
  }

  if (snapshot.vectorSearchMode === 'atlas' && !snapshot.atlasVectorIndexConfigured) {
    hardFailures.push(buildDiagnostic(
      'QA_ATLAS_VECTOR_INDEX_NAME_MISSING',
      'QA atlas mode requires QA_ATLAS_VECTOR_INDEX_NAME.',
    ));
  }

  if (snapshot.vectorSearchMode === 'atlas' && snapshot.queryEmbeddingProvider === 'mock') {
    hardFailures.push(buildDiagnostic(
      'QA_ATLAS_REQUIRES_REAL_QUERY_EMBEDDINGS',
      'QA atlas mode is not compatible with mock query embeddings. Set QA_QUERY_EMBEDDING_PROVIDER=gemini or openai.',
    ));
  }

  // Atlas searches the active Leaf collection directly. Unknown metadata is not
  // safe to treat as compatible, even when the vector index has the right size.
  if (snapshot.vectorSearchMode === 'atlas' && !isLeafQueryEmbeddingCompatible(snapshot)) {
    hardFailures.push(buildDiagnostic(
      'QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_INCOMPATIBLE',
      'Atlas Leaf vectors are missing or incompatible with the current query embedding contract.',
    ));
  }

  // 沒有 Leaf fallback 時，Parent 不相容會讓整條檢索路徑失效，必須直接判定不健康。
  if (snapshot.hierarchicalRetrievalEnabled
      && !snapshot.hierarchicalRetrievalFallbackToLeaf
      && !isParentQueryEmbeddingCompatible(snapshot)) {
    hardFailures.push(buildDiagnostic(
      'HIERARCHICAL_QUERY_EMBEDDING_INCOMPATIBLE',
      'Hierarchical retrieval requires active Parent metadata matching the complete query embedding contract.',
    ));
  }

  if (snapshot.hierarchicalRetrievalEnabled
      && !snapshot.hierarchicalRetrievalFallbackToLeaf
      && !snapshot.hierarchicalActiveDataCompatible) {
    hardFailures.push(buildDiagnostic(
      'HIERARCHICAL_ACTIVE_DATA_NOT_READY',
      'Hierarchical retrieval without Leaf fallback requires verified active Parent and Leaf data plus queryable indexes.',
    ));
  }

  return hardFailures;
}

function buildQaWarnings(snapshot) {
  const warnings = [];

  if (snapshot.vectorSearchMode === 'memory') {
    warnings.push(buildDiagnostic(
      'PHASE1_MEMORY_SEARCH',
      'Phase-1 QA retrieval is running in memory mode instead of Atlas vector search.',
    ));
  }

  if (snapshot.queryEmbeddingProvider === 'mock') {
    warnings.push(buildDiagnostic(
      'PHASE1_MOCK_QUERY_EMBEDDING',
      'Phase-1 QA query embeddings are still mock embeddings.',
    ));
  }

  if (snapshot.hierarchicalRetrievalEnabled && !isParentQueryEmbeddingCompatible(snapshot)) {
    warnings.push(buildDiagnostic(
      'HIERARCHICAL_QUERY_EMBEDDING_INCOMPATIBLE',
      'Parent search remains unavailable until active Parent metadata matches the complete stable embedding contract.',
    ));
  }
  if (snapshot.hierarchicalRetrievalEnabled && !snapshot.hierarchicalActiveDataCompatible) {
    warnings.push(buildDiagnostic(
      'HIERARCHICAL_ACTIVE_DATA_NOT_READY',
      'Hierarchical rollout remains unavailable until a live read-only check verifies active Parent and Leaf data plus indexes.',
    ));
  }

  return warnings;
}

function buildQaRuntimeSnapshot() {
  const queryEmbeddingContract = buildQueryContract();
  const dataContractCompatibility = buildDataContractCompatibility(queryEmbeddingContract);
  const hierarchicalActiveDataReadiness = getHierarchicalDataReadinessSnapshot();
  const hierarchicalActiveDataCompatible = hierarchicalActiveDataReadiness.ready === true
    && hierarchicalActiveDataReadiness.evidence?.contractHash === contractHash(queryEmbeddingContract);
  const snapshot = {
    queryEmbeddingProvider: env.qaQueryEmbeddingProvider,
    vectorSearchMode: env.qaVectorSearchMode,
    answerProvider: env.qaAnswerProvider,
    atlasVectorIndexConfigured: Boolean(env.qaAtlasVectorIndexName),
    atlasFilterMode: env.qaAtlasFilterMode,
    geminiConfigured: Boolean(env.geminiApiKey),
    openaiConfigured: Boolean(env.openaiApiKey),
    hierarchicalRetrievalEnabled: env.hierarchicalRetrievalEnabled,
    hierarchicalRetrievalFallbackToLeaf: env.hierarchicalRetrievalFallbackToLeaf,
    hierarchicalRetrievalRolloutMode: env.hierarchicalRetrievalRolloutMode,
    hierarchicalRetrievalRolloutModeValid: env.hierarchicalRetrievalRolloutModeValid,
    hierarchicalRetrievalAllowlistsValid: env.hierarchicalRetrievalAllowlistsValid,
    hierarchicalParentStorageMode: 'atlas_parent_vector',
    hierarchicalActiveDataReadiness,
    hierarchicalActiveDataCompatible,
    queryEmbeddingDimensions: queryEmbeddingContract.dimension,
    queryEmbeddingContract,
    // Keep the short alias for existing consumers while the explicit field is
    // adopted by the documented health contract.
    queryContract: queryEmbeddingContract,
    dataContractCompatibility,
    hierarchicalRolloutContractStatus: buildHierarchicalRolloutContractStatus(
      dataContractCompatibility,
    ),
  };

  snapshot.parentQueryEmbeddingCompatible = isParentQueryEmbeddingCompatible(snapshot);
  snapshot.leafQueryEmbeddingCompatible = isLeafQueryEmbeddingCompatible(snapshot);

  const hardFailures = buildQaHardFailures(snapshot);
  const warnings = buildQaWarnings(snapshot);
  const degraded = warnings.some(
    (item) => item.code === 'HIERARCHICAL_QUERY_EMBEDDING_INCOMPATIBLE',
  );

  return {
    ...snapshot,
    readiness: hardFailures.length ? 'hard_fail' : degraded ? 'degraded' : 'ready',
    readyForAsk: hardFailures.length === 0,
    costControl: buildCostControlSnapshot(),
    warnings,
    hardFailures,
  };
}

function buildLineRuntimeSnapshot() {
  const missingConfig = [];

  if (!env.lineChannelSecret) missingConfig.push('LINE_CHANNEL_SECRET');
  if (!env.lineChannelAccessToken) missingConfig.push('LINE_CHANNEL_ACCESS_TOKEN');

  const signatureValidationConfigured = Boolean(env.lineChannelSecret);
  const liveReplyConfigured = Boolean(env.lineChannelAccessToken);
  const liveFlowReady = Boolean(env.lineChannelSecret && env.lineChannelAccessToken);
  const hardFailures = [];
  const degradedReasons = [];

  if (!signatureValidationConfigured) {
    hardFailures.push(buildDiagnostic(
      'LINE_CHANNEL_SECRET_MISSING',
      'LINE_CHANNEL_SECRET is required for webhook signature validation.',
    ));
  }

  if (!liveReplyConfigured) {
    degradedReasons.push(buildDiagnostic(
      'LINE_CHANNEL_ACCESS_TOKEN_MISSING',
      'LINE_CHANNEL_ACCESS_TOKEN is missing, so LINE replies stay in backend-only mode.',
    ));
  }

  return {
    signatureValidationConfigured,
    liveReplyConfigured,
    liveFlowReady,
    readiness: hardFailures.length
      ? 'hard_fail'
      : liveFlowReady
        ? 'ready'
        : 'degraded',
    deliveryMode: liveFlowReady
      ? 'live'
      : signatureValidationConfigured
        ? 'backend_only'
        : 'disabled',
    missingConfig,
    hardFailures,
    degradedReasons,
  };
}

function buildMultimodalRuntimeSnapshot() {
  const vectorIndexName = env.videoSegmentVideoVectorIndexName || DEFAULT_VIDEO_VECTOR_INDEX_NAME;
  const hardFailures = !env.videoSegmentVideoVectorIndexName
    ? [buildDiagnostic(
      'VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_MISSING',
      'Set VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_NAME before multimodal QA can be enabled.',
    )]
    : [];
  const blockers = [
    buildDiagnostic(
      'MULTIMODAL_QA_NOT_INTEGRATED',
      'video_segments_video is not wired into QA retrieval yet.',
    ),
    buildDiagnostic(
      'VIDEO_SEGMENTS_VIDEO_SCOPE_MAPPING_UNVERIFIED',
      'video_segments_video.video_id must map to videos before course-scoped QA can use it.',
    ),
  ];

  return {
    segmentCollection: env.videoSegmentVideoCollection,
    vectorIndexName: env.videoSegmentVideoVectorIndexName || null,
    expectedVectorIndexName: vectorIndexName,
    vectorIndexConfigured: Boolean(env.videoSegmentVideoVectorIndexName),
    expectedVectorIndexDefinition: buildVideoVectorSearchIndexDefinition(),
    setupCommand: 'npm run db:ensure-video-vector-index',
    readiness: 'not_enabled',
    readyForQa: false,
    blockers,
    hardFailures,
  };
}

function assertQaRuntimeConfiguration() {
  const snapshot = buildQaRuntimeSnapshot();

  if (snapshot.hardFailures.length) {
    throw new AppError(
      snapshot.hardFailures[0].message,
      500,
      'QA_RUNTIME_MISCONFIGURED',
      snapshot,
    );
  }

  return snapshot;
}

module.exports = {
  QA_QUERY_EMBEDDING_PROVIDERS,
  QA_VECTOR_SEARCH_MODES,
  QA_ANSWER_PROVIDERS,
  QA_ATLAS_FILTER_MODES,
  buildQaRuntimeSnapshot,
  buildLineRuntimeSnapshot,
  buildMultimodalRuntimeSnapshot,
  expectedQueryEmbeddingDimensions,
  isParentQueryEmbeddingCompatible,
  buildHierarchicalRolloutContractStatus,
  assertQaRuntimeConfiguration,
};
