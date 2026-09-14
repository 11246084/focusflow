const AppError = require('../utils/appError');
const env = require('../config/env');
const logger = require('../utils/logger');

// 短影片腳本生成與引用驗證（規格書 WO-05 / R-01 / R-06 / DR-07）。
//
// 這個模組最重要的不是「能生出腳本」——LLM 當然生得出文字——而是**生完之後的驗證**：
// 每一拍宣告的依據（basedOn）必須真的存在於本次證據包，否則整份退回重生。
// 這是唯一能讓「AI 生成」與「追得回逐字稿」同時成立的機制（R-01）。

// 8 拍的固定規則，逐項對應 docs/30_Features/Short_Video/examples/10-teacher-avatar-metaphor.md §5。
//
// 名稱、時間、剪輯節奏、B-roll 用哪一段都是模板的手法卡，不是創作選擇——依 DR-01
// 它們是常數，由程式依位置寫入，不交給模型。實測（2026-09-10）交給模型時，它把
// 時間平均切成每拍 4 秒，抹掉了模板刻意的節奏：反轉給最多空間（6 秒）、結尾 1 秒收掉。
//
// 第 4 拍原本叫 deepen（加深），模型照名字寫成「補充資訊」，整條弧線最關鍵的反轉因此
// 沒有位置。改名 reversal，並由 validateReversal 強制它引用資料庫原句的轉折。
const BEAT_PLAN = [
  {
    role: 'hook', timeRange: '0:00–0:03', seconds: 3, cut: '快切', stage: null,
    guide: 'State the core conflict immediately, no background. Finish in 3 seconds: about 10-14 Chinese characters. Default formula is counter-intuitive:「你以為X？其實Y。」Build it from a contrast the evidence actually contains.',
  },
  {
    role: 'context', timeRange: '0:03–0:08', seconds: 5, cut: '正常', stage: 'S1',
    guide: 'Set up the background. The original student question fits here as resonance, not in the opening.',
  },
  {
    role: 'reveal', timeRange: '0:08–0:13', seconds: 5, cut: '快切', stage: 'S2',
    stageNote: '以 S1 為 @Image1 鎖定機位與光線',
    guide: 'Answer the first question. One idea only.',
  },
  {
    role: 'reversal', timeRange: '0:13–0:19', seconds: 6, cut: '突停｜音樂抽掉一拍', stage: 'S2',
    stageNote: '不換素材，用亮度／閃爍變化表示轉折',
    guide: 'THE REVERSAL. Overturn what shot 3 just established, not merely add a "but". Use the reversal sentence that already exists in the evidence.',
  },
  {
    role: 'evidence', timeRange: '0:19–0:23', seconds: 4, cut: '快切', stage: 'S2',
    guide: 'Back the reversal with a concrete fact from the evidence.',
  },
  {
    role: 'climax', timeRange: '0:23–0:27', seconds: 4, cut: '緩推放大', stage: 'S3',
    guide: 'Reveal the core point and answer the hook from shot 1. The most important moment.',
  },
  {
    role: 'conclusion', timeRange: '0:27–0:29', seconds: 2, cut: '放慢', stage: 'S3',
    stageNote: '不換素材',
    guide: 'Restate the most counter-intuitive line. No new information.',
  },
  {
    role: 'ending', timeRange: '0:29–0:30', seconds: 1, cut: '留白', stage: 'S3',
    stageNote: '定格畫面淡出',
    guide: 'An open question that gives no answer the evidence has not confirmed. No call to action.',
  },
];

const ARC_ROLES = BEAT_PLAN.map((beat) => beat.role);
const SHOT_COUNT = BEAT_PLAN.length;
const REVERSAL_SHOT_NO = ARC_ROLES.indexOf('reversal') + 1;
// 鏡 01 的素材是模板裡唯一留白的選擇（S【＿】）；模型沒給或給錯時用 V5 的選擇。
const DEFAULT_OPENING_STAGE = 'S2';

// 「埋問題」是把觀眾拉到下一拍的裝置（模板每拍的〔剪輯〕都有）。模板與 V5 範例
// 在鏡 01–06 都有，鏡 07–08 範例省略（收尾本身就是問句），只強制前 6 拍。
const HOOK_QUESTION_REQUIRED_THROUGH = 6;

// 模板 §3 的四題是固定的創作問題，模型只填答案。實測交給模型自己出題時，
// 它寫成內容大綱（「如何用 T5 示範…」），完全失去這一節作為寫作計畫的用途。
const WRITING_PLAN_QUESTIONS = {
  curiosity: '我要讓觀眾「想知道什麼」',
  delayedAnswer: '我要故意延後哪個答案',
  reversal: '中途最大的反轉是什麼',
  takeaway: '最後觀眾應該記住哪一句話',
};
const WRITING_PLAN_KEYS = Object.keys(WRITING_PLAN_QUESTIONS);
const STAGE_KEYS = ['s1', 's2', 's3'];
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

/**
 * 第 4 拍必須是反轉，而且反轉必須來自資料庫原句（規格書 R-06）。
 *
 * 只寫在 prompt 裡不夠：模型會把第 4 拍寫成補充資訊，形式上 8 拍都在，
 * 弧線卻沒有轉折。這裡把「反轉落在第 4 拍」變成可檢查的事實——
 * 模型標出的轉折片段（reversalBasedOn）必須真的出現在第 4 拍的依據裡。
 */
function validateReversal(payload, evidence) {
  const errors = [];
  const allowed = new Set(evidence.map((item) => String(item.chunkId)));
  const reversalIds = (payload?.reversalBasedOn || []).map(String);

  if (!reversalIds.length) {
    errors.push('缺少 reversalBasedOn：弧線依賴資料庫原句裡現成的轉折，必須標出是哪幾個片段');
    return { valid: false, errors };
  }

  for (const chunkId of reversalIds) {
    if (!allowed.has(chunkId)) {
      errors.push(`reversalBasedOn 引用了證據包外的 chunkId「${chunkId}」`);
    }
  }

  const reversalShot = (payload?.shots || [])[REVERSAL_SHOT_NO - 1];
  const cited = Array.isArray(reversalShot?.basedOn) ? reversalShot.basedOn.map(String) : [];
  if (!cited.some((chunkId) => reversalIds.includes(chunkId))) {
    errors.push(`鏡 ${REVERSAL_SHOT_NO}（反轉）沒有引用 reversalBasedOn 標出的轉折片段，反轉必須落在這一拍`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 模板要求、但模型容易漏掉的欄位（寫作四題答案、隱喻對應、埋問題）。
 *
 * 缺這些欄位腳本仍「看起來完整」，所以不擋就會一直漏——實測第一版就全漏了。
 * 走同一條退回重試的路徑。
 */
function validateTemplateFields(payload) {
  const errors = [];

  for (const key of WRITING_PLAN_KEYS) {
    if (!payload?.writingPlan?.[key]) {
      errors.push(`寫作四題缺少「${WRITING_PLAN_QUESTIONS[key]}」的答案`);
    }
  }

  for (const key of STAGE_KEYS) {
    if (!payload?.stageMeanings?.[key]) {
      errors.push(`stageMeanings 缺少 ${key.toUpperCase()} 對應的概念`);
    }
  }

  const options = payload?.visualMetaphorOptions || [];
  if (!options.length) {
    errors.push('缺少 visualMetaphorOptions');
  }
  options.forEach((option, index) => {
    if (!option?.rationale) {
      errors.push(`視覺隱喻第 ${index + 1} 組缺少「為什麼用這個隱喻」`);
    }
  });

  (payload?.shots || []).forEach((shot, index) => {
    if (index < HOOK_QUESTION_REQUIRED_THROUGH && !shot?.hookQuestion) {
      errors.push(`鏡 ${index + 1}：缺少埋問題（hookQuestion）`);
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
  `The script has exactly ${SHOT_COUNT} shots with FIXED roles and durations assigned by position. Do not output arcRole or timeRange.`,
  ...BEAT_PLAN.map((beat, index) => `Shot ${index + 1} (${beat.role}, ${beat.seconds}s): ${beat.guide}`),
  'Total narration is about 150-190 Chinese characters, not counting English proper nouns. Size each line to its shot duration.',
  'The arc depends on a reversal that already exists in the evidence (a statement of the form "you think X, but actually not X").',
  `List the chunkIds containing that reversal in reversalBasedOn, and shot ${REVERSAL_SHOT_NO} MUST cite at least one of them in basedOn.`,
  'If no evidence snippet contains such a reversal, set arcApplicable to false and leave shots as an empty array. Do NOT invent a reversal.',
  'Every shot has hookQuestion: the unanswered question the viewer is left with after this shot, which the next shot resolves. Traditional Chinese, under 15 characters.',
  'writingPlan answers four fixed planning questions: curiosity = what the viewer will want to know; delayedAnswer = which answer is deliberately withheld until shot 6; reversal = the biggest mid-video reversal, taken from the evidence; takeaway = the one sentence the viewer should remember, which shot 7 restates.',
  'stageMeanings states the concept each visual stage stands for. S1 appears in shot 2, S2 in shots 3-5 (the idea that gets overturned), S3 in shots 6-8 (the resolution).',
  'Provide 2 to 3 distinct visual metaphor options. All options depict the SAME three stageMeanings and differ only in visual form. Each stage describes abstract light/shape motion only, never text or logos. Each option has a one-sentence rationale explaining why the imagery fits the core view.',
  'For shot 1 only, choose brollStage "S1", "S2" or "S3" as the opening image. brollNote (optional, any shot) describes only changes in brightness, position, count or arrangement, so it applies to every metaphor option.',
  'Return ONLY a JSON object, no markdown fences, with this shape:',
  '{"arcApplicable":boolean,"reversalBasedOn":string[],"globalSettings":{"coreEvent":string,"coreView":string,"audienceAssumption":string,"audienceTakeaway":string,"targetAudience":string},'
    + '"writingPlan":{"curiosity":string,"delayedAnswer":string,"reversal":string,"takeaway":string},'
    + '"stageMeanings":{"s1":string,"s2":string,"s3":string},'
    + '"visualMetaphorOptions":[{"label":string,"s1":string,"s2":string,"s3":string,"rationale":string}],'
    + '"shots":[{"shotNo":number,"narration":string,"subtitle":string,"hookQuestion":string,"brollStage":string,"brollNote":string,"sfx":string,"basedOn":string[]|"template"}]}',
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

function trimText(value) {
  return String(value ?? '').trim();
}

function normalizeStage(value) {
  const stage = trimText(value).toUpperCase();
  return /^S[1-3]$/.test(stage) ? stage : null;
}

function pickTrimmed(source, keys) {
  return keys.reduce((result, key) => {
    result[key] = trimText(source?.[key]);
    return result;
  }, {});
}

function normalizePayload(payload) {
  return {
    globalSettings: payload?.globalSettings || null,
    writingPlan: pickTrimmed(payload?.writingPlan, WRITING_PLAN_KEYS),
    stageMeanings: pickTrimmed(payload?.stageMeanings, STAGE_KEYS),
    visualMetaphorOptions: (Array.isArray(payload?.visualMetaphorOptions) ? payload.visualMetaphorOptions : [])
      .map((option) => pickTrimmed(option, ['label', ...STAGE_KEYS, 'rationale'])),
    // 角色、時間、剪輯節奏、素材都依位置寫入（BEAT_PLAN），模型給的一律不採用。
    shots: (Array.isArray(payload?.shots) ? payload.shots : []).map((shot, index) => {
      const beat = BEAT_PLAN[index] || null;
      return {
        shotNo: index + 1,
        arcRole: beat?.role || null,
        timeRange: beat?.timeRange || null,
        cut: beat?.cut || '',
        brollStage: beat?.stage || normalizeStage(shot?.brollStage) || DEFAULT_OPENING_STAGE,
        brollNote: [beat?.stageNote, trimText(shot?.brollNote)].filter(Boolean).join('；'),
        narration: shot?.narration || '',
        subtitle: shot?.subtitle || '',
        hookQuestion: trimText(shot?.hookQuestion),
        sfx: shot?.sfx || '',
        basedOn: shot?.basedOn === TEMPLATE_BASIS ? TEMPLATE_BASIS : (shot?.basedOn || []),
      };
    }),
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
    const reversal = validateReversal(normalized, evidence);
    const templateFields = validateTemplateFields(normalized);
    const errors = [
      ...citation.errors,
      ...language.errors,
      ...subtitles.errors,
      ...reversal.errors,
      ...templateFields.errors,
    ];

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
  validateReversal,
  validateTemplateFields,
  BEAT_PLAN,
  WRITING_PLAN_QUESTIONS,
  validateTraditionalChinese,
  validateSubtitles,
  findSimplifiedCharacters,
  SUBTITLE_MAX_LENGTH,
  buildScriptPrompt,
  parseJsonPayload,
  normalizePayload,
  SHOT_COUNT,
};
