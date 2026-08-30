const Video = require('../models/video.model');
const mongoose = require('mongoose');

const COURSE_BRIDGE_MODES = {
  STANDARD: 'standard',
  QA_SCOPE_ONLY: 'qa_scope_only',
  MIXED_SCOPE: 'mixed_scope',
};

const VIDEO_OWNERSHIP_TYPES = {
  APP_OWNED: 'app_owned',
  PIPELINE_METADATA: 'pipeline_metadata',
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
    // Preserve only the canonical Leaf identity when it is actually present.
    // Do not fall back to segmentId: legacy segment-only records must remain
    // distinguishable so Citation can return chunkId: null.
    chunkId: normalizeIdentifier(segment.chunkId),
    segmentId: normalizeIdentifier(segment.segmentId, segment.chunkId, segment._id),
    videoId: normalizeIdentifier(segment.videoId),
    courseId: normalizeIdentifier(segment.courseId),
    startSec: normalizeNumber(segment.startSec),
    endSec: normalizeNumber(segment.endSec),
    transcript: normalizeTranscript(segment.text),
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
}

function extractPipelineVisualVideoId(value) {
  const normalizedValue = normalizeIdentifier(value);

  if (!normalizedValue) {
    return null;
  }

  const match = normalizedValue.match(/\b(video_\d+)(?:_part_\d+)?\b/i);
  return match ? match[1].toLowerCase() : null;
}

function addVisualVideoIdentifier(targetSet, value) {
  const visualVideoId = extractPipelineVisualVideoId(value);

  if (visualVideoId) {
    targetSet.add(visualVideoId);
  }
}

function addVisualVideoIdentifiers(targetSet, video) {
  if (!video) {
    return;
  }

  addVisualVideoIdentifier(targetSet, video.videoId);
  addVisualVideoIdentifier(targetSet, video.video_id);
  addVisualVideoIdentifier(targetSet, video.fileName);
  addVisualVideoIdentifier(targetSet, video.file_name);
  addVisualVideoIdentifier(targetSet, video.filePath);
  addVisualVideoIdentifier(targetSet, video.file_path);
  addVisualVideoIdentifier(targetSet, video.sourceUrl);
  addVisualVideoIdentifier(targetSet, video.videoUrl);
  addVisualVideoIdentifier(targetSet, video.video_url);
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
  const courseObjectIdVideoRefs = courseVideoRefs.filter((videoId) => mongoose.Types.ObjectId.isValid(videoId));

  const addVideo = (video) => {
    if (!video) {
      return;
    }

    const videoKey = normalizeIdentifier(video._id, video.id, video.videoId);

    if (!videoKey || videosById.has(videoKey)) {
      return;
    }

    videosById.set(videoKey, video);
  };

  const referencedVideoConditions = [];

  if (courseObjectIdVideoRefs.length) {
    referencedVideoConditions.push({ _id: { $in: courseObjectIdVideoRefs } });
  }

  if (courseVideoRefs.length) {
    referencedVideoConditions.push(
      { videoId: { $in: courseVideoRefs } },
      { video_id: { $in: courseVideoRefs } },
    );
  }

  const [courseVideos, referencedVideos] = await Promise.all([
    Video.find({ courseId: course._id }),
    referencedVideoConditions.length ? Video.find({ $or: referencedVideoConditions }) : [],
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
      .map((video) => normalizeIdentifier(video.videoId))
      .filter(Boolean),
    courseVideoIds: courseVideoRefs,
    bridgeContract: 'course_video_refs_v1',
    bridgeContractPath: 'course.videoIds -> videos.videoId -> video_segments_text.videoId',
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
  const externalVideoId = normalizeIdentifier(plainVideo.videoId, plainVideo.video_id);
  const durationSec = normalizeNumber(plainVideo.durationSec, plainVideo.duration_sec);
  const fileName = normalizeTranscript(plainVideo.fileName, plainVideo.file_name);
  const youtubeVideoId = normalizeIdentifier(plainVideo.youtubeVideoId, plainVideo.youtube_video_id);

  if (Video.isAppOwnedRecord(video)) {
    return {
      ...plainVideo,
      durationSec,
      duration_sec: durationSec,
      fileName,
      file_name: fileName,
      file_path: plainVideo.filePath || plainVideo.file_path || null,
      externalVideoId,
      ownership: VIDEO_OWNERSHIP_TYPES.APP_OWNED,
      qaScopeOnly: false,
      metadataOnly: false,
      isAppOwned: true,
      bridgeMode: summary.bridgeMode || COURSE_BRIDGE_MODES.STANDARD,
      bridgeSource: null,
      youtubeVideoId,
      youtube_video_id: youtubeVideoId,
      video_source: plainVideo.videoSource || plainVideo.video_source || plainVideo.sourceType || null,
      video_url: plainVideo.videoUrl || plainVideo.video_url || plainVideo.sourceUrl || null,
    };
  }

  return {
    _id: normalizeIdentifier(plainVideo._id, plainVideo.id),
    courseId: normalizeIdentifier(courseId),
    title: normalizeTranscript(plainVideo.title, plainVideo.fileName, plainVideo.file_name, externalVideoId),
    sourceType: plainVideo.sourceType || null,
    sourceUrl: plainVideo.sourceUrl || null,
    youtubeVideoId,
    youtube_video_id: youtubeVideoId,
    uploadedBy: null,
    processing: null,
    videoId: externalVideoId,
    externalVideoId,
    ownership: VIDEO_OWNERSHIP_TYPES.PIPELINE_METADATA,
    fileName: fileName || null,
    filePath: plainVideo.filePath || null,
    durationSec,
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

  return {
    allowedCourseIds,
    allowedVideoIds,
  };
}

function buildCourseVisualSegmentScope(scopedVideos) {
  const allowedVideoIds = new Set();

  for (const video of scopedVideos?.videos || []) {
    addVisualVideoIdentifiers(allowedVideoIds, video);
  }

  return {
    allowedVideoIds,
  };
}

function buildSegmentLookupQuery(scope) {
  const allowedVideoIds = [...scope.allowedVideoIds];
  if (!allowedVideoIds.length) {
    return { _id: { $in: [] } };
  }

  return { videoId: { $in: allowedVideoIds } };
}

function segmentMatchesScope(segment, scope) {
  const videoId = normalizeIdentifier(segment?.videoId);
  if (!videoId) {
    return false;
  }

  return scope.allowedVideoIds.has(videoId);
}

module.exports = {
  COURSE_BRIDGE_MODES,
  VIDEO_OWNERSHIP_TYPES,
  pickFirstDefined,
  normalizeIdentifier,
  normalizeNumber,
  normalizeTranscript,
  normalizeSegment,
  extractPipelineVisualVideoId,
  collectScopedVideos,
  buildCourseBridgeSummary,
  buildCourseBridgePresentation,
  buildVideoBridgePresentation,
  buildCourseSegmentScope,
  buildCourseVisualSegmentScope,
  buildSegmentLookupQuery,
  segmentMatchesScope,
};
