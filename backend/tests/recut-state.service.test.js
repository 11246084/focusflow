const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids, newObjectId } = require('./helpers/backendTestHarness');
const { seedScript, makeVersion, reviewScript, approvedScript, renderedAsset, snapshot } = require('./helpers/recutFixtures');
const { transitionRecut: move, setProductionModeForScript: setMode, createRecutSource, validateSentenceList } = require('../src/services/recutState.service');
const RecutReviewEvent = require('../src/models/recutReviewEvent.model');
const { getScriptById, listCourseScripts } = require('../src/services/shortScript.service');
const fixture = require('./fixtures/recut-sentences.json');
const user = { id: ids.teacher, role: 'teacher' };
const blocked = (fn) => assert.rejects(fn, { code: 'RECUT_STATE_INVALID' });

describe('recut 資料與狀態機', () => {
  beforeEach(resetStore);
  it('舊文件讀取與列表將缺少的 productionMode 視為 avatar，讀取不寫回', async () => {
    const script = seedScript(); delete script.productionMode;
    assert.equal((await getScriptById({ user, scriptId: script._id })).productionMode, 'avatar');
    assert.equal((await listCourseScripts({ user, courseId: ids.teacherCourse }))[0].productionMode, 'avatar');
    assert.equal(script.productionMode, undefined);
  });
  it('生成前可切換；生成後切換保留 avatar 版本、recut 原片與版本', async () => {
    const script = seedScript({ productionMode: 'avatar', versions: [{ versionNo: 1, payload: { shots: 8 } }] });
    await setMode({ scriptId: script._id, mode: 'recut' });
    const version = await reviewScript(script);
    await setMode({ scriptId: script._id, mode: 'avatar' });
    await setMode({ scriptId: script._id, mode: 'recut' });
    assert.equal(store.recutVersions.length, 1); assert.equal(store.recutSources.length, 1);
    assert.equal(String(snapshot(script).currentVersionId), String(version._id));
    assert.equal(script.versions[0].payload.shots, 8);
  });
  it('句子清單保留絕對秒數、逐字時間及命中標記；非法時間拒收', async () => {
    const script = seedScript();
    const source = await createRecutSource({ ...fixture, scriptId: script._id });
    assert.equal(source.sentences[0].id, 's1'); assert.equal(source.sentences[0].retrievalHit, true);
    assert.equal(source.sentences[1].retrievalHit, false); assert.equal(source.sentences[0].words[0].startSec, 41.2);
    const invalid = structuredClone(fixture); invalid.sentences[0].words[0].startSec = 0;
    assert.throws(() => validateSentenceList(invalid), { code: 'VALIDATION_ERROR' });
  });
  it('沒有講稿核准紀錄不得排渲染；目前版本核准後才可排入並開始', async () => {
    const script = seedScript(); const version = await reviewScript(script);
    await blocked(() => move({ scriptId: script._id, event: 'queue_render', versionId: version._id }));
    await move({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: ids.teacher });
    await move({ scriptId: script._id, event: 'queue_render', versionId: version._id });
    await move({ scriptId: script._id, event: 'start_render', versionId: version._id });
    assert.equal(snapshot(script).state, 'rendering');
  });
  it('只有舊版的核准紀錄即使狀態宣稱已核准仍不能排新版渲染', async () => {
    const script = seedScript(); await approvedScript(script);
    const version = await makeVersion(script, { fullScript: '改變內容' });
    await move({ scriptId: script._id, event: 'revise', versionId: version._id });
    script.recut.state = 'script_approved';
    await blocked(() => move({ scriptId: script._id, event: 'queue_render', versionId: version._id }));
  });
  it('未套用修改擋講稿核准，全部復原後可核准；品質建議不阻擋', async () => {
    const script = seedScript(); const version = await reviewScript(script);
    const edit = await RecutReviewEvent.create({ scriptId: script._id, versionId: version._id, kind: 'edit',
      sentenceId: 's1', originalLabel: '結論或定義', reasonLabel: '漏了重點', action: 'remove' });
    await RecutReviewEvent.create({ scriptId: script._id, versionId: version._id, kind: 'suggestion', suggestionType: 'quality', content: '圖卡不清楚', adopted: false });
    await move({ scriptId: script._id, event: 'set_pending_edits', pendingEditId: edit._id });
    await blocked(() => move({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: ids.teacher }));
    await move({ scriptId: script._id, event: 'set_pending_edits', pendingEditId: null });
    await move({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: ids.teacher });
    assert.equal(snapshot(script).state, 'script_approved');
  });
  it('重新配圖進行中不可核准；回到原版後可核准', async () => {
    const script = seedScript(); const version = await reviewScript(script); const base = snapshot(script); const taskId = newObjectId();
    await move({ scriptId: script._id, event: 'queue_task', taskId });
    await move({ scriptId: script._id, event: 'start_task', taskId });
    await blocked(() => move({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: ids.teacher }));
    await move({ scriptId: script._id, event: 'restore_task', taskId, baseSnapshot: base });
    await move({ scriptId: script._id, event: 'approve_script', versionId: version._id, actorId: ids.teacher });
    assert.equal(snapshot(script).state, 'script_approved');
  });
  it('講稿核准指定舊版、無法回答或沒有施工單都拒絕', async () => {
    const script = seedScript(); const old = await reviewScript(script);
    const current = await makeVersion(script, { selection: { answerable: false, ranges: [], unanswerableReason: '原片沒解釋' }, plan: null });
    await move({ scriptId: script._id, event: 'revise', versionId: current._id });
    await blocked(() => move({ scriptId: script._id, event: 'approve_script', versionId: old._id, actorId: ids.teacher }));
    await blocked(() => move({ scriptId: script._id, event: 'approve_script', versionId: current._id, actorId: ids.teacher }));
  });
  it('成品核准必須符合目前 MP4 的 ID、腳本版與 generation', async () => {
    const script = seedScript(); const { version, asset } = await renderedAsset(script);
    await blocked(() => move({ scriptId: script._id, event: 'approve_asset', versionId: version._id, assetId: newObjectId(), generationVersion: 1, actorId: ids.teacher }));
    await move({ scriptId: script._id, event: 'approve_asset', versionId: version._id, assetId: asset._id, generationVersion: 1, actorId: ids.teacher });
    await move({ scriptId: script._id, event: 'publish', versionId: version._id, assetId: asset._id, generationVersion: 1 });
    assert.equal(snapshot(script).state, 'published');
  });
  it('沒有成品核准紀錄時不得上架', async () => {
    const script = seedScript(); const { version, asset } = await renderedAsset(script);
    script.recut.state = 'asset_approved';
    await blocked(() => move({ scriptId: script._id, event: 'publish', versionId: version._id, assetId: asset._id, generationVersion: 1 }));
  });
  it('舊 MP4 核准不得用於新版 generation', async () => {
    const script = seedScript(); const { version, asset } = await renderedAsset(script);
    await move({ scriptId: script._id, event: 'approve_asset', versionId: version._id, assetId: asset._id, generationVersion: 1, actorId: ids.teacher });
    asset.generationVersion = 2; script.recut.currentAssetGenerationVersion = 2;
    await blocked(() => move({ scriptId: script._id, event: 'publish', versionId: version._id, assetId: asset._id, generationVersion: 2 }));
  });
  it('純呈現修改沿用講稿核准但清除成品；每版新 MP4 都要重審', async () => {
    const script = seedScript(); const { version, asset } = await renderedAsset(script);
    await move({ scriptId: script._id, event: 'approve_asset', versionId: version._id, assetId: asset._id, generationVersion: 1, actorId: ids.teacher });
    const next = await makeVersion(script, { sourceId: version.sourceId, theme: 'G' });
    await move({ scriptId: script._id, event: 'revise', versionId: next._id });
    assert.equal(snapshot(script).state, 'script_approved'); assert.equal(snapshot(script).currentAssetId, null);
    assert.equal(store.recutApprovals.filter((a) => a.type === 'asset').length, 1);
    assert.ok(store.recutApprovals.find((a) => String(a.versionId) === String(next._id)).inheritedFromApprovalId);
    await move({ scriptId: script._id, event: 'queue_render', versionId: next._id });
    await blocked(() => move({ scriptId: script._id, event: 'publish', versionId: next._id, assetId: asset._id, generationVersion: 1 }));
  });
  it('加回移除原話、範圍或順序改變都回講稿審閱', async () => {
    for (const ranges of [[{ from: 's1', to: 's1' }], [{ from: 's1', to: 's2', startAt: '是工具箱' }], [{ from: 's2', to: 's2' }, { from: 's1', to: 's1' }]]) {
      const script = seedScript(); const current = await approvedScript(script);
      const next = await makeVersion(script, { sourceId: current.sourceId, selection: { ...current.selection, ranges } });
      await move({ scriptId: script._id, event: 'revise', versionId: next._id });
      assert.equal(snapshot(script).state, 'script_review');
      await blocked(() => move({ scriptId: script._id, event: 'queue_render', versionId: next._id }));
    }
  });
  it('不同腳本的版本與並行舊 revision 都不可覆蓋目前版本', async () => {
    const script = seedScript(); const other = seedScript(); const version = await makeVersion(other);
    await blocked(() => move({ scriptId: script._id, event: 'revise', versionId: version._id }));
    await blocked(() => move({ scriptId: script._id, event: 'queue_task', taskId: newObjectId(), expectedRevision: 99 }));
  });
});
