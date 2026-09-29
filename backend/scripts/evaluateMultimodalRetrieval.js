#!/usr/bin/env node

// 唯讀評測 video_segments_text / video_segments_video 的 Atlas Vector Search 表現。
//
// PowerShell（於 backend/ 下）：
//   $env:RETRIEVAL_EVAL_READONLY_MONGODB_URI='<dedicated read-only URI>'
//   $env:QA_QUERY_EMBEDDING_PROVIDER='gemini'
//   node scripts/evaluateMultimodalRetrieval.js
//
// 選用參數：
//   --questions <path>             題集 JSON
//   --json-out <path>              JSON 報告
//   --markdown-out <path>          Markdown 報告
//   --score-postprocessor-module   匯出 postprocessScores(payload) 的 CommonJS 模組
//                                  payload.runs 含整批 question/queryVector/rankings；
//                                  回傳與 runs 等長的 {text:number[],video:number[]}。
//                                  中心化、CSLS 等實驗皆由此單一接點置換分數。
//
// 安全邊界：只接受目標 database 上「唯一 read role」的帳號；Mongo command
// monitoring 一旦觀察到寫入命令就中止。報告只寫本機檔案，不寫回資料庫。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const env = require('../src/config/env');
const { embedQuery } = require('../src/services/queryEmbedding.service');

const TOP_K = 15;
const NUM_CANDIDATES = 75;
const RRF_K = 60;
const TEXT_COLLECTION = 'video_segments_text';
const VIDEO_COLLECTION = 'video_segments_video';
const TEXT_INDEX = 'text_embedding_index';
const VIDEO_INDEX = 'video_embedding_index';
const METRIC_K_VALUES = Object.freeze([1, 3, 5]);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_QUESTIONS_PATH = path.join(
  REPO_ROOT,
  'docs',
  'reports',
  '2026-09-29_影像文字檢索評測題集.json',
);
const DEFAULT_JSON_OUT = path.join(
  REPO_ROOT,
  'docs',
  'reports',
  '2026-09-29_影像文字檢索評測結果.json',
);
const DEFAULT_MARKDOWN_OUT = path.join(
  REPO_ROOT,
  'docs',
  'reports',
  '2026-09-29_影像文字檢索評測結果.md',
);

const WRITE_COMMANDS = new Set([
  'insert', 'update', 'delete', 'findandmodify', 'bulkwrite', 'create',
  'createindexes', 'dropindexes', 'drop', 'dropdatabase', 'collmod', 'renamecollection',
]);
const READ_COMMANDS = new Set([
  'aggregate', 'getmore', 'connectionstatus', 'ping', 'endsessions',
]);

class RetrievalEvaluationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RetrievalEvaluationError';
    this.code = code;
    this.details = details;
  }
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    questionsPath: DEFAULT_QUESTIONS_PATH,
    jsonOutPath: DEFAULT_JSON_OUT,
    markdownOutPath: DEFAULT_MARKDOWN_OUT,
    scorePostprocessorModule: null,
  };
  const valueOptions = new Map([
    ['--questions', 'questionsPath'],
    ['--json-out', 'jsonOutPath'],
    ['--markdown-out', 'markdownOutPath'],
    ['--score-postprocessor-module', 'scorePostprocessorModule'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const optionName = valueOptions.get(arg);
    if (!optionName || !argv[index + 1]) {
      throw new RetrievalEvaluationError(
        `Unknown or incomplete option: ${arg}`,
        'RETRIEVAL_EVAL_INVALID_ARGUMENT',
      );
    }
    options[optionName] = path.resolve(argv[index + 1]);
    index += 1;
  }
  return options;
}

function usageText() {
  return [
    'Usage: node scripts/evaluateMultimodalRetrieval.js [options]',
    '',
    'Required environment:',
    '  RETRIEVAL_EVAL_READONLY_MONGODB_URI  Dedicated user with only read on target DB',
    '  QA_QUERY_EMBEDDING_PROVIDER           Provider used by queryEmbedding.embedQuery',
    '',
    'Options:',
    '  --questions <path>',
    '  --json-out <path>',
    '  --markdown-out <path>',
    '  --score-postprocessor-module <path>',
  ].join('\n');
}

function createCommandMonitor() {
  const state = { mongoReads: 0, mongoWrites: 0, writeCommands: [] };
  return {
    observe(event = {}) {
      const commandName = String(event.commandName || '').toLowerCase();
      if (WRITE_COMMANDS.has(commandName)) {
        state.mongoWrites += 1;
        state.writeCommands.push(commandName);
      } else if (READ_COMMANDS.has(commandName)) {
        state.mongoReads += 1;
      }
    },
    assertNoWrites() {
      if (state.mongoWrites > 0) {
        throw new RetrievalEvaluationError(
          'A forbidden MongoDB write command was detected.',
          'RETRIEVAL_EVAL_WRITE_DETECTED',
          { writeCommands: [...state.writeCommands] },
        );
      }
    },
    snapshot() {
      return {
        mongoReads: state.mongoReads,
        mongoWrites: state.mongoWrites,
        writeDetected: state.mongoWrites > 0,
      };
    },
  };
}

function assertStrictReadOnlyRoles(authenticatedUserRoles, databaseName) {
  const roles = Array.isArray(authenticatedUserRoles) ? authenticatedUserRoles : [];
  const targetDatabase = String(databaseName || '').trim();
  const valid = targetDatabase
    && roles.length === 1
    && roles[0]?.role === 'read'
    && roles[0]?.db === targetDatabase;
  if (!valid) {
    throw new RetrievalEvaluationError(
      'The evaluator requires a dedicated MongoDB user with only the read role on the target database.',
      'RETRIEVAL_EVAL_DATABASE_ROLE_NOT_READ_ONLY',
    );
  }
  return { verified: true, role: 'read', database: targetDatabase };
}

function assertEvaluationRuntimeConfiguration(config = env) {
  if (config.qaQueryEmbeddingProvider !== 'gemini') {
    throw new RetrievalEvaluationError(
      'Multimodal evaluation requires QA_QUERY_EMBEDDING_PROVIDER=gemini so both indexes use the expected query space.',
      'RETRIEVAL_EVAL_QUERY_PROVIDER_INCOMPATIBLE',
    );
  }
  if (!config.geminiApiKey) {
    throw new RetrievalEvaluationError(
      'GEMINI_API_KEY is required for multimodal retrieval evaluation.',
      'RETRIEVAL_EVAL_QUERY_PROVIDER_NOT_CONFIGURED',
    );
  }
}

function loadQuestionBank(filePath) {
  const resolvedPath = path.resolve(filePath);
  let source;
  let payload;
  try {
    source = fs.readFileSync(resolvedPath, 'utf8');
    payload = JSON.parse(source);
  } catch {
    throw new RetrievalEvaluationError(
      'The retrieval evaluation question bank could not be read as JSON.',
      'RETRIEVAL_EVAL_QUESTION_BANK_READ_FAILED',
    );
  }
  return {
    questionBank: validateQuestionBank(payload),
    sourcePath: resolvedPath,
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  };
}

function validateQuestionBank(payload) {
  if (!payload?.meta || !Array.isArray(payload.meta.lectures)
      || !Array.isArray(payload.questions) || !payload.questions.length) {
    throw new RetrievalEvaluationError(
      'Question bank must include meta.lectures and a non-empty questions array.',
      'RETRIEVAL_EVAL_QUESTION_BANK_INVALID',
    );
  }

  const lectures = new Map();
  for (const item of payload.meta.lectures) {
    const lecture = Number(item?.lecture);
    const videoId = String(item?.videoId || '').trim();
    if (!Number.isInteger(lecture) || lecture < 1 || !videoId || lectures.has(lecture)) {
      throw new RetrievalEvaluationError(
        'Each lecture must have a unique positive lecture number and videoId.',
        'RETRIEVAL_EVAL_QUESTION_BANK_INVALID',
      );
    }
    lectures.set(lecture, { ...item, lecture, videoId });
  }

  const questionIds = new Set();
  const questions = payload.questions.map((question) => {
    const id = String(question?.id || '').trim();
    const type = String(question?.type || '').trim();
    const text = String(question?.question || '').trim();
    const answerable = question?.expected?.answerable === true;
    const targets = Array.isArray(question?.expected?.targets) ? question.expected.targets : [];
    if (!id || questionIds.has(id) || !type || !text
        || typeof question?.expected?.answerable !== 'boolean') {
      throw new RetrievalEvaluationError(
        'Every question needs a unique id, type, question, and boolean expected.answerable.',
        'RETRIEVAL_EVAL_QUESTION_BANK_INVALID',
      );
    }
    questionIds.add(id);

    const resolvedTargets = targets.map((target) => {
      const lecture = Number(target?.lecture);
      const startSec = Number(target?.startSec);
      const endSec = Number(target?.endSec);
      const lectureInfo = lectures.get(lecture);
      if (!lectureInfo || !Number.isFinite(startSec) || !Number.isFinite(endSec)
          || startSec < 0 || endSec <= startSec || typeof target?.primary !== 'boolean') {
        throw new RetrievalEvaluationError(
          `Question ${id} has an invalid target.`,
          'RETRIEVAL_EVAL_QUESTION_BANK_INVALID',
        );
      }
      return {
        ...target,
        lecture,
        videoId: lectureInfo.videoId,
        startSec,
        endSec,
        primary: target.primary,
      };
    });

    if ((answerable && (!resolvedTargets.length || !resolvedTargets.some((target) => target.primary)))
        || (!answerable && resolvedTargets.length)) {
      throw new RetrievalEvaluationError(
        `Question ${id} has targets inconsistent with expected.answerable.`,
        'RETRIEVAL_EVAL_QUESTION_BANK_INVALID',
      );
    }
    return {
      id,
      type,
      complex: Boolean(question.complex),
      question: text,
      answerable,
      targets: resolvedTargets,
    };
  });

  return {
    meta: payload.meta,
    lectures: [...lectures.values()],
    questions,
  };
}

function buildTextVectorPipeline(queryVector, videoIds) {
  return [
    {
      $vectorSearch: {
        index: TEXT_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: NUM_CANDIDATES,
        limit: TOP_K,
        filter: { videoId: { $in: videoIds } },
      },
    },
    {
      $project: {
        _id: 1,
        chunkId: 1,
        segmentId: 1,
        videoId: 1,
        startSec: 1,
        endSec: 1,
        text: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];
}

function buildVideoVectorPipeline(queryVector, videoIds) {
  return [
    {
      $vectorSearch: {
        index: VIDEO_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: NUM_CANDIDATES,
        limit: TOP_K,
        filter: { video_id: { $in: videoIds } },
      },
    },
    {
      $project: {
        _id: 1,
        video_id: 1,
        clip_id: 1,
        clip_path: 1,
        start_sec: 1,
        end_sec: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];
}

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTextCandidate(document) {
  return {
    id: String(document?._id || document?.chunkId || ''),
    modality: 'text',
    videoId: String(document?.videoId || ''),
    startSec: finiteNumber(document?.startSec),
    endSec: finiteNumber(document?.endSec),
    score: finiteNumber(document?.score),
    chunkId: document?.chunkId == null ? null : String(document.chunkId),
    segmentId: document?.segmentId == null ? null : String(document.segmentId),
    text: document?.text == null ? null : String(document.text),
  };
}

function normalizeVideoCandidate(document) {
  return {
    id: String(document?._id || document?.clip_id || ''),
    modality: 'video',
    videoId: String(document?.video_id || ''),
    startSec: finiteNumber(document?.start_sec),
    endSec: finiteNumber(document?.end_sec),
    score: finiteNumber(document?.score),
    clipId: document?.clip_id == null ? null : String(document.clip_id),
    clipPath: document?.clip_path == null ? null : String(document.clip_path),
  };
}

function validateCandidates(candidates, pathName) {
  const normalized = Array.isArray(candidates) ? candidates : [];
  for (const candidate of normalized) {
    if (!candidate.id || !candidate.videoId || !Number.isFinite(candidate.score)
        || !Number.isFinite(candidate.startSec) || !Number.isFinite(candidate.endSec)
        || candidate.endSec <= candidate.startSec) {
      throw new RetrievalEvaluationError(
        `The ${pathName} vector search returned an invalid candidate.`,
        'RETRIEVAL_EVAL_INVALID_CANDIDATE',
      );
    }
  }
  return normalized;
}

async function identityScorePostprocessor({ runs }) {
  return runs.map(({ rankings }) => ({
    text: rankings.text.map((candidate) => candidate.score),
    video: rankings.video.map((candidate) => candidate.score),
  }));
}
identityScorePostprocessor.postprocessorName = 'identity';

// 單一、整批分數後處理接點。中心化或 CSLS 實驗只需替換 postprocessScores；
// 每個 run 同時提供 queryVector 與兩路 raw ranking，方便估計跨 query/candidate 統計量。
async function applyScorePostprocessor({ runs, postprocessScores }) {
  const processor = postprocessScores || identityScorePostprocessor;
  const adjustments = await processor({ runs });
  if (!Array.isArray(adjustments) || adjustments.length !== runs.length) {
    throw new RetrievalEvaluationError(
      'Score postprocessor must return one score set for every evaluation run.',
      'RETRIEVAL_EVAL_SCORE_POSTPROCESSOR_INVALID',
    );
  }
  return runs.map((run, runIndex) => {
    const output = {};
    for (const pathName of ['text', 'video']) {
      const scores = adjustments[runIndex]?.[pathName];
      if (!Array.isArray(scores) || scores.length !== run.rankings[pathName].length
          || scores.some((score) => !Number.isFinite(Number(score)))) {
        throw new RetrievalEvaluationError(
          `Score postprocessor returned invalid ${pathName} scores for run ${runIndex + 1}.`,
          'RETRIEVAL_EVAL_SCORE_POSTPROCESSOR_INVALID',
        );
      }
      output[pathName] = run.rankings[pathName]
        .map((candidate, index) => ({ ...candidate, score: Number(scores[index]) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, TOP_K);
    }
    return { ...run, rankings: output };
  });
}

function loadScorePostprocessor(modulePath) {
  if (!modulePath) return identityScorePostprocessor;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const loaded = require(path.resolve(modulePath));
  const processor = typeof loaded === 'function' ? loaded : loaded?.postprocessScores;
  if (typeof processor !== 'function') {
    throw new RetrievalEvaluationError(
      'Score postprocessor module must export a function or postprocessScores function.',
      'RETRIEVAL_EVAL_SCORE_POSTPROCESSOR_INVALID',
    );
  }
  processor.postprocessorName = loaded?.name || processor.name || path.basename(modulePath);
  return processor;
}

function fuseWithRrf(rankings, { rrfK = RRF_K, limit = TOP_K } = {}) {
  const byVideoId = new Map();
  for (const pathName of ['text', 'video']) {
    const seenVideoIds = new Set();
    rankings[pathName].forEach((candidate, index) => {
      if (seenVideoIds.has(candidate.videoId)) return;
      seenVideoIds.add(candidate.videoId);
      const current = byVideoId.get(candidate.videoId) || {
        id: candidate.videoId,
        modality: 'fusion',
        videoId: candidate.videoId,
        score: 0,
        components: [],
        sourceRanks: {},
      };
      current.score += 1 / (rrfK + index + 1);
      current.components.push(candidate);
      current.sourceRanks[pathName] = index + 1;
      byVideoId.set(candidate.videoId, current);
    });
  }
  return [...byVideoId.values()]
    .sort((left, right) => right.score - left.score
      || left.videoId.localeCompare(right.videoId))
    .slice(0, limit);
}

function rangesOverlap(candidate, target) {
  return candidate.startSec < target.endSec && target.startSec < candidate.endSec;
}

function candidateMatchesTargets(candidate, targets) {
  const components = Array.isArray(candidate.components) && candidate.components.length
    ? candidate.components
    : [candidate];
  return components.some((component) => targets.some((target) => (
    component.videoId === target.videoId && rangesOverlap(component, target)
  )));
}

function evaluateRanking(candidates, targets) {
  const firstHitIndex = candidates.findIndex((candidate) => candidateMatchesTargets(candidate, targets));
  const result = {
    recallAt1: firstHitIndex >= 0 && firstHitIndex < 1 ? 1 : 0,
    recallAt3: firstHitIndex >= 0 && firstHitIndex < 3 ? 1 : 0,
    recallAt5: firstHitIndex >= 0 && firstHitIndex < 5 ? 1 : 0,
    reciprocalRank: firstHitIndex >= 0 ? 1 / (firstHitIndex + 1) : 0,
    firstHitRank: firstHitIndex >= 0 ? firstHitIndex + 1 : null,
  };
  return result;
}

function evaluateQuestion(question, rankings) {
  if (!question.answerable) {
    return {
      answerable: false,
      top1Scores: Object.fromEntries(['text', 'video', 'fusion'].map((pathName) => [
        pathName,
        rankings[pathName][0]
          ? {
            score: rankings[pathName][0].score,
            videoId: rankings[pathName][0].videoId,
            candidateId: rankings[pathName][0].id,
          }
          : { score: null, videoId: null, candidateId: null },
      ])),
    };
  }

  const primaryTargets = question.targets.filter((target) => target.primary);
  return {
    answerable: true,
    relaxed: Object.fromEntries(['text', 'video', 'fusion'].map((pathName) => [
      pathName,
      evaluateRanking(rankings[pathName], question.targets),
    ])),
    primaryOnly: Object.fromEntries(['text', 'video', 'fusion'].map((pathName) => [
      pathName,
      evaluateRanking(rankings[pathName], primaryTargets),
    ])),
  };
}

function aggregateMetricRows(questionResults, questionType = null) {
  const eligible = questionResults.filter((result) => result.answerable
    && (questionType == null || result.type === questionType));
  const aggregate = {};
  for (const matchingMode of ['relaxed', 'primaryOnly']) {
    aggregate[matchingMode] = {};
    for (const pathName of ['text', 'video', 'fusion']) {
      const rows = eligible.map((result) => result.evaluation[matchingMode][pathName]);
      const count = rows.length;
      aggregate[matchingMode][pathName] = {
        questionCount: count,
        recallAt1: count ? rows.reduce((sum, row) => sum + row.recallAt1, 0) / count : null,
        recallAt3: count ? rows.reduce((sum, row) => sum + row.recallAt3, 0) / count : null,
        recallAt5: count ? rows.reduce((sum, row) => sum + row.recallAt5, 0) / count : null,
        mrr: count ? rows.reduce((sum, row) => sum + row.reciprocalRank, 0) / count : null,
      };
    }
  }
  return aggregate;
}

function summarizeMetrics(questionResults) {
  const types = [...new Set(questionResults.filter((result) => result.answerable)
    .map((result) => result.type))].sort();
  return {
    definition: 'Recall@K is the share of answerable questions with at least one matching result in Top K.',
    overall: aggregateMetricRows(questionResults),
    byType: Object.fromEntries(types.map((type) => [type, aggregateMetricRows(questionResults, type)])),
  };
}

async function searchQuestion({ db, question, videoIds, embed = embedQuery }) {
  const queryVector = await embed(question.question);
  if (!Array.isArray(queryVector) || !queryVector.length
      || queryVector.some((value) => !Number.isFinite(value))) {
    throw new RetrievalEvaluationError(
      `Question ${question.id} produced an invalid query embedding.`,
      'RETRIEVAL_EVAL_QUERY_EMBEDDING_INVALID',
    );
  }

  const [textDocuments, videoDocuments] = await Promise.all([
    db.collection(TEXT_COLLECTION).aggregate(
      buildTextVectorPipeline(queryVector, videoIds),
      { allowDiskUse: false },
    ).toArray(),
    db.collection(VIDEO_COLLECTION).aggregate(
      buildVideoVectorPipeline(queryVector, videoIds),
      { allowDiskUse: false },
    ).toArray(),
  ]);

  const rawRankings = {
    text: validateCandidates(textDocuments.map(normalizeTextCandidate), 'text'),
    video: validateCandidates(videoDocuments.map(normalizeVideoCandidate), 'video'),
  };
  return {
    question,
    queryVector,
    queryEmbeddingDimension: queryVector.length,
    rankings: rawRankings,
  };
}

async function createReadOnlyDatabase(uri, commandMonitor) {
  if (!String(uri || '').trim()) {
    throw new RetrievalEvaluationError(
      'RETRIEVAL_EVAL_READONLY_MONGODB_URI is required.',
      'RETRIEVAL_EVAL_READONLY_DATABASE_URI_REQUIRED',
    );
  }
  const client = new MongoClient(uri, {
    autoSelectFamily: false,
    monitorCommands: true,
    readPreference: 'secondaryPreferred',
    retryWrites: false,
    serverSelectionTimeoutMS: 10000,
  });
  client.on('commandStarted', (event) => commandMonitor.observe(event));
  await client.connect();
  const db = client.db();
  try {
    const connectionStatus = await db.admin().command({ connectionStatus: 1, showPrivileges: false });
    const databaseAccess = assertStrictReadOnlyRoles(
      connectionStatus?.authInfo?.authenticatedUserRoles,
      db.databaseName,
    );
    commandMonitor.assertNoWrites();
    return { client, db, databaseAccess };
  } catch (error) {
    await client.close();
    throw error;
  }
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  const compact = {
    rank: candidate.rank,
    id: candidate.id,
    modality: candidate.modality,
    videoId: candidate.videoId,
    startSec: candidate.startSec,
    endSec: candidate.endSec,
    score: candidate.score,
  };
  if (candidate.chunkId) compact.chunkId = candidate.chunkId;
  if (candidate.clipId) compact.clipId = candidate.clipId;
  if (candidate.sourceRanks) compact.sourceRanks = candidate.sourceRanks;
  if (candidate.components) {
    compact.components = candidate.components.map((component) => ({
      modality: component.modality,
      id: component.id,
      videoId: component.videoId,
      startSec: component.startSec,
      endSec: component.endSec,
      score: component.score,
    }));
  }
  return compact;
}

function addRanks(candidates) {
  return candidates.map((candidate, index) => compactCandidate({ ...candidate, rank: index + 1 }));
}

async function runEvaluation({
  questionBank,
  sourcePath,
  sourceSha256,
  db,
  databaseAccess,
  commandMonitor,
  postprocessScores = identityScorePostprocessor,
  embed = embedQuery,
  now = () => new Date(),
}) {
  const startedAt = now().toISOString();
  const videoIds = questionBank.lectures.map((lecture) => lecture.videoId);
  const rawRuns = [];

  for (const [index, question] of questionBank.questions.entries()) {
    process.stdout.write(`[${index + 1}/${questionBank.questions.length}] ${question.id} `);
    const search = await searchQuestion({ db, question, videoIds, embed });
    commandMonitor.assertNoWrites();
    rawRuns.push(search);
    process.stdout.write('retrieved\n');
  }

  const adjustedRuns = await applyScorePostprocessor({ runs: rawRuns, postprocessScores });
  const questionResults = adjustedRuns.map((search) => {
    const { question } = search;
    const rankings = {
      ...search.rankings,
      fusion: fuseWithRrf(search.rankings),
    };
    const evaluation = evaluateQuestion(question, rankings);
    return {
      id: question.id,
      type: question.type,
      complex: question.complex,
      question: question.question,
      answerable: question.answerable,
      targets: question.targets,
      queryEmbeddingDimension: search.queryEmbeddingDimension,
      evaluation,
      rankings: Object.fromEntries(['text', 'video', 'fusion'].map((pathName) => [
        pathName,
        addRanks(rankings[pathName]),
      ])),
    };
  });

  commandMonitor.assertNoWrites();
  const safety = commandMonitor.snapshot();
  return {
    schemaVersion: '1.0',
    generatedAt: now().toISOString(),
    startedAt,
    source: {
      path: path.relative(REPO_ROOT, sourcePath).replace(/\\/g, '/'),
      sha256: sourceSha256,
      name: questionBank.meta.name,
      version: questionBank.meta.version,
      course: questionBank.meta.course,
    },
    configuration: {
      collections: { text: TEXT_COLLECTION, video: VIDEO_COLLECTION },
      indexes: { text: TEXT_INDEX, video: VIDEO_INDEX },
      topK: TOP_K,
      numCandidates: NUM_CANDIDATES,
      rrfK: RRF_K,
      rrfFusionKey: 'videoId',
      scorePostprocessor: postprocessScores.postprocessorName || postprocessScores.name || 'custom',
      queryEmbeddingProvider: env.qaQueryEmbeddingProvider,
    },
    metrics: summarizeMetrics(questionResults),
    unanswerable: questionResults.filter((result) => !result.answerable).map((result) => ({
      id: result.id,
      type: result.type,
      question: result.question,
      top1Scores: result.evaluation.top1Scores,
    })),
    questions: questionResults,
    safety: {
      writesAllowed: false,
      databaseAccess,
      ...safety,
    },
  };
}

function formatMetric(value) {
  return value == null ? '—' : value.toFixed(4);
}

function renderMetricTable(metrics) {
  const lines = [
    '| 比對 | 路徑 | 題數 | Recall@1 | Recall@3 | Recall@5 | MRR |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const matchingMode of ['relaxed', 'primaryOnly']) {
    const label = matchingMode === 'relaxed' ? '全部 target' : '僅 primary';
    for (const pathName of ['text', 'video', 'fusion']) {
      const row = metrics[matchingMode][pathName];
      lines.push(`| ${label} | ${pathName} | ${row.questionCount} | ${formatMetric(row.recallAt1)} | ${formatMetric(row.recallAt3)} | ${formatMetric(row.recallAt5)} | ${formatMetric(row.mrr)} |`);
    }
  }
  return lines.join('\n');
}

function renderMarkdown(report) {
  const lines = [
    '# 影像／文字檢索評測結果',
    '',
    `- 產生時間：${report.generatedAt}`,
    `- 題集：${report.source.name}（${report.source.version}）`,
    `- 課程：${report.source.course.title}（${report.source.course.id}）`,
    `- 查詢向量：queryEmbedding.service.js / ${report.configuration.queryEmbeddingProvider}`,
    `- 每路候選：Top ${report.configuration.topK}；RRF k=${report.configuration.rrfK}`,
    `- 分數後處理：${report.configuration.scorePostprocessor}`,
    `- 資料庫安全：唯一 read role 已驗證；Mongo writes=${report.safety.mongoWrites}`,
    '',
    '> Recall@K 定義為：可回答題目中，Top K 至少一筆符合講次且時間區間重疊的題目比例。answerable=false 不列入 Recall/MRR。',
    '',
    '## 整體',
    '',
    renderMetricTable(report.metrics.overall),
  ];

  for (const [type, metrics] of Object.entries(report.metrics.byType)) {
    lines.push('', `## 題型：${type}`, '', renderMetricTable(metrics));
  }

  lines.push(
    '',
    '## 不可回答題目的 Top 1 分數',
    '',
    '| 題號 | 問題 | 文字 | 影像 | RRF 融合 |',
    '|---|---|---:|---:|---:|',
  );
  for (const item of report.unanswerable) {
    lines.push(`| ${item.id} | ${item.question.replace(/\|/g, '\\|')} | ${formatMetric(item.top1Scores.text.score)} | ${formatMetric(item.top1Scores.video.score)} | ${formatMetric(item.top1Scores.fusion.score)} |`);
  }

  lines.push('', '## 逐題首筆命中排名', '', '| 題號 | 題型 | 文字 | 影像 | RRF 融合 |', '|---|---|---:|---:|---:|');
  for (const item of report.questions.filter((question) => question.answerable)) {
    lines.push(`| ${item.id} | ${item.type} | ${item.evaluation.relaxed.text.firstHitRank ?? '—'} | ${item.evaluation.relaxed.video.firstHitRank ?? '—'} | ${item.evaluation.relaxed.fusion.firstHitRank ?? '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function writeReports(report, jsonOutPath, markdownOutPath) {
  for (const outputPath of [jsonOutPath, markdownOutPath]) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  fs.writeFileSync(jsonOutPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownOutPath, renderMarkdown(report), 'utf8');
}

function safeFailure(error) {
  return {
    success: false,
    code: error?.code || 'RETRIEVAL_EVAL_FAILED',
    message: error instanceof RetrievalEvaluationError
      ? error.message
      : 'The read-only retrieval evaluation failed safely.',
  };
}

async function main(argv = process.argv.slice(2)) {
  let connection;
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      console.log(usageText());
      return;
    }
    const loaded = loadQuestionBank(options.questionsPath);
    const postprocessScores = loadScorePostprocessor(options.scorePostprocessorModule);
    assertEvaluationRuntimeConfiguration();
    const commandMonitor = createCommandMonitor();
    const uri = process.env.RETRIEVAL_EVAL_READONLY_MONGODB_URI
      || process.env.PHASE2_2_READONLY_MONGODB_URI;
    connection = await createReadOnlyDatabase(uri, commandMonitor);
    const report = await runEvaluation({
      ...loaded,
      questionBank: loaded.questionBank,
      db: connection.db,
      databaseAccess: connection.databaseAccess,
      commandMonitor,
      postprocessScores,
    });
    await connection.client.close();
    connection = null;
    writeReports(report, options.jsonOutPath, options.markdownOutPath);
    console.log(`JSON: ${options.jsonOutPath}`);
    console.log(`Markdown: ${options.markdownOutPath}`);
  } catch (error) {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  } finally {
    if (connection?.client) await connection.client.close();
  }
}

if (require.main === module) main();

module.exports = {
  METRIC_K_VALUES,
  NUM_CANDIDATES,
  RRF_K,
  TEXT_COLLECTION,
  TEXT_INDEX,
  TOP_K,
  VIDEO_COLLECTION,
  VIDEO_INDEX,
  WRITE_COMMANDS,
  RetrievalEvaluationError,
  aggregateMetricRows,
  applyScorePostprocessor,
  assertEvaluationRuntimeConfiguration,
  assertStrictReadOnlyRoles,
  buildTextVectorPipeline,
  buildVideoVectorPipeline,
  candidateMatchesTargets,
  createCommandMonitor,
  evaluateQuestion,
  evaluateRanking,
  fuseWithRrf,
  identityScorePostprocessor,
  loadQuestionBank,
  normalizeTextCandidate,
  normalizeVideoCandidate,
  parseCliArgs,
  rangesOverlap,
  renderMarkdown,
  runEvaluation,
  searchQuestion,
  summarizeMetrics,
  validateQuestionBank,
};
