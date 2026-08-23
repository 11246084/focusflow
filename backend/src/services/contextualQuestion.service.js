const env = require('../config/env');

const FOLLOW_UP_MARKERS = /^(那|那麼|所以|而|它|它們|兩者|他|她|這|這個|這些|上述|前面|剛才|其中|跟|與|以及|還有|為什麼會這樣|為何如此|then|what about|how about|why is that|and\b)/i;
const PRONOUN_MARKERS = /(它|他|她|這個|這些|上述|前面|剛才|其中)/;

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && String(item.content || '').trim())
    .slice(-(env.maxConversationTurns * 2))
    .map((item) => ({ role: item.role, content: String(item.content).trim() }));
}

function previousUserQuestion(history) {
  return [...history].reverse().find((item) => item.role === 'user')?.content || '';
}

function extractTopic(question) {
  const text = String(question || '').trim().replace(/[？?。.!！]+$/g, '');
  const patterns = [
    /(?:什麼是|何謂|介紹|解釋|提到|關於)\s*([^，,。！？?]{2,40})/,
    /^([^，,。！？?]{2,40}?)(?:是什麼|有哪些|的優缺點|的缺點|的優點)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/^(老師怎麼|老師如何|課程中)/, '');
  }
  return text.length <= 60
    ? text
      .replace(/^(老師怎麼|老師如何|課程中|那麼|那|而|所以)/, '')
      .replace(/(?:呢|又如何|怎麼樣)$/g, '')
      .trim()
    : '';
}

function recentUserTopics(history) {
  const topics = [];
  for (const item of history.filter((entry) => entry.role === 'user')) {
    const topic = extractTopic(item.content);
    if (topic && !topics.includes(topic)) topics.push(topic);
  }
  return topics;
}

function isContextDependent(question) {
  const text = String(question || '').trim();
  return FOLLOW_UP_MARKERS.test(text) || PRONOUN_MARKERS.test(text);
}

function contextualizeQuestion({ recentConversationHistory, currentQuestion }) {
  const history = normalizeHistory(recentConversationHistory);
  const question = String(currentQuestion || '').trim();
  const previousQuestion = previousUserQuestion(history);
  const requiresContext = Boolean(previousQuestion && isContextDependent(question));

  if (!requiresContext) {
    return { requiresContext: false, standaloneQuestion: question };
  }

  const topics = recentUserTopics(history);
  const topic = topics.at(-1) || extractTopic(previousQuestion);
  if (!topic) {
    return { requiresContext: true, standaloneQuestion: `${previousQuestion}；追問：${question}` };
  }

  if (/(這兩個|兩者|它們)/.test(question) && topics.length >= 2) {
    const comparisonTopics = topics.slice(-2);
    return {
      requiresContext: true,
      standaloneQuestion: `課程中${comparisonTopics.join('與')}：${question.replace(/這兩個|兩者|它們/g, comparisonTopics.join('與'))}`,
    };
  }

  let rewritten = question.replace(PRONOUN_MARKERS, topic).replace(/^(那麼|那|所以|而)\s*/, '');
  if (/^(跟|與)/.test(rewritten)) {
    rewritten = `${topic}${rewritten}`;
  } else if (!rewritten.includes(topic)) {
    rewritten = `${topic}：${rewritten}`;
  }

  return {
    requiresContext: true,
    standaloneQuestion: `課程中${rewritten}`,
  };
}

module.exports = {
  contextualizeQuestion, normalizeHistory, extractTopic, isContextDependent, recentUserTopics,
};
