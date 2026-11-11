'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyChecks, inspectResult, LIMITS } = require('../src/worker/checks');
const expected = { width: 720, height: 1280, fps: 30, durationSec: 35 };
const pass = { ...expected, videoTracks: 1, audioTracks: 1, blackMaxSec: 0, silenceMaxSec: 0, integratedLufs: -16, truePeakDbtp: -2, fontLoaded: true };
test('媒體檢查解析ffprobe與FFmpeg原始值，指令門檻固定', async () => {
  const calls = [];
  const checks = await inspectResult({ filePath: 'fake.mp4', fontLoaded: true, runCommand: async (binary, args) => {
    calls.push({ binary, args });
    return binary === 'ffprobe' ? { stdout: JSON.stringify({ streams: [{ codec_type: 'video', width: 720, height: 1280, avg_frame_rate: '30/1' }, { codec_type: 'audio' }], format: { duration: '35' } }) }
      : { stderr: 'black_duration:0.1\nblack_duration:0.2\nsilence_start: 12\nsilence_end: 12.8 | silence_duration: 0.8\n{"input_i":"-16.2","input_tp":"-2.3"}' };
  } });
  assert.equal(checks.blackMaxSec, 0.2); assert.equal(checks.silenceMaxSec, 0.8); assert.equal(checks.integratedLufs, -16.2);
  assert.equal(checks.fps, 30); assert.equal(classifyChecks(checks, expected).valid, true);
  assert(calls[1].args.includes(`blackdetect=d=0:pix_th=${LIMITS.blackPixelThreshold}`));
  assert(calls[1].args.some((a) => a.includes('silencedetect=n=-50dB:d=0')));
});
for (const [key, value, retryable] of [
  ['videoTracks', 2, false], ['audioTracks', 0, false], ['width', 1080, false], ['height', 1920, false],
  ['fps', 60, false], ['durationSec', 35.501, false], ['silenceMaxSec', 2, false],
  ['integratedLufs', -18.01, false], ['truePeakDbtp', -1.49, false], ['blackMaxSec', 0.5, true], ['fontLoaded', false, true],
]) test(`${key}不合格的固定／偶發分類`, () => {
  const result = classifyChecks({ ...pass, [key]: value }, expected);
  assert.equal(result.valid, false); assert.equal(result.retryable, retryable);
});
test('固定與偶發同時出現，以固定失敗處理', () => {
  assert.equal(classifyChecks({ ...pass, width: 1, fontLoaded: false }, expected).retryable, false);
});
test('缺少或非有限原始值不能宣稱passed', () => {
  for (const key of ['durationSec', 'blackMaxSec', 'silenceMaxSec', 'integratedLufs', 'truePeakDbtp']) {
    assert.equal(classifyChecks({ ...pass, [key]: NaN }, expected).valid, false);
  }
});
test('FFmpeg缺響度數據就停止，不使用預設通過數字', async () => {
  await assert.rejects(inspectResult({ filePath: 'fake.mp4', fontLoaded: true, runCommand: async (binary) => binary === 'ffprobe'
    ? { stdout: JSON.stringify({ streams: [], format: {} }) } : { stderr: '' } }), { code: 'RECUT_RENDER_CHECK_FAILED' });
});
