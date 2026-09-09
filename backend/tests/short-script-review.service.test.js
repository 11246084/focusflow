const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const shortScriptService = require('../src/services/shortScript.service');
const env = require('../src/config/env');
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
      arcRole: 'hook',
      timeRange: '0:00',
      narration: `第 ${index + 1} 拍`,
      subtitle: '字幕',
      editing: '快切',
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
                globalSettings: { coreEvent: 'x', coreView: 'y' },
                writingFourQuestions: ['a', 'b', 'c', 'd'],
                visualMetaphorOptions: [{ label: metaphorLabel, s1: 'a', s2: 'b', s3: 'c' }],
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

  it('教師通過後狀態轉 approved', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });

    const updated = await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'approve',
    });

    assert.equal(updated.status, 'approved');
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
  it('已核准的腳本仍可被退回，回到 changes_requested', async () => {
    const script = await createScript();
    stubGeneration();
    await shortScriptService.generateScriptVersion({ user: TEACHER, scriptId: script._id });
    await shortScriptService.submitReview({ user: TEACHER, scriptId: script._id, decision: 'approve' });

    const updated = await shortScriptService.submitReview({
      user: TEACHER,
      scriptId: script._id,
      decision: 'request_changes',
      feedback: '再改',
      feedbackType: 'narrative',
    });

    assert.equal(updated.status, 'changes_requested');
  });

  it('尚未生成就通過會被狀態機擋下', async () => {
    const script = await createScript();

    await assert.rejects(
      () => shortScriptService.submitReview({
        user: TEACHER,
        scriptId: script._id,
        decision: 'approve',
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
        decision: 'approve',
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
