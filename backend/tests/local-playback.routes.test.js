const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ids, resetStore, startServer, stopServer, loginAs, store, env, cleanupTestUploads } = require('./helpers/backendTestHarness');

test('protected source checks every GET and HEAD, supports Range and blocks public uploads', async () => {
  resetStore();
  env.localPlaybackEnabled = true; env.mediaAccelRedirectEnabled = false;
  const server = await startServer();
  const file = path.join(env.uploadDir, 'test-upload-中文 source.mp4');
  try {
    fs.writeFileSync(file, '0123456789');
    const video = store.videos.find((v) => v._id === ids.publishedVideo);
    video.filePath = file; video.videoSource = 'upload';
    const student = await loginAs(server.baseUrl, 'student@focusflow.local', 'Student123!');
    const teacher = await loginAs(server.baseUrl, 'teacher@focusflow.local', 'Teacher123!');
    const url = `${server.baseUrl}/api/v1/videos/${ids.publishedVideo}/source`;
    const req = (token, options = {}) => fetch(url, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
    assert.equal((await req(null)).status, 401);
    const ranged = await req(student, { headers: { Range: 'bytes=2-4' } });
    assert.equal(ranged.status, 206); assert.equal(ranged.headers.get('content-range'), 'bytes 2-4/10'); assert.equal(await ranged.text(), '234');
    assert.equal(ranged.headers.get('cache-control'), 'private, no-store');
    assert.equal((await req(student, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/uploads/${encodeURIComponent(path.basename(file))}`)).status, 404);
    const enrollment = store.enrollments.find((e) => String(e.courseId) === ids.publishedCourse);
    store.enrollments = store.enrollments.filter((e) => String(e.courseId) !== ids.publishedCourse);
    const forbidden = await req(student, { method: 'HEAD' }); assert.equal(forbidden.status, 403); assert.equal(forbidden.headers.get('x-accel-redirect'), null);
    video.videoSource = 'youtube';
    assert.equal((await req(student)).status, 403);
    store.enrollments.push(enrollment);
    assert.equal((await req(student)).status, 409);
    assert.equal((await req(teacher)).status, 200);
    env.mediaAccelRedirectEnabled = true;
    const accel = await req(teacher, { method: 'HEAD' });
    assert.equal(accel.status, 200); assert.match(accel.headers.get('x-accel-redirect'), /%E4%B8%AD%E6%96%87%20source/);
    video.filePath = __filename;
    const outside = await req(teacher); assert.equal(outside.status, 409); assert.equal(outside.headers.get('x-accel-redirect'), null);
    env.localPlaybackEnabled = false; assert.equal((await req(teacher)).status, 409);
  } finally { env.localPlaybackEnabled = false; env.mediaAccelRedirectEnabled = false; await stopServer(server.server); cleanupTestUploads(); }
});
