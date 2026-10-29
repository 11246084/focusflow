const escape = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
function changedPaths(before, after, path = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return [path];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => changedPaths(before[key], after[key], `${path}/${escape(key)}`));
}
function validPresentationPath(path) {
  return typeof path === 'string' && (path === '/theme' || /^\/plan\/[^/]+/.test(path))
    && !['/plan/source', '/plan/clips', '/plan/schemaVersion'].some((root) => path === root || path.startsWith(`${root}/`));
}
function scopeMatches(before, after, allowedPaths) {
  return changedPaths(before, after).every((path) => allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`)));
}
module.exports = { changedPaths, validPresentationPath, scopeMatches };
