const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const express = require('express');
const {
  assertSupportedExpressVersion,
  compareRouteCoverage,
  isInScope,
  listExpressRoutes,
  listOpenApiOperations,
  toOpenApiPath,
} = require('./helpers/expressRouteInventory');

function keysOf(routes) {
  return routes.map((route) => `${route.method} ${route.openApiPath}`).sort();
}

function buildFixtureApp() {
  const app = express();
  const noop = (req, res) => res.sendStatus(204);

  const courses = express.Router();
  courses.use((req, res, next) => next());
  courses.get('/', noop);
  courses.post('/', noop);
  courses.get('/:courseId', noop);
  courses.patch('/:courseId/videos/:videoId', noop);

  const rootMounted = express.Router();
  rootMounted.use(['/videos'], (req, res, next) => next());
  rootMounted.get('/videos/:videoId', noop);

  const api = express.Router();
  api.use('/courses', courses);
  api.use('/', rootMounted);

  const health = express.Router();
  health.get('/', noop);

  app.use(express.json());
  app.use('/health', health);
  app.use('/api/v1', api);
  app.get('/docs/openapi.yaml', noop);
  return app;
}

describe('expressRouteInventory', () => {
  it('解析具名 mount prefix、掛在 / 的 router 與巢狀 router', () => {
    const routes = listExpressRoutes(buildFixtureApp());

    assert.deepEqual(keysOf(routes), [
      'GET /api/v1/courses',
      'GET /api/v1/courses/{courseId}',
      'GET /api/v1/videos/{videoId}',
      'GET /docs/openapi.yaml',
      'GET /health',
      'PATCH /api/v1/courses/{courseId}/videos/{videoId}',
      'POST /api/v1/courses',
    ]);
  });

  it('只掛 middleware 的 router.use 不會被當成 route', () => {
    const routes = listExpressRoutes(buildFixtureApp());

    // courses.use(fn) 與 rootMounted.use(['/videos'], fn) 都只是 middleware。
    assert.equal(routes.some((route) => route.expressPath === '/api/v1/videos'), false);
    assert.equal(routes.length, 7);
  });

  it('忽略 Express 自動處理的 HEAD、OPTIONS 與 router.all', () => {
    const app = express();
    const router = express.Router();
    router.all('/any', (req, res) => res.end());
    router.head('/probe', (req, res) => res.end());
    router.options('/probe', (req, res) => res.end());
    router.get('/probe', (req, res) => res.end());
    app.use('/api/v1', router);

    assert.deepEqual(keysOf(listExpressRoutes(app)), ['GET /api/v1/probe']);
  });

  it('Express 參數轉成 OpenAPI path template', () => {
    assert.equal(toOpenApiPath('/api/v1/courses/:courseId/videos/:videoId'), '/api/v1/courses/{courseId}/videos/{videoId}');
    assert.equal(toOpenApiPath('/health'), '/health');
    assert.equal(toOpenApiPath('/docs/openapi.yaml'), '/docs/openapi.yaml');
  });

  it('可選參數、wildcard、regex 參數無法轉換時回 null', () => {
    assert.equal(toOpenApiPath('/items/:id?'), null);
    assert.equal(toOpenApiPath('/files/*'), null);
    assert.equal(toOpenApiPath('/items/:id(\\d+)'), null);
    assert.equal(toOpenApiPath(/^\/docs$/), null);
  });

  it('RegExp route 保留在清單中但 openApiPath 為 null', () => {
    const app = express();
    app.get(/^\/docs$/, (req, res) => res.end());

    const [route] = listExpressRoutes(app);
    assert.equal(route.openApiPath, null);
    assert.equal(route.mountPrefix, '');
  });

  it('帶參數的 router mount 直接失敗，不默默略過', () => {
    const app = express();
    const nested = express.Router({ mergeParams: true });
    nested.get('/', (req, res) => res.end());
    app.use('/courses/:courseId/items', nested);

    assert.throws(() => listExpressRoutes(app), /path parameters are not supported/);
  });

  it('同一組 method 與 path 註冊兩次時會被列為重複', () => {
    const app = express();
    const first = express.Router();
    const second = express.Router();
    first.get('/videos/:videoId', (req, res) => res.end());
    second.get('/videos/:videoId', (req, res) => res.end());
    app.use('/api/v1', first);
    app.use('/api/v1', second);

    const routeOperations = listExpressRoutes(app).map((route) => ({ method: route.method, path: route.openApiPath }));
    const result = compareRouteCoverage({ routeOperations, specOperations: [] });

    assert.deepEqual(result.duplicates, [{ key: 'GET /api/v1/videos/{videoId}', count: 2 }]);
  });

  it('非 Express 4 時明確失敗', () => {
    assert.doesNotThrow(() => assertSupportedExpressVersion('4.22.1'));
    assert.throws(() => assertSupportedExpressVersion('5.1.0'), /Express 4/);
  });

  it('scope 判斷只接受完整的 path segment', () => {
    assert.equal(isInScope('/api/v1/courses', ['/api/v1']), true);
    assert.equal(isInScope('/health', ['/health']), true);
    assert.equal(isInScope('/healthz', ['/health']), false);
    assert.equal(isInScope('/docs/openapi.yaml', ['/api/v1', '/health']), false);
  });

  it('從 OpenAPI paths 取出所有 operation，略過 path-level 欄位', () => {
    const operations = listOpenApiOperations({
      paths: {
        '/api/v1/courses/{courseId}': {
          parameters: [{ name: 'courseId', in: 'path' }],
          summary: 'shared',
          get: {},
          delete: {},
        },
      },
    });

    assert.deepEqual(operations, [
      { method: 'GET', path: '/api/v1/courses/{courseId}' },
      { method: 'DELETE', path: '/api/v1/courses/{courseId}' },
    ]);
  });
});

describe('compareRouteCoverage', () => {
  const op = (method, path) => ({ method, path });

  it('route 有、spec 沒有的 operation 列為 missing', () => {
    const result = compareRouteCoverage({
      routeOperations: [op('GET', '/api/v1/a'), op('GET', '/api/v1/b')],
      specOperations: [op('GET', '/api/v1/a')],
    });

    assert.deepEqual(result.missing, ['GET /api/v1/b']);
    assert.deepEqual(result.stale, []);
  });

  it('spec 有、route 已不存在的 operation 列為 stale', () => {
    const result = compareRouteCoverage({
      routeOperations: [op('GET', '/api/v1/a')],
      specOperations: [op('GET', '/api/v1/a'), op('DELETE', '/api/v1/gone')],
    });

    assert.deepEqual(result.stale, ['DELETE /api/v1/gone']);
    assert.deepEqual(result.missing, []);
  });

  it('同一條 path 的 method 不一致時合併成一筆 method mismatch', () => {
    const result = compareRouteCoverage({
      routeOperations: [op('PATCH', '/api/v1/a')],
      specOperations: [op('PUT', '/api/v1/a')],
    });

    assert.deepEqual(result.methodMismatches, [
      { path: '/api/v1/a', routeOnlyMethods: ['PATCH'], specOnlyMethods: ['PUT'] },
    ]);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.stale, []);
  });

  it('path 形狀相同但參數名稱不同時列為 parameter mismatch', () => {
    const result = compareRouteCoverage({
      routeOperations: [op('GET', '/api/v1/courses/{courseId}')],
      specOperations: [op('GET', '/api/v1/courses/{id}')],
    });

    assert.deepEqual(result.parameterMismatches, [
      { method: 'GET', routePath: '/api/v1/courses/{courseId}', specPath: '/api/v1/courses/{id}' },
    ]);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.stale, []);
  });

  it('by-design 排除項不算 missing，但仍需存在於 routes 且不得寫進 spec', () => {
    const result = compareRouteCoverage({
      routeOperations: [op('POST', '/api/v1/internal/x')],
      specOperations: [op('GET', '/api/v1/line/webhook')],
      undocumentedByDesign: ['POST /api/v1/internal/x', 'GET /api/v1/line/webhook', 'POST /api/v1/internal/removed'],
    });

    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.undocumentedByDesignNotRouted, ['GET /api/v1/line/webhook', 'POST /api/v1/internal/removed']);
    assert.deepEqual(result.undocumentedByDesignInSpec, ['GET /api/v1/line/webhook']);
  });

  it('known gap 補進 spec 或 route 已移除時要求從清單刪除', () => {
    const result = compareRouteCoverage({
      routeOperations: [op('GET', '/api/v1/a'), op('GET', '/api/v1/b')],
      specOperations: [op('GET', '/api/v1/a')],
      knownGaps: ['GET /api/v1/a', 'GET /api/v1/b', 'GET /api/v1/removed'],
    });

    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.knownGapsNowDocumented, ['GET /api/v1/a']);
    assert.deepEqual(result.knownGapsNotRouted, ['GET /api/v1/removed']);
  });
});
