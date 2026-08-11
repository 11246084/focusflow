const path = require('path');
const dotenv = require('dotenv');
const {
  parseIdentifierAllowlist,
  parseRolloutMode,
} = require('../services/hierarchicalRollout.service');

const projectRoot = path.resolve(__dirname, '../..');

// Resolve the backend .env explicitly so startup does not depend on the caller's working directory.
dotenv.config({ path: path.join(projectRoot, '.env') });

function parseNonNegativeNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

const hierarchicalRolloutModeConfig = parseRolloutMode(
  process.env.HIERARCHICAL_RETRIEVAL_ROLLOUT_MODE,
);
const hierarchicalAllowedCourseIdsConfig = parseIdentifierAllowlist(
  process.env.HIERARCHICAL_RETRIEVAL_ALLOWED_COURSE_IDS,
);
const hierarchicalAllowedVideoIdsConfig = parseIdentifierAllowlist(
  process.env.HIERARCHICAL_RETRIEVAL_ALLOWED_VIDEO_IDS,
);
const hierarchicalAllowedUserIdsConfig = parseIdentifierAllowlist(
  process.env.HIERARCHICAL_RETRIEVAL_ALLOWED_USER_IDS,
);

function isSameOrDescendantPath(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPrivateAvatarUploadDir(uploadDir, avatarUploadDir) {
  if (isSameOrDescendantPath(uploadDir, avatarUploadDir)) {
    throw new Error('AVATAR_UPLOAD_DIR must be outside UPLOAD_DIR.');
  }
}

const uploadDir = path.resolve(projectRoot, process.env.UPLOAD_DIR || 'uploads');
const avatarUploadDir = path.resolve(
  projectRoot,
  process.env.AVATAR_UPLOAD_DIR || path.join('private-data', 'avatars'),
);

// Avatar bytes must never sit under the public video upload tree.
assertPrivateAvatarUploadDir(uploadDir, avatarUploadDir);

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/focusflow',
  videoSegmentCollection: process.env.VIDEO_SEGMENT_COLLECTION || 'video_segments_text',
  videoSegmentVideoCollection: process.env.VIDEO_SEGMENT_VIDEO_COLLECTION || 'video_segments_video',
  videoSegmentVideoVectorIndexName: process.env.VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_NAME
    || process.env.VIDEO_SEGMENT_VIDEO_VECTOR_INDEX_NAME
    || 'video_embedding_index',
  videoSegmentParentCollection: process.env.VIDEO_SEGMENT_PARENT_COLLECTION || 'video_segments_parent',
  videoSegmentParentVectorIndexName: process.env.VIDEO_SEGMENTS_PARENT_VECTOR_INDEX_NAME
    || 'parent_embedding_index',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-local-env',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  demoSeedEnabled: String(process.env.DEMO_SEED_ENABLED || 'false').toLowerCase() === 'true',
  uploadDir,
  avatarUploadDir,
  qaQueryEmbeddingProvider: process.env.QA_QUERY_EMBEDDING_PROVIDER || 'mock',
  qaAnswerProvider: process.env.QA_ANSWER_PROVIDER || 'gemini',
  qaVectorSearchMode: process.env.QA_VECTOR_SEARCH_MODE || 'memory',
  qaAtlasVectorIndexName: process.env.QA_ATLAS_VECTOR_INDEX_NAME || '',
  qaAtlasFilterMode: process.env.QA_ATLAS_FILTER_MODE || 'bridge_course_or_video',
  qaMatchLimit: Number(process.env.QA_MATCH_LIMIT) || 3,
  hierarchicalRetrievalEnabled: parseBoolean(
    process.env.HIERARCHICAL_RETRIEVAL_ENABLED,
    false,
    'HIERARCHICAL_RETRIEVAL_ENABLED',
  ),
  hierarchicalRetrievalFallbackToLeaf: parseBoolean(
    process.env.HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF,
    true,
    'HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF',
  ),
  hierarchicalRetrievalRolloutMode: hierarchicalRolloutModeConfig.value,
  hierarchicalRetrievalRolloutModeValid: hierarchicalRolloutModeConfig.valid,
  hierarchicalRetrievalRolloutModeRequested: hierarchicalRolloutModeConfig.requested,
  hierarchicalRetrievalAllowedCourseIds: hierarchicalAllowedCourseIdsConfig.values,
  hierarchicalRetrievalAllowedVideoIds: hierarchicalAllowedVideoIdsConfig.values,
  hierarchicalRetrievalAllowedUserIds: hierarchicalAllowedUserIdsConfig.values,
  hierarchicalRetrievalAllowlistsValid: [
    hierarchicalAllowedCourseIdsConfig,
    hierarchicalAllowedVideoIdsConfig,
    hierarchicalAllowedUserIdsConfig,
  ].every((config) => config.valid),
  hierarchicalParentLimit: parsePositiveInteger(process.env.HIERARCHICAL_PARENT_LIMIT, 5, 'HIERARCHICAL_PARENT_LIMIT'),
  hierarchicalChildExpansionLimit: parsePositiveInteger(
    process.env.HIERARCHICAL_CHILD_EXPANSION_LIMIT, 30, 'HIERARCHICAL_CHILD_EXPANSION_LIMIT',
  ),
  hierarchicalContextMaxLeaves: parsePositiveInteger(
    process.env.HIERARCHICAL_CONTEXT_MAX_LEAVES, 15, 'HIERARCHICAL_CONTEXT_MAX_LEAVES',
  ),
  hierarchicalContextMaxCharacters: parsePositiveInteger(
    process.env.HIERARCHICAL_CONTEXT_MAX_CHARACTERS, 5000, 'HIERARCHICAL_CONTEXT_MAX_CHARACTERS',
  ),
  hierarchicalParentTimeoutMs: parsePositiveInteger(
    process.env.HIERARCHICAL_PARENT_TIMEOUT_MS, 1000, 'HIERARCHICAL_PARENT_TIMEOUT_MS',
  ),
  faqCacheEnabled: String(process.env.FAQ_CACHE_ENABLED || 'true').toLowerCase() === 'true',
  // <= 0 或 > 1 視為停用語意相似層，只保留正規化文字完全相同的快取命中
  faqCacheSimilarityThreshold: Number(process.env.FAQ_CACHE_SIMILARITY_THRESHOLD ?? 0.95),
  faqCacheMaxEntriesPerCourse: Number(process.env.FAQ_CACHE_MAX_ENTRIES_PER_COURSE) || 200,
  qaMockEmbeddingDimensions: Number(process.env.QA_MOCK_EMBEDDING_DIMENSIONS) || 32,
  qaEstimatedTokensPerAsk: Number(process.env.QA_ESTIMATED_TOKENS_PER_ASK) || 1000,
  qaMonthlyTokenBudget: Number(process.env.QA_MONTHLY_TOKEN_BUDGET) || 0,
  qaUserMonthlyTokenQuota: Number(process.env.QA_USER_MONTHLY_TOKEN_QUOTA) || 0,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiEmbeddingModelName: process.env.GEMINI_EMBEDDING_MODEL_NAME || 'gemini-embedding-2',
  qaActiveLeafEmbeddingContractJson: process.env.QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_JSON || '',
  qaActiveParentEmbeddingContractJson: process.env.QA_ACTIVE_PARENT_EMBEDDING_CONTRACT_JSON || '',
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET || '',
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  processingWebhookSecret: process.env.PROCESSING_WEBHOOK_SECRET || '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  shortsSyncIntervalMs: parseNonNegativeNumber(process.env.SHORTS_SYNC_INTERVAL_MS, 600000),
  youtubeUploadEnabled: String(process.env.YOUTUBE_UPLOAD_ENABLED || 'false').toLowerCase() === 'true',
  youtubeAutoUploadEnabled: String(process.env.YOUTUBE_AUTO_UPLOAD_ENABLED || 'false').toLowerCase() === 'true',
  // Keep the earlier OAuth variable names readable while deployments migrate to the canonical names.
  youtubeClientId: process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_OAUTH_CLIENT_ID || '',
  youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '',
  youtubeRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_OAUTH_REFRESH_TOKEN || '',
  youtubeOAuthClientId: process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_OAUTH_CLIENT_ID || '',
  youtubeOAuthClientSecret: process.env.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '',
  youtubeOAuthRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_OAUTH_REFRESH_TOKEN || '',
  youtubeUploadAccessToken: process.env.YOUTUBE_UPLOAD_ACCESS_TOKEN || '',
  youtubeUploadPrivacy: process.env.YOUTUBE_UPLOAD_PRIVACY
    || process.env.YOUTUBE_UPLOAD_PRIVACY_STATUS
    || 'unlisted',
  youtubeUploadPrivacyStatus: process.env.YOUTUBE_UPLOAD_PRIVACY
    || process.env.YOUTUBE_UPLOAD_PRIVACY_STATUS
    || 'unlisted',
  youtubeUploadCategoryId: process.env.YOUTUBE_UPLOAD_CATEGORY_ID || '27',
  // 刪除影片時把 FocusFlow 自己上傳的 YouTube 影片轉為 private（不刪除，可還原）。
  // 需要 `youtube.force-ssl` scope 的 refresh token；只有憑證齊備時才會實際執行。
  youtubePrivatizeOnDelete:
    String(process.env.YOUTUBE_PRIVATIZE_ON_DELETE || 'true').toLowerCase() === 'true',
  allowedOrigins: String(process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  projectRoot,
  assertPrivateAvatarUploadDir,
  parseBoolean,
  parsePositiveInteger,
  parseRolloutMode,
  parseIdentifierAllowlist,
};
