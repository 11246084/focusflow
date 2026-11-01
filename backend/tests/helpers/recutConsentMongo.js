const mongoose = require('mongoose');
const Consent = require('../../src/models/recutConsent.model');
const Course = require('../../src/models/course.model');
const Video = require('../../src/models/video.model');
const { createMongoRepository } = require('../../src/services/recutConsent.repository');

async function connect(dbName) {
  if (!/^recut_consent_test_[a-f0-9_]+$/.test(dbName)) throw new Error('Dedicated test database required.');
  // A fixed loopback-only endpoint. No URI/config/environment fallback is allowed.
  const connection = await mongoose.createConnection(`mongodb://127.0.0.1:27031/${dbName}`, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000,
  }).asPromise();
  const models = { ConsentModel: connection.model('RecutConsent', Consent.schema),
    CourseModel: connection.model('Course', Course.schema), VideoModel: connection.model('Video', Video.schema) };
  return { connection, models, repository: createMongoRepository(models) };
}
module.exports = { connect };
