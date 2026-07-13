const env = require('../config/env');
const AppError = require('../utils/appError');
const { buildCostControlSnapshot } = require('./costControl.service');
const {
  DEFAULT_VIDEO_VECTOR_INDEX_NAME,
  buildVideoVectorSearchIndexDefinition,
} = require('./videoVectorIndex.service');

const QA_QUERY_EMBEDDING_PROVIDERS = ['mock', 'openai', 'gemini'];
const QA_VECTOR_SEARCH_MODES = ['memory', 'atlas'];
const QA_ANSWER_PROVIDERS = ['template', 'openai', 'gemini'];
const QA_ATLAS_FILTER_MODES = ['bridge_course_or_video'];

function buildDiagnostic(code, message) {
  return { code, message };
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

  return warnings;
}

function buildQaRuntimeSnapshot() {
  const snapshot = {
    queryEmbeddingProvider: env.qaQueryEmbeddingProvider,
    vectorSearchMode: env.qaVectorSearchMode,
    answerProvider: env.qaAnswerProvider,
    atlasVectorIndexConfigured: Boolean(env.qaAtlasVectorIndexName),
    atlasFilterMode: env.qaAtlasFilterMode,
    geminiConfigured: Boolean(env.geminiApiKey),
    openaiConfigured: Boolean(env.openaiApiKey),
  };

  const hardFailures = buildQaHardFailures(snapshot);

  return {
    ...snapshot,
    readiness: hardFailures.length ? 'hard_fail' : 'ready',
    readyForAsk: hardFailures.length === 0,
    costControl: buildCostControlSnapshot(),
    warnings: buildQaWarnings(snapshot),
    hardFailures,
  };
}

function buildLineRuntimeSnapshot() {
  const missingConfig = [];

  if (!env.lineChannelSecret) {
    missingConfig.push('LINE_CHANNEL_SECRET');
  }

  if (!env.lineChannelAccessToken) {
    missingConfig.push('LINE_CHANNEL_ACCESS_TOKEN');
  }

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
  const hardFailures = [];
  const vectorIndexName = env.videoSegmentVideoVectorIndexName || DEFAULT_VIDEO_VECTOR_INDEX_NAME;
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

  if (!env.videoSegmentVideoVectorIndexName) {
    hardFailures.push(buildDiagnostic(
      'VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_MISSING',
      'Set VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_NAME before multimodal QA can be enabled.',
    ));
  }

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

function assertAllowedRuntimeValue({ label, value, allowedValues, snapshot }) {
  if (allowedValues.includes(value)) {
    return;
  }

  throw new AppError(
    `${label} "${value}" is not supported.`,
    500,
    'QA_RUNTIME_MISCONFIGURED',
    {
      ...snapshot,
      invalidSetting: label,
      invalidValue: value,
      allowedValues,
    },
  );
}

function assertQaRuntimeConfiguration() {
  const snapshot = buildQaRuntimeSnapshot();

  assertAllowedRuntimeValue({
    label: 'QA_QUERY_EMBEDDING_PROVIDER',
    value: env.qaQueryEmbeddingProvider,
    allowedValues: QA_QUERY_EMBEDDING_PROVIDERS,
    snapshot,
  });
  assertAllowedRuntimeValue({
    label: 'QA_VECTOR_SEARCH_MODE',
    value: env.qaVectorSearchMode,
    allowedValues: QA_VECTOR_SEARCH_MODES,
    snapshot,
  });
  assertAllowedRuntimeValue({
    label: 'QA_ANSWER_PROVIDER',
    value: env.qaAnswerProvider,
    allowedValues: QA_ANSWER_PROVIDERS,
    snapshot,
  });
  assertAllowedRuntimeValue({
    label: 'QA_ATLAS_FILTER_MODE',
    value: env.qaAtlasFilterMode,
    allowedValues: QA_ATLAS_FILTER_MODES,
    snapshot,
  });

  if (env.qaQueryEmbeddingProvider === 'openai' && !env.openaiApiKey) {
    throw new AppError(
      'OPENAI_API_KEY is required when QA_QUERY_EMBEDDING_PROVIDER=openai.',
      500,
      'QA_RUNTIME_MISCONFIGURED',
      snapshot,
    );
  }

  if (env.qaAnswerProvider === 'openai' && !env.openaiApiKey) {
    throw new AppError(
      'OPENAI_API_KEY is required when QA_ANSWER_PROVIDER=openai.',
      500,
      'QA_RUNTIME_MISCONFIGURED',
      snapshot,
    );
  }

  if (env.qaAnswerProvider === 'gemini' && !env.geminiApiKey) {
    throw new AppError(
      'GEMINI_API_KEY is required when QA_ANSWER_PROVIDER=gemini.',
      500,
      'QA_RUNTIME_MISCONFIGURED',
      snapshot,
    );
  }

  if (env.qaVectorSearchMode !== 'atlas') {
    return snapshot;
  }

  if (!env.qaAtlasVectorIndexName) {
    throw new AppError(
      'QA atlas mode requires QA_ATLAS_VECTOR_INDEX_NAME.',
      500,
      'QA_RUNTIME_MISCONFIGURED',
      snapshot,
    );
  }

  if (env.qaQueryEmbeddingProvider === 'mock') {
    throw new AppError(
      'QA atlas mode is not compatible with mock query embeddings. Set QA_QUERY_EMBEDDING_PROVIDER=gemini or openai.',
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
  assertQaRuntimeConfiguration,
};
