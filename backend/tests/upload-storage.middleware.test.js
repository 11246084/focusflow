const assert = require('node:assert/strict');
const { test } = require('node:test');
const { uploadSingleVideo, uploadVideoBatch } = require('../src/middleware/upload.middleware');
function reject(middleware, headers) {
  return new Promise((resolve) => middleware({ headers }, {}, resolve));
}
test('multipart preflight rejects missing, invalid, chunked and oversized lengths before storage', async () => {
  assert.equal((await reject(uploadSingleVideo, {})).statusCode, 411);
  assert.equal((await reject(uploadSingleVideo, { 'content-length': '-1' })).statusCode, 400);
  assert.equal((await reject(uploadSingleVideo, { 'content-length': '12', 'transfer-encoding': 'chunked' })).statusCode, 400);
  assert.equal((await reject(uploadSingleVideo, { 'content-length': String(502 * 1024 * 1024) })).statusCode, 413);
  assert.equal((await reject(uploadVideoBatch, { 'content-length': String(5002 * 1024 * 1024) })).statusCode, 413);
});

test('等待容量預約時已斷線，取得token後立即釋放且不啟動multer', async () => {
  const { EventEmitter } = require('node:events');
  const storage = require('../src/services/uploadStorage.service');
  const { guardedUpload } = require('../src/middleware/upload.middleware');
  const originals = { reserve: storage.reserve, release: storage.release };
  let resolveReservation; let releases = 0; let multerCalls = 0;
  storage.reserve = () => new Promise(resolve => { resolveReservation = resolve; });
  storage.release = async token => { assert.equal(token, 'test-reservation'); releases++; };
  try {
    const req = new EventEmitter(); req.headers = { 'content-length': '100' }; req.aborted = false; req.destroyed = false;
    let error;
    const running = guardedUpload(() => { multerCalls++; }, 1000)(req, {}, value => { error = value; });
    req.aborted = true; req.destroyed = true; req.emit('aborted');
    resolveReservation('test-reservation'); await running;
    assert.equal(releases, 1); assert.equal(multerCalls, 0); assert.equal(error.code, 'UPLOAD_ABORTED');
    assert.equal(req.listenerCount('aborted'), 0);
  } finally { Object.assign(storage, originals); }
});
