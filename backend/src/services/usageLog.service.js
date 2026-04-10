const UsageLog = require('../models/usageLog.model');

async function recordUsage({ userId, courseId = null, event, durationSec = null, metadata = {} }) {
  try {
    await UsageLog.create({
      userId,
      courseId,
      event,
      durationSec,
      metadata,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Failed to record usage log.', error);
    }
  }
}

module.exports = {
  recordUsage,
};
