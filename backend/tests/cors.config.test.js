const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { buildCorsOptions, parseAllowedOrigins } = require('../src/config/cors');

function checkOrigin(origin, allowedOrigins) {
  const options = buildCorsOptions({ allowedOrigins });
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(allowed);
    });
  });
}

describe('cors config', () => {
  it('parses comma-separated allowed origins', () => {
    assert.deepEqual(
      parseAllowedOrigins(' https://app.example.com,https://admin.example.com ,, '),
      ['https://app.example.com', 'https://admin.example.com'],
    );
  });

  it('keeps open CORS behavior when no allowed origins are configured', () => {
    assert.deepEqual(buildCorsOptions({ allowedOrigins: [] }), {});
  });

  it('allows server-to-server requests and configured origins only', async () => {
    const allowedOrigins = ['https://app.example.com'];

    assert.equal(await checkOrigin(undefined, allowedOrigins), true);
    assert.equal(await checkOrigin('https://app.example.com', allowedOrigins), true);
    assert.equal(await checkOrigin('https://evil.example.com', allowedOrigins), false);
  });
});
