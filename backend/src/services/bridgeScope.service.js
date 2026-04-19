const Video = require('../models/video.model');

const COURSE_BRIDGE_MODES = {
  STANDARD: 'standard',
  QA_SCOPE_ONLY: 'qa_scope_only',
  MIXED_SCOPE: 'mixed_scope',
};

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function toPlainObject(document) {
  if (!document) {
    return null;
  }

  if (typeof document.toObject === 'function') {
    return document.toObject();
  }

  return { ...document };
}

function normalizeIdentifier(...values) {
  const normalizedValue = pickFirstDefined(...values);

  if (normalizedValue == null || normalizedValue === '') {
    return null;
  }

  return String(normalizedValue);
}

function normalizeNumber(...values) {
  const normalizedValue = pickFirstDefined(...values);

  if (normalizedValue == null || normalizedValue === '') {
    return null;
  }

  const nextValue = Number(normalizedValue);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function normalizeTranscript(...values) {
  const normalizedValue = pickFirstDefined(...values, '');
  return String(normalizedValue).trim();
}

function normalizeSegment(segment) {
  return {
    segmentId: normalizeIdentifier(
      segment.segmentId,
      segment.segment_id,
      segment.chunkId,
      segment.chunk_id,
      segment._id,
    ),
    videoId: normalizeIdentifier(segment.videoId, segment.video_id),
    courseId: normalizeIdentifier(segment.courseId),
    startSec: normalizeNumber(segment.startSec, segment.start_sec),
    endSec: normalizeNumber(segment.endSec, segment.end_sec),
    transcript: normalizeTranscript(segment.transcript, segment.text, segment.original_text),
    embedding: Array.isArray(segment.embedding) ? segment.embedding : [],
  };
}

function addIdentifier(targetSet, value) {
  const normalizedValue = normalizeIdentifier(value);

  if (normalizedValue) {
    targetSet.add(normalizedValue);
  }
}

function addVideoIdentifiers(targetSet, video) {
  if (!video) {
    return;
  }

  addIdentifier(targetSet, video._id);
  addIdentifier(targetSet, video.id);
  addIdentifier(targetSet, video.videoId);
  addIdentifier(targetSet, video.video_id);
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left?.createdAt || 0) || 0;
    const rightTime = Date.parse(right?.createdAt || 0) || 0;
    return rightTime - leftTime;
  });
}

async function collectScopedVideos(course) {
  const videosById = new Map();
  const courseVideoRefs = (course.videoIds || [])
    .map((videoId) => normalizeIdentifier(videoId))
    .filter(Boolean);

  const addVideo = (video) => {
    if (!video) {
      return;
    }

    const videoKey = normalizeIdentifier(video._id, video.id, video.videoId, video.video_id);

    if (!videoKey || videosById.has(videoKey)) {
      return;
    }

    videosById.set(videoKey, video);
  };

  const [courseVideos, referencedVideos] = await Promise.all([
    Video.find({ courseId: course._id }),
    courseVideoRefs.length ? Video.find({ _id: { $in: courseVideoRefs } }) : [],
  ]);

  for (const video of courseVideos) {
    addVideo(video);
  }

  for (const video of referencedVideos) {
    addVideo(video);
  }

  const videos = sortByCreatedAtDesc([...videosById.values()]);

  return {
    courseVideoRefs,
    videos,
    appOwnedVideos: videos.filter((video) => Video.isAppOwnedRecord(video)),
    pipelineMetadataVideos: videos.filter((video) => Video.isPipelineMetadataRecord(video)),
  };
}

function buildCourseBridgeSummary(course, scopedVideos = {}) {
  const courseVideoRefs = scopedVideos.courseVideoRefs || [];
  const videos = scopedVideos.videos || [];
  const appOwnedVideos = scopedVideos.appOwnedVideos || [];
  const pipelineMetadataVideos = scopedVideos.pipelineMetadataVideos || [];

  let bridgeMode = COURSE_BRIDGE_MODES.STANDARD;

  if (pipelineMetadataVideos.length && !appOwnedVideos.length) {
    bridgeMode = COURSE_BRIDGE_MODES.QA_SCOPE_ONLY;
  } else if (pipelineMetadataVideos.length) {
    bridgeMode = COURSE_BRIDGE_MODES.MIXED_SCOPE;
  }

  return {
    isBridgeCourse: bridgeMode !== COURSE_BRIDGE_MODES.STANDARD,
    qaScopeOnly: bridgeMode === COURSE_BRIDGE_MODES.QA_SCOPE_ONLY,
    bridgeMode,
    videoCount: videos.length,
    appVideoCount: appOwnedVideos.length,
    bridgeVideoCount: pipelineMetadataVideos.length,
    appOwnedVideoCount: appOwnedVideos.length,
    metadataOnlyVideoCount: pipelineMetadataVideos.length,
    courseVideoRefCount: courseVideoRefs.length,
    bridgeExternalVideoIds: pipelineMetadataVideos
      .map((video) => normalizeIdentifier(video.video_id, video.videoId))
      .filter(Boolean),
    courseVideoIds: courseVideoRefs,
    bridgeContract: 'course_video_refs_v1',
    bridgeContractPath: 'course.videoIds -> videos.video_id -> video_segments_text.video_id',
  };
}

function buildCourseBridgePresentation(course, scopedVideos) {
  return {
    ...toPlainObject(course),
    ...buildCourseBridgeSummary(course, scopedVideos),
  };
}

function buildVideoBridgePresentation(video, summary = {}, { courseId } = {}) {
  const plainVideo = toPlainObject(video);
  const externalVideoId = normalizeIdentifier(plainVideo.video_id, plainVideo.videoId);
  const durationSec = normalizeNumber(plainVideo.durationSec, plainVideo.duration_sec);
  const fileName = normalizeTranscript(plainVideo.fileName, plainVideo.file_name);

  if (Video.isAppOwnedRecord(video)) {
    return {
      ...plainVideo,
      durationSec,
      duration_sec: durationSec,
      fileName,
      externalVideoId,
      qaScopeOnly: false,
      metadataOnly: false,
      isAppOwned: true,
      bridgeMode: summary.bridgeMode || COURSE_BRIDGE_MODES.STANDARD,
      bridgeSource: null,
    };
  }

  return {
    _id: normalizeIdentifier(plainVideo._id, plainVideo.id),
    courseId: normalizeIdentifier(courseId),
    title: normalizeTranscript(plainVideo.title, plainVideo.file_name, externalVideoId),
    sourceType: plainVideo.sourceType || null,
    sourceUrl: pickFirstDefined(plainVideo.sourceUrl, plainVideo.video_url),
    uploadedBy: null,
    processing: null,
    video_id: externalVideoId,
    videoId: externalVideoId,
    externalVideoId,
    file_name: fileName || null,
    fileName: fileName || null,
    file_path: pickFirstDefined(plainVideo.file_path, plainVideo.filePath),
    durationSec,
    duration_sec: durationSec,
    createdAt: plainVideo.createdAt || null,
    updatedAt: plainVideo.updatedAt || null,
    qaScopeOnly: true,
    metadataOnly: true,
    isAppOwned: false,
    bridgeMode: COURSE_BRIDGE_MODES.QA_SCOPE_ONLY,
    bridgeSource: 'pipeline_metadata',
  };
}

async function buildCourseSegmentScope(course, scopedVideos) {
  const allowedCourseIds = new Set([String(course._id)]);
  const allowedVideoIds = new Set();
  const resolvedScopedVideos = scopedVideos || await collectScopedVideos(course);

  for (const video of resolvedScopedVideos.videos || []) {
    addVideoIdentifiers(allowedVideoIds, video);
  }

  for (const videoId of resolvedScopedVideos.courseVideoRefs || []) {
    addIdentifier(allowedVideoIds, videoId);
  }

  return {
    allowedCourseIds,
    allowedVideoIds,
  };
}

function buildSegmentLookupQuery(scope) {
  const conditions = [];

  for (const courseId of scope.allowedCourseIds) {
    conditions.push({ courseId });
  }

  if (scope.allowedVideoIds.size) {
    const allowedVideoIds = [...scope.allowedVideoIds];
    conditions.push({ videoId: { $in: allowedVideoIds } });
    conditions.push({ video_id: { $in: allowedVideoIds } });
  }

  if (!conditions.length) {
    return {};
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return { $or: conditions };
}

function segmentMatchesScope(segment, scope) {
  if (segment.courseId) {
    return scope.allowedCourseIds.has(segment.courseId);
  }

  if (!segment.videoId) {
    return false;
  }

  return scope.allowedVideoIds.has(segment.videoId);
}

module.exports = {
  COURSE_BRIDGE_MODES,
  pickFirstDefined,
  normalizeIdentifier,
  normalizeNumber,
  normalizeTranscript,
  normalizeSegment,
  collectScopedVideos,
  buildCourseBridgeSummary,
  buildCourseBridgePresentation,
  buildVideoBridgePresentation,
  buildCourseSegmentScope,
  buildSegmentLookupQuery,
  segmentMatchesScope,
};
