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
    .map((match, index) => [
      `片段 ${index + 1}`,
      `影片：${match.videoTitle || match.videoId || '未知影片'}`,
      `時間：${match.startSec}-${match.endSec}s`,
      `內容：${match.transcript}`,
    ].join('\n'))
    .join('\n');

  return [
    `問題：${question}`,
    '',
    '可用資料庫片段：',
    context,
    '',
    '回答規則：',
    '1. 只能根據「可用資料庫片段」回答。',
    '2. 不可以使用外部知識、常識、推測或補充說明。',
    '3. transcript 可能有 STT 專有名詞誤寫；只允許把命中片段中的相近專有名詞對齊到使用者問題中的名詞。',
    '4. 不可以替其他 transcript 詞語加括號解釋、改寫或補註；片段寫什麼就引用什麼。',
    '5. 如果片段沒有直接支持答案，請只回答：「目前資料庫片段不足以回答這個問題。」',
    '6. 回答最後用括號標出依據影片與時間，例如「依據：video_001.mp4 12-20s」。',
  ].join('\n');
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
            text: [
              'You are a retrieval-grounded QA assistant for course videos.',
              'Use only the transcript snippets provided in the user message.',
              'Do not use outside knowledge, prior knowledge, assumptions, or general explanations.',
              'Transcript snippets may contain speech-to-text mistakes in proper nouns. You may align a matched proper noun to the term in the user question only when it is clearly the same term.',
              'Do not add parenthetical explanations, corrections, or interpretations for any other transcript words.',
              'If the snippets do not explicitly support the answer, reply exactly in Traditional Chinese: 目前資料庫片段不足以回答這個問題。',
              'When answering, keep it concise and include the supporting video title and snippet time range.',
            ].join(' '),
          },
        ],
      },
      contents,
      generationConfig: {
        responseMimeType: 'text/plain',
        temperature: 0,
        topP: 0.1,
        candidateCount: 1,
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
