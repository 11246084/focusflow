const Consent = require('../models/recutConsent.model');
const Course = require('../models/course.model');
const Video = require('../models/video.model');

function createMongoRepository() {
  return {
    getCourse: (id) => Course.findById(id).lean(),
    getVideo: (id) => Video.findById(id).lean(),
    getSource: (sourceId, courseId) => Video.findOne({ courseId, videoId: sourceId }).lean(),
    async read(teacherId) {
      return await Consent.findOne({ teacherId }).lean()
        || { teacherId: String(teacherId), revision: 0, records: [], withdrawals: [] };
    },
    async commit(before, { record, withdrawals }) {
      const update = { $inc: { revision: 1 }, $set: { withdrawals } };
      if (record) update.$push = { records: record };
      try {
        const result = await Consent.updateOne(
          { teacherId: before.teacherId, revision: before.revision },
          update,
          { upsert: before.revision === 0, runValidators: true, setDefaultsOnInsert: false },
        );
        return Boolean(result.modifiedCount || result.upsertedCount);
      } catch (error) {
        // Concurrent first write / stale revision loses the CAS, never replaces history.
        if (error.code === 11000) return false;
        throw error;
      }
    },
    listPending: () => Consent.find({ 'withdrawals.status': { $ne: 'completed' }, 'withdrawals.0': { $exists: true } }).lean(),
    listManualActions: () => Consent.find({ 'withdrawals.actions.manualActionRequired': true }).lean(),
  };
}
module.exports = { createMongoRepository };
