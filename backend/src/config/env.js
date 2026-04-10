const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/focusflow',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-local-env',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  demoSeedEnabled: String(process.env.DEMO_SEED_ENABLED || 'true').toLowerCase() === 'true',
  uploadDir: path.resolve(projectRoot, process.env.UPLOAD_DIR || 'uploads'),
  qaQueryEmbeddingProvider: process.env.QA_QUERY_EMBEDDING_PROVIDER || 'mock',
  qaAnswerProvider: process.env.QA_ANSWER_PROVIDER || 'template',
  qaVectorSearchMode: process.env.QA_VECTOR_SEARCH_MODE || 'memory',
  qaMatchLimit: Number(process.env.QA_MATCH_LIMIT) || 3,
  qaMockEmbeddingDimensions: Number(process.env.QA_MOCK_EMBEDDING_DIMENSIONS) || 32,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET || '',
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  processingWebhookSecret: process.env.PROCESSING_WEBHOOK_SECRET || '',
  projectRoot,
};
