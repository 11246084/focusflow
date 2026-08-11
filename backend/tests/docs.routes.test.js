const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const yaml = require('js-yaml');
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

  it('OpenAPI health schema 與 Phase 2-2 runtime diagnostics 契約一致', async () => {
    const response = await fetch(`${serverContext.baseUrl}/docs/openapi.yaml`);
    const spec = yaml.load(await response.text());
    const qaRuntime = spec.components.schemas.QaRuntimeSnapshot;
    const hierarchyFields = [
      'hierarchicalRetrievalEnabled',
      'hierarchicalRetrievalFallbackToLeaf',
      'hierarchicalParentStorageMode',
      'queryEmbeddingDimensions',
      'queryEmbeddingContract',
      'dataContractCompatibility',
      'leafQueryEmbeddingCompatible',
      'parentQueryEmbeddingCompatible',
    ];

    assert.equal(response.status, 200);
    // QaRuntimeSnapshot is shared by /health and /qa/ask; required fields must match the runtime builder.
    hierarchyFields.forEach((field) => {
      assert.equal(qaRuntime.required.includes(field), true);
      assert.ok(qaRuntime.properties[field]);
    });
    assert.equal(
      qaRuntime.properties.readiness.$ref,
      '#/components/schemas/ReadinessStatus',
    );
    assert.equal(spec.components.schemas.EmbeddingContract.properties.taskType.anyOf.some(
      (item) => item.type === 'null',
    ), true);
    assert.equal(
      spec.components.schemas.EmbeddingDataContractCompatibility.properties.parent.$ref,
      '#/components/schemas/EmbeddingContractCompatibility',
    );
    const healthExample = spec.paths['/health'].get.responses['200']
      .content['application/json'].examples.healthy.value.data.runtime.qa;
    for (const kind of ['leaf', 'parent']) {
      assert.ok(healthExample.dataContractCompatibility[kind].expected);
      assert.ok(healthExample.dataContractCompatibility[kind].active);
    }
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
