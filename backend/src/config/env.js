const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

function parseNonNegativeNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/focusflow',
  videoSegmentCollection: process.env.VIDEO_SEGMENT_COLLECTION || 'video_segments_text',
  videoSegmentVideoCollection: process.env.VIDEO_SEGMENT_VIDEO_COLLECTION || 'video_segments_video',
  videoSegmentVideoVectorIndexName: process.env.VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_NAME
    || process.env.VIDEO_SEGMENT_VIDEO_VECTOR_INDEX_NAME
    || 'video_embedding_index',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-local-env',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  demoSeedEnabled: String(process.env.DEMO_SEED_ENABLED || 'false').toLowerCase() === 'true',
  uploadDir: path.resolve(projectRoot, process.env.UPLOAD_DIR || 'uploads'),
  qaQueryEmbeddingProvider: process.env.QA_QUERY_EMBEDDING_PROVIDER || 'mock',
  qaAnswerProvider: process.env.QA_ANSWER_PROVIDER || 'gemini',
  qaVectorSearchMode: process.env.QA_VECTOR_SEARCH_MODE || 'memory',
  qaAtlasVectorIndexName: process.env.QA_ATLAS_VECTOR_INDEX_NAME || '',
  qaAtlasFilterMode: process.env.QA_ATLAS_FILTER_MODE || 'bridge_course_or_video',
  qaMatchLimit: Number(process.env.QA_MATCH_LIMIT) || 3,
  faqCacheEnabled: String(process.env.FAQ_CACHE_ENABLED || 'true').toLowerCase() === 'true',
  // <= 0 或 > 1 視為停用語意相似層，只保留正規化文字完全相同的快取命中
  faqCacheSimilarityThreshold: Number(process.env.FAQ_CACHE_SIMILARITY_THRESHOLD ?? 0.95),
  faqCacheMaxEntriesPerCourse: Number(process.env.FAQ_CACHE_MAX_ENTRIES_PER_COURSE) || 200,
  qaMockEmbeddingDimensions: Number(process.env.QA_MOCK_EMBEDDING_DIMENSIONS) || 32,
  qaEstimatedTokensPerAsk: Number(process.env.QA_ESTIMATED_TOKENS_PER_ASK) || 1000,
  qaMonthlyTokenBudget: Number(process.env.QA_MONTHLY_TOKEN_BUDGET) || 0,
  qaUserMonthlyTokenQuota: Number(process.env.QA_USER_MONTHLY_TOKEN_QUOTA) || 0,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
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
  allowedOrigins: String(process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  projectRoot,
};
