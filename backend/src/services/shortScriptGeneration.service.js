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

// 字幕是短字卡，不是口白的複製。模板要求每屏 4–7 字、靜音播放要能看懂；
// 實測模型會直接把整句口白塞進字幕欄，一整句話在畫面上讀不完。
// 上限放寬到 20 字（模板的 4–7 字是每屏，一拍可能跨兩屏），只擋明顯的整句複製。
const SUBTITLE_MAX_LENGTH = 20;

// 簡體字偵測。實測（2026-09-04，gemini-3.5-flash）即使系統指示要求繁體，
// 模型仍會零星混入簡體——例如把「經典」寫成「经典」。這門課是繁體教材，
// 口白最後要餵給中文語音複製，混入簡體會直接唸錯或顯示錯字。
//
// 這是**盡力而為的清單，不是完整的簡繁對照表**：只收錄常見於技術／教學文本、
// 且在繁體中不使用的簡體字。漏網的字仍需靠教師審核攔下。
// 發現新的漏網字時直接加進這個集合。
const SIMPLIFIED_ONLY = new Set([
  '经', '济', '发', '达', '国', '际', '认', '识', '过', '还', '这', '样', '们', '时',
  '间', '关', '键', '习', '数', '据', '电', '脑', '视', '觉', '简', '单', '复', '杂',
  '运', '训', '练', '选', '择', '设', '备', '图', '检', '测', '应', '该', '说', '实',
  '现', '开', '软', '网', '络', '结', '构', '级', '类', '别', '资', '讯', '处', '题',
  '问', '让', '两', '为', '会', '来', '东', '师', '课', '业', '专', '门', '进', '内',
  '边', '长', '书', '总', '论', '证', '断', '与', '师', '样',
]);

function findSimplifiedCharacters(text) {
  const found = new Set();
  for (const character of String(text || '')) {
    if (SIMPLIFIED_ONLY.has(character)) {
      found.add(character);
    }
  }
  return [...found];
}

/**
 * 口白與字幕必須是繁體中文（規格書 DR-18）。
 * 偵測到簡體字視為驗證失敗，與捏造引用走同一條退回重試的路徑。
 */
function validateTraditionalChinese(payload) {
  const errors = [];

  (payload?.shots || []).forEach((shot, index) => {
    const shotNo = shot?.shotNo ?? index + 1;
    for (const [field, label] of [['narration', '口白'], ['subtitle', '字幕']]) {
      const simplified = findSimplifiedCharacters(shot?.[field]);
      if (simplified.length) {
        errors.push(`鏡 ${shotNo}：${label}出現簡體字「${simplified.join('、')}」，必須改為繁體中文`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * 字幕必須是短字卡，不得直接複製口白（規格書 DR-19）。
 *
 * 只做客觀可判定的檢查：長度上限與「是否與口白完全相同」。
 * 「結尾不得有 CTA」屬於主觀判斷，只寫進系統指示，由教師審核把關。
 */
function validateSubtitles(payload) {
  const errors = [];

  (payload?.shots || []).forEach((shot, index) => {
    const shotNo = shot?.shotNo ?? index + 1;
    const subtitle = String(shot?.subtitle || '').trim();
    const narration = String(shot?.narration || '').trim();

    if (subtitle && subtitle === narration) {
      errors.push(`鏡 ${shotNo}：字幕與口白完全相同，字幕應是短字卡而非整句複製`);
      return;
    }

    if (subtitle.length > SUBTITLE_MAX_LENGTH) {
      errors.push(`鏡 ${shotNo}：字幕 ${subtitle.length} 字，超過上限 ${SUBTITLE_MAX_LENGTH} 字`);
    }
  });

  return { valid: errors.length === 0, errors };
}

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
  'Write all narration, subtitles, and settings in Traditional Chinese as used in Taiwan (zh-TW).',
  'NEVER output Simplified Chinese characters. For example write 經典 not 经典, 選擇 not 选择, 設備 not 设备.',
  'Every shot must declare basedOn: either an array of chunkId values taken verbatim from the evidence list, or the string "template".',
  `"template" is allowed ONLY on the final shot (shotNo ${SHOT_COUNT}), and that shot must be an open question that gives no answer the evidence has not confirmed.`,
  'The final shot must NOT contain any call to action. Never ask viewers to comment, like, subscribe, follow, or click. It ends on an open question and nothing else.',
  `The subtitle is a short on-screen card, NOT a copy of the narration. Keep every subtitle within ${SUBTITLE_MAX_LENGTH} characters and never make it identical to that shot's narration; it must stay readable when the video is watched on mute.`,
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

    // 解析失敗也要重試：模型偶爾會輸出截斷或多餘文字的 JSON，這跟捏造引用一樣
    // 是可以靠重試修正的暫時性問題，不該一次就放棄。
    let parsed;
    try {
      parsed = parseJsonPayload(lastRaw);
    } catch (error) {
      lastErrors = [`輸出不是可解析的 JSON：${error.message}`];
      logger.warn('shortScript.output_parse_failed', { attempt, length: lastRaw.length });

      if (attempt === maxAttempts) {
        error.details = { attempts: maxAttempts, errors: lastErrors, rawOutput: lastRaw };
        throw error;
      }
      continue;
    }

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
    const citation = validateCitations(normalized, evidence);
    const language = validateTraditionalChinese(normalized);
    const subtitles = validateSubtitles(normalized);
    const errors = [...citation.errors, ...language.errors, ...subtitles.errors];

    if (!errors.length) {
      return { payload: normalized, attempts: attempt, rawOutput: lastRaw };
    }

    lastErrors = errors;
      logger.warn('shortScript.validation_failed', { attempt, errors });
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
  validateTraditionalChinese,
  validateSubtitles,
  findSimplifiedCharacters,
  SUBTITLE_MAX_LENGTH,
  buildScriptPrompt,
  parseJsonPayload,
  normalizePayload,
  SHOT_COUNT,
};
