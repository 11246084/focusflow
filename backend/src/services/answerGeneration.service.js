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

async function generateAnswerWithOpenAI(question, matches) {
  if (!env.openaiApiKey) {
    throw new AppError('OPENAI_API_KEY is required for OpenAI answers.', 500, 'ANSWER_PROVIDER_NOT_CONFIGURED');
  }

  const context = matches
    .map((match, index) => `片段 ${index + 1} (${match.startSec}-${match.endSec}s): ${match.transcript}`)
    .join('\n');

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
          content: `問題：${question}\n\n片段內容：\n${context}`,
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

async function generateAnswer(question, matches) {
  if (!matches.length) {
    return buildTemplateAnswer(question, matches);
  }

  if (env.qaAnswerProvider === 'openai') {
    return generateAnswerWithOpenAI(question, matches);
  }

  return buildTemplateAnswer(question, matches);
}

module.exports = {
  generateAnswer,
};
