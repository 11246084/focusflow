const assert = require('node:assert/strict');
const { beforeEach, afterEach, describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resetStore, store, ids, newObjectId } = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const Video = require('../src/models/video.model');
const RuntimeSetting = require('../src/models/runtimeSetting.model');
const upload = require('../src/services/youtubeUpload.service');
const gate = require('../src/services/youtubeUploadGate.service');
const ownership = require('../src/services/youtubeWorkOwnership.service');
const quarantine = require('../src/services/youtubeQuarantine.service');
const { releaseWaitingUploads } = require('../src/scripts/releaseWaitingYouTubeUploads');
const NOW = new Date('2026-10-28T01:00:00Z');
function response(payload, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => payload, text: async () => JSON.stringify(payload) };
}
function fakeUpload(calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('uploadType=resumable')) return response({}, 200, { location: 'https://session.invalid/private-capability' });
    if (options.body?.resume) { for await (const _ of options.body) {} return response({ id: 'qaVideo1234', status: { privacyStatus: 'unlisted' } }, 201); }
    return response({ items: [{ id: 'qaVideo1234', status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded', embeddable: true } }] });
  };
}
describe('Q-A quota and resumable send boundary', () => {
  let saved; let temp; let originals;
  beforeEach(() => {
    resetStore(); upload.resetYouTubeUploadState();
    saved = { ...env };
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-qa-owned-'));
    Object.assign(env, { uploadDir: temp, youtubeUploadEnabled: true, youtubeUploadAccessToken: 'fake-token',
      youtubeUploadMaxAttempts: 3, youtubeUploadRecoveryEnabled: true, youtubeUploadRecoveryBatchSize: 100,
      shortScriptAutomationEnabled: false });
    store.videos = []; store.shortAssets = [];
    originals = { cas: Video.findOneAndUpdate, settings: RuntimeSetting.findOne, settingsCas: RuntimeSetting.findOneAndUpdate, verify: quarantine.verifyOwnYouTubeVideo };
  });
  afterEach(() => {
    Video.findOneAndUpdate = originals.cas; RuntimeSetting.findOne = originals.settings; RuntimeSetting.findOneAndUpdate = originals.settingsCas;
    quarantine.verifyOwnYouTubeVideo = originals.verify;
    Object.assign(env, saved); upload.resetYouTubeUploadState();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  function add(state = {}) {
    const filePath = path.join(temp, `${newObjectId()}.mp4`); fs.writeFileSync(filePath, 'owned test media');
    const item = { _id: newObjectId(), courseId: ids.teacherCourse, uploadedBy: ids.teacher, title: 'Q-A fixture',
      processing: { status: 'completed' }, filePath, videoSource: 'upload', sourceUrl: '/uploads/original', videoUrl: '/uploads/original',
      youtubeVideoId: null, youtubeUpload: { attemptCount: 0, ...state } };
    store.videos.push(item); return item;
  }
  it('QA-T1 classifies daily/channel/rate/unknown and honors Retry-After', () => {
    for (const [status, body, expected] of [
      [403, { error: { errors: [{ reason: 'quotaExceeded' }] } }, 'api_daily'],
      [429, { error: { message: 'Video Uploads per day' } }, 'api_daily'],
      [400, { error: { errors: [{ reason: 'uploadLimitExceeded' }] } }, 'channel_limit'],
      [429, { error: { message: 'slow down' } }, 'rate_limit'], [500, 'not json', 'unknown'],
    ]) assert.equal(gate.classifyUploadSessionError(status, body, '120', NOW).type, expected);
    assert.equal(gate.classifyUploadSessionError(429, {}, '120', NOW).retryAt - NOW, 120000);
  });
  it('QA-T4 Pacific midnight follows DST in November', () => {
    assert.equal(gate.nextPacificReset(new Date('2026-10-31T23:00:00Z')).toISOString(), '2026-11-01T07:10:00.000Z');
    assert.equal(gate.nextPacificReset(new Date('2026-11-01T23:00:00Z')).toISOString(), '2026-11-02T08:10:00.000Z');
  });
  it('QA-T3 both independent pauses must expire', async () => {
    store.runtimeSettings.push({ key: gate.PAUSE_KEY, value: { apiQuota: { since: NOW, until: NOW }, channelLimit: { since: NOW, until: new Date(+NOW + 50000) } } });
    const snapshot = await gate.getUploadPauseSnapshot({ now: NOW });
    assert.equal(snapshot.paused, true); assert.equal(+snapshot.earliestRetryAt, +NOW + 50000);
  });
  it('QA-T5 gate has one winner and QA-T6 old owner cannot release successor', async () => {
    const leases = await Promise.all([gate.acquireUploadGate(), gate.acquireUploadGate()]);
    assert.equal(leases.filter(Boolean).length, 1);
    const first = leases.find(Boolean); const record = store.runtimeSettings.find((item) => item.key === gate.GATE_KEY);
    record.value.leaseUntil = new Date(0);
    const second = await gate.acquireUploadGate(); assert.ok(second);
    await first.release(); assert.equal(record.value.ownerToken, second.ownerToken); await second.release();
  });
  it('QA-T5 busy gate polls every 500ms for 30 seconds before yielding', async () => {
    const held = await gate.acquireUploadGate(); const sleeps = [];
    assert.equal(await gate.waitForUploadGate({ sleep: async (ms) => { sleeps.push(ms); } }), null);
    assert.equal(sleeps.length, 60); assert.ok(sleeps.every((ms) => ms === 500));
    await held.release();
  });
  it('QA-T2 paused auto and recovery never contact YouTube; teacher gets public earliestRetryAt', async () => {
    const video = add(); const until = new Date(Date.now() + 86400000);
    store.runtimeSettings.push({ key: gate.PAUSE_KEY, value: { apiQuota: { since: NOW, until } } });
    const fetchImpl = () => assert.fail('No external request during pause');
    await upload.autoUploadVideoToYouTube(video._id, { fetchImpl, now: NOW });
    assert.equal(video.youtubeUpload.status, 'waiting'); assert.equal(video.youtubeUpload.attemptCount, 0);
    await assert.rejects(upload.scheduleYouTubeUploadRetry(video._id, { id: ids.teacher, role: 'teacher' }, { fetchImpl }),
      (error) => error.code === 'YOUTUBE_UPLOAD_QUOTA_WAITING' && +new Date(error.publicDetails.earliestRetryAt) === +until);
    await upload.recoverPendingYouTubeUploads({ fetchImpl, now: NOW });
  });
  for (const operation of ['pause read', 'gate acquire', 'session save']) it(`QA-T7 ${operation} DB failure prevents media send`, async () => {
    const video = add(); const calls = [];
    if (operation === 'pause read') RuntimeSetting.findOne = () => { throw new Error('DB read failure'); };
    if (operation === 'gate acquire') RuntimeSetting.findOneAndUpdate = () => { throw new Error('DB gate failure'); };
    if (operation === 'session save') Video.findOneAndUpdate = (query, update, opts) => {
      if (update?.$set?.['youtubeUpload.phase'] === 'session_saved') throw new Error('DB save failure');
      return originals.cas(query, update, opts);
    };
    await upload.autoUploadVideoToYouTube(video._id, { fetchImpl: fakeUpload(calls), now: NOW });
    assert.equal(calls.filter((call) => call.options.body?.resume).length, 0);
    if (operation !== 'session save') assert.equal(calls.length, 0);
  });
  it('QA-T8 three real blocked cycles notify once and never consume item retries', async () => {
    const video = add();
    const fetchImpl = async () => response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
    for (let round = 0; round < 4; round += 1) {
      const now = new Date(+NOW + round * 86400000);
      video.youtubeUpload.nextRetryAt = now;
      await upload.autoUploadVideoToYouTube(video._id, { fetchImpl, now });
    }
    assert.equal(video.youtubeUpload.status, 'waiting'); assert.equal(video.youtubeUpload.attemptCount, 0);
    assert.equal(store.notifications.filter((item) => item.dedupeKey?.startsWith('youtube_upload_blocked_rounds:')).length, 1);
  });
  for (const ambiguous of [false, true]) it(`QA-T9/T18 sending CAS ${ambiguous ? 'applied then timeout' : 'rejected'} sends no media`, async () => {
    const video = add(); const calls = [];
    Video.findOneAndUpdate = (query, update, opts) => {
      if (update?.$set?.['youtubeUpload.phase'] === 'sending') {
        if (ambiguous) originals.cas(query, update, opts);
        throw new Error('CAS result unavailable');
      }
      return originals.cas(query, update, opts);
    };
    await upload.autoUploadVideoToYouTube(video._id, { fetchImpl: fakeUpload(calls), now: NOW });
    assert.equal(calls.filter((call) => call.options.body?.resume).length, 0);
    assert.equal(video.youtubeUpload.retrySafe, false);
    assert.equal(video.youtubeUpload.status, 'uploading', 'ambiguous boundary remains recoverable via one status query');
  });
  for (const phase of ['claimed', 'session_saved']) it(`QA-T10 stale ${phase} rotates attempt and preserves retry budget`, async () => {
    const video = add({ status: 'uploading', phase, attemptId: 'old', attemptCount: 1, heartbeatAt: new Date(0), lastAttemptAt: new Date(0) });
    await upload.recoverStaleUpload({ model: Video, kind: 'video', item: structuredClone(video), now: NOW, fetchImpl: () => assert.fail('no request') });
    assert.equal(video.youtubeUpload.status, 'failed'); assert.equal(video.youtubeUpload.retrySafe, true);
    assert.notEqual(video.youtubeUpload.attemptId, 'old'); assert.equal(video.youtubeUpload.attemptCount, 0);
  });
  for (const status of [201, 308, 404, 'network']) it(`QA-T12/14 sending recovery status ${status} never creates session or follows redirect`, async () => {
    const video = add({ status: 'uploading', phase: 'sending', attemptId: 'old', attemptCount: 1, heartbeatAt: new Date(0), lastAttemptAt: new Date(0),
      session: { url: 'https://session.invalid/private-capability', fileSize: 16 } });
    const calls = [];
    quarantine.verifyOwnYouTubeVideo = async () => ({ privacyStatus: 'unlisted', snippet: { description: `Uploaded by FocusFlow (video ${video._id}).` } });
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('session.invalid')) {
        assert.equal(options.redirect, 'manual'); assert.equal(options.headers['Content-Range'], 'bytes */16');
        if (status === 'network') throw new Error('offline');
        return response({ id: 'qaVideo1234' }, status, { location: 'https://redirect.invalid' });
      }
      return response({ items: [{ id: 'qaVideo1234', status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } }] });
    };
    await upload.recoverStaleUpload({ model: Video, kind: 'video', item: structuredClone(video), now: NOW, fetchImpl });
    assert.equal(video.youtubeUpload.status, status === 201 ? 'uploaded' : 'failed');
    assert.equal(video.youtubeUpload.retrySafe, false);
    assert.equal(calls.filter((call) => call.options.method === 'POST').length, 0);
    assert.equal(JSON.stringify(video.youtubeUpload.error || '').includes('private-capability'), false);
    if (status !== 201) assert.match(video.youtubeUpload.error, /不能據此推定 YouTube 上沒有影片/);
  });
  it('QA-T14/#48 Range response persists received/total MB and warns against assuming no remote video', async () => {
    const video = add({ status: 'uploading', phase: 'sending', attemptId: 'old', heartbeatAt: new Date(0), lastAttemptAt: new Date(0),
      session: { url: 'https://session.invalid/private-capability', fileSize: 4 * 1024 ** 2 } });
    await upload.recoverStaleUpload({ model: Video, kind: 'video', item: structuredClone(video), now: NOW,
      fetchImpl: async (_url, options) => { assert.equal(options.redirect, 'manual'); return response({}, 308, { range: `bytes=0-${2 * 1024 ** 2 - 1}` }); } });
    assert.equal(video.youtubeUpload.retrySafe, false);
    assert.match(video.youtubeUpload.error, /已接收 2\.00\/4\.00 MB/);
    assert.match(video.youtubeUpload.error, /不能據此推定 YouTube 上沒有影片/);
  });
  it('QA-T14 HTTP 200 with status override 308 stays incomplete', async () => {
    const result = await upload.queryUploadSession({ session: { url: 'https://session.invalid', fileSize: 10 },
      fetchImpl: async (_url, options) => { assert.equal(options.redirect, 'manual'); return response({}, 200, { 'x-http-status-code-override': '308' }); } });
    assert.equal(result.status, 308); assert.equal(result.result, 'incomplete');
  });
  it('QA-T13 late success appends orphan and leaves current attempt/backup ownership intact', async () => {
    const video = add(); const calls = [];
    const fake = fakeUpload(calls);
    const result = await upload.autoUploadVideoToYouTube(video._id, { now: NOW, fetchImpl: async (url, options) => {
      const res = await fake(url, options);
      if (options.body?.resume) video.youtubeUpload.attemptId = 'successor';
      return res;
    } });
    assert.equal(result, null); assert.equal(video.youtubeUpload.attemptId, 'successor');
    assert.equal(video.youtubeVideoId, null); assert.equal(video.youtubeUpload.orphanUploads.length, 1); assert.equal(store.youtubeBackups.length, 0);
  });
  it('QA-T16 legacy unknown phase performs one query then quarantines', async () => {
    const video = add({ status: 'uploading', attemptId: 'old', heartbeatAt: new Date(0), lastAttemptAt: new Date(0), session: { url: 'https://session.invalid', fileSize: 10 } });
    let calls = 0;
    await upload.recoverStaleUpload({ model: Video, kind: 'video', item: structuredClone(video), now: NOW,
      fetchImpl: async (_url, options) => { calls += 1; assert.equal(options.method, 'PUT'); return response({}, 404); } });
    assert.equal(calls, 1); assert.equal(video.youtubeUpload.retrySafe, false);
  });
  it('QA-T17 waiting claim requires due time; probe alone can bypass due guard', () => {
    const item = add({ status: 'waiting', nextRetryAt: new Date(+NOW + 10000) });
    const normal = ownership.uploadClaimQuery(item, { now: NOW }); const probe = ownership.uploadClaimQuery(item, { now: NOW, probe: true });
    assert.deepEqual(normal.$and[1].$or[2]['youtubeUpload.nextRetryAt'], { $lte: NOW });
    assert.equal(probe.$and[1].$or[2]['youtubeUpload.nextRetryAt'], undefined);
  });
  it('QA-T19 rollback preview does not write and --write preserves attemptCount', async () => {
    const video = add({ status: 'waiting', attemptCount: 2 });
    assert.equal((await releaseWaitingUploads()).changed, 0); assert.equal(video.youtubeUpload.status, 'waiting');
    assert.equal((await releaseWaitingUploads({ write: true, now: NOW })).changed, 1);
    assert.equal(video.youtubeUpload.status, 'failed'); assert.equal(video.youtubeUpload.retrySafe, true); assert.equal(video.youtubeUpload.attemptCount, 2);
  });
  it('probe takes exactly one future waiting item and clears both restrictions after success', async () => {
    const one = add({ status: 'waiting', nextRetryAt: new Date(+NOW + 100000), queuedAt: NOW });
    const two = add({ status: 'waiting', nextRetryAt: new Date(+NOW + 100000), queuedAt: new Date(+NOW + 1) });
    store.runtimeSettings.push({ key: gate.PAUSE_KEY, value: { apiQuota: { since: NOW, until: new Date(+NOW + 100000) }, channelLimit: { since: NOW, until: new Date(+NOW + 200000) } } });
    const result = await gate.runUploadProbe({ actor: { id: ids.admin }, fetchImpl: fakeUpload(), now: NOW });
    assert.equal(result.succeeded, true); assert.equal(one.youtubeUpload.status, 'uploaded'); assert.equal(two.youtubeUpload.status, 'waiting');
    const snapshot = await gate.getUploadPauseSnapshot({ now: NOW }); assert.equal(snapshot.paused, false); assert.equal(snapshot.probe, null);
    const audit = snapshot.log.find((entry) => entry.type === 'probe');
    assert.equal(audit.by, ids.admin); assert.equal(audit.result, 'success'); assert.ok(audit.startedAt); assert.ok(audit.finishedAt);
  });
  it('probe rejects duplicate click while a fresh persisted marker exists', async () => {
    store.runtimeSettings.push({ key: gate.PAUSE_KEY, value: { probe: { startedAt: NOW, by: ids.admin } } });
    await assert.rejects(gate.runUploadProbe({ actor: ids.admin, now: NOW, fetchImpl: () => assert.fail('duplicate cannot contact YouTube') }), { code: 'YOUTUBE_UPLOAD_PROBE_RUNNING' });
  });
  it('probe recovers a dead marker only after checking active attempt heartbeats and gate', async () => {
    const prior = { startedAt: new Date(+NOW - 901000), by: ids.admin };
    store.runtimeSettings.push({ key: gate.PAUSE_KEY, value: { probe: prior } });
    const active = add({ status: 'uploading', heartbeatAt: new Date(), attemptId: 'active' });
    await assert.rejects(gate.runUploadProbe({ actor: ids.admin, now: NOW, fetchImpl: () => assert.fail('live attempt blocks takeover') }), { code: 'YOUTUBE_UPLOAD_PROBE_RUNNING' });
    active.youtubeUpload.heartbeatAt = new Date(0);
    const lease = await gate.acquireUploadGate();
    await assert.rejects(gate.runUploadProbe({ actor: ids.admin, now: NOW }), { code: 'YOUTUBE_UPLOAD_PROBE_RUNNING' });
    await lease.release();
    const result = await gate.runUploadProbe({ actor: ids.admin, now: NOW });
    assert.equal(result.reason, 'no_waiting_upload'); assert.equal((await gate.getUploadPauseSnapshot({ now: NOW })).probe, null);
    assert.equal((await gate.getUploadPauseSnapshot({ now: NOW })).log.at(-1).result, 'no_waiting_upload');
  });
});
