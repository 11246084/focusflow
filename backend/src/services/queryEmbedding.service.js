const env = require('../config/env');
const AppError = require('../utils/appError');

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const GEMINI_QUERY_EMBEDDING_DIMENSIONS = 3072;

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
  return vector.map((value) => value / magnitude);
}

function buildMockEmbedding(text, dimensions = env.qaMockEmbeddingDimensions) {
  const normalized = normalizeText(text);
  const vector = Array.from({ length: dimensions }, () => 0);

  for (const [index, char] of Array.from(normalized).entries()) {
    const code = char.charCodeAt(0);
    const slot = code % dimensions;
    vector[slot] += 1 + ((index % 7) / 10);
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

async function embedWithOpenAI(text) {
  if (!env.openaiApiKey) {
    throw new AppError('OPENAI_API_KEY is required for OpenAI embeddings.', 500, 'EMBEDDING_PROVIDER_NOT_CONFIGURED');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
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

  if (!response.ok) {
    const payload = await response.text();
    throw new AppError('Failed to generate query embedding.', 502, 'EMBEDDING_PROVIDER_ERROR', payload);
  }

  const payload = await response.json();
  return payload.data?.[0]?.embedding || [];
}

async function embedWithGemini(text) {
  if (!env.geminiApiKey) {
    throw new AppError('GEMINI_API_KEY is required for Gemini embeddings.', 500, 'EMBEDDING_PROVIDER_NOT_CONFIGURED');
  }

  const model = GEMINI_EMBEDDING_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      // Parent documents use RETRIEVAL_DOCUMENT; queries must use the paired query task in the same 3072-D space.
      embedContentConfig: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: GEMINI_QUERY_EMBEDDING_DIMENSIONS,
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new AppError('Failed to generate Gemini query embedding.', 502, 'EMBEDDING_PROVIDER_ERROR', payload);
  }

  const payload = await response.json();
  return normalizeEmbeddingVector(payload.embedding?.values, GEMINI_QUERY_EMBEDDING_DIMENSIONS);
}

async function embedQuery(text) {
  if (env.qaQueryEmbeddingProvider === 'openai') {
    return embedWithOpenAI(text);
  }

  if (env.qaQueryEmbeddingProvider === 'gemini') {
    return embedWithGemini(text);
  }

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
