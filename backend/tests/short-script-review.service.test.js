const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const shortScriptService = require('../src/services/shortScript.service');
const env = require('../src/config/env');
const ShortScript = require('../src/models/shortScript.model');
const {
  ids,
  newObjectId,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');

const TEACHER = { id: ids.teacher, role: 'teacher' };
const originalFetch = global.fetch;
const originalApiKey = env.geminiApiKey;

function resetEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.openaiApiKey = '';
  env.qaActiveLeafEmbeddingContractJson = '';
  env.qaActiveParentEmbeddingContractJson = '';
  env.shortScriptEvidenceExpandWindow = 1;
  env.shortScriptEvidenceMinItems = 6;
  env.shortScriptEvidenceMaxItems = 12;
  env.shortScriptMatchLimit = 6;
  env.shortScriptGenerationRetryLimit = 2;
  env.geminiApiKey = 'test-key';
}

function addQuestion({ question, askCount = 5, questionEmbedding = [1, 0, 0] } = {}) {
  for (let index = 0; index < askCount; index += 1) {
    store.questions.push({
      _id: newObjectId(),
      userId: ids.student,
      courseId: ids.teacherCourse,
      question,
      answer: 'answer',
      status: 'answered',
      source: 'api',
      matchCount: 1,
      matches: [],
      runtime: {},
      questionEmbedding,
      askedAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
  }
}

function addChunkSeries({ count = 20 } = {}) {
  for (let index = 0; index < count; index += 1) {
    const chunkId = `chunk_${String(index).padStart(4, '0')}`;
    store.videoSegments.push({
      _id: newObjectId(),
      segmentId: chunkId,
      chunkId,
      courseId: ids.teacherCourse,
      videoId: ids.teacherVideo,
      startSec: index * 20,
      endSec: (index * 20) + 19,
      text: index >= 3 && index <= 9
        ? 'OpenCV 可以使用 CPU 來運算，這一段有提到 OpenCV。'
        : `這一段講其他內容，第 ${index} 格。`,
      embedding: [],
    });
  }
}

// 生成服務的假回應：依實際傳入的證據產生合法的 basedOn，確保引用驗證會通過。
function stubGeneration({ metaphorLabel = '光點網路' } = {}) {
  const calls = [];
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.contents[0].parts[0].text;
    calls.push(prompt);

    const chunkIds = [...prompt.matchAll(/chunkId=(\S+)/g)].map((match) => match[1]);
    const shots = Array.from({ length: 8 }, (unused, index) => ({
      shotNo: index + 1,
      narration: `第 ${index + 1} 拍`,
      subtitle: '字幕',
      hookQuestion: `埋問題 ${index + 1}`,
      sfx: '',
      basedOn: index === 7 ? 'template' : [chunkIds[index % chunkIds.length]],
    }));

    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                arcApplicable: true,
                // 鏡 4（index 3）的依據就是轉折片段，驗證才會通過。
                reversalBasedOn: shots[3].basedOn,
                globalSettings: { coreEvent: 'x', coreView: 'y' },
                writingPlan: { curiosity: 'a', delayedAnswer: 'b', reversal: 'c', takeaway: 'd' },
                stageMeanings: { s1: 'a', s2: 'b', s3: 'c' },
                visualMetaphorOptions: [{ label: metaphorLabel, s1: 'a', s2: 'b', s3: 'c', rationale: 'r' }],
                shots,
              }),
            }],
          },
        }],
      }),
    };
  };
  return calls;
}

async function createScript() {
  addQuestion({ question: 'OpenCV 是什麼?', askCount: 8 });
  addChunkSeries();
  return shortScriptService.createScriptWithFrozenEvidence({
    user: TEACHER,
    courseId: ids.teacherCourse,
  });
}

describe('shortScript.service 審核迴圈', () => {
  beforeEach(() => {
    resetStore();
    resetEnv();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    env.geminiApiKey = originalApiKey;
  });

  it('生成後狀態轉 generated 並附加第一版', async () => {
    const script = await createScript();
    stubGeneration();

    const updated = await shortScriptService.generateScriptVersion({
      user: TEACHER,
      scriptId: script._id,
    });

    assert.equal(updated.status, 'generated');
    assert.equal(updated.versions.length, 1);
    assert.equal(updated.versions[0].versionNo, 1);
    assert.equal(updated.versions[0].payload.shots.length, 8);
  });

  // 讓 provider 停在「等一個可手動放行的 promise」，確保兩個請求都在任何寫入前讀完腳本。
  function gateProvider() {
    const inner = global.fetch; let release; const gate = new Promise((resolve) => { release = resolve; });
    let waiting = 0; let reached;
    const allReached = new Promise((resolve) => { reached = resolve; });
    global.fetch = async (...args) => { waiting += 1; if (waiting >= 2) reached(); await gate; return inner(...args); };
    return { release, allReached, oneReached: () => new Promise((resolve) => { const t = setInterval(() => { if (waiting >= 1) { clearInterval(t); resolve(); } }, 1); }) };
  }
  const storedScript = (script) => store.shortScripts.find((item) => String(item._id) === String(script._id));

  it('兩個生成請求同時進行，只有一個成功，另一個回 SHORT_SCRIPT_STATE_INVALID，且只留一筆 versionNo 1', async () => {
    const script = await createScript();
    stubGeneration(); const gate = gateProvider();
    const pending = [1, 2].map(() => shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id }));
    await gate.allReached; gate.release();
    const results = await Promise.allSettled(pending);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected');
    assert.equal(rejected.reason.code, 'SHORT_SCRIPT_STATE_INVALID');
    assert.equal(rejected.reason.statusCode ?? rejected.reason.status, 409);
    const stored = storedScript(script);
    assert.equal(stored.versions.length, 1);
    assert.equal(stored.versions[0].versionNo, 1);
  });

  it('生成等待模型時腳本被否決，生成回 SHORT_SCRIPT_STATE_INVALID，腳本維持 dismissed 且沒有新版本', async () => {
    const script = await createScript();
    stubGeneration(); const gate = gateProvider();
    const generating = shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    const settled = generating.then(() => null, (error) => error);
    await gate.oneReached();
    await shortScriptService.submitReview({ user: TEACHER, scriptId: script._id, decision: 'dismiss', feedback: '不做' });
    gate.release();

    const error = await settled;
    assert.equal(error?.code, 'SHORT_SCRIPT_STATE_INVALID');
    const stored = storedScript(script);
    assert.equal(stored.status, 'dismissed'); assert.equal(stored.versions.length, 0);
  });

  it('退回時腳本在讀取後被別的請求新增一版，退回回 SHORT_SCRIPT_STATE_INVALID，回饋不寫到任何版本', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    const original = ShortScript.findById; let injected = false;
    ShortScript.findById = (id) => ({
      lean: async () => {
        const snapshot = JSON.parse(JSON.stringify(await original(id).lean()));
        if (!injected) {
          injected = true; // 讀完之後、寫入之前：另一個請求已完成「退回 + 重生」，腳本多了第 2 版。
          const stored = storedScript(script);
          stored.versions.push({ ...JSON.parse(JSON.stringify(stored.versions[0])), versionNo: 2, feedback: null, feedbackType: null });
        }
        return snapshot;
      },
    });
    try {
      await assert.rejects(
        () => shortScriptService.submitReview({
          user: TEACHER, scriptId: script._id, decision: 'request_changes', feedback: '開頭不夠吸引人', feedbackType: 'narrative',
        }),
        (error) => error.code === 'SHORT_SCRIPT_STATE_INVALID' && (error.statusCode ?? error.status) === 409,
      );
    } finally { ShortScript.findById = original; }
    assert.equal(injected, true);
    const stored = storedScript(script);
    assert.equal(stored.status, 'generated');
    for (const version of stored.versions) { assert.equal(version.feedback, null); assert.equal(version.reviewedAt, null); }
  });

  it('生成會寫入成本紀錄，且用獨立的 event 型別（DR-06）', async () => {
    const script = await createScript();
    stubGeneration();

    const before = store.usageLogs.length;
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    const added = store.usageLogs.slice(before);
    assert.equal(added.length, 1);
    assert.equal(added[0].event, 'short_script_generate');
    assert.equal(added[0].metadata.versionNo, 1);
    assert.equal(added[0].metadata.generationAttempts, 1);
  });

  it('成本紀錄不得計入教師儀表板的問答次數', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    const askCount = store.usageLogs.filter((log) => log.event === 'ask').length;
    assert.equal(askCount, 0, '腳本生成不得寫入 ask 事件');
  });

  // approved 只有一種來源：影片成功上架（2026-09-09 決議）。人工按不出來。
  it('approve 不再是可用的審核決定', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    await assert.rejects(
      () => shortScriptService.submitReview({ user: TEACHER, scriptId: script._id, decision: 'approve' }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  });

  it('影片上架成功時腳本標成 approved（已上架）', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    const updated = await shortScriptService.markScriptPublished({ scriptId: script._id });

    assert.equal(updated.status, 'approved');
  });

  it('被退回但教師直接重拍同一版並上架時，腳本同樣標成 approved', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    await shortScriptService.submitReview({
      user: TEACHER, scriptId: script._id, decision: 'request_changes', feedback: '再改', feedbackType: 'narrative',
    });

    const updated = await shortScriptService.markScriptPublished({ scriptId: script._id });

    assert.equal(updated.status, 'approved');
  });

  it('已否決的腳本不因影片上架而復活', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    await shortScriptService.submitReview({ user: TEACHER, scriptId: script._id, decision: 'dismiss', feedback: '不做' });

    const result = await shortScriptService.markScriptPublished({ scriptId: script._id });

    assert.equal(result, null);
  });

  it('退回時回饋記在被審的那一版上', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    const updated = await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'request_changes',
      feedback: '開頭不夠吸引人',
      feedbackType: 'narrative',
    });

    assert.equal(updated.status, 'changes_requested');
    assert.equal(updated.versions[0].feedback, '開頭不夠吸引人');
    assert.equal(updated.versions[0].feedbackType, 'narrative');
    assert.ok(updated.versions[0].reviewedAt);
  });

  it('退回時未指定 feedbackType 會被拒絕（系統不猜）', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    await assert.rejects(
      () => shortScriptService.submitReview({
        user: TEACHER,
        scriptId: script._id,
        decision: 'request_changes',
        feedback: '有問題',
      }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  });

  it('退回時沒寫回饋內容會被拒絕', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    await assert.rejects(
      () => shortScriptService.submitReview({
        user: TEACHER,
        scriptId: script._id,
        decision: 'request_changes',
        feedback: '   ',
        feedbackType: 'narrative',
      }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  });

  it('narrative 回饋重生時沿用同一份證據，且回饋進入 prompt', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'request_changes',
      feedback: '節奏太趕',
      feedbackType: 'narrative',
    });

    const calls = stubGeneration();
    const updated = await shortScriptService.generateScriptVersion({
      user: TEACHER,
      scriptId: script._id,
    });

    assert.equal(updated.versions.length, 2);
    assert.equal(updated.versions[1].evidenceRefreshed, false, 'narrative 不應重新凍結證據');
    assert.ok(calls[0].includes('節奏太趕'), '教師回饋應進入 prompt');
  });

  it('retrieval 回饋重生時會重新凍結證據', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'request_changes',
      feedback: '這裡講錯了',
      feedbackType: 'retrieval',
    });

    const calls = stubGeneration();
    const updated = await shortScriptService.generateScriptVersion({
      user: TEACHER,
      scriptId: script._id,
    });

    assert.equal(updated.versions[1].evidenceRefreshed, true, 'retrieval 應重新凍結證據');
    assert.equal(calls[0].includes('這裡講錯了'), false, 'retrieval 回饋不應當成敘事指示');
  });

  it('版本逐版保留，可比對前後兩版', async () => {
    const script = await createScript();
    stubGeneration({ metaphorLabel: '第一版隱喻' });
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'request_changes',
      feedback: '換個隱喻',
      feedbackType: 'narrative',
    });

    stubGeneration({ metaphorLabel: '第二版隱喻' });
    const updated = await shortScriptService.generateScriptVersion({
      user: TEACHER,
      scriptId: script._id,
    });

    assert.equal(updated.versions.length, 2);
    assert.equal(updated.versions[0].payload.visualMetaphorOptions[0].label, '第一版隱喻');
    assert.equal(updated.versions[1].payload.visualMetaphorOptions[0].label, '第二版隱喻');
  });

  // 規格書 DR-20 起 approved 不再是終態：整支影片都是從腳本生成的，
  // 影片做出來才發現的問題只能改腳本，所以核准後仍要能退回。
  it('已上架的腳本仍可被退回，回到 changes_requested', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    await shortScriptService.markScriptPublished({ scriptId: script._id });

    const updated = await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'request_changes',
      feedback: '再改',
      feedbackType: 'narrative',
    });

    assert.equal(updated.status, 'changes_requested');
  });

  it('尚未生成就退回會被狀態機擋下', async () => {
    const script = await createScript();

    await assert.rejects(
      () => shortScriptService.submitReview({
        user: TEACHER,
        scriptId: script._id,
        decision: 'request_changes',
        feedback: '再改',
        feedbackType: 'narrative',
      }),
      (error) => error.code === 'SHORT_SCRIPT_STATE_INVALID',
    );
  });

  it('教師可在審核時直接否決整個主題', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    const updated = await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'dismiss',
      feedback: '這題不適合做影片',
    });

    assert.equal(updated.status, 'dismissed');
    assert.equal(updated.dismissReason, '這題不適合做影片');
  });

  it('非課程 owner 不得審核', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    await assert.rejects(
      () => shortScriptService.submitReview({
        user: { id: ids.otherTeacher, role: 'teacher' },
        scriptId: script._id,
        decision: 'dismiss',
      }),
      (error) => error.code === 'COURSE_MANAGE_DENIED',
    );
  });

  it('未知的審核決定回 VALIDATION_ERROR', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    await assert.rejects(
      () => shortScriptService.submitReview({
        user: TEACHER,
        scriptId: script._id,
        decision: 'maybe',
      }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  });
});
