const Consent = require('../models/recutConsent.model');
const Course = require('../models/course.model');
const Video = require('../models/video.model');

function createMongoRepository({ ConsentModel = Consent, CourseModel = Course, VideoModel = Video } = {}) {
  return {
    getCourse: (id) => CourseModel.findById(id).lean(),
    getVideo: (id) => VideoModel.findById(id).lean(),
    getSource: (sourceId, courseId) => VideoModel.findOne({ courseId, videoId: sourceId }).lean(),
    async read(teacherId) {
      return await ConsentModel.findOne({ teacherId }).lean()
        || { teacherId: String(teacherId), revision: 0, records: [], withdrawals: [] };
    },
    async commit(before, { record, withdrawals }) {
      const update = { $inc: { revision: 1 }, $set: { withdrawals } };
      if (record) update.$push = { records: record };
      try {
        const result = await ConsentModel.updateOne(
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
    listPending: () => ConsentModel.find({ withdrawals: { $elemMatch: { status: { $ne: 'completed' } } } }).lean(),
    listManualActions: () => ConsentModel.find({ 'withdrawals.actions.manualActionRequired': true }).lean(),
  };
}
module.exports = { createMongoRepository };
