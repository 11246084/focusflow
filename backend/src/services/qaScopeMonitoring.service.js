const logger = require('../utils/logger');
const { segmentMatchesScope } = require('./bridgeScope.service');

function logScopeEmpty({
  courseId = null,
  userId = null,
  searchMode = null,
  reason = 'canonical_video_scope_empty',
} = {}, runtimeLogger = logger) {
  runtimeLogger.warn('qa.scope_empty', {
    courseId: courseId == null ? null : String(courseId),
    userId: userId == null ? null : String(userId),
    searchMode: searchMode == null ? null : String(searchMode),
    reason: String(reason),
  });
}

function filterCandidatesByScope(candidates, {
  scope,
  courseId = null,
  reason = 'candidate_outside_canonical_scope',
  getSegment = (candidate) => candidate,
} = {}, runtimeLogger = logger) {
  const items = Array.isArray(candidates) ? candidates : [];
  const accepted = [];
  let droppedCount = 0;

  for (const candidate of items) {
    if (segmentMatchesScope(getSegment(candidate), scope)) {
      accepted.push(candidate);
    } else {
      droppedCount += 1;
    }
  }

  if (droppedCount > 0) {
    runtimeLogger.warn('qa.scope_mismatch_dropped', {
      courseId: courseId == null ? null : String(courseId),
      droppedCount,
      totalCount: items.length,
      reason: String(reason),
    });
  }

  return accepted;
}

module.exports = {
  filterCandidatesByScope,
  logScopeEmpty,
};
