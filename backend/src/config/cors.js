const env = require('./env');

function parseAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function createOriginChecker(allowedOrigins) {
  return (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  };
}

function buildCorsOptions({
  allowedOrigins = env.allowedOrigins,
} = {}) {
  if (!allowedOrigins.length) {
    return {};
  }

  return {
    origin: createOriginChecker(allowedOrigins),
    credentials: true,
  };
}

module.exports = {
  buildCorsOptions,
  parseAllowedOrigins,
};
