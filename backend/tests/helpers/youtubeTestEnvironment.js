const CREDENTIAL_KEYS = [
  'youtubeClientId', 'youtubeClientSecret', 'youtubeRefreshToken',
  'youtubeOAuthClientId', 'youtubeOAuthClientSecret', 'youtubeOAuthRefreshToken',
  'youtubeUploadAccessToken',
];

function clearYouTubeCredentials(env) {
  for (const key of CREDENTIAL_KEYS) env[key] = '';
}

function useYouTubeTestEnvironment(env, resetState) {
  const keys = [...CREDENTIAL_KEYS, 'youtubeUploadEnabled', 'youtubeUploadMaxAttempts'];
  const saved = Object.fromEntries(keys.map((key) => [key, env[key]]));
  const fetch = global.fetch;
  clearYouTubeCredentials(env);
  Object.assign(env, {
    youtubeUploadEnabled: true,
    youtubeUploadMaxAttempts: 3,
    youtubeClientId: 'test-client-id',
    youtubeClientSecret: 'test-client-secret',
    youtubeRefreshToken: 'test-refresh-token',
  });
  global.fetch = async () => { throw new Error('Unexpected external fetch in YouTube test.'); };
  resetState();
  return () => {
    global.fetch = fetch;
    Object.assign(env, saved);
    resetState();
  };
}

module.exports = { clearYouTubeCredentials, useYouTubeTestEnvironment };
