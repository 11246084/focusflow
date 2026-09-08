const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');
const shortScriptService = require('../src/services/shortScript.service');
const env = require('../src/config/env');
const {
  ids,
  newObjectId,
  resetStore,
  store,
} = require('./helpers/backendTestHarness');

const TEACHER = { id: ids.teacher, role: 'teacher' };

function resetQaEnv() {
  env.qaQueryEmbeddingProvider = 'mock';
  env.qaVectorSearchMode = 'memory';
  env.qaAnswerProvider = 'template';
  env.qaAtlasVectorIndexName = '';
  env.qaAtlasFilterMode = 'bridge_course_or_video';
  env.geminiApiKey = '';
  env.openaiApiKey = '';
  env.qaActiveLeafEmbeddingContractJson = '';
  env.qaActiveParentEmbeddingContractJson = '';
  env.shortScriptEvidenceExpandWindow = 1;
  env.shortScriptEvidenceMinItems = 6;
  env.shortScriptEvidenceMaxItems = 12;
  env.shortScriptMatchLimit = 6;
}

// 熱度＝該問句在 questions 出現的筆數（規格書 DR-14）。
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

// 模擬 V5 的實際資料形狀：同一支影片內連號的 chunk，內容在兩格之間被切斷。
function addChunkSeries({ videoId = ids.teacherVideo, count = 10, keyword = 'OpenCV' } = {}) {
  const created = [];
  for (let index = 0; index < count; index += 1) {
    const chunkId = `chunk_${String(index).padStart(4, '0')}`;
    const segment = {
      _id: newObjectId(),
      segmentId: chunkId,
      chunkId,
      courseId: ids.teacherCourse,
      videoId,
      startSec: index * 20,
      endSec: (index * 20) + 19,
      // 中段連續幾格提到關鍵字（比照 V5 的 chunk_0001~0006 連號分布），
      // 讓檢索命中集中在中間，方便驗證前後擴展。
      text: index >= 3 && index <= 7
        ? `${keyword} 可以使用 CPU 來運算，這一段有提到 ${keyword}。`
        : `這一段講其他內容，第 ${index} 格。`,
      embedding: [],
    };
    store.videoSegments.push(segment);
    created.push(segment);
  }
  return created;
}

describe('shortScript.service 證據包凍結', () => {
  beforeEach(() => {
    resetStore();
    resetQaEnv();
  });

  it('自動選題後建立腳本，並凍結證據與 selectionReason', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 10 });

    const script = await shortScriptService.createScriptWithFrozenEvidence({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(script.status, 'evidence_ready');
    assert.equal(script.topic, 'OpenCV 跟 YOLO 差在哪?');
    assert.ok(script.evidence.length >= 6);
    assert.ok(script.evidenceFrozenAt);
    assert.equal(script.selectionReason.rank, 1);
    assert.equal(script.selectionReason.totalAskCount, 8);
  });

  it('證據同時包含命中與鄰接擴展片段（腳本檢索上限低於證據上限）', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 20 });

    const script = await shortScriptService.createScriptWithFrozenEvidence({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    const hits = script.evidence.filter((item) => item.expandedFrom === null);
    const expanded = script.evidence.filter((item) => item.expandedFrom !== null);

    assert.ok(hits.length > 0, '應有命中片段');
    assert.ok(expanded.length > 0, '應有鄰接擴展片段，否則擴展等於被架空');
    assert.ok(hits.length <= env.shortScriptMatchLimit);
  });

  it('證據帶有代號 A、B、C 與 STT 原文', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 10 });

    const script = await shortScriptService.createScriptWithFrozenEvidence({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(script.evidence[0].code, 'A');
    assert.equal(script.evidence[1].code, 'B');
    assert.equal(typeof script.evidence[0].rawText, 'string');
    assert.ok(script.evidence[0].rawText.length > 0);
    assert.equal(typeof script.evidence[0].chunkId, 'string');
  });

  it('證據依原片時間排序', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 10 });

    const script = await shortScriptService.createScriptWithFrozenEvidence({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    const starts = script.evidence.map((item) => item.startSec);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  });

  it('凍結後刪除來源片段，證據內容不變', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 10 });

    const script = await shortScriptService.createScriptWithFrozenEvidence({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });
    const before = JSON.stringify(script.evidence);

    store.videoSegments.length = 0;

    const reloaded = await shortScriptService.getScriptById({ user: TEACHER, scriptId: script._id });
    assert.equal(JSON.stringify(reloaded.evidence), before);
  });

  it('第一名證據不足時換下一名，不是直接失敗（DR-12 第 3 層）', async () => {
    // 第一名：證據不足（只有 2 格提到 Zebra）。第二名：證據充足。
    addQuestion({ question: 'Zebra 是什麼?', askCount: 9, questionEmbedding: [1, 0, 0] });
    addQuestion({ question: 'OpenCV 是什麼?', askCount: 3, questionEmbedding: [0, 1, 0] });

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

    const script = await shortScriptService.createScriptWithFrozenEvidence({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    assert.equal(script.topic, 'OpenCV 是什麼?', '第一名證據不足，應改選第二名');
    assert.equal(script.selectionReason.rank, 2);
    assert.equal(script.selectionReason.rejectedForEvidence.length, 1);
    assert.equal(script.selectionReason.rejectedForEvidence[0].reason, 'insufficient_evidence');
    assert.equal(script.selectionReason.rejectedForEvidence[0].rank, 1);
  });

  it('全部候選證據都不足時才回 SHORT_SCRIPT_EVIDENCE_EMPTY', async () => {
    addQuestion({ question: 'Zebra 是什麼?', askCount: 9, questionEmbedding: [1, 0, 0] });
    addQuestion({ question: 'Giraffe 是什麼?', askCount: 3, questionEmbedding: [0, 1, 0] });
    addChunkSeries({ count: 2 });

    await assert.rejects(
      () => shortScriptService.createScriptWithFrozenEvidence({
        user: TEACHER,
        courseId: ids.teacherCourse,
      }),
      (error) => error.code === 'SHORT_SCRIPT_EVIDENCE_EMPTY',
    );
  });

  it('沒有候選主題時回 SHORT_SCRIPT_NO_CANDIDATE', async () => {
    addChunkSeries({ count: 10 });

    await assert.rejects(
      () => shortScriptService.createScriptWithFrozenEvidence({
        user: TEACHER,
        courseId: ids.teacherCourse,
      }),
      (error) => error.code === 'SHORT_SCRIPT_NO_CANDIDATE',
    );
  });

  it('證據不足最低片段數時回 SHORT_SCRIPT_EVIDENCE_EMPTY', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 2 });

    await assert.rejects(
      () => shortScriptService.createScriptWithFrozenEvidence({
        user: TEACHER,
        courseId: ids.teacherCourse,
      }),
      (error) => error.code === 'SHORT_SCRIPT_EVIDENCE_EMPTY',
    );
  });

  it('同一主題不會被重複選中（已建立的腳本會被排除）', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 10 });

    await shortScriptService.createScriptWithFrozenEvidence({
      user: TEACHER,
      courseId: ids.teacherCourse,
    });

    await assert.rejects(
      () => shortScriptService.createScriptWithFrozenEvidence({
        user: TEACHER,
        courseId: ids.teacherCourse,
      }),
      (error) => error.code === 'SHORT_SCRIPT_NO_CANDIDATE',
    );
  });

  it('非課程 owner 不得建立腳本', async () => {
    addQuestion({ question: 'OpenCV 跟 YOLO 差在哪?', askCount: 8 });
    addChunkSeries({ count: 10 });

    await assert.rejects(
      () => shortScriptService.createScriptWithFrozenEvidence({
        user: { id: ids.otherTeacher, role: 'teacher' },
        courseId: ids.teacherCourse,
      }),
      (error) => error.code === 'COURSE_MANAGE_DENIED',
    );
  });
});

describe('shortScript.service 鄰接擴展', () => {
  beforeEach(() => {
    resetStore();
    resetQaEnv();
  });

  it('命中片段的前後各補一格', async () => {
    addChunkSeries({ count: 10 });

    const expanded = await shortScriptService.expandMatchesWithNeighbours([
      { chunkId: 'chunk_0004', segmentId: 'chunk_0004', videoId: ids.teacherVideo, startSec: 80, endSec: 99, transcript: 'hit' },
    ]);

    const chunkIds = expanded.map((item) => item.chunkId);
    assert.deepEqual(chunkIds, ['chunk_0003', 'chunk_0004', 'chunk_0005']);
  });

  it('重疊的擴展結果會去重，不會出現重複片段', async () => {
    addChunkSeries({ count: 10 });

    const expanded = await shortScriptService.expandMatchesWithNeighbours([
      { chunkId: 'chunk_0003', segmentId: 'chunk_0003', videoId: ids.teacherVideo, startSec: 60, endSec: 79, transcript: 'hit' },
      { chunkId: 'chunk_0005', segmentId: 'chunk_0005', videoId: ids.teacherVideo, startSec: 100, endSec: 119, transcript: 'hit' },
    ]);

    const chunkIds = expanded.map((item) => item.chunkId);
    assert.deepEqual(chunkIds, ['chunk_0002', 'chunk_0003', 'chunk_0004', 'chunk_0005', 'chunk_0006']);
    assert.equal(new Set(chunkIds).size, chunkIds.length);
  });

  it('不會跨影片擴展', async () => {
    addChunkSeries({ count: 5, videoId: ids.teacherVideo });
    addChunkSeries({ count: 5, videoId: ids.publishedVideo });

    const expanded = await shortScriptService.expandMatchesWithNeighbours([
      { chunkId: 'chunk_0002', segmentId: 'chunk_0002', videoId: ids.teacherVideo, startSec: 40, endSec: 59, transcript: 'hit' },
    ]);

    assert.equal(expanded.every((item) => item.videoId === ids.teacherVideo), true);
  });

  it('窗口設為 2 時前後各補兩格（不寫死 N+1）', async () => {
    addChunkSeries({ count: 10 });

    const expanded = await shortScriptService.expandMatchesWithNeighbours(
      [{ chunkId: 'chunk_0005', segmentId: 'chunk_0005', videoId: ids.teacherVideo, startSec: 100, endSec: 119, transcript: 'hit' }],
      { window: 2 },
    );

    assert.deepEqual(
      expanded.map((item) => item.chunkId),
      ['chunk_0003', 'chunk_0004', 'chunk_0005', 'chunk_0006', 'chunk_0007'],
    );
  });

  it('窗口為 0 時不擴展', async () => {
    addChunkSeries({ count: 10 });

    const expanded = await shortScriptService.expandMatchesWithNeighbours(
      [{ chunkId: 'chunk_0004', segmentId: 'chunk_0004', videoId: ids.teacherVideo, startSec: 80, endSec: 99, transcript: 'hit' }],
      { window: 0 },
    );

    assert.equal(expanded.length, 1);
  });

  it('擴展來的片段標記 expandedFrom，命中片段為 null', async () => {
    addChunkSeries({ count: 10 });

    const expanded = await shortScriptService.expandMatchesWithNeighbours([
      { chunkId: 'chunk_0004', segmentId: 'chunk_0004', videoId: ids.teacherVideo, startSec: 80, endSec: 99, transcript: 'hit' },
    ]);

    const hit = expanded.find((item) => item.chunkId === 'chunk_0004');
    const neighbour = expanded.find((item) => item.chunkId === 'chunk_0003');
    assert.equal(hit.expandedFrom, null);
    assert.equal(neighbour.expandedFrom, 'chunk_0004');
  });

  it('證據超過上限時，砍掉的是最不相關的而不是最晚出現的', async () => {
    addChunkSeries({ count: 20 });

    // 命中片段刻意放在影片後段：若截斷是按時間切前 N 筆，這些高分片段會全被丟掉。
    const matches = [
      { chunkId: 'chunk_0015', segmentId: 'chunk_0015', videoId: ids.teacherVideo, startSec: 300, endSec: 319, transcript: 'hit-1' },
      { chunkId: 'chunk_0017', segmentId: 'chunk_0017', videoId: ids.teacherVideo, startSec: 340, endSec: 359, transcript: 'hit-2' },
    ];

    const expanded = await shortScriptService.expandMatchesWithNeighbours(matches);
    const evidence = shortScriptService.buildEvidence(expanded, { limit: 3 });

    const keptIds = evidence.map((item) => item.chunkId);
    assert.equal(keptIds.includes('chunk_0015'), true);
    assert.equal(keptIds.includes('chunk_0017'), true);
    assert.equal(evidence.length, 3);
  });

  it('截斷後仍依原片時間排序顯示', async () => {
    addChunkSeries({ count: 20 });

    const expanded = await shortScriptService.expandMatchesWithNeighbours([
      { chunkId: 'chunk_0015', segmentId: 'chunk_0015', videoId: ids.teacherVideo, startSec: 300, endSec: 319, transcript: 'hit' },
    ]);
    const evidence = shortScriptService.buildEvidence(expanded, { limit: 3 });

    const starts = evidence.map((item) => item.startSec);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  });

  it('片段在影片的第一格時，只往後擴展不會出錯', async () => {
    addChunkSeries({ count: 5 });

    const expanded = await shortScriptService.expandMatchesWithNeighbours([
      { chunkId: 'chunk_0000', segmentId: 'chunk_0000', videoId: ids.teacherVideo, startSec: 0, endSec: 19, transcript: 'hit' },
    ]);

    assert.deepEqual(expanded.map((item) => item.chunkId), ['chunk_0000', 'chunk_0001']);
  });
});
