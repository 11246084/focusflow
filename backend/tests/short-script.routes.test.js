const assert = require('node:assert/strict');
const {
  after, afterEach, before, beforeEach, describe, it,
} = require('node:test');
const env = require('../src/config/env');
const {
  ids,
  jsonRequest,
  loginAs,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  store,
} = require('./helpers/backendTestHarness');

const originalFetch = global.fetch;
const originalApiKey = env.geminiApiKey;
const originalFlag = env.shortScriptAutomationEnabled;

let server;
let baseUrl;

function resetEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.shortScriptEvidenceExpandWindow = 1;
  env.shortScriptEvidenceMinItems = 6;
  env.shortScriptEvidenceMaxItems = 12;
  env.shortScriptMatchLimit = 6;
  env.shortScriptGenerationRetryLimit = 2;
  env.shortScriptAutomationEnabled = true;
  env.geminiApiKey = 'test-key';
}

function seedTopicAndSegments() {
  for (let index = 0; index < 8; index += 1) {
    store.questions.push({
      _id: newObjectId(),
      userId: ids.student,
      courseId: ids.teacherCourse,
      question: 'OpenCV 是什麼?',
      answer: 'answer',
      status: 'answered',
      source: 'api',
      matchCount: 1,
      matches: [],
      runtime: {},
      questionEmbedding: [1, 0, 0],
      askedAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
  }

  for (let index = 0; index < 20; index += 1) {
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

// 只攔截 Gemini 的網址，其餘（含測試自己發的 HTTP 請求）照原樣送出，
// 否則連登入請求都會被假回應吃掉。
function stubGeneration() {
  global.fetch = async (url, options) => {
    if (!String(url).includes('generativelanguage.googleapis.com')) {
      return originalFetch(url, options);
    }

    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
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
                globalSettings: { coreEvent: 'x' },
                writingFourQuestions: ['a'],
                visualMetaphorOptions: [{ label: '光點', s1: 'a', s2: 'b', s3: 'c' }],
                shots,
              }),
            }],
          },
        }],
      }),
    };
  };
}

describe('short script routes', () => {
  before(async () => { ({ server, baseUrl } = await startServer()); });
  after(async () => stopServer(server));

  beforeEach(() => {
    resetStore();
    resetEnv();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    env.geminiApiKey = originalApiKey;
    env.shortScriptAutomationEnabled = originalFlag;
  });

  it('feature flag 關閉時整組路由回 404', async () => {
    env.shortScriptAutomationEnabled = false;
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts`, {
      token,
    });

    assert.equal(response.status, 404);
  });

  it('未登入時回 401', async () => {
    const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts`);
    assert.equal(response.status, 401);
  });

  it('學生無權存取教師端腳本 API', async () => {
    const token = await loginAs(baseUrl, 'student@focusflow.local', 'Student123!');

    const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts`, {
      token,
    });

    assert.equal(response.status, 403);
  });

  it('教師可取得候選主題（唯讀，不建立腳本）', async () => {
    seedTopicAndSegments();
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts/candidates`,
      { token },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data[0].question, 'OpenCV 是什麼?');
    assert.equal(store.shortScripts.length, 0, '候選預覽不得建立腳本');
  });

  it('教師可自動選題並建立腳本', async () => {
    seedTopicAndSegments();
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts/auto`,
      { method: 'POST', token },
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, 'evidence_ready');
    assert.ok(response.body.data.evidence.length >= 6);
  });

  it('沒有候選時回 SHORT_SCRIPT_NO_CANDIDATE', async () => {
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts/auto`,
      { method: 'POST', token },
    );

    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, 'SHORT_SCRIPT_NO_CANDIDATE');
  });

  it('生成、審核、取得的完整流程', async () => {
    seedTopicAndSegments();
    stubGeneration();
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const created = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts/auto`,
      { method: 'POST', token },
    );
    const scriptId = created.body.data._id;

    const generated = await jsonRequest(baseUrl, `/api/v1/short-scripts/${scriptId}/generate`, {
      method: 'POST',
      token,
    });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.data.status, 'generated');

    const reviewed = await jsonRequest(baseUrl, `/api/v1/short-scripts/${scriptId}/review`, {
      method: 'POST',
      token,
      body: { decision: 'approve' },
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.data.status, 'approved');

    const fetched = await jsonRequest(baseUrl, `/api/v1/short-scripts/${scriptId}`, { token });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.versions.length, 1);
    assert.ok(fetched.body.data.selectionReason);
  });

  it('退回時缺 feedbackType 回 VALIDATION_ERROR', async () => {
    seedTopicAndSegments();
    stubGeneration();
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const created = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts/auto`,
      { method: 'POST', token },
    );
    const scriptId = created.body.data._id;
    await jsonRequest(baseUrl, `/api/v1/short-scripts/${scriptId}/generate`, { method: 'POST', token });

    const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${scriptId}/review`, {
      method: 'POST',
      token,
      body: { decision: 'request_changes', feedback: '有問題' },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  });

  it('缺 decision 時回 VALIDATION_ERROR', async () => {
    seedTopicAndSegments();
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const created = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts/auto`,
      { method: 'POST', token },
    );

    const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${created.body.data._id}/review`,
      { method: 'POST', token, body: {} },
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  });

  it('腳本不存在時回 SHORT_SCRIPT_NOT_FOUND', async () => {
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/${newObjectId()}`, { token });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'SHORT_SCRIPT_NOT_FOUND');
  });

  it('scriptId 格式錯誤時回 INVALID_ID', async () => {
    const token = await loginAs(baseUrl, 'teacher@focusflow.local', 'Teacher123!');

    const response = await jsonRequest(baseUrl, `/api/v1/short-scripts/not-an-id`, { token });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_ID');
  });

  it('非課程 owner 的教師被拒絕', async () => {
    seedTopicAndSegments();
    const token = await loginAs(baseUrl, 'teacher2@focusflow.local', 'Teacher123!');

    const response = await jsonRequest(baseUrl, `/api/v1/courses/${ids.teacherCourse}/short-scripts/auto`,
      { method: 'POST', token },
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'COURSE_MANAGE_DENIED');
  });
});
