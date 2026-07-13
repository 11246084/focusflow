const UsageLog = require('../models/usageLog.model');

async function recordUsage({ userId, courseId = null, event, durationSec = null, metadata = {} }) {
  try {
    return await UsageLog.create({
      userId,
      courseId,
      event,
      durationSec,
      metadata,
      timestamp: new Date(),
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('Failed to record usage log.', error);
    }
    return null;
  }
}

module.exports = {
  recordUsage,
};
