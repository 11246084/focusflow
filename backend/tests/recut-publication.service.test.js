const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, newObjectId } = require('./helpers/backendTestHarness');
const { makeReview, assetFor, teacher } = require('./helpers/recutReviewFixtures');
const { snapshot } = require('./helpers/recutFixtures');
const state = require('../src/services/recutState.service');
const review = require('../src/services/recutReview.service');
const publish = require('../src/services/shortAssetPublish.service');
const remote = require('../src/services/youtubeRemoteState.service');
const ShortScript = require('../src/models/shortScript.model');
const opts = (f, asset, extra = {}) => ({ scriptId: f.script._id, versionId: f.version._id,
  expectedRevision: snapshot(f.script).revision, assetId: asset._id, generationVersion: 1, user: teacher, ...extra });
async function fixture(ready = false) {
  const f = await makeReview();
  await review.approveScript({ user: teacher, scriptId: f.script._id, versionId: f.version._id, expectedRevision: snapshot(f.script).revision });
  await review.queueRender({ user: teacher, scriptId: f.script._id, versionId: f.version._id, expectedRevision: snapshot(f.script).revision });
  const asset = await assetFor(f);
  Object.assign(asset, { courseId: ids.teacherCourse, title: '交叉測試', filePath: 'owned-fixture.mp4',
    youtubeVideoId: 'recutFake01', youtubeAvailability: 'playable', reviewStatus: 'pending',
    disclosure: { aiDisclosureConfirmed: true, consentConfirmed: true },
    youtubeUpload: { status: 'uploaded', remoteState: ready ? 'ready' : 'processing', attemptId: 'attempt-1', readyAt: ready ? new Date() : null } });
  return { f, asset };
}
const readyFetch = async () => ({ ok: true, json: async () => ({ items: [{ id: 'recutFake01',
  status: { privacyStatus: 'unlisted', uploadStatus: 'processed', embeddable: true } }] }) });
describe('recut 審核與 YouTube ready 交叉閘門', () => {
  beforeEach(async () => { await resetStore(); require('../src/config/env').youtubeUploadAccessToken = 'fake-only'; });
  it('ready先到，核准同時寫兩份證據並同步published；相同請求可重送', async () => {
    const { f, asset } = await fixture(true); const input = opts(f, asset);
    await review.approveAsset(input);
    assert.equal(asset.reviewStatus, 'approved'); assert.equal(asset.reviewedGenerationVersion, 1);
    assert.equal(asset.status, 'published'); assert.equal(snapshot(f.script).state, 'published');
    await review.approveAsset(input);
    assert.equal(store.recutApprovals.filter((a) => a.type === 'asset').length, 1);
    assert.equal(asset.reviewHistory.length, 1);
  });
  it('核准先到仍draft，真正ready回呼才發布並同步狀態', async () => {
    const { f, asset } = await fixture();
    await review.approveAsset(opts(f, asset)); assert.equal(asset.status, 'draft');
    await remote.checkItemRemoteState({ kind: 'short_asset', item: asset, fetchImpl: readyFetch });
    assert.equal(asset.status, 'published'); assert.equal(snapshot(f.script).state, 'published');
  });
  it('published資產在script狀態提交失敗後，ready重送補同步且不重發核准', async () => {
    const { f, asset } = await fixture(true); const input = opts(f, asset);
    const original = ShortScript.findOneAndUpdate; let fail = true;
    ShortScript.findOneAndUpdate = async (query, update, options) => {
      if (fail && update.$set?.recut?.state === 'published') { fail = false; throw new Error('injected persistence failure'); }
      return original(query, update, options);
    };
    try { await assert.rejects(review.approveAsset(input), /persistence failure/); }
    finally { ShortScript.findOneAndUpdate = original; }
    assert.equal(asset.status, 'published'); assert.equal(snapshot(f.script).state, 'asset_approved');
    await remote.checkItemRemoteState({ kind: 'short_asset', item: asset, fetchImpl: readyFetch });
    assert.equal(snapshot(f.script).state, 'published');
  });
  it('即使遠端ready，舊version/asset/generation核准不能發布新版', async () => {
    const { f, asset } = await fixture(true); await review.approveAsset(opts(f, asset));
    asset.generationVersion = 2; asset.status = 'draft'; f.script.recut.currentAssetGenerationVersion = 2;
    await assert.rejects(publish.markShortAssetPublished(asset), { code: 'SHORT_ASSET_NOT_APPROVED' });
    asset.reviewedGenerationVersion = 2;
    await assert.rejects(publish.markShortAssetPublished(asset), { code: 'RECUT_STATE_INVALID' });
    asset.generationVersion = 1; asset.reviewedGenerationVersion = 1; f.script.recut.currentAssetGenerationVersion = 1;
    f.script.recut.currentAssetId = newObjectId();
    await assert.rejects(publish.markShortAssetPublished(asset), { code: 'RECUT_STATE_INVALID' });
  });
  for (const scope of ['presentation', 'content']) it(`${scope}退回撤銷對應核准並清除成品，新MP4必重審`, async () => {
    const { f, asset } = await fixture();
    // No remote ID avoids any network on rejection; archival remains local.
    asset.youtubeVideoId = null;
    await review.approveAsset(opts(f, asset));
    await review.rejectAsset(opts(f, asset, { scope, reasons: [{ code: 'visualQuality' }] }));
    assert.equal(asset.reviewStatus, 'rejected'); assert.equal(asset.status, 'draft');
    assert.equal(snapshot(f.script).currentAssetId, null);
    assert.equal(snapshot(f.script).state, scope === 'presentation' ? 'script_approved' : 'script_review');
    assert.ok(store.recutApprovals.find((a) => a.type === 'asset').revokedAt);
    assert.equal(Boolean(store.recutApprovals.find((a) => a.type === 'script').revokedAt), scope === 'content');
    assert.equal(store.recutReviewEvents.filter((e) => e.kind === 'asset_rejection').length, 1);
    await assert.rejects(publish.markShortAssetPublished(asset));
  });
});
