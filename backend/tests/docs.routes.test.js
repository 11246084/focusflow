const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const yaml = require('js-yaml');
const {
  startServer,
  stopServer,
} = require('./helpers/backendTestHarness');
const app = require('../src/app');
const { readOpenApiYaml } = require('../src/docs/openapi');
const {
  assertSupportedExpressVersion,
  compareRouteCoverage,
  isInScope,
  listExpressRoutes,
  listOpenApiOperations,
} = require('./helpers/expressRouteInventory');

// openapi.yaml 是公開／應用層的 API contract，涵蓋範圍固定為這兩個 prefix。
// app 層的 GET /、/docs*、/uploads 屬於服務本身的基礎設施，不列入。
const COVERAGE_SCOPE = ['/api/v1', '/health'];

// 刻意不寫進公開 openapi.yaml 的端點。每筆都要有理由，且必須仍存在於 routes。
const UNDOCUMENTED_BY_DESIGN = {
  'POST /api/v1/internal/videos/{videoId}/processing/start': 'STT pipeline 專用 webhook，只驗 X-Processing-Secret，不對外開放',
  'POST /api/v1/internal/videos/{videoId}/processing/complete': 'STT pipeline 專用 webhook，只驗 X-Processing-Secret，不對外開放',
  'POST /api/v1/internal/videos/{videoId}/processing/fail': 'STT pipeline 專用 webhook，只驗 X-Processing-Secret，不對外開放',
  'GET /api/v1/line/webhook': 'LINE Developers Console 設定 webhook URL 時的存在性探測，固定回 200',
};

// 尚未補進 openapi.yaml 的公開端點。只能刪、不能加：
// 某筆一旦寫進 spec，測試會要求把它從這裡移除。
const KNOWN_OPENAPI_GAPS = [];

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

describe('Express route ↔ OpenAPI coverage', () => {
  assertSupportedExpressVersion(require('express/package.json').version);

  const allRoutes = listExpressRoutes(app);
  const scopedRoutes = allRoutes.filter((route) => isInScope(route.openApiPath ?? route.mountPrefix, COVERAGE_SCOPE));
  const routeOperations = scopedRoutes
    .filter((route) => route.openApiPath)
    .map((route) => ({ method: route.method, path: route.openApiPath }));
  const specOperations = listOpenApiOperations(yaml.load(readOpenApiYaml()));
  const coverage = compareRouteCoverage({
    routeOperations,
    specOperations,
    undocumentedByDesign: Object.keys(UNDOCUMENTED_BY_DESIGN),
    knownGaps: KNOWN_OPENAPI_GAPS,
  });

  it('盤點範圍內的 route 都能轉成 OpenAPI path', () => {
    const unsupported = scopedRoutes
      .filter((route) => !route.openApiPath)
      .map((route) => `${route.method} ${route.expressPath}`);

    assert.ok(routeOperations.length > 0, 'route inventory returned no API routes');
    assert.deepEqual(unsupported, []);
  });

  it('每個實際 route 都有對應的 OpenAPI operation', () => {
    assert.deepEqual(coverage.missing, [], 'Document these routes in docs/openapi.yaml, or justify them in UNDOCUMENTED_BY_DESIGN.');
  });

  it('OpenAPI 沒有已不存在的 stale endpoint', () => {
    assert.deepEqual(coverage.stale, [], 'Remove these operations from docs/openapi.yaml.');
  });

  it('同一條 path 的 HTTP method 與實作一致', () => {
    assert.deepEqual(coverage.methodMismatches, []);
  });

  it('path 參數名稱與 Express route 一致', () => {
    assert.deepEqual(coverage.parameterMismatches, []);
  });

  it('沒有重複註冊的 method 與 path', () => {
    assert.deepEqual(coverage.duplicates, []);
  });

  it('UNDOCUMENTED_BY_DESIGN 的每筆都仍存在於 routes 且未寫進公開 spec', () => {
    assert.deepEqual(coverage.undocumentedByDesignNotRouted, [], 'Remove stale entries from UNDOCUMENTED_BY_DESIGN.');
    assert.deepEqual(coverage.undocumentedByDesignInSpec, [], 'These endpoints must stay out of the public openapi.yaml.');
  });

  it('KNOWN_OPENAPI_GAPS 沒有已補齊或已移除的項目', () => {
    assert.deepEqual(coverage.knownGapsNowDocumented, [], 'Remove documented entries from KNOWN_OPENAPI_GAPS.');
    assert.deepEqual(coverage.knownGapsNotRouted, [], 'Remove stale entries from KNOWN_OPENAPI_GAPS.');
  });
});
