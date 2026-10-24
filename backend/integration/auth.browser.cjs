// Local-only browser fixture. This never loads server.js or connects to MongoDB.
if (process.env.AUTH_BROWSER_FIXTURE !== 'local-only') throw new Error('Explicit local-only fixture opt-in required.');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-auth-browser-'));
// app.js captures this directory when express.static is created.
process.env.UPLOAD_DIR = uploadDirectory;
const { env, store, ids, resetStore } = require('../tests/helpers/backendTestHarness');
const app = require('../src/app');
const mongoose = require('mongoose');
const mailer = require('../src/services/mailer.service');
if (mongoose.connection.readyState !== 0) throw new Error('Fixture must never connect to a database.');
env.uploadDir = uploadDirectory;
env.csrfTrustedOrigins = ['http://localhost:5173', 'https://localhost:5173', 'http://127.0.0.1:5173'];
env.allowedOrigins = env.csrfTrustedOrigins;
env.shortScriptAutomationEnabled = true;
env.shortsSyncIntervalMs = 600000;
const messages = [];
mailer.setTransportForTests({ sendMail: async (message) => { messages.push(message); } });
function reset(production = false, firstLoginRole = null) {
  resetStore(); messages.length = 0; env.nodeEnv = production ? 'production' : 'test';
  for (const user of store.users) {
    user.mustChangePassword = user.role === firstLoginRole;
    user.emailVerifiedAt = user.role === firstLoginRole ? null : new Date();
  }
  // An empty successful sync is enough for the existing smoke script; any
  // unexpected attempt to call YouTube fails inside this fixture.
  void require('../src/services/shortsSync.service').runShortsSync({
    fetchImpl: async () => { throw new Error('External HTTP forbidden in local fixture.'); },
  });
}
reset();
const server = app.listen(4000, '127.0.0.1');
const controls = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/shutdown') {
    res.end('{}'); setImmediate(shutdown); return;
  }
  if (req.method === 'POST' && req.url.startsWith('/reset')) {
    const url = new URL(req.url, 'http://127.0.0.1');
    reset(url.searchParams.get('production') === 'true', url.searchParams.get('firstLoginRole'));
  }
  res.end(JSON.stringify({ production: env.nodeEnv === 'production', ids,
    messages: messages.map((message) => ({ to: message.to, code: message.subject.match(/^\d{6}/)?.[0] })),
    sessionCount: store.authSessions.length, users: store.users.map((user) => ({ id: String(user._id), role: user.role, mustChangePassword: user.mustChangePassword })) }));
}).listen(4001, '127.0.0.1');
function shutdown() {
  server.close(); controls.close();
  if (uploadDirectory.startsWith(os.tmpdir()) && path.basename(uploadDirectory).startsWith('focusflow-auth-browser-')) fs.rmSync(uploadDirectory, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
console.log('Local stub backend: 127.0.0.1:4000; test controls: 127.0.0.1:4001. No MongoDB or real mail.');
