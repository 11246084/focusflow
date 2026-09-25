// Express route ↔ OpenAPI coverage 的共用工具。
//
// 路由清單一律從 Express 的 runtime router 結構取得，不用 regex 掃原始碼：
// route 檔有多行宣告、middleware 陣列、掛在 '/' 的 router 等寫法，文字解析抓不準。
// 這裡依賴 Express 4 的內部結構（app._router.stack、layer.regexp.fast_slash），
// 升級 Express 5 時 assertSupportedExpressVersion() 會明確失敗，提醒改寫本檔。

const ROUTE_METHOD_IGNORE = new Set(['_all', 'head', 'options']);
const OPENAPI_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const MOUNT_SUFFIX = '\\/?(?=\\/|$)';
const SAFE_PATH_PATTERN = /^(\/[A-Za-z0-9._~-]+)*$/;
const EXPRESS_PARAM_PATTERN = /:([A-Za-z0-9_]+)/g;

function assertSupportedExpressVersion(version) {
  const major = Number(String(version || '').split('.')[0]);
  if (major !== 4) {
    throw new Error(
      `expressRouteInventory only understands Express 4 router internals (found ${version}).`,
    );
  }
}

// 還原 router.use(prefix, router) 的 prefix。掛在 '/' 的 layer 會帶 fast_slash。
function decodeMountPrefix(layer) {
  const { regexp } = layer;
  if (regexp.fast_slash) {
    return '';
  }

  if ((layer.keys || []).length > 0) {
    throw new Error(`Router mounts with path parameters are not supported: ${regexp}`);
  }

  const source = regexp.source;
  if (!source.startsWith('^') || !source.endsWith(MOUNT_SUFFIX)) {
    throw new Error(`Unrecognized router mount pattern: ${regexp}`);
  }

  const prefix = source
    .slice(1, -MOUNT_SUFFIX.length)
    .replace(/\\(.)/g, '$1');

  if (!SAFE_PATH_PATTERN.test(prefix) || !regexp.test(prefix)) {
    throw new Error(`Could not decode router mount prefix from ${regexp}`);
  }

  return prefix;
}

function joinPaths(prefix, path) {
  const joined = `${prefix}/${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

// Express ':courseId' → OpenAPI '{courseId}'。可選參數、wildcard、自訂 regex 參數
// 沒有對應的 OpenAPI 寫法，回 null 讓呼叫端列為 unsupported。
function toOpenApiPath(expressPath) {
  if (typeof expressPath !== 'string') {
    return null;
  }

  const converted = expressPath.replace(EXPRESS_PARAM_PATTERN, '{$1}');
  const withoutParams = converted.replace(/\{[A-Za-z0-9_]+\}/g, 'param');
  return SAFE_PATH_PATTERN.test(withoutParams) || withoutParams === '/' ? converted : null;
}

function collectRoutes(stack, prefix, routes) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method] && !ROUTE_METHOD_IGNORE.has(method))
        .map((method) => method.toUpperCase());

      for (const routePath of paths) {
        const expressPath = typeof routePath === 'string' ? joinPaths(prefix, routePath) : routePath;
        const openApiPath = typeof expressPath === 'string' ? toOpenApiPath(expressPath) : null;
        for (const method of methods) {
          routes.push({
            method,
            expressPath: String(expressPath),
            openApiPath,
            mountPrefix: prefix,
          });
        }
      }
      continue;
    }

    if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
      collectRoutes(layer.handle.stack, joinPaths(prefix, decodeMountPrefix(layer)), routes);
    }
  }

  return routes;
}

/**
 * 盤點 Express app 實際註冊的 route。
 *
 * @param {import('express').Express} app
 * @returns {{method: string, expressPath: string, openApiPath: string|null, mountPrefix: string}[]}
 *   openApiPath 為 null 代表無法轉成 OpenAPI path（RegExp route、wildcard 等）。
 */
function listExpressRoutes(app) {
  if (!app || !app._router) {
    throw new Error('Express app has no router yet; register routes before listing them.');
  }

  return collectRoutes(app._router.stack, '', []);
}

function isInScope(path, scopePrefixes) {
  return scopePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function listOpenApiOperations(spec) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of OPENAPI_METHODS) {
      if (pathItem && pathItem[method]) {
        operations.push({ method: method.toUpperCase(), path });
      }
    }
  }
  return operations;
}

function operationKey({ method, path }) {
  return `${method} ${path}`;
}

function pathShape(path) {
  return path.replace(/\{[^}]+\}/g, '{}');
}

function findDuplicates(routeOperations) {
  const counts = new Map();
  for (const operation of routeOperations) {
    const key = operationKey(operation);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
}

/**
 * 比對 route 與 OpenAPI operation。
 *
 * routeOperations／specOperations 皆為 {method, path}，path 使用 OpenAPI 格式。
 * undocumentedByDesign／knownGaps 為 'METHOD /path' 字串陣列。
 */
function compareRouteCoverage({
  routeOperations,
  specOperations,
  undocumentedByDesign = [],
  knownGaps = [],
}) {
  const routeKeys = new Set(routeOperations.map(operationKey));
  const specKeys = new Set(specOperations.map(operationKey));
  const excluded = new Set([...undocumentedByDesign, ...knownGaps]);

  const routeOnly = routeOperations.filter((operation) => {
    const key = operationKey(operation);
    return !specKeys.has(key) && !excluded.has(key);
  });
  const specOnly = specOperations.filter((operation) => !routeKeys.has(operationKey(operation)));

  // 參數名稱不一致：method 相同、把參數名稱抹掉後 path 形狀相同。
  const parameterMismatches = [];
  const pairedRoute = new Set();
  const pairedSpec = new Set();
  for (const routeOp of routeOnly) {
    const specOp = specOnly.find((candidate) => (
      !pairedSpec.has(operationKey(candidate))
      && candidate.method === routeOp.method
      && pathShape(candidate.path) === pathShape(routeOp.path)
    ));
    if (specOp) {
      parameterMismatches.push({ method: routeOp.method, routePath: routeOp.path, specPath: specOp.path });
      pairedRoute.add(operationKey(routeOp));
      pairedSpec.add(operationKey(specOp));
    }
  }

  const remainingRoute = routeOnly.filter((operation) => !pairedRoute.has(operationKey(operation)));
  const remainingSpec = specOnly.filter((operation) => !pairedSpec.has(operationKey(operation)));

  // method 不一致：同一條 path 兩邊都有，但 method 集合不同。
  const routePaths = new Set(routeOperations.map((operation) => operation.path));
  const specPaths = new Set(specOperations.map((operation) => operation.path));
  const mismatchByPath = new Map();
  const ensureMismatch = (path) => {
    if (!mismatchByPath.has(path)) {
      mismatchByPath.set(path, { path, routeOnlyMethods: [], specOnlyMethods: [] });
    }
    return mismatchByPath.get(path);
  };

  const missing = [];
  for (const operation of remainingRoute) {
    if (specPaths.has(operation.path)) {
      ensureMismatch(operation.path).routeOnlyMethods.push(operation.method);
    } else {
      missing.push(operationKey(operation));
    }
  }

  const stale = [];
  for (const operation of remainingSpec) {
    if (routePaths.has(operation.path)) {
      ensureMismatch(operation.path).specOnlyMethods.push(operation.method);
    } else {
      stale.push(operationKey(operation));
    }
  }

  return {
    missing: missing.sort(),
    stale: stale.sort(),
    methodMismatches: [...mismatchByPath.values()],
    parameterMismatches,
    duplicates: findDuplicates(routeOperations),
    undocumentedByDesignNotRouted: undocumentedByDesign.filter((key) => !routeKeys.has(key)),
    undocumentedByDesignInSpec: undocumentedByDesign.filter((key) => specKeys.has(key)),
    knownGapsNotRouted: knownGaps.filter((key) => !routeKeys.has(key)),
    knownGapsNowDocumented: knownGaps.filter((key) => specKeys.has(key)),
  };
}

module.exports = {
  assertSupportedExpressVersion,
  compareRouteCoverage,
  decodeMountPrefix,
  isInScope,
  joinPaths,
  listExpressRoutes,
  listOpenApiOperations,
  operationKey,
  toOpenApiPath,
};
