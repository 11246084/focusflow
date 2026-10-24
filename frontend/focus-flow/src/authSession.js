import { apiFetch, clearUser, setUser, getUser, getAuthEpoch, assertAuthEpoch,
  acceptAuthUser, advanceAuthEpoch, removeLegacyToken, invalidateAuthSession, subscribeAuthEvents } from './api.js';

export const AUTH_SESSION_STATUS = Object.freeze({ ANONYMOUS: 'anonymous', AUTHENTICATED: 'authenticated',
  INVALID: 'invalid', UNAVAILABLE: 'unavailable', FORBIDDEN: 'forbidden', STALE: 'stale' });
export const isInvalidSessionError = (error) => error?.status === 401;
export async function restoreAuthSession({ apiFetchImpl = apiFetch, clearUserImpl = clearUser,
  setUserImpl = setUser, getEpochImpl = getAuthEpoch, assertEpochImpl = assertAuthEpoch,
  acceptUserImpl = acceptAuthUser } = {}) {
  removeLegacyToken();
  const epoch = getEpochImpl();
  try {
    const response = await apiFetchImpl('/auth/me', { sessionFailure: false });
    assertEpochImpl(epoch);
    const user = response?.data?.user;
    if (!user?.id || !['student', 'teacher', 'admin'].includes(user.role)) return { status: AUTH_SESSION_STATUS.UNAVAILABLE, error: new Error('登入資料不完整，請稍後再試。') };
    const cached = getUser();
    if (cached?.id && (cached.id !== user.id || cached.role !== user.role)) advanceAuthEpoch();
    setUserImpl(user); acceptUserImpl(user);
    return { status: AUTH_SESSION_STATUS.AUTHENTICATED, user };
  } catch (error) {
    if (error?.code === 'STALE_AUTH_RESPONSE') return { status: AUTH_SESSION_STATUS.STALE };
    if (isInvalidSessionError(error)) {
      clearUserImpl();
      return { status: AUTH_SESSION_STATUS.ANONYMOUS, error };
    }
    return { status: AUTH_SESSION_STATUS.UNAVAILABLE, error };
  }
}
export function requireAdminSession(session) {
  if (session.status !== AUTH_SESSION_STATUS.AUTHENTICATED || session.user.role === 'admin') return session;
  return { status: AUTH_SESSION_STATUS.FORBIDDEN, user: session.user };
}
export function observeAuthSession(onEvent, { documentImpl = globalThis.document, now = Date.now } = {}) {
  const unsubscribe = subscribeAuthEvents(onEvent);
  let lastVisibleCheck = now();
  const visible = () => {
    if (documentImpl?.visibilityState !== 'visible' || now() - lastVisibleCheck < 30000) return;
    lastVisibleCheck = now();
    invalidateAuthSession('revalidate');
  };
  documentImpl?.addEventListener('visibilitychange', visible);
  return () => { unsubscribe(); documentImpl?.removeEventListener('visibilitychange', visible); };
}
export function sessionIdentityMatches(epoch, userId) {
  return epoch === getAuthEpoch() && userId === getUser()?.id;
}
