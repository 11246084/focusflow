const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const LineLoginState = require('../models/lineLoginState.model');
const AppError = require('../utils/appError');
const {
  bindLineAccount,
  selectCourseForBoundUser,
  sendBindWelcomeMessage,
} = require('./line.service');

const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_FRIENDSHIP_URL = 'https://api.line.me/friendship/v1/status';
const LINE_ID_TOKEN_ISSUER = 'https://access.line.me';

// openid 取得 ID token；查好友狀態的 API 要求 access token 帶 profile scope。
// 姓名、頭貼一律不讀不存，LINE 身分只看 ID token 的 sub。
const LINE_LOGIN_SCOPE = 'openid profile';
const STATE_TTL_MS = 10 * 60 * 1000;
const LINE_REQUEST_TIMEOUT_MS = 10 * 1000;

const FRIENDSHIP = {
  FRIEND: 'friend',
  NOT_FRIEND: 'not_friend',
  UNKNOWN: 'unknown',
};

const BINDING_FAILURES = {
  line_bound_to_other_account: () => new AppError(
    'This LINE account is already linked to another FocusFlow account.',
    409,
    'LINE_ACCOUNT_ALREADY_BOUND',
  ),
  replace_confirmation_required: () => new AppError(
    'Replacing the linked LINE account requires confirmation.',
    409,
    'LINE_REPLACE_CONFIRMATION_REQUIRED',
  ),
  binding_changed: () => new AppError(
    'The LINE binding changed during this request. Please start again.',
    409,
    'LINE_BINDING_CHANGED',
  ),
  user_not_found: () => new AppError('User not found.', 404, 'USER_NOT_FOUND'),
};

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashState(state) {
  return crypto.createHash('sha256').update(state).digest('hex');
}

function assertLineLoginConfigured() {
  if (!env.lineLoginChannelId || !env.lineLoginChannelSecret || !env.lineLoginCallbackUrl) {
    throw new AppError('LINE Login is not configured.', 503, 'LINE_LOGIN_NOT_CONFIGURED');
  }
}

// 只記錄階段與 HTTP 狀態，LINE 的回應內容、授權碼、token 都不進 log。
function logLineFailure(stage, status) {
  if (env.nodeEnv !== 'test') {
    console.warn(`[LINE Login] ${stage} failed.`, status ? `status=${status}` : '');
  }
}

function tokenExchangeError() {
  return new AppError(
    'LINE authorization could not be completed. Please start again.',
    502,
    'LINE_LOGIN_TOKEN_EXCHANGE_FAILED',
  );
}

function idTokenError() {
  return new AppError(
    'LINE identity could not be verified. Please start again.',
    400,
    'LINE_LOGIN_ID_TOKEN_INVALID',
  );
}

// 開始一次連結：產生 state、nonce、PKCE verifier 並綁定目前的使用者與 session。
async function startLineLogin({ userId, sid, courseId = null, replaceExisting = false }) {
  assertLineLoginConfigured();

  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await LineLoginState.deleteMany({ userId });
  await LineLoginState.create({
    _id: hashState(state),
    userId,
    sid,
    nonce,
    codeVerifier,
    ...(courseId ? { courseId } : {}),
    replaceExisting,
    expiresAt,
  });

  const authorizeUrl = new URL(LINE_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.lineLoginChannelId,
    redirect_uri: env.lineLoginCallbackUrl,
    state,
    scope: LINE_LOGIN_SCOPE,
    nonce,
    code_challenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'),
    code_challenge_method: 'S256',
    bot_prompt: 'aggressive',
  }).toString();

  return { authorizeUrl: authorizeUrl.toString(), expiresAt };
}

// state 一進來就以單一操作取出並刪除，兩個請求同時送只有一個拿得到。
// 比對放在刪除之後：屬於別人的 state 被送進來代表連結外流，這個流程要作廢，
// 否則攻擊者騙學生授權後，還能拿回呼網址用自己的 session 完成。
async function consumeLoginState({ state, userId, sid }) {
  const record = await LineLoginState.findOneAndDelete({ _id: hashState(state) });

  if (!record || new Date(record.expiresAt) <= new Date()) {
    throw new AppError('This LINE link request is no longer valid.', 400, 'LINE_LOGIN_STATE_INVALID');
  }

  if (String(record.userId) !== String(userId) || record.sid !== sid) {
    throw new AppError(
      'This LINE link request was started by another login.',
      403,
      'LINE_LOGIN_STATE_MISMATCH',
    );
  }

  return record;
}

async function exchangeCodeForTokens({ code, codeVerifier }) {
  let response;
  try {
    response = await fetch(LINE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.lineLoginCallbackUrl,
        client_id: env.lineLoginChannelId,
        client_secret: env.lineLoginChannelSecret,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(LINE_REQUEST_TIMEOUT_MS),
    });
  } catch {
    logLineFailure('token exchange');
    throw tokenExchangeError();
  }

  if (!response.ok) {
    logLineFailure('token exchange', response.status);
    throw tokenExchangeError();
  }

  const tokens = await response.json().catch(() => null);
  if (!tokens?.id_token || !tokens?.access_token) {
    logLineFailure('token exchange', response.status);
    throw tokenExchangeError();
  }

  return tokens;
}

// 網頁登入的 ID token 固定是 HS256、金鑰是 channel secret；演算法寫死，alg:none 與其他演算法一律拒絕。
function verifyIdToken(idToken, expectedNonce) {
  let payload;
  try {
    payload = jwt.verify(idToken, env.lineLoginChannelSecret, {
      algorithms: ['HS256'],
      audience: env.lineLoginChannelId,
      issuer: LINE_ID_TOKEN_ISSUER,
    });
  } catch {
    logLineFailure('ID token verification');
    throw idTokenError();
  }

  if (payload.nonce !== expectedNonce || typeof payload.sub !== 'string' || !payload.sub) {
    logLineFailure('ID token verification');
    throw idTokenError();
  }

  return payload.sub;
}

// 好友狀態查不到不影響綁定結果，回 unknown 讓畫面分開顯示。
async function readFriendship(accessToken) {
  try {
    const response = await fetch(LINE_FRIENDSHIP_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(LINE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      logLineFailure('friendship check', response.status);
      return FRIENDSHIP.UNKNOWN;
    }
    const payload = await response.json();
    if (typeof payload?.friendFlag !== 'boolean') return FRIENDSHIP.UNKNOWN;
    return payload.friendFlag ? FRIENDSHIP.FRIEND : FRIENDSHIP.NOT_FRIEND;
  } catch {
    logLineFailure('friendship check');
    return FRIENDSHIP.UNKNOWN;
  }
}

// 完成連結。access token 只留在這個函式的區域變數，用完即丟，不寫入資料庫。
async function completeLineLogin({ userId, sid, code, state }) {
  assertLineLoginConfigured();

  const record = await consumeLoginState({ state, userId, sid });
  const tokens = await exchangeCodeForTokens({ code, codeVerifier: record.codeVerifier });
  const lineUserId = verifyIdToken(tokens.id_token, record.nonce);

  const binding = await bindLineAccount({
    userId,
    lineUserId,
    replaceExisting: record.replaceExisting === true,
  });
  if (!binding.ok) {
    throw BINDING_FAILURES[binding.reason]();
  }

  const friendship = await readFriendship(tokens.access_token);
  const welcomeSent = friendship === FRIENDSHIP.FRIEND && !binding.alreadyBound
    ? await sendBindWelcomeMessage(lineUserId)
    : false;
  const course = record.courseId
    ? await selectCourseForBoundUser(userId, record.courseId)
    : null;

  return {
    bound: true,
    alreadyBound: binding.alreadyBound,
    replaced: binding.replaced,
    friendship,
    welcomeSent,
    course,
  };
}

module.exports = {
  startLineLogin,
  completeLineLogin,
};
