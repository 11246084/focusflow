const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resetStore, store, ids } = require('./helpers/backendTestHarness');
const { seedScript, snapshot } = require('./helpers/recutFixtures');
const { expandContinuousWindow: expand, inspectProbe, calculateFixedGain: gain, splitSentences, createRecutSourceSteps, loadSourceInputs } = require('../src/services/recutSource.service');
const { createRecutQueue } = require('../src/services/recutQueue.service');
const segments = Array.from({ length: 20 }, (_, i) => ({ videoId: ids.teacherVideo, chunkId: `c${i}`, startSec: i * 15, endSec: (i + 1) * 15 }));
const windowInput = () => ({ hits: [segments[5], segments[7]], segments });
const fixedWindow = () => ({ startSec: 30, endSec: 180, hitRanges: [{ chunkId: 'c5', startSec: 75, endSec: 90 }], segments });
const word = (w, s, e) => ({ w, s, e });
const blocked = (fn, code = 'RECUT_WINDOW_NOT_FOUND') => assert.throws(fn, { code });
const queues = [];

describe('recut RC2 連續視窗與句子', () => {
  beforeEach(resetStore);
  afterEach(async () => { for (const q of queues) { await q.idle(); q.stop(); } queues.length = 0; });
  it('正常擴展含全部命中、對齊片段邊界，優先 150 秒且結果確定', () => {
    const a = expand({ ...windowInput(), frozenAt: new Date(0) });
    assert.equal(a.endSec - a.startSec, 150); assert.ok(a.startSec <= 75 && a.endSec >= 120);
    assert.deepEqual(a.hitChunkIds, ['c5', 'c7']); assert.deepEqual(a, expand({ ...windowInput(), frozenAt: new Date(0) }));
  });
  it('命中分散超過三分鐘停止；不擅自捨棄遠處命中', () => blocked(() => expand({ hits: [segments[0], segments[19]], segments })));
  it('跨影片停止，不跨片拼接', () => blocked(() => expand({ hits: [segments[1], { ...segments[3], videoId: 'other' }], segments })));
  it('影片片段太短或單片段超過三分鐘皆找不到視窗', () => {
    blocked(() => expand({ hits: [segments[1]], segments: segments.slice(0, 5) }));
    const long = { videoId: 'v', chunkId: 'long', startSec: 0, endSec: 200 };
    blocked(() => expand({ hits: [long], segments: [long] }));
  });
  it('片段中斷超過十秒、缺命中或非法時間停止', () => {
    blocked(() => expand({ hits: [segments[1], segments[7]], segments: [segments[1], segments[7]] }));
    blocked(() => expand({ hits: [segments[1]], segments: [] }));
    blocked(() => expand({ hits: [{ ...segments[1], endSec: NaN }], segments }));
  });
  it('原片缺聲音軌、長度不足、音軌過短各有教師可讀原因', () => {
    blocked(() => inspectProbe({ streams: [], format: { duration: '300' } }, fixedWindow()), 'RECUT_SOURCE_NO_AUDIO');
    blocked(() => inspectProbe({ streams: [{ codec_type: 'audio' }], format: { duration: '50' } }, fixedWindow()), 'RECUT_SOURCE_TOO_SHORT');
    blocked(() => inspectProbe({ streams: [{ codec_type: 'audio', duration: '50' }], format: { duration: '300' } }, fixedWindow()), 'RECUT_SOURCE_TOO_SHORT');
    assert.equal(inspectProbe({ streams: [{ codec_type: 'audio' }], format: { duration: '300' } }, fixedWindow()).audioTrack, true);
  });
  it('一般增益與峰值限制；不改動動態或聲音內容', () => {
    assert.equal(gain({ integratedLufs: -21, truePeakDbtp: -8 }).fixedGainDb, 5);
    assert.equal(gain({ integratedLufs: -21, truePeakDbtp: -6 }).fixedGainDb, 4.5);
    assert.equal(gain({ integratedLufs: -12, truePeakDbtp: -1 }).fixedGainDb, -4);
  });
  it('離目標兩 LU 以上停止，無效量測不放行', () => {
    blocked(() => gain({ integratedLufs: -30, truePeakDbtp: -5 }), 'RECUT_SOURCE_TOO_QUIET');
    blocked(() => gain({ integratedLufs: -21, truePeakDbtp: -4.5 }), 'RECUT_SOURCE_TOO_QUIET');
    blocked(() => gain({ integratedLufs: -Infinity, truePeakDbtp: -Infinity }), 'RECUT_SOURCE_AUDIO_INVALID');
  });
  it('依 0.3 秒停頓、標點切句，編號依序且轉成原片絕對秒數', () => {
    const sentences = splitSentences([word('第一', 0, 1), word('句', 1.3, 2), word('。', 2, 2.1), word('第二', 2.1, 3)], fixedWindow());
    assert.deepEqual(sentences.map((s) => s.id), ['s1', 's2', 's3']);
    assert.equal(sentences[1].text, '句。'); assert.equal(sentences[0].startSec, 30);
  });
  it('超過八秒在字詞邊界強制切；不把單一長字詞假造拆時', () => {
    const sentences = splitSentences(Array.from({ length: 10 }, (_, i) => word('字', i, i + 1)), fixedWindow());
    assert.deepEqual(sentences.map((s) => s.endSec - s.startSec), [8, 2]);
    blocked(() => splitSentences([word('長字詞', 0, 9)], fixedWindow()), 'RECUT_ASR_INVALID');
  });
  it('★ 依時間重疊命中標記；不是整個視窗都算命中', () => {
    const sentences = splitSentences([word('未命中。', 0, 2), word('命中。', 46, 48)], fixedWindow());
    assert.deepEqual(sentences.map((s) => s.retrievalHit), [false, true]); assert.deepEqual(sentences[1].chunkIds, ['c5']);
  });
  it('空結果、倒序、視窗外、零長字詞拒絕', () => {
    for (const input of [[], [word('字', -1, 1)], [word('字', 1, 1)], [word('字', 5, 6), word('字', 2, 3)], [word('字', 149, 151)]]) {
      blocked(() => splitSentences(input, fixedWindow()), 'RECUT_ASR_INVALID');
    }
  });
  it('使用實際課程影片範圍解析 native／external 影片識別', async () => {
    const script = seedScript({ evidence: [{ ...segments[5], videoId: ids.teacherVideoExternal, expandedFrom: null }] });
    store.videoSegments.push(...segments.map((s) => ({ ...s, videoId: ids.teacherVideoExternal })));
    const input = await loadSourceInputs({ scriptId: script._id, courseId: script.courseId });
    assert.equal(String(input.video._id), ids.teacherVideo); assert.equal(input.hits[0].videoId, ids.teacherVideo);
    assert.ok(input.segments.length); assert.ok(input.segments.every((segment) => !segment.transcriptVersion));
  });
  it('同版本才以chunkId回查，排除其他版本片段', async () => {
    const script = seedScript({ evidence: [{ ...segments[5], transcriptVersion: 'upgrade-1' }] });
    store.videos.find((video) => String(video._id) === ids.teacherVideo).activeTranscriptVersion = 'upgrade-1';
    store.videoSegments.push(...segments.map((segment) => ({ ...segment, transcriptVersion: 'upgrade-1', transcript: '快照原文' })));
    store.videoSegments.push({ ...segments[5], transcriptVersion: 'upgrade-old', transcript: '不得讀取的舊文' });
    const input = await loadSourceInputs({ scriptId: script._id, courseId: script.courseId });
    assert.ok(input.segments.length); assert.ok(input.segments.every((segment) => segment.transcriptVersion === 'upgrade-1'));
  });
  it('影片逐字稿升級後，舊凍結證據不得回查重用的chunkId', async () => {
    const script = seedScript({ evidence: [{ ...segments[5] }] });
    store.videos.find((video) => String(video._id) === ids.teacherVideo).activeTranscriptVersion = 'upgrade-2';
    const Model = require('../src/models/videoSegment.model'); const original = Model.find; let queries = 0;
    Model.find = (...args) => { queries++; return original(...args); };
    try { await assert.rejects(loadSourceInputs({ scriptId: script._id, courseId: script.courseId }), { code: 'RECUT_SOURCE_UPDATED' }); }
    finally { Model.find = original; }
    assert.equal(queries, 0); assert.equal(script.evidence[0].startSec, segments[5].startSec);
  });
  for (const failure of ['probe', 'decode', 'measure']) {
    it(`${failure} 失敗停止任務、不辨識、不扣模型額度，教師取得原因`, async () => {
      const script = seedScript(); let asrCalls = 0;
      const media = {
        probe: async () => ({ streams: failure === 'probe' ? [] : [{ codec_type: 'audio' }], format: { duration: '300' } }),
        decode: async () => { if (failure === 'decode') throw new Error('fake bad audio'); },
        measure: async () => failure === 'measure' ? { integratedLufs: -30, truePeakDbtp: -5 } : { integratedLufs: -21, truePeakDbtp: -8 },
        transcribe: async () => { asrCalls++; return []; },
      };
      const q = createRecutQueue(); queues.push(q);
      q.registerSteps('generate', createRecutSourceSteps({ media, loadInputs: async () => ({ ...windowInput(), video: { _id: ids.teacherVideo, filePath: 'fake.mp4' } }) }));
      const task = await q.enqueue({ script, requestedBy: ids.teacher }); await q.idle();
      const stored = store.recutTasks.find((t) => String(t._id) === String(task._id));
      assert.equal(stored.status, 'failed'); assert.equal(stored.callsUsed, 0); assert.equal(asrCalls, 0); assert.equal(snapshot(script).state, 'idle');
      assert.match(stored.error.message, /原片/); assert.equal(store.notifications.length, 1);
    });
  }
  it('四個步驟串入 RC1，來源只寫一份，凍結視窗不隨後來片段變更', async () => {
    const script = seedScript(); const order = [];
    const media = { probe: async () => { order.push('probe'); return { streams: [{ codec_type: 'audio' }], format: { duration: '300' } }; },
      decode: async () => { order.push('decode'); }, measure: async () => { order.push('measure'); return { integratedLufs: -21, truePeakDbtp: -8 }; },
      transcribe: async () => { order.push('asr'); return [word('第一句。', 0, 2), word('第二句。', 3, 5)]; } };
    const q = createRecutQueue(); queues.push(q);
    const steps = createRecutSourceSteps({ media, loadInputs: async () => ({ ...windowInput(), video: { _id: ids.teacherVideo, filePath: 'fake.mp4' } }) });
    q.registerSteps('generate', [...steps, { id: 'fixture-final-version', stage: 'selection', run: async ({ data }) => ({ version: {
      sourceId: data.sourceId, selection: { answerable: false, ranges: [], unanswerableReason: '測試停止' }, modelId: 'fake', shortRenderVersion: 'fixture',
    } }) }]);
    const task = await q.enqueue({ script, requestedBy: ids.teacher }); await q.idle();
    assert.equal(store.recutTasks.find((t) => String(t._id) === String(task._id)).status, 'succeeded');
    assert.deepEqual(order, ['probe', 'decode', 'measure', 'asr']); assert.equal(store.recutSources.length, 1);
    assert.equal(store.recutSources[0].audio.fixedGainDb, 5); assert.equal(store.recutSources[0].sentences[0].id, 's1');
    assert.ok(store.recutSources[0].frozenAt); assert.equal(store.recutAttempts.length, 5);
    assert.equal(store.recutSources[0].transcriptVersion, 'legacy');
    assert.ok(store.recutSources[0].transcriptChunks.length);
  });
  it('ASR provenance freezes excluded first/last sentence IDs and source identity', async () => {
    const script = seedScript();
    const steps = createRecutSourceSteps();
    const result = await steps[3].run({ task: { scriptId: script._id }, data: {
      sourceWindow: { ...fixedWindow(), frozenAt: new Date(), hitChunkIds: ['c5'] }, sourceVideoId: ids.teacherVideo,
      transcriptVersion: 'generation-2', rawAsrResult: { sourceSha256: 'a'.repeat(64),
        words: [word('截斷首句。', 0, 2), word('可用原話。', 3, 5), word('截斷尾句', 6, 8)],
        asrProvenance: { kind: 'fresh-local-asr', boundaryStartTruncated: true, boundaryEndTruncated: true,
          rawWordsSha256: 'b'.repeat(64), excludedWords: [{ w: '尾', s: 150, e: 150, reason: 'explicit-cut' }] } },
    } });
    const src = store.recutSources.find((v) => String(v._id) === result.sourceId);
    assert.deepEqual(src.excludedSentenceIds, ['s1', 's3']); assert.equal(src.sourceSha256, 'a'.repeat(64));
    assert.equal(src.asrProvenance.rawWordsSha256, 'b'.repeat(64)); assert.equal(src.asrProvenance.excludedWords[0].s, 150);
    assert.equal(src.sentences.length, 3); assert.equal(src.transcriptVersion, 'generation-2');
    assert.ok(src.transcriptChunks.length);
  });
  it('arbitrary raw/fake ASR cannot claim a cut to erase invalid trailing tokens', async () => {
    const step = createRecutSourceSteps()[3]; const script = seedScript();
    for (const raw of [[word('正常', 0, 2), word('零長', 150, 150)],
      { words: [word('正常', 0, 2), word('零長', 150, 150)], boundaryEvidence: { kind: 'ffmpeg-extracted-window' } }]) {
      await assert.rejects(step.run({ task: { scriptId: script._id }, data: { sourceWindow: fixedWindow(), rawAsrResult: raw } }), { code: 'RECUT_ASR_INVALID' });
    }
    assert.equal(store.recutSources.length, 0);
  });

});
