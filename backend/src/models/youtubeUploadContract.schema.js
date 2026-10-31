const mongoose = require('mongoose');

// Q-0 的影片與短片共用欄位；每次產生獨立 schema，保留兩種既有子文件預設。
function youtubeUploadContractFields({ video = false } = {}) {
  return {
    waitReason: { type: String, enum: ['api_quota', 'channel_limit', 'gate_busy', null], default: null },
    queuedAt: { type: Date, default: null },
    phase: { type: String, enum: ['claimed', 'session_saved', 'sending', null], default: null },
    session: {
      type: new mongoose.Schema({
        url: { type: String, select: false },
        fileSize: { type: Number, min: 0 },
        createdAt: { type: Date },
      }, { _id: false }),
      default: null,
    },
    orphanUploads: {
      type: [new mongoose.Schema({
        youtubeVideoId: String, attemptId: String, detectedAt: Date,
      }, { _id: false })],
      default: [],
    },
    ...(video ? { privacyStatus: { type: String, default: null } } : {}),
    remoteState: { type: String, enum: ['processing', 'ready', 'blocked', null], default: null },
    blockedReason: { type: String, default: null },
    readyAt: { type: Date, default: null },
    lastCheckAt: { type: Date, default: null },
    lastCheckError: { type: String, default: null },
    privacyIncidents: {
      type: [new mongoose.Schema({
        detectedAt: Date, observed: String, action: String, result: String, actor: String,
      }, { _id: false })],
      default: [],
    },
  };
}

module.exports = { youtubeUploadContractFields };
