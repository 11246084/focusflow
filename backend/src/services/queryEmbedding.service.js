const env = require('../config/env');
const AppError = require('../utils/appError');

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

  const model = 'gemini-embedding-2-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new AppError('Failed to generate Gemini query embedding.', 502, 'EMBEDDING_PROVIDER_ERROR', payload);
  }

  const payload = await response.json();
  return payload.embedding?.values || [];
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
  embedQuery,
  buildMockEmbedding,
};
