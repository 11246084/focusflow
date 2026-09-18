// 基本安全標頭。前端 SPA 的 HTML 由 nginx 直接提供，這裡只涵蓋 backend 回應
// （/api、/docs、/uploads、/health）；HSTS 由 nginx 在 TLS 終端統一加，
// 避免本機 http 開發時瀏覽器記住錯誤的 HSTS。

// JSON API 不需要載入任何子資源，直接鎖死；/docs 的 Swagger UI 需要自己的
// script / style，不套這條 CSP。
const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
  }

  next();
}

module.exports = {
  securityHeaders,
};
