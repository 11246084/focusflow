import { BACKEND_ORIGIN, getToken } from '../api.js';

const AVATAR_PATH = `${BACKEND_ORIGIN}/api/v1/auth/me/avatar`;
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// This is deliberately based on server-owned metadata instead of a mutable blob URL.
// A new successful upload gets a new updatedAt value and therefore refreshes the image.
export function getAvatarVersion(user) {
  if (!user?.hasAvatar) return null;
  return `${user.id || ''}:${user.avatarUpdatedAt || ''}`;
}

export async function fetchCurrentUserAvatarObjectUrl({
  signal,
  token = getToken(),
  fetchImpl = fetch,
  createObjectUrl = URL.createObjectURL,
} = {}) {
  try {
    const response = await fetchImpl(AVATAR_PATH, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal,
    });
    if (!response.ok) return null;
    const mimeType = String(response.headers?.get?.('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!AVATAR_MIME_TYPES.has(mimeType)) return null;
    return createObjectUrl(await response.blob());
  } catch {
    // An avatar is auxiliary UI. Authentication/session invalidation stays in authSession.
    return null;
  }
}

export function revokeAvatarObjectUrl(url, revokeObjectUrl = URL.revokeObjectURL) {
  if (url) revokeObjectUrl(url);
}

// Owns exactly one committed object URL. Each load generation invalidates older
// completions, so an avatar from a previous user/session cannot win a later load.
export function createAvatarUrlController({
  fetchAvatar = fetchCurrentUserAvatarObjectUrl,
  revokeAvatar = revokeAvatarObjectUrl,
} = {}) {
  let currentUrl = null;
  let generation = 0;

  function release(url = currentUrl) {
    if (!url || currentUrl !== url) return false;
    revokeAvatar(url);
    currentUrl = null;
    return true;
  }

  async function load({ hasAvatar, signal } = {}) {
    const requestId = generation + 1;
    generation = requestId;
    release();
    if (!hasAvatar) return null;

    const nextUrl = await fetchAvatar({ signal });
    if (!nextUrl) return null;
    if (requestId !== generation) {
      revokeAvatar(nextUrl);
      return null;
    }

    currentUrl = nextUrl;
    return nextUrl;
  }

  function cancel() {
    generation += 1;
    release();
  }

  return { load, release, cancel };
}
