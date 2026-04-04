const Video = require('../models/video.model');
const { VIDEO_PROCESSING_STATUSES } = require('../constants/enums');

async function queueVideoForProcessing(videoId) {
  // TODO: replace this with a real background job when STT/chunking is wired in.
  return Video.findByIdAndUpdate(
    videoId,
    {
      $set: {
        'processing.status': VIDEO_PROCESSING_STATUSES.QUEUED,
        'processing.errorMessage': null,
      },
    },
    {
      new: true,
    },
  );
}

module.exports = {
  queueVideoForProcessing,
};
