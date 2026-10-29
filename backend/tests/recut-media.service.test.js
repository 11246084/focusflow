const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
require('./helpers/backendTestHarness');
const { createRecutMediaTools } = require('../src/services/recutMedia.service');
it('recut 媒體工具只抽視窗，以離線 small 辨識，ASR 一次一件並清暫存（程式皆為 fake run）', async () => {
  let active = 0; let peak = 0; const commands = []; const outputs = [];
  const tools = createRecutMediaTools({ resolveSource: () => 'fixture.mp4', run: async (binary, args, options) => {
    commands.push({ binary, args, options });
    if (args[0] === '-I') {
      active++; peak = Math.max(peak, active); await new Promise(setImmediate);
      assert.equal(options.env.HF_HUB_OFFLINE, '1'); assert.equal(args.at(-1), 'small');
      outputs.push(args[3]); await fs.writeFile(args[3], JSON.stringify([{ w: '原音', s: 0, e: 1 }])); active--;
    }
    return { stdout: '{}', stderr: '' };
  } });
  const w = { startSec: 40, endSec: 190 };
  const results = await Promise.all([tools.transcribe('input', w), tools.transcribe('input', w)]);
  assert.equal(peak, 1); assert.equal(results[0][0].w, '原音');
  for (const command of commands.filter((c) => c.args[0] !== '-I')) {
    assert.equal(command.args[command.args.indexOf('-ss') + 1], '40'); assert.equal(command.args[command.args.indexOf('-t') + 1], '150');
    assert.equal(command.options.windowsHide, true);
  }
  for (const file of outputs) await assert.rejects(() => fs.stat(file), { code: 'ENOENT' });
});
it('recut 媒體工具解析 ffprobe 與 loudnorm 量測 JSON，不以動態 loudnorm 輸出成品', async () => {
  const tools = createRecutMediaTools({ resolveSource: () => 'fixture.mp4', run: async (binary, args) => args.includes('-show_streams')
    ? { stdout: '{"streams":[{"codec_type":"audio"}],"format":{"duration":"300"}}' }
    : { stderr: 'log\n{"input_i":"-21.0","input_tp":"-8.0"}\n' } });
  assert.equal((await tools.probe('input')).streams[0].codec_type, 'audio');
  assert.deepEqual(await tools.measure('input', { startSec: 30, endSec: 180 }), { integratedLufs: -21, truePeakDbtp: -8 });
});
