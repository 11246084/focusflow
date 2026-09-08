const AppError = require('../utils/appError');
const env = require('../config/env');
const logger = require('../utils/logger');

// 短影片腳本生成與引用驗證（規格書 WO-05 / R-01 / R-06 / DR-07）。
//
// 這個模組最重要的不是「能生出腳本」——LLM 當然生得出文字——而是**生完之後的驗證**：
// 每一拍宣告的依據（basedOn）必須真的存在於本次證據包，否則整份退回重生。
// 這是唯一能讓「AI 生成」與「追得回逐字稿」同時成立的機制（R-01）。

const ARC_ROLES = [
  'hook', 'context', 'reveal', 'deepen', 'evidence', 'climax', 'conclusion', 'ending',
];

const SHOT_COUNT = 8;
const TEMPLATE_BASIS = 'template';

function buildEvidenceBlock(evidence) {
  return evidence
    .map((item) => [
      `[${item.code}] chunkId=${item.chunkId}`,
      `time=${item.startSec}-${item.endSec}s`,
      `transcript=${item.rawText}`,
    ].join(' | '))
    .join('\n');
}

function buildScriptPrompt({ topic, evidence, usedMetaphors = [] }) {
  const avoid = usedMetaphors.length
    ? `已被同課程其他腳本用過的視覺隱喻（不可重複）：${usedMetaphors.join('、')}`
    : '同課程尚無其他腳本，視覺隱喻不受既有選擇限制。';

  return [
    `主題：${topic}`,
    '',
    '可用證據（只能用這些，不得引用未列出的 chunkId）：',
    buildEvidenceBlock(evidence),
    '',
    avoid,
    '',
    `請輸出 ${SHOT_COUNT} 拍的短影片腳本 JSON。`,
  ].join('\n');
}

const SYSTEM_INSTRUCTION = [
  'You write 30-second educational short-video scripts grounded ONLY in the provided transcript evidence.',
  'Write all narration, subtitles, and settings in Traditional Chinese.',
  'Every shot must declare basedOn: either an array of chunkId values taken verbatim from the evidence list, or the string "template".',
  `"template" is allowed ONLY on the final shot (shotNo ${SHOT_COUNT}), and that shot must be an open question that gives no answer the evidence has not confirmed.`,
  'Never invent facts, names, numbers, or claims that are absent from the evidence.',
  'The transcript comes from speech-to-text and contains misspelled proper nouns. Write the correct name in the narration, but never change the chunkId you cite.',
  'The narrative arc is HOOK → context → reveal → deepen → evidence → climax → conclusion → ending.',
  'The arc depends on a reversal that already exists in the evidence (a statement of the form "you think X, but actually not X").',
  'If no evidence snippet contains such a reversal, set arcApplicable to false and leave shots as an empty array. Do NOT invent a reversal.',
  'Provide 2 to 3 distinct visual metaphor options; each has three stages s1, s2, s3 describing abstract light/shape motion only, never text or logos.',
  'Return ONLY a JSON object, no markdown fences, with this shape:',
  '{"arcApplicable":boolean,"reversalBasedOn":string[],"globalSettings":{"coreEvent":string,"coreView":string,"audienceAssumption":string,"audienceTakeaway":string,"targetAudience":string},'
    + '"writingFourQuestions":string[],"visualMetaphorOptions":[{"label":string,"s1":string,"s2":string,"s3":string}],'
    + '"shots":[{"shotNo":number,"arcRole":string,"timeRange":string,"narration":string,"subtitle":string,"editing":string,"sfx":string,"basedOn":string[]|"template"}]}',
].join(' ');

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts.map((part) => part?.text || '').join('').trim();
}

// 模型偶爾會用 ```json 包起來，或在 JSON 前後多寫一句話。
function parseJsonPayload(rawText) {
  const trimmed = String(rawText || '').trim();
  const withoutFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new AppError('Generation output is not JSON.', 502, 'SHORT_SCRIPT_OUTPUT_INVALID');
  }

  try {
    return JSON.parse(withoutFence.slice(start, end + 1));
  } catch (error) {
    throw new AppError('Generation output is not valid JSON.', 502, 'SHORT_SCRIPT_OUTPUT_INVALID');
  }
}

async function callGemini(prompt) {
  // fail-fast：provider 沒設定就直接錯，不得靜默 fallback 成模板輸出（規格書 7.2）。
  if (!env.geminiApiKey) {
    throw new AppError(
      'GEMINI_API_KEY is required for short script generation.',
      500,
      'SHORT_SCRIPT_PROVIDER_NOT_CONFIGURED',
    );
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiChatModel)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    },
  );

  if (!response.ok) {
    throw new AppError('Short script generation provider failed.', 502, 'SHORT_SCRIPT_GENERATION_FAILED');
  }

  return extractGeminiText(await response.json());
}

/**
 * 引用驗證（規格書 R-01 / 附錄 E）。
 *
 * 不接受部分採用：同一次生成裡只要出現一個捏造的引用，就代表模型當次的 grounding
 * 已經不可信，其餘拍次沒有理由被當成正確的。
 */
function validateCitations(payload, evidence) {
  const allowed = new Set(evidence.map((item) => String(item.chunkId)));
  const errors = [];
  const shots = Array.isArray(payload?.shots) ? payload.shots : [];

  if (shots.length !== SHOT_COUNT) {
    errors.push(`shots 應有 ${SHOT_COUNT} 拍，實際 ${shots.length} 拍`);
  }

  shots.forEach((shot, index) => {
    const shotNo = shot?.shotNo ?? index + 1;
    const basedOn = shot?.basedOn;

    if (basedOn === TEMPLATE_BASIS) {
      if (shotNo !== SHOT_COUNT) {
        errors.push(`鏡 ${shotNo}：template 只允許用在最後一拍`);
      }
      return;
    }

    if (!Array.isArray(basedOn) || !basedOn.length) {
      errors.push(`鏡 ${shotNo}：缺少 basedOn`);
      return;
    }

    for (const chunkId of basedOn) {
      if (!allowed.has(String(chunkId))) {
        errors.push(`鏡 ${shotNo}：引用了證據包外的 chunkId「${chunkId}」`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

function normalizePayload(payload) {
  return {
    globalSettings: payload?.globalSettings || null,
    writingFourQuestions: Array.isArray(payload?.writingFourQuestions) ? payload.writingFourQuestions : [],
    visualMetaphorOptions: Array.isArray(payload?.visualMetaphorOptions) ? payload.visualMetaphorOptions : [],
    shots: (Array.isArray(payload?.shots) ? payload.shots : []).map((shot, index) => ({
      shotNo: shot?.shotNo ?? index + 1,
      arcRole: ARC_ROLES.includes(shot?.arcRole) ? shot.arcRole : (ARC_ROLES[index] || null),
      timeRange: shot?.timeRange || null,
      narration: shot?.narration || '',
      subtitle: shot?.subtitle || '',
      editing: shot?.editing || '',
      sfx: shot?.sfx || '',
      basedOn: shot?.basedOn === TEMPLATE_BASIS ? TEMPLATE_BASIS : (shot?.basedOn || []),
    })),
    reversalBasedOn: Array.isArray(payload?.reversalBasedOn) ? payload.reversalBasedOn : [],
  };
}

/**
 * 生成腳本並驗證引用。
 *
 * 重試上限見 DR-07：重試 2 次（共 3 次生成），仍失敗回 SHORT_SCRIPT_CITATION_INVALID
 * 並保留最後一次原始輸出——沒有原始輸出就無法診斷失敗是 prompt 問題還是證據問題。
 *
 * @returns {Promise<{payload: object, attempts: number, rawOutput: string}>}
 */
async function generateScript({ topic, evidence, usedMetaphors = [], feedback = null } = {}) {
  if (!Array.isArray(evidence) || !evidence.length) {
    throw new AppError('Evidence is required to generate a script.', 422, 'SHORT_SCRIPT_EVIDENCE_EMPTY');
  }

  const basePrompt = buildScriptPrompt({ topic, evidence, usedMetaphors });
  const maxAttempts = env.shortScriptGenerationRetryLimit + 1;

  let lastRaw = '';
  let lastErrors = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const prompt = [
      basePrompt,
      feedback ? `\n教師回饋（請據此調整敘事，但依據仍限於上列證據）：${feedback}` : '',
      lastErrors.length
        ? `\n上一次生成的引用驗證失敗，請修正後重新輸出：\n${lastErrors.join('\n')}`
        : '',
    ].join('');

    lastRaw = await callGemini(prompt);
    const parsed = parseJsonPayload(lastRaw);

    // 弧線適用性判定（規格書 R-06 / DR-12 第 4 層）。
    // 證據沒有轉折句時，硬套 8 拍弧線只會逼出假反轉或空轉的鉤子。
    if (parsed?.arcApplicable === false) {
      throw new AppError(
        'The frozen evidence contains no reversal, so the 8-shot arc does not apply.',
        422,
        'SHORT_SCRIPT_ARC_NOT_APPLICABLE',
      );
    }

    const normalized = normalizePayload(parsed);
    const validation = validateCitations(normalized, evidence);

    if (validation.valid) {
      return { payload: normalized, attempts: attempt, rawOutput: lastRaw };
    }

    lastErrors = validation.errors;
    logger.warn('shortScript.citation_validation_failed', { attempt, errors: validation.errors });
  }

  const error = new AppError(
    'Generated script cited chunk ids outside the frozen evidence.',
    502,
    'SHORT_SCRIPT_CITATION_INVALID',
  );
  // 保留最後一次原始輸出供人工檢視（DR-07）。
  error.details = { attempts: maxAttempts, errors: lastErrors, rawOutput: lastRaw };
  throw error;
}

module.exports = {
  generateScript,
  validateCitations,
  buildScriptPrompt,
  parseJsonPayload,
  normalizePayload,
  SHOT_COUNT,
};
