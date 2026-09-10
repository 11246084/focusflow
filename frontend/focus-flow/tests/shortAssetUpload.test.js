import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { uploadAsset } from '../src/services/shortScript.js';

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

function makeFile(name) {
  const file = new Blob(['short-video-bytes'], { type: 'video/mp4' });
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

function response(body, { ok = true, status = 200, json = true } = {}) {
  return {
    ok,
    status,
    async json() {
      if (!json) throw new Error('Unexpected token < in JSON');
      return body;
    },
  };
}

describe('短影片成品上傳契約', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      getItem(key) {
        return key === 'ff_token' ? 'teacher-token' : null;
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  });

  it('以 multipart 送出影片、標題、腳本版本與兩個確認旗標', async () => {
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return response({ data: { id: 'asset-1', reviewStatus: 'pending' } }, { statusCode: 201 });
    };

    const asset = await uploadAsset('script-1', {
      file: makeFile('short.mp4'),
      title: '什麼是過擬合',
      description: '課程短影片',
      versionNo: 2,
    });

    assert.equal(asset.id, 'asset-1');
    const [url, options] = calls[0];
    assert.ok(url.endsWith('/short-scripts/script-1/asset'));
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer teacher-token');
    // multipart 的 boundary 必須由 fetch 自行決定，手動設 Content-Type 會讓後端解不到欄位。
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.body.get('title'), '什麼是過擬合');
    assert.equal(options.body.get('description'), '課程短影片');
    assert.equal(options.body.get('versionNo'), '2');
    assert.equal(options.body.get('aiDisclosureConfirmed'), 'true');
    assert.equal(options.body.get('consentConfirmed'), 'true');
    assert.ok(options.body.get('video'));
  });

  it('保留後端的錯誤訊息與錯誤碼，供頁面分辨失敗原因', async () => {
    globalThis.fetch = async () => response(
      {
        message: 'AI disclosure and written consent must be confirmed before uploading.',
        error: { code: 'SHORT_ASSET_DISCLOSURE_REQUIRED' },
      },
      { ok: false, status: 400 },
    );

    const error = await uploadAsset('script-1', { file: makeFile('short.mp4'), title: 't' })
      .then(() => null, (thrown) => thrown);

    assert.equal(error.status, 400);
    assert.equal(error.code, 'SHORT_ASSET_DISCLOSURE_REQUIRED');
    assert.match(error.message, /consent/);
  });

  it('nginx 擋下超大檔案時給出可理解的原因，而不是 Request failed', async () => {
    // 413 由 nginx 回，body 是 HTML；解析 JSON 會丟例外，此時沒有 message 可用。
    globalThis.fetch = async () => response(null, { ok: false, status: 413, json: false });

    const error = await uploadAsset('script-1', { file: makeFile('huge.mp4'), title: 't' })
      .then(() => null, (thrown) => thrown);

    assert.equal(error.status, 413);
    assert.match(error.message, /上傳大小/);
  });
});
