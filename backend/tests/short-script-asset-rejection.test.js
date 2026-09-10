const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const ShortAsset = require('../src/models/shortAsset.model');
const ShortScript = require('../src/models/shortScript.model');
const shortAssetService = require('../src/services/shortAsset.service');
const shortScriptService = require('../src/services/shortScript.service');
const { ids, store, newObjectId, resetStore } = require('./helpers/backendTestHarness');

const TEACHER = { id: ids.teacher, role: 'teacher' };

// 建立一份「已核准、教師已照著拍完」的腳本，兩個版本用來驗證回饋寫在正確的那一版。
function addScript({ status = 'approved', versionCount = 2 } = {}) {
  const versions = [];
  for (let index = 1; index <= versionCount; index += 1) {
    versions.push({
      versionNo: index,
      payload: { shots: [] },
      generatedAt: '2026-09-01T00:00:00.000Z',
      feedback: null,
      feedbackType: null,
      reviewedBy: null,
      reviewedAt: null,
      evidenceFrozenAt: '2026-09-01T00:00:00.000Z',
      rejectedAsAsset: false,
    });
  }

  const script = {
    _id: newObjectId(),
    courseId: ids.teacherCourse,
    topic: '什麼是過擬合',
    topicKey: '什麼是過擬合',
    sourceQuestions: [],
    evidence: [],
    evidenceFrozenAt: '2026-09-01T00:00:00.000Z',
    versions,
    status,
    createdBy: ids.teacher,
  };
  store.shortScripts.push(script);
  return script;
}

async function addAsset({ scriptId = null, versionNo = null } = {}) {
  return shortAssetService.createShortAsset({
    courseId: ids.teacherCourse,
    sourceVideoId: ids.teacherVideo,
    title: '過擬合短影片',
    sourceScriptId: scriptId,
    sourceVersionNo: versionNo,
  });
}

function reject(assetId, reasons) {
  return shortAssetService.reviewShortAsset({
    assetId,
    user: TEACHER,
    status: 'rejected',
    expectedGenerationVersion: 1,
    reasons,
    now: new Date('2026-09-09T00:00:00.000Z'),
  });
}

describe('成品退回 → 腳本重生（規格書 DR-20）', () => {
  beforeEach(() => resetStore());

  it('ShortAsset 記錄影片是照哪一份腳本、哪一版拍的', () => {
    const paths = ShortAsset.schema.paths;

    assert.equal(paths.sourceScriptId.options.ref, 'ShortScript');
    assert.equal(paths.sourceScriptId.options.index, true);
    assert.equal(paths.sourceScriptId.defaultValue, null);
    assert.equal(paths.sourceVersionNo.defaultValue, null);
  });

  it('approved 不是終態，成品被退回時腳本可回到 changes_requested', () => {
    const allowed = shortScriptService.ALLOWED_TRANSITIONS.approved;

    assert.equal(allowed.includes('changes_requested'), true);
  });

  it('內容有誤走 retrieval，其餘理由走 narrative', () => {
    const { resolveFeedbackTypeFromReasons } = shortScriptService;

    assert.equal(resolveFeedbackTypeFromReasons([{ code: 'contentIncorrect' }]), 'retrieval');
    assert.equal(resolveFeedbackTypeFromReasons([{ code: 'audioIssue' }]), 'narrative');
    assert.equal(resolveFeedbackTypeFromReasons([{ code: 'visualQuality' }]), 'narrative');
    assert.equal(resolveFeedbackTypeFromReasons([{ code: 'subtitleIssue' }]), 'narrative');
    assert.equal(resolveFeedbackTypeFromReasons([{ code: 'incomplete' }]), 'narrative');
    assert.equal(resolveFeedbackTypeFromReasons([{ code: 'other' }]), 'narrative');
  });

  it('同時勾選內容有誤與其他理由時以 retrieval 為準', () => {
    const feedbackType = shortScriptService.resolveFeedbackTypeFromReasons([
      { code: 'audioIssue' },
      { code: 'contentIncorrect' },
    ]);

    assert.equal(feedbackType, 'retrieval');
  });

  it('退回成品會把理由寫回腳本並改成 changes_requested', async () => {
    const script = addScript();
    const asset = await addAsset({ scriptId: script._id, versionNo: 2 });

    await reject(asset._id, [{ code: 'contentIncorrect', note: '第 3 拍講反了' }]);

    const updated = await ShortScript.findById(script._id).lean();
    assert.equal(updated.status, 'changes_requested');
    assert.equal(updated.versions[1].feedbackType, 'retrieval');
    assert.match(updated.versions[1].feedback, /第 3 拍講反了/);
    assert.equal(updated.versions[1].rejectedAsAsset, true);
    assert.equal(String(updated.versions[1].reviewedBy), String(ids.teacher));
  });

  it('回饋寫在教師實際拍攝的那一版，不是最新版', async () => {
    const script = addScript({ versionCount: 3 });
    const asset = await addAsset({ scriptId: script._id, versionNo: 2 });

    await reject(asset._id, [{ code: 'subtitleIssue', note: '字幕太長' }]);

    const updated = await ShortScript.findById(script._id).lean();
    assert.equal(updated.versions[1].feedback !== null, true);
    assert.equal(updated.versions[2].feedback, null);
  });

  it('成品通過時不改動腳本', async () => {
    const script = addScript();
    const asset = await addAsset({ scriptId: script._id, versionNo: 2 });

    await shortAssetService.reviewShortAsset({
      assetId: asset._id,
      user: TEACHER,
      status: 'approved',
      expectedGenerationVersion: 1,
    });

    const updated = await ShortScript.findById(script._id).lean();
    assert.equal(updated.status, 'approved');
    assert.equal(updated.versions[1].feedback, null);
  });

  it('影片沒有連結腳本時退回照常成立，不影響審核結果', async () => {
    const asset = await addAsset();

    const reviewed = await reject(asset._id, [{ code: 'other', note: '重做' }]);

    assert.equal(reviewed.reviewStatus, 'rejected');
  });

  it('腳本連結失敗不會讓已寫入的成品審核回傳錯誤', async () => {
    const script = addScript();
    const asset = await addAsset({ scriptId: script._id, versionNo: 2 });
    const originalFindById = ShortScript.findById;
    ShortScript.findById = () => {
      throw new Error('simulated script lookup failure');
    };

    try {
      // 審核在呼叫連結之前就已寫進資料庫，連結失敗若往外拋，教師會看到錯誤而重送，
      // 再撞上 SHORT_ASSET_REVIEW_CONFLICT。因此這裡必須 fail soft。
      const reviewed = await reject(asset._id, [{ code: 'contentIncorrect', note: '講錯' }]);

      assert.equal(reviewed.reviewStatus, 'rejected');
    } finally {
      ShortScript.findById = originalFindById;
    }
  });

  it('退回成品會通知腳本建立者，並附上可跳轉的 scriptId', async () => {
    const script = addScript();
    const asset = await addAsset({ scriptId: script._id, versionNo: 2 });

    await reject(asset._id, [{ code: 'visualQuality', note: '畫面太暗' }]);

    const notices = store.notifications.filter((item) => item.source === 'short_asset_rejected');
    assert.equal(notices.length, 1);
    assert.equal(String(notices[0].recipientId), String(ids.teacher));
    assert.equal(String(notices[0].scriptId), String(script._id));
    assert.match(notices[0].content, /畫面品質問題（畫面太暗）/);

    const { toPublicNotification } = require('../src/services/notification.service');
    assert.equal(toPublicNotification(notices[0]).scriptId, String(script._id));
  });

  it('影片沒有連結腳本時不發退回通知', async () => {
    const asset = await addAsset();

    await reject(asset._id, [{ code: 'other', note: '重做' }]);

    assert.equal(store.notifications.some((item) => item.source === 'short_asset_rejected'), false);
  });

  it('通知建立失敗不會讓已寫入的成品審核回傳錯誤', async () => {
    const script = addScript();
    const asset = await addAsset({ scriptId: script._id, versionNo: 2 });
    const Notification = require('../src/models/notification.model');
    const originalCreate = Notification.create;
    Notification.create = async () => {
      throw new Error('simulated notification failure');
    };

    try {
      const reviewed = await reject(asset._id, [{ code: 'incomplete' }]);

      assert.equal(reviewed.reviewStatus, 'rejected');
    } finally {
      Notification.create = originalCreate;
    }
  });

  it('腳本已被否決時不因成品退回而復活', async () => {
    const script = addScript({ status: 'dismissed' });
    const asset = await addAsset({ scriptId: script._id, versionNo: 2 });

    await reject(asset._id, [{ code: 'contentIncorrect', note: '講錯' }]);

    const updated = await ShortScript.findById(script._id).lean();
    assert.equal(updated.status, 'dismissed');
  });
});
