const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const mongoose = require('mongoose');
const { ids, resetStore, store } = require('./helpers/backendTestHarness');
const Video = require('../src/models/video.model');
const env = require('../src/config/env');
const { clearYouTubeCredentials, useYouTubeTestEnvironment } = require('./helpers/youtubeTestEnvironment');

describe('backend harness 的查詢快照與 fixture', () => {
  beforeEach(resetStore);

  it('lean 結果與 store 雙向隔離並保留 Date、ObjectId、Buffer', async () => {
    const source = store.videos[0];
    source.youtubeUpload = { uploadedAt: new Date('2026-01-01'), nested: { count: 1 } };
    source.owner = new mongoose.Types.ObjectId(ids.teacher);
    source.bytes = Buffer.from('fixture');
    const query = Video.findById(source._id).select('_id youtubeUpload').lean();
    source.youtubeUpload.nested.count = 2;
    const read = await query;
    assert.equal(read.youtubeUpload.nested.count, 2); // 求值時才取快照
    source.youtubeUpload.nested.count = 3;
    assert.equal(read.youtubeUpload.nested.count, 2);
    read.youtubeUpload.uploadedAt.setUTCFullYear(2030);
    read.owner.id[0] ^= 1;
    read.bytes[0] = 0;
    assert.equal(source.youtubeUpload.uploadedAt.getUTCFullYear(), 2026);
    assert.equal(source.owner.toHexString(), ids.teacher);
    assert.equal(source.bytes.toString(), 'fixture');
    assert.ok(read.owner instanceof mongoose.Types.ObjectId);
  });

  it('find/findOne/select/populate/sort/limit/lean 保留鏈與原始順序', async () => {
    const order = store.videos.map((video) => video._id);
    const read = await Video.find({}).select('_id').populate('courseId').sort({ _id: -1 }).limit(1).lean();
    assert.equal(read.length, 1);
    assert.ok(read[0].courseId.title);
    const one = await Video.findOne({ _id: order[0] }).select('_id').lean();
    one.title = 'snapshot only';
    assert.notEqual(store.videos[0].title, one.title);
    assert.deepEqual(store.videos.map((video) => video._id), order);
  });

  it('中途失敗仍還原 fetch、主別名憑證與 credential state', async () => {
    const saved = { ...env };
    const fetch = global.fetch;
    let resets = 0;
    try {
      env.youtubeClientId = 'fixture-primary';
      env.youtubeOAuthClientId = 'fixture-alias';
      const restore = useYouTubeTestEnvironment(env, () => { resets += 1; });
      await assert.rejects(async () => {
        try {
          clearYouTubeCredentials(env);
          assert.equal(env.youtubeOAuthClientId, '');
          assert.equal(env.youtubeUploadAccessToken, '');
          global.fetch = undefined;
          throw new Error('injected failure');
        } finally { restore(); }
      }, /injected failure/);
      assert.equal(env.youtubeClientId, 'fixture-primary');
      assert.equal(env.youtubeOAuthClientId, 'fixture-alias');
      assert.equal(global.fetch, fetch);
      assert.equal(resets, 2);
    } finally { Object.assign(env, saved); global.fetch = fetch; }
  });
});
