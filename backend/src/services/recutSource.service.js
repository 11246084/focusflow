const mongoose = require('mongoose');
const ShortScript = require('../models/shortScript.model');
const VideoSegment = require('../models/videoSegment.model');
const { getCourseByIdOrThrow } = require('./courseAccess.service');
const { collectScopedVideos } = require('./bridgeScope.service');
const { createRecutSource } = require('./recutState.service');
const { createRecutMediaTools } = require('./recutMedia.service');
const { expandContinuousWindow, inspectProbe, calculateFixedGain, splitSentences } = require('./recutSourceAlgorithms.service');
const { normalizeRecutAsrResult } = require('./recutAsrNormalization.service');
const AppError = require('../utils/appError');
const C = require('../constants/recutSource');
function fail(message = '找不到同一支影片內的連續 2～3 分鐘視窗。', code = 'RECUT_WINDOW_NOT_FOUND') {
  throw new AppError(message, 422, code);
}

// 換一群命中再試就可能成功的錯誤；其餘（如腳本不存在）直接停止。
const RETRYABLE = new Set(['RECUT_WINDOW_NOT_FOUND', 'RECUT_SOURCE_UNAVAILABLE', 'RECUT_SOURCE_UPDATED']);

// 題目關鍵字：中文取相鄰兩字、英數取整個詞，去掉「老師、什麼、那個」這類問句常用字。
const FILLER = new Set(['老師', '師說', '說的', '的那', '那個', '這個', '什麼', '是什', '麼啊', '是啥', '請問', '為什', '怎麼', '如何',
  '可以', '一下', '的是', '差在', '在哪', '哪裡', '是不', '不是', '有沒', '沒有', '什么', '那个', '这个']);
function questionTerms(questions) {
  const terms = new Set();
  for (const q of questions) {
    const text = String(q || '').toLowerCase();
    for (const word of text.match(/[a-z0-9][a-z0-9.+#-]*/g) || []) if (word.length >= 2) terms.add(word);
    for (const run of text.match(/\p{Script=Han}+/gu) || []) for (let i = 0; i + 1 < run.length; i++) {
      const pair = run.slice(i, i + 2); if (!FILLER.has(pair)) terms.add(pair);
    }
  }
  return terms;
}
const relevance = (terms, text) => { const t = String(text || '').toLowerCase(); let n = 0; for (const term of terms) if (t.includes(term)) n++; return n; };

// 命中分散在多支影片、或同一影片相距超過三分鐘時，切成「同一影片、三分鐘內」的命中群。
// 依「命中片段含題目關鍵字的數量」、命中數、最前面命中的檢索排名排序，逐群嘗試
// （recut 決策第 1 項，2026-11-19 修訂；關鍵字排序見第 97 項）。
function hitClusters(entries, { terms = new Set(), textOf = (e) => e.hit.rawText } = {}) {
  const byVideo = new Map();
  for (const entry of entries) {
    const key = String(entry.video._id);
    if (!byVideo.has(key)) byVideo.set(key, []);
    byVideo.get(key).push(entry);
  }
  const clusters = new Map();
  for (const list of byVideo.values()) {
    const sorted = [...list].sort((a, b) => a.hit.startSec - b.hit.startSec);
    for (let i = 0; i < sorted.length; i++) {
      const members = sorted.slice(i).filter((e) => e.hit.endSec - sorted[i].hit.startSec <= C.MAX_WINDOW_SEC);
      const key = `${String(sorted[i].video._id)}:${members.map((e) => e.rank).join(',')}`;
      clusters.set(key, { key, video: sorted[i].video, members, rank: Math.min(...members.map((e) => e.rank)),
        score: relevance(terms, members.map(textOf).join(' ')) });
    }
  }
  return [...clusters.values()].sort((a, b) => b.score - a.score || b.members.length - a.members.length || a.rank - b.rank);
}

async function loadClusterInputs({ script, video: rawVideo, hits }) {
  const video = { ...(rawVideo.toObject ? rawVideo.toObject() : rawVideo), filePath: rawVideo.filePath || rawVideo.file_path };
  if (!mongoose.isValidObjectId(video._id) || !video.filePath) fail('本機原片已不存在。', 'RECUT_SOURCE_UNAVAILABLE');
  const transcriptVersion = video.activeTranscriptVersion || 'legacy';
  // chunk IDs are reused after transcript upgrades. Never resolve old IDs against a new generation.
  if (hits.some((hit) => (hit.transcriptVersion || 'legacy') !== transcriptVersion)) {
    fail('來源已更新，需要重新凍結；保留原有講稿與來源快照。', 'RECUT_SOURCE_UPDATED');
  }
  const segments = await VideoSegment.find({ videoId: { $in: [String(video._id), video.videoId, video.video_id].filter(Boolean) },
    ...(transcriptVersion === 'legacy' ? { $or: [{ transcriptVersion: 'legacy' }, { transcriptVersion: null }] } : { transcriptVersion }) }).lean();
  // 同一影片的 native／external 別名先正規化，再做連續視窗計算。
  const input = { script, video, hits: hits.map((h) => ({ ...h, videoId: String(video._id) })),
    segments: segments.map((s) => ({ ...s, videoId: String(video._id) })) };
  input.sourceWindow = expandContinuousWindow({ hits: input.hits, segments: input.segments });
  return input;
}

// exclude：已經試過、模型判定無法回答的命中群（recut 決策第 98 項）。
async function loadSourceInputs(task, { exclude = [], excludedWindows = [], missingVideoIds = [] } = {}) {
  const script = await ShortScript.findById(task.scriptId).lean();
  if (!script || String(script.courseId) !== String(task.courseId)) fail('找不到任務所屬腳本。', 'RECUT_SOURCE_UNAVAILABLE');
  const hits = (script.evidence || []).filter((s) => s.expandedFrom == null);
  const course = await getCourseByIdOrThrow(script.courseId);
  const scope = await collectScopedVideos(course);
  if (!hits.length) fail();
  const entries = hits.map((hit, rank) => ({ hit, rank,
    video: scope.videos.find((v) => [v._id, v.videoId, v.video_id].filter(Boolean).some((id) => String(id) === String(hit.videoId))) }))
    .filter((e) => e.video);
  if (!entries.length) fail('原片不在課程範圍內。', 'RECUT_SOURCE_UNAVAILABLE');
  let firstError = null;
  // 命中片段連同前後擴展的片段一起比對關鍵字（例如「拉馬，這個字的意思是羊駝」）。
  const evidence = script.evidence || [];
  const textOf = (e) => [e.hit.rawText, ...evidence.filter((x) => x.expandedFrom && x.expandedFrom === e.hit.chunkId).map((x) => x.rawText)].join(' ');
  const terms = questionTerms([script.topic, ...(script.sourceQuestions || []).map((q) => q.question)]);
  const skipped = new Set(exclude);
  const clusters = hitClusters(entries, { terms, textOf }).filter((cluster) =>
    !skipped.has(cluster.key) && !missingVideoIds.includes(String(cluster.video._id)));
  for (const [index, cluster] of clusters.entries()) {
    try {
      const input = await loadClusterInputs({ script, video: cluster.video, hits: cluster.members.map((e) => e.hit) });
      const window = input.sourceWindow;
      if (excludedWindows.some((w) => w.videoId === window.videoId && w.startSec === window.startSec && w.endSec === window.endSec)) continue;
      return { ...input, clusterKey: cluster.key, alternatives: clusters.length - index - 1 };
    } catch (error) {
      if (!RETRYABLE.has(error.code)) throw error;
      firstError = firstError || error;
    }
  }
  throw firstError || new AppError('找不到其他可用的原片段落。', 422, 'RECUT_WINDOW_NOT_FOUND');
}

function createRecutSourceSteps({ loadInputs = loadSourceInputs, media = createRecutMediaTools() } = {}) {
  return [
    { id: 'recut-window-v1', stage: 'sourceCheck', run: async ({ task, data = {} }) => {
      const { video, hits, segments, sourceWindow, clusterKey, alternatives } = await loadInputs(task, {
        exclude: data.excludedClusterKeys || [], excludedWindows: data.excludedWindows || [], missingVideoIds: data.missingVideoIds || [],
      });
      return { sourceWindow: sourceWindow || expandContinuousWindow({ hits, segments }), sourceVideoId: String(video._id), sourcePath: video.filePath,
        transcriptVersion: video.activeTranscriptVersion || 'legacy',
        ...(clusterKey ? { sourceClusterKey: clusterKey, sourceAlternatives: alternatives } : {}) };
    } },
    { id: 'recut-source-check-v1', stage: 'sourceCheck', run: async ({ data, checkCancelled }) => {
      const results = inspectProbe(await media.probe(data.sourcePath), data.sourceWindow);
      await checkCancelled();
      try { await media.decode(data.sourcePath, data.sourceWindow); } catch { fail('原片無法正常解碼。', 'RECUT_SOURCE_UNDECODABLE'); }
      await checkCancelled();
      const measurement = await media.measure(data.sourcePath, data.sourceWindow);
      if (measurement.silenceIntervals?.length) results.silenceIntervals = measurement.silenceIntervals;
      const audio = calculateFixedGain(measurement);
      return { sourceCheck: { passed: true, results: { ...results, decodable: true }, checkedAt: new Date() }, audio };
    } },
    { id: 'recut-window-asr-v1', stage: 'sourceCheck', run: async ({ data }) => ({ rawAsrResult: await media.transcribe(data.sourcePath, data.sourceWindow) }) },
    { id: 'recut-sentences-v1', stage: 'sourceCheck', run: async ({ task, data }) => {
      // Legacy arrays remain supported; only the media adapter may establish an explicit cut.
      const normalized = normalizeRecutAsrResult(data.rawAsrResult ?? data.rawWords, data.sourceWindow);
      const sentences = splitSentences(normalized.words, data.sourceWindow);
      const excludedSentenceIds = [...new Set([
        ...(normalized.excludeFirstSentence ? [sentences[0].id] : []),
        ...(normalized.excludeLastSentence ? [sentences.at(-1).id] : []),
      ])];
      const source = await createRecutSource({ scriptId: task.scriptId, videoId: data.sourceVideoId,
        ...data.sourceWindow, transcriptVersion: data.transcriptVersion, transcriptChunks: data.sourceWindow.segments,
        sourceSha256: data.rawAsrResult?.sourceSha256, asrProvenance: normalized.asrProvenance, excludedSentenceIds,
        sentences, sourceCheck: data.sourceCheck, audio: data.audio });
      return { sourceId: String(source._id) };
    } },
  ];
}
module.exports = { expandContinuousWindow, inspectProbe, calculateFixedGain, splitSentences, loadSourceInputs, createRecutSourceSteps, hitClusters, questionTerms };
