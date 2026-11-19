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

// 命中分散在多支影片、或同一影片相距超過三分鐘時，切成「同一影片、三分鐘內」的命中群。
// 依命中數多到少、最前面命中的檢索排名排序，逐群嘗試（recut 決策第 1 項，2026-11-19 修訂）。
function hitClusters(entries) {
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
      clusters.set(key, { video: sorted[i].video, members, rank: Math.min(...members.map((e) => e.rank)) });
    }
  }
  return [...clusters.values()].sort((a, b) => b.members.length - a.members.length || a.rank - b.rank);
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
  expandContinuousWindow({ hits: input.hits, segments: input.segments });
  return input;
}

async function loadSourceInputs(task) {
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
  for (const cluster of hitClusters(entries)) {
    try {
      return await loadClusterInputs({ script, video: cluster.video, hits: cluster.members.map((e) => e.hit) });
    } catch (error) {
      if (!RETRYABLE.has(error.code)) throw error;
      firstError = firstError || error;
    }
  }
  throw firstError;
}

function createRecutSourceSteps({ loadInputs = loadSourceInputs, media = createRecutMediaTools() } = {}) {
  return [
    { id: 'recut-window-v1', stage: 'sourceCheck', run: async ({ task }) => {
      const { video, hits, segments } = await loadInputs(task);
      return { sourceWindow: expandContinuousWindow({ hits, segments }), sourceVideoId: String(video._id), sourcePath: video.filePath,
        transcriptVersion: video.activeTranscriptVersion || 'legacy' };
    } },
    { id: 'recut-source-check-v1', stage: 'sourceCheck', run: async ({ data, checkCancelled }) => {
      const results = inspectProbe(await media.probe(data.sourcePath), data.sourceWindow);
      await checkCancelled();
      try { await media.decode(data.sourcePath, data.sourceWindow); } catch { fail('原片無法正常解碼。', 'RECUT_SOURCE_UNDECODABLE'); }
      await checkCancelled();
      const audio = calculateFixedGain(await media.measure(data.sourcePath, data.sourceWindow));
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
module.exports = { expandContinuousWindow, inspectProbe, calculateFixedGain, splitSentences, loadSourceInputs, createRecutSourceSteps };
