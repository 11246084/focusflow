const AuthSession = require('../models/authSession.model');
const AppError = require('../utils/appError');
const { verifyToken, unavailable } = require('./authTokens.service');

async function revokeCurrent(credential) {
  let payload;
  try {
    payload = verifyToken(credential.token, { ignoreExpiration: true });
    if (payload.typ !== 'session' || !/^[a-f0-9]{32}$/.test(payload.sid)
      || !Number.isInteger(payload.ver) || typeof payload.sub !== 'string') throw new Error();
  } catch {
    if (credential.transport === 'bearer') throw new AppError('Invalid token.', 401, 'INVALID_TOKEN');
    return;
  }
  try { await AuthSession.deleteMany({ _id: payload.sid, userId: payload.sub }); }
  catch { throw unavailable(); }
}
module.exports = { revokeCurrent };
