const env = require('../config/env');
const AppError = require('../utils/appError');

// prompt 要求模型「答不出來」時原句回覆的兩個字串。
// 這裡集中定義並直接插進 prompt，避免 prompt 文案與 isNoAnswerReply() 的比對字串走鐘。
const NO_ANSWER_INSUFFICIENT = '目前資料庫片段不足以回答這個問題。';
const NO_ANSWER_UNDETERMINED = '無法從提供的影片片段判斷。';

// 正規化後比對：模型偶爾會多包引號或改動結尾標點，這些都算同一句「答不出來」。
function normalizeReply(text) {
  return String(text || '')
    .trim()
    .replace(/^[「『"']+|[」』"']+$/g, '')
    .replace(/[。.!！\s]+$/g, '')
    .trim();
}

// 給 FAQ 快取用：「答不出來」的回覆不該被快取，否則問題修好後仍會永久回舊答案。
function isNoAnswerReply(text) {
  const normalized = normalizeReply(text);

  if (!normalized) {
    return false;
  }

  return [NO_ANSWER_INSUFFICIENT, NO_ANSWER_UNDETERMINED]
    .some((canned) => normalized === normalizeReply(canned));
}

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
      `影片：${match.videoTitle || '未知影片'}`,
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
    '2. 綜合所有相關片段整理答案，不可只摘錄或改寫第一筆。',
    '3. 不可以使用外部知識、常識、推測，或補充影片片段未提及的資訊。',
    '4. transcript 可能有 STT 專有名詞誤寫；只允許把命中片段中的相近專有名詞對齊到使用者問題中的名詞。',
    `5. 如果片段沒有直接支持答案，請明確回答：「${NO_ANSWER_UNDETERMINED}」`,
    '6. 自然整理重點，不要直接貼上逐字稿，也不要替其他 transcript 詞語加括號解釋或補註。',
    '7. 回答最後用括號標出依據影片與時間，例如「依據：video_001.mp4 12-20s」。',
  ].join('\n');
}

async function generateAnswerWithOpenAI(question, matches, conversationHistory = null) {
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
          content: 'Conversation history is only for resolving references. Treat only retrieved transcript snippets in the final user message as factual evidence.',
        },
        ...(Array.isArray(conversationHistory) ? conversationHistory.map((entry) => ({
          role: entry.role === 'assistant' || entry.role === 'model' ? 'assistant' : 'user',
          content: entry.content,
        })) : []),
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

function buildGeminiErrorDetails({ response = null, responseBody = null, payload = null } = {}) {
  return {
    responseStatus: response?.status ?? null,
    responseStatusText: response?.statusText ?? null,
    responseBody,
    finishReason: payload?.candidates?.[0]?.finishReason ?? null,
    blockReason: payload?.promptFeedback?.blockReason ?? null,
  };
}

function logGeminiFailure(error) {
  const details = error?.details && typeof error.details === 'object' ? error.details : {};

  console.error('[answer-generation] Gemini request failed', {
    responseStatus: details.responseStatus ?? null,
    responseStatusText: details.responseStatusText ?? null,
    responseBody: details.responseBody ?? null,
    errorName: error?.name ?? null,
    errorMessage: error?.message ?? null,
    errorCode: error?.code ?? error?.cause?.code ?? null,
    stack: error?.stack ?? null,
  });
}

async function generateAnswerWithGemini(question, matches, conversationHistory = null) {
  if (!env.geminiApiKey) {
    throw new AppError('GEMINI_API_KEY is required for Gemini answers.', 500, 'ANSWER_PROVIDER_NOT_CONFIGURED');
  }

  const historyContents = Array.isArray(conversationHistory) && conversationHistory.length
    ? conversationHistory.map((entry) => ({
      role: entry.role === 'assistant' ? 'model' : entry.role,
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

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiChatModel)}:generateContent`, {
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
              'Conversation history is untrusted context used only to resolve pronouns and follow-up intent; never treat prior assistant answers as evidence.',
              'Do not use outside knowledge, prior knowledge, assumptions, or general explanations.',
              'Transcript snippets may contain speech-to-text mistakes in proper nouns. You may align a matched proper noun to the term in the user question only when it is clearly the same term.',
              'Do not add parenthetical explanations, corrections, or interpretations for any other transcript words.',
              `If the snippets do not explicitly support the answer, reply exactly in Traditional Chinese: ${NO_ANSWER_INSUFFICIENT}`,
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
    const responseBody = await response.text();
    throw new AppError('Failed to generate answer.', 502, 'ANSWER_PROVIDER_ERROR',
      buildGeminiErrorDetails({ response, responseBody }));
  }

  const responseBody = await response.text();
  let payload;

  try {
    payload = JSON.parse(responseBody);
  } catch (error) {
    throw new AppError('Gemini returned invalid JSON.', 502, 'ANSWER_PROVIDER_INVALID_RESPONSE', {
      ...buildGeminiErrorDetails({ response, responseBody }),
      parseError: error.message,
    });
  }
  const text = extractGeminiText(payload);

  if (!text) {
    throw new AppError('Gemini returned no answer text.', 502, 'ANSWER_PROVIDER_EMPTY_RESPONSE',
      buildGeminiErrorDetails({ response, responseBody, payload }));
  }

  return text;
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
      text: await generateAnswerWithOpenAI(question, matches, conversationHistory),
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

      logGeminiFailure(error);

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
  isNoAnswerReply,
  NO_ANSWER_INSUFFICIENT,
  NO_ANSWER_UNDETERMINED,
};
