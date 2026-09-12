import {
  apiFetch,
  clearToken,
  clearUser,
  getToken,
  setUser,
} from './api.js';

export const AUTH_SESSION_STATUS = Object.freeze({
  ANONYMOUS: 'anonymous',
  AUTHENTICATED: 'authenticated',
  INVALID: 'invalid',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
});

export function isInvalidSessionError(error) {
  return error?.status === 401 || error?.status === 403;
}

export async function restoreAuthSession({
  apiFetchImpl = apiFetch,
  clearTokenImpl = clearToken,
  clearUserImpl = clearUser,
  getTokenImpl = getToken,
  setUserImpl = setUser,
} = {}) {
  if (!getTokenImpl()) {
    return { status: AUTH_SESSION_STATUS.ANONYMOUS };
  }

  try {
    const response = await apiFetchImpl('/auth/me');
    const user = response?.data?.user;

    // A successful response without a public user is a server/contract problem,
    // not evidence that the persisted token is invalid.
    if (!user || typeof user.role !== 'string') {
      return {
        status: AUTH_SESSION_STATUS.UNAVAILABLE,
        error: new Error('Current user response is incomplete.'),
      };
    }

    setUserImpl(user);
    return { status: AUTH_SESSION_STATUS.AUTHENTICATED, user };
  } catch (error) {
    if (isInvalidSessionError(error)) {
      clearTokenImpl();
      clearUserImpl();
      return { status: AUTH_SESSION_STATUS.INVALID, error };
    }

    // Keep the persisted session for retry when the API is temporarily down or
    // the browser is offline. Only the backend can establish token invalidity.
    return { status: AUTH_SESSION_STATUS.UNAVAILABLE, error };
  }
}

export function requireAdminSession(session) {
  if (session.status !== AUTH_SESSION_STATUS.AUTHENTICATED) {
    return session;
  }

  if (session.user.role === 'admin') {
    return session;
  }

  // This is based on the freshly verified backend user, never the cached role.
  // A non-admin account is authenticated but forbidden from this UI; it must
  // retain its valid session for the normal student/teacher entry point.
  return { status: AUTH_SESSION_STATUS.FORBIDDEN, user: session.user };
}
