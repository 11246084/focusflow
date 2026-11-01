const { createRecutConsentService } = require('../../src/services/recutConsent.service');
const { TERMS_VERSION } = require('../../src/constants/recutConsent');
const copy = (value) => JSON.parse(JSON.stringify(value));
const ids = Object.fromEntries(['teacher', 'otherTeacher', 'course', 'secondCourse', 'otherCourse', 'video', 'otherVideo', 'asset', 'secondAsset', 'foreignAsset', 'admin', 'secondAdmin'].map((name, index) => [name, (index + 1).toString(16).padStart(24, '0')]));
function fixture() {
  const teacher = { id: ids.teacher, role: 'teacher' };
  const admin = { id: ids.admin, role: 'admin' };
  const store = new Map();
  const courses = new Map([
    [ids.course, { _id: ids.course, teacherId: ids.teacher }],
    [ids.secondCourse, { _id: ids.secondCourse, teacherId: ids.teacher }],
    [ids.otherCourse, { _id: ids.otherCourse, teacherId: ids.otherTeacher }],
  ]);
  const videos = new Map([
    [ids.video, { _id: ids.video, courseId: ids.course, videoId: 'lecture-one' }],
    [ids.otherVideo, { _id: ids.otherVideo, courseId: ids.otherCourse, videoId: 'foreign-lecture' }],
  ]);
  const repository = {
    getCourse: async (id) => copy(courses.get(id) || null),
    getVideo: async (id) => copy(videos.get(id) || null),
    getSource: async (sourceId, courseId) => copy([...videos.values()].find((item) => item.videoId === sourceId && item.courseId === courseId) || null),
    read: async (teacherId) => copy(store.get(teacherId) || { teacherId, revision: 0, records: [], withdrawals: [] }),
    async commit(before, mutation) {
      const current = store.get(before.teacherId);
      if ((current?.revision || 0) !== before.revision) return false;
      store.set(before.teacherId, copy({ teacherId: before.teacherId, revision: before.revision + 1,
        records: [...(current?.records || []), ...(mutation.record ? [mutation.record] : [])], withdrawals: mutation.withdrawals }));
      return true;
    },
    listPending: async () => copy([...store.values()].filter((state) => state.withdrawals.some((job) => job.status !== 'completed'))),
    listManualActions: async () => copy([...store.values()].filter((state) => state.withdrawals.some((job) => job.actions.some((action) => action.manualActionRequired)))),
  };
  const calls = [];
  const completed = new Set();
  let privacyFails = false;
  const assets = [{ id: ids.asset, youtubeVideoId: 'fake-yt-one', status: 'published' }, { id: ids.secondAsset, status: 'draft' }];
  const lifecycle = {
    listAssets: async (scope) => { calls.push(['listAssets', scope]); return copy(assets); },
    stopWork: async (scope, context) => { calls.push(['stopWork', scope, context]); },
    archiveAsset: async (id, scope, context) => { calls.push(['archiveAsset', id, context]); },
    makeYouTubePrivate: async (id, scope, context) => {
      calls.push(['makeYouTubePrivate', id, context]);
      if (privacyFails) throw Object.assign(new Error('fake provider failure'), { code: 'YOUTUBE_FAKE_FAILURE' });
    },
    listAdmins: async () => [{ id: ids.admin }, { id: ids.secondAdmin }],
    notifyAdmin: async (id, payload, context) => {
      if (!completed.has(context.operationId)) { calls.push(['notifyAdmin', id, payload, context]); completed.add(context.operationId); }
    },
  };
  const service = createRecutConsentService({ repository, lifecycle });
  const base = { user: teacher, courseId: ids.course, termsVersion: TERMS_VERSION };
  let sequence = 0;
  const grant = (kind = 'content', choice = 'granted', extra = {}) => service.recordConsent({ ...base, kind, choice, requestId: `grant-${++sequence}`, ...extra });
  const withdraw = (extra = {}) => service.withdraw({ ...base, kind: 'voice', requestId: `withdraw-${++sequence}`, ...extra });
  return { ids, teacher, admin, base, repository, store, courses, videos, lifecycle, service, grant, withdraw, calls, assets,
    setPrivacyFails(value) { privacyFails = value; } };
}
module.exports = { fixture, ids };
