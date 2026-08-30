const env = require('../config/env');
const logger = require('../utils/logger');

function buildStudentPilotFlagSnapshot(config = env) {
  return {
    STUDENT_PILOT_MODE: config.studentPilotMode,
    QA_VECTOR_SEARCH_MODE: config.qaVectorSearchMode,
    FAQ_CACHE_ENABLED: config.faqCacheEnabled,
    HIERARCHICAL_RETRIEVAL_ENABLED: config.hierarchicalRetrievalEnabled,
    HIERARCHICAL_RETRIEVAL_ROLLOUT_MODE: config.hierarchicalRetrievalRolloutMode,
    VIDEO_BATCH_PIPELINE_ENABLED: config.videoBatchPipelineEnabled,
    YOUTUBE_UPLOAD_ENABLED: config.youtubeUploadEnabled,
    YOUTUBE_UPLOAD_RECOVERY_ENABLED: config.youtubeUploadRecoveryEnabled,
    YOUTUBE_UPLOAD_CLEANUP_ENABLED: config.youtubeUploadCleanupEnabled,
    YOUTUBE_PRIVATIZE_ON_DELETE: config.youtubePrivatizeOnDelete,
    DEMO_SEED_ENABLED: config.demoSeedEnabled,
    MAX_CONVERSATION_TURNS: config.maxConversationTurns,
  };
}

function validateStudentPilotRuntime(config = env, runtimeLogger = logger) {
  if (!config.studentPilotMode) {
    return { enabled: false, snapshot: null };
  }

  if (config.qaVectorSearchMode !== 'atlas') {
    throw new Error(
      'STUDENT_PILOT_MODE requires QA_VECTOR_SEARCH_MODE=atlas; memory mode cannot be used for the student pilot.',
    );
  }

  if (!config.youtubeUploadEnabled) {
    throw new Error(
      'STUDENT_PILOT_MODE requires YOUTUBE_UPLOAD_ENABLED=true; 新上傳影片將無播放來源。',
    );
  }

  const snapshot = buildStudentPilotFlagSnapshot(config);
  runtimeLogger.warn('runtime.flag_snapshot', snapshot);
  return { enabled: true, snapshot };
}

module.exports = {
  buildStudentPilotFlagSnapshot,
  validateStudentPilotRuntime,
};
