const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const {
  startServer,
  stopServer,
} = require('./helpers/backendTestHarness');

describe('docs routes', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  it('serves the raw OpenAPI yaml', async () => {
    const response = await fetch(`${serverContext.baseUrl}/docs/openapi.yaml`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /yaml|plain/i);
    assert.match(text, /^openapi:\s+3\.1\.0/m);
    assert.match(text, /LINE Webhook/);
    assert.match(text, /\/api\/v1\/line\/bind-token:/);
  });

  it('serves swagger ui configured to load the same-origin yaml spec', async () => {
    const response = await fetch(`${serverContext.baseUrl}/docs`);
    const html = await response.text();
    const initResponse = await fetch(`${serverContext.baseUrl}/docs/swagger-ui-init.js`);
    const initScript = await initResponse.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /html/i);
    assert.equal(initResponse.status, 200);
    assert.match(html, /swagger-ui-init\.js/);
    assert.match(initScript, /\/docs\/openapi\.yaml/);
  });
});
