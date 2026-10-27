// Cross-page request to open one short script (e.g. from a rejection
// notification, or the script page handing a script to the upload page).
// sessionStorage covers the case where the target page is not mounted yet;
// the window event covers the case where it already is.
//
// page 指定由哪一頁接手：shortScripts（腳本頁，預設）或 shortUploads（成品上傳頁）。
// 每一頁只取走指定給自己的請求，另一頁的請求留在 sessionStorage 等它掛載。

const STORAGE_KEY = 'ff_open_script';
const COURSE_KEY = 'ff_short_script_course';
export const OPEN_SCRIPT_EVENT = 'ff:open-script';
export const SHORT_SCRIPT_PAGE = 'shortScripts';
export const SHORT_UPLOAD_PAGE = 'shortUploads';

export function isScriptTargetForPage(target, page) {
  return Boolean(target?.scriptId) && (target.page || SHORT_SCRIPT_PAGE) === page;
}

export function requestOpenScript({ scriptId, courseId, page = SHORT_SCRIPT_PAGE }) {
  if (!scriptId) return;
  const target = { scriptId: String(scriptId), courseId: courseId ? String(courseId) : '', page };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    // Storage can be blocked; the event below still reaches a mounted page.
  }
  window.dispatchEvent(new CustomEvent(OPEN_SCRIPT_EVENT, { detail: target }));
}

export function consumePendingScriptOpen(page = SHORT_SCRIPT_PAGE) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const target = JSON.parse(raw);
    if (!isScriptTargetForPage(target, page)) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return target;
  } catch {
    return null;
  }
}

// 腳本頁與成品上傳頁共用目前選的課程，切換頁面時不必重選。
export function rememberShortScriptCourse(courseId) {
  if (!courseId) return;
  try {
    sessionStorage.setItem(COURSE_KEY, String(courseId));
  } catch {
    // Storage can be blocked; the page then falls back to the first course.
  }
}

export function recallShortScriptCourse() {
  try {
    return sessionStorage.getItem(COURSE_KEY) || '';
  } catch {
    return '';
  }
}

// 初次載入時要選哪一門課：深連結指定的 > 上次選的 > 第一門。
export function pickInitialCourseId(courses = [], { requestedId = '', rememberedId = '' } = {}) {
  const ids = courses.map((course) => String(course._id));
  if (requestedId && ids.includes(String(requestedId))) return String(requestedId);
  if (rememberedId && ids.includes(String(rememberedId))) return String(rememberedId);
  return ids[0] || '';
}
