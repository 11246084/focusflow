// Explicit negative deployment check. Point only at a fresh standalone loopback
// Mongo instance; the normal youtube suite requires a replica set.
require('./helpers/youtubeReviewFixture');
const { it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { openIsolatedYouTubeMongo } = require('./helpers/isolatedYouTubeMongo');
const { deleteCourse } = require('../src/services/course.service');

it('NR02 standalone Mongo 回 503 且所有資料保持原狀', async () => {
  const uri = process.env.YOUTUBE_TEST_MONGODB_URI;
  const isolated = await openIsolatedYouTubeMongo(uri);
  try {
    await mongoose.connect(uri, { dbName: isolated.databaseName, autoIndex: false, autoCreate: false });
    const db = mongoose.connection.db;
    const hello = await db.admin().command({ hello: 1 }); assert.equal(hello.setName, undefined, 'this test requires standalone Mongo');
    const courseId = new mongoose.Types.ObjectId(); const teacherId = new mongoose.Types.ObjectId();
    await db.collection('courses').insertOne({ _id: courseId, teacherId, title: 'Fixture', status: 'published' });
    await db.collection('videos').insertOne({ courseId, title: 'Fixture' });
    await db.collection('enrollments').insertOne({ courseId, studentId: teacherId });
    const snapshot = async () => JSON.stringify(await Promise.all(['courses', 'videos', 'enrollments'].map((name) => db.collection(name).find({}).toArray())));
    const before = await snapshot();
    await assert.rejects(deleteCourse(String(courseId), { id: String(teacherId), role: 'admin' }), { code: 'COURSE_DELETE_UNAVAILABLE', statusCode: 503 });
    assert.equal(await snapshot(), before);
  } finally { await mongoose.disconnect(); await isolated.close(); }
});
