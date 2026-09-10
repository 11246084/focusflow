// Cross-page request to open one short script (e.g. from a rejection
// notification). sessionStorage covers the case where the script page is not
// mounted yet; the window event covers the case where it already is.

const STORAGE_KEY = 'ff_open_script';
export const OPEN_SCRIPT_EVENT = 'ff:open-script';

export function requestOpenScript({ scriptId, courseId }) {
  if (!scriptId) return;
  const target = { scriptId: String(scriptId), courseId: courseId ? String(courseId) : '' };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    // Storage can be blocked; the event below still reaches a mounted page.
  }
  window.dispatchEvent(new CustomEvent(OPEN_SCRIPT_EVENT, { detail: target }));
}

export function consumePendingScriptOpen() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
