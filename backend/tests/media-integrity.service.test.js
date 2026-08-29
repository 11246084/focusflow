const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const { assertMediaIntegrity } = require('../src/services/mediaIntegrity.service');

const directories = [];

function temporaryFile(name, contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-media-'));
  directories.push(directory);
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function box(type, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

describe('uploaded media integrity preflight', () => {
  afterEach(() => {
    while (directories.length) fs.rmSync(directories.pop(), { recursive: true, force: true });
  });

  it('accepts an ISO BMFF file containing ftyp, mdat, and moov boxes', () => {
    const filePath = temporaryFile('valid.mp4', Buffer.concat([
      box('ftyp', Buffer.from('isom')),
      box('mdat', Buffer.from('media')),
      box('moov', Buffer.from('metadata')),
    ]));
    assert.equal(assertMediaIntegrity(filePath, 'valid.mp4').container, 'iso-bmff');
  });

  it('rejects a truncated MP4 before it enters the processing queue', () => {
    const filePath = temporaryFile('truncated.mp4', Buffer.concat([
      box('ftyp', Buffer.from('isom')),
      box('mdat', Buffer.from('partial-media')),
    ]));
    assert.throws(
      () => assertMediaIntegrity(filePath, 'truncated.mp4'),
      (error) => error.code === 'INVALID_MEDIA_CONTAINER' && /missing moov/.test(error.message),
    );
  });

  it('accepts an MKV EBML signature and rejects a renamed non-MKV file', () => {
    const valid = temporaryFile('valid.mkv', Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8)]));
    const invalid = temporaryFile('invalid.mkv', Buffer.from('not-a-matroska-file'));
    assert.equal(assertMediaIntegrity(valid, 'valid.mkv').container, 'matroska');
    assert.throws(() => assertMediaIntegrity(invalid, 'invalid.mkv'), /invalid EBML header/);
  });
});
