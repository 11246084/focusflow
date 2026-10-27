// Shared only by the explicit loopback integration suite and its child processes.
process.env.NODE_ENV = 'test';
for (const key of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET', 'YOUTUBE_OAUTH_REFRESH_TOKEN', 'YOUTUBE_UPLOAD_ACCESS_TOKEN']) process.env[key] = '';
require('dotenv').config = () => ({ parsed: {} });
global.fetch = async () => { throw new Error('External network prohibited in review regressions'); };
const env = require('../../src/config/env');
const upload = require('../../src/services/youtubeUpload.service');
const quarantine = require('../../src/services/youtubeQuarantine.service');
Object.assign(env, { youtubeUploadEnabled: true, youtubeClientId: 'fake', youtubeClientSecret: 'fake', youtubeRefreshToken: 'fake',
  youtubeUploadMaxAttempts: 3, youtubeUploadRetryBaseMs: 0, youtubeUploadRecoveryEnabled: true, youtubeUploadStuckAfterMs: 1000,
  youtubeUploadCleanupEnabled: true, youtubeUploadCleanupMinAgeDays: 14, youtubeUploadCleanupMaxAgeDays: 0,
  youtubeUploadCleanupMinFreeGb: 1, shortScriptAutomationEnabled: true });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const response = (payload, headers = {}) => ({ ok: true, status: 200, headers: { get: (key) => headers[key] }, json: async () => payload });
function fakeYouTube({ waitVerify, waitPut, counters = {}, id = 'reviewYt001' } = {}) {
  return async (url, options = {}) => {
    if (url === upload.YOUTUBE_TOKEN_URL) return response({ access_token: 'fake', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
    if (String(url).startsWith(quarantine.YOUTUBE_CHANNELS_URL)) return response({ items: [{ id: 'own-channel' }] });
    if (String(url).startsWith(quarantine.YOUTUBE_VIDEOS_URL)) { await waitVerify?.(); return response({ items: [{ snippet: { channelId: 'own-channel' }, status: { privacyStatus: 'unlisted' } }] }); }
    if (url === upload.YOUTUBE_UPLOAD_URL) { counters.sessions = (counters.sessions || 0) + 1; return response({}, { location: 'https://review.invalid/session' }); }
    if (url === 'https://review.invalid/session') { counters.puts = (counters.puts || 0) + 1; for await (const chunk of options.body) { void chunk; } await waitPut?.(); return response({ id }); }
    throw new Error('Unexpected mock URL');
  };
}
module.exports = { env, deferred, fakeYouTube };
