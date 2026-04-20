const env = require('../config/env');
const AppError = require('../utils/appError');

function buildTemplateAnswer(question, matches) {
  const [topMatch] = matches;

  if (!topMatch) {
    return '目前找不到足夠相關的影片片段，請換個問法或確認課程是否已完成索引。';
  }

  const excerpt = topMatch.transcript.length > 140
    ? `${topMatch.transcript.slice(0, 140)}...`
    : topMatch.transcript;

  return `根據目前最相關的課程片段，這個問題和影片內容最接近的說明是：${excerpt}`;
}

function buildAnswerResult({ text, provider, fallback = null }) {
  return {
    text,
    provider,
    fallback,
  };
}

function buildPrompt(question, matches) {
  const context = matches
    .map((match, index) => `片段 ${index + 1} (${match.startSec}-${match.endSec}s): ${match.transcript}`)
    .join('\n');

  return `問題：${question}\n\n影片片段：\n${context}`;
}

async function generateAnswerWithOpenAI(question, matches) {
  if (!env.openaiApiKey) {
    throw new AppError('OPENAI_API_KEY is required for OpenAI answers.', 500, 'ANSWER_PROVIDER_NOT_CONFIGURED');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: env.openaiChatModel,
      messages: [
        {
          role: 'system',
          content: 'You answer questions about a course video using only the provided transcript snippets.',
        },
        {
          role: 'user',
          content: buildPrompt(question, matches),
        },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new AppError('Failed to generate answer.', 502, 'ANSWER_PROVIDER_ERROR', payload);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content?.trim() || buildTemplateAnswer(question, matches);
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => part?.text || '')
    .join('')
    .trim();
}

async function generateAnswerWithGemini(question, matches, conversationHistory = null) {
  if (!env.geminiApiKey) {
    throw new AppError('GEMINI_API_KEY is required for Gemini answers.', 500, 'ANSWER_PROVIDER_NOT_CONFIGURED');
  }

  const historyContents = Array.isArray(conversationHistory) && conversationHistory.length
    ? conversationHistory.map((entry) => ({
      role: entry.role,
      parts: [{ text: entry.content }],
    }))
    : [];

  const contents = [
    ...historyContents,
    {
      role: 'user',
      parts: [{ text: buildPrompt(question, matches) }],
    },
  ];

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.geminiChatModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.geminiApiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: 'You answer questions about a course video using only the provided transcript snippets. Format your answer as a numbered list when listing items or steps; use plain prose only for single-sentence answers. If the snippets are insufficient, say so briefly. Keep the answer concise and grounded in the snippets.',
          },
        ],
      },
      contents,
      generationConfig: {
        responseMimeType: 'text/plain',
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new AppError('Failed to generate answer.', 502, 'ANSWER_PROVIDER_ERROR', payload);
  }

  const payload = await response.json();
  return extractGeminiText(payload) || buildTemplateAnswer(question, matches);
}

async function generateAnswer(question, matches, conversationHistory = null) {
  if (!matches.length) {
    return buildAnswerResult({
      text: buildTemplateAnswer(question, matches),
      provider: 'template',
    });
  }

  if (env.qaAnswerProvider === 'template') {
    return buildAnswerResult({
      text: buildTemplateAnswer(question, matches),
      provider: 'template',
    });
  }

  if (env.qaAnswerProvider === 'openai') {
    return buildAnswerResult({
      text: await generateAnswerWithOpenAI(question, matches),
      provider: 'openai',
    });
  }

  if (env.qaAnswerProvider === 'gemini') {
    try {
      return buildAnswerResult({
        text: await generateAnswerWithGemini(question, matches, conversationHistory),
        provider: 'gemini',
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'ANSWER_PROVIDER_NOT_CONFIGURED') {
        throw error;
      }

      return buildAnswerResult({
        text: buildTemplateAnswer(question, matches),
        provider: 'template',
        fallback: {
          stage: 'answer',
          from: 'gemini',
          to: 'template',
          code: error.code || 'ANSWER_PROVIDER_ERROR',
          message: 'Gemini answer generation failed, so the backend used the template answer fallback.',
        },
      });
    }
  }

  throw new AppError(
    `Unsupported QA answer provider "${env.qaAnswerProvider}".`,
    500,
    'QA_RUNTIME_MISCONFIGURED',
    {
      answerProvider: env.qaAnswerProvider,
    },
  );
}

module.exports = {
  generateAnswer,
  buildTemplateAnswer,
  buildAnswerResult,
};
