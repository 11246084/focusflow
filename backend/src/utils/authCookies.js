const env = require('../config/env');
const AppError = require('./appError');

function cookieOptions() {
  return { httpOnly: true, secure: env.nodeEnv === 'production', sameSite: 'strict', path: '/' };
}
function cookieName(kind) { return `${env.nodeEnv === 'production' ? '__Host-' : ''}ff_${kind}`; }
function readCookie(req, kind) {
  const name = cookieName(kind);
  const values = String(req.headers.cookie || '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return '';
  try { return decodeURIComponent(values[0].slice(name.length + 1)); } catch { return ''; }
}
function assertTrustedOrigin(req) {
  if (!env.csrfTrustedOrigins.includes(req.headers.origin)) {
    throw new AppError('Request origin is not trusted.', 403, 'CSRF_REJECTED');
  }
  req.authOriginTrusted = true;
}
function assertCsrf(req) {
  assertTrustedOrigin(req);
  if (req.headers['x-requested-with'] !== 'FocusFlow') {
    throw new AppError('CSRF header required.', 403, 'CSRF_REJECTED');
  }
}
function assertBrowser(req) {
  if (Object.hasOwn(req.headers, 'authorization')) {
    throw new AppError('Browser session required.', 403, 'BROWSER_SESSION_REQUIRED');
  }
  assertCsrf(req);
}
function cookieMaxAge(exp, now = Date.now()) { return Math.max(0, exp * 1000 - now); }
function setAuthCookie(req, res, kind, value, exp) {
  // Revalidate here: callers cannot accidentally bypass the issuance boundary.
  assertTrustedOrigin(req);
  res.cookie(cookieName(kind), value, { ...cookieOptions(), maxAge: cookieMaxAge(exp) });
}
function clearAuthCookie(res, kind) { res.clearCookie(cookieName(kind), cookieOptions()); }
function clearSessionCookies(res) { ['session', 'stepup'].forEach((kind) => clearAuthCookie(res, kind)); }
module.exports = { cookieName, cookieOptions, readCookie, assertTrustedOrigin, assertCsrf,
  assertBrowser, cookieMaxAge, setAuthCookie, clearAuthCookie, clearSessionCookies };
