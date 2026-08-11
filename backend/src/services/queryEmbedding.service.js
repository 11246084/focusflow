const env = require('../config/env');
const AppError = require('../utils/appError');
const {
  GEMINI_EMBEDDING_2_MODEL,
  GEMINI_EMBEDDING_DIMENSIONS,
  buildGeminiSearchQueryText,
  isStableGeminiEmbeddingModel,
} = require('./embeddingContract.service');

const GEMINI_EMBEDDING_MODEL = GEMINI_EMBEDDING_2_MODEL;
const GEMINI_QUERY_EMBEDDING_DIMENSIONS = GEMINI_EMBEDDING_DIMENSIONS;

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeEmbeddingVector(values, expectedDimensions = null) {
  const vector = Array.isArray(values) ? values : [];

  if (!vector.length
      || (expectedDimensions != null && vector.length !== expectedDimensions)
      || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new AppError('Embedding provider returned an invalid vector.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new AppError('Embedding provider returned an invalid vector.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  // Query 與資料向量必須採用同一正規化規則；這裡固定輸出 unit L2 vector。
  return vector.map((value) => value / magnitude);
}

function buildMockEmbedding(text, dimensions = env.qaMockEmbeddingDimensions) {
  const normalized = normalizeText(text);
  const vector = Array.from({ length: dimensions }, () => 0);

  for (const [index, char] of Array.from(normalized).entries()) {
    const slot = char.charCodeAt(0) % dimensions;
    vector[slot] += 1 + ((index % 7) / 10);
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

async function embedWithOpenAI(text) {
  if (!env.openaiApiKey) {
    throw new AppError(
      'OPENAI_API_KEY is required for OpenAI embeddings.',
      500,
      'EMBEDDING_PROVIDER_NOT_CONFIGURED',
    );
  }

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: env.openaiEmbeddingModel,
      }),
    });
  } catch {
    throw new AppError('Failed to reach the OpenAI embedding provider.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  if (!response.ok) {
    throw new AppError('Failed to generate query embedding.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AppError('OpenAI embedding response was invalid JSON.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  return payload.data?.[0]?.embedding || [];
}

async function embedWithGemini(text) {
  if (!env.geminiApiKey) {
    throw new AppError(
      'GEMINI_API_KEY is required for Gemini embeddings.',
      500,
      'EMBEDDING_PROVIDER_NOT_CONFIGURED',
    );
  }

  const model = String(env.geminiEmbeddingModelName || '').trim();
  // 禁止透過設定退回 preview 模型，避免 query 與資料落在不同向量空間卻靜默失準。
  if (!isStableGeminiEmbeddingModel(model)) {
    throw new AppError(
      'GEMINI_EMBEDDING_MODEL_NAME must be the stable gemini-embedding-2 model.',
      500,
      'EMBEDDING_CONTRACT_INVALID',
    );
  }

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.geminiApiKey,
        },
        body: JSON.stringify({
          model: `models/${model}`,
          content: {
            parts: [{ text: buildGeminiSearchQueryText(text) }],
          },
          // Stable REST 以文字 instruction 取代 preview taskType，並以 snake_case 指定輸出維度。
          output_dimensionality: GEMINI_QUERY_EMBEDDING_DIMENSIONS,
        }),
      },
    );
  } catch {
    throw new AppError('Failed to reach the Gemini embedding provider.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  if (!response.ok) {
    throw new AppError('Failed to generate Gemini query embedding.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AppError('Gemini embedding response was invalid JSON.', 502, 'EMBEDDING_PROVIDER_ERROR');
  }

  return normalizeEmbeddingVector(payload.embedding?.values, GEMINI_QUERY_EMBEDDING_DIMENSIONS);
}

async function embedQuery(text) {
  if (env.qaQueryEmbeddingProvider === 'openai') return embedWithOpenAI(text);
  if (env.qaQueryEmbeddingProvider === 'gemini') return embedWithGemini(text);
  return buildMockEmbedding(text);
}

module.exports = {
  GEMINI_EMBEDDING_MODEL,
  GEMINI_QUERY_EMBEDDING_DIMENSIONS,
  embedWithGemini,
  embedQuery,
  buildMockEmbedding,
  normalizeEmbeddingVector,
};
