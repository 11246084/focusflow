const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const { test } = require('node:test');
const { probeLocalPlayback } = require('../src/services/mediaIntegrity.service');
const box = (name) => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(name, 4); return b; };
test('ffprobe detects compatible codecs, incompatible codecs, moov order and unknown', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-probe-')); const file = path.join(root, 'source.mp4');
  const original = child.execFile;
  try {
    fs.writeFileSync(file, Buffer.concat([box('ftyp'), box('moov'), box('mdat')]));
    child.execFile = (cmd, args, options, cb) => cb(null, JSON.stringify({ format: { format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }] }));
    const compatible = await probeLocalPlayback(file); assert.equal(compatible.compatible, true); assert.equal(compatible.moovFirst, true);
    fs.writeFileSync(file, Buffer.concat([box('ftyp'), box('mdat'), box('moov')]));
    child.execFile = (cmd, args, options, cb) => cb(null, JSON.stringify({ format: { format_name: 'matroska' }, streams: [{ codec_type: 'video', codec_name: 'hevc' }] }));
    const incompatible = await probeLocalPlayback(file); assert.equal(incompatible.compatible, false); assert.equal(incompatible.moovFirst, false);
    child.execFile = (cmd, args, options, cb) => cb(new Error('missing'));
    const unknown = await probeLocalPlayback(file); assert.equal(unknown.compatible, null); assert.equal(unknown.moovFirst, false);
  } finally { child.execFile = original; fs.rmSync(root, { recursive: true, force: true }); }
});
