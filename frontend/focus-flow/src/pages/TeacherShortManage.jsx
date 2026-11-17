import { useCallback, useEffect, useState } from 'react';
import '../styles/recut.css';
import * as api from '../services/recut.js';
import { listAssets } from '../services/shortScript.js';
import { MANAGE_REFRESH_MS, MODE_TEXT, SHORT_GROUPS, formatAgo, groupIcon, recutErrorText, sortManageItems, toManageItem } from '../services/recutFlow.js';
import { requestNewShort, requestOpenScript } from '../utils/scriptDeepLink.js';
import useVisiblePolling from '../hooks/useVisiblePolling';
import { Ic } from '../components/Icons';
import { RecutConsentManager } from './RecutConsent';
import { SheetDialog } from './recutUi';
import { SHORT_STUDIO_PAGE } from './TeacherShortStudio';

const ALL_COURSES = '';
const EMPTY_TEXT = { mine: '沒有等你處理的短片', waiting: '沒有處理中的短片', done: '還沒有上架的短片', closed: '沒有不做的短片' };

async function fetchManageData() {
  const list = await api.listCourses();
  const perCourse = await Promise.all(list.map(async (course) => {
    const [scripts, assets] = await Promise.all([api.listScripts(course._id), listAssets(course._id).catch(() => [])]);
    return scripts.map((script) => toManageItem(script, course, assets));
  }));
  return { list, rows: sortManageItems(perCourse.flat()) };
}

// 短影片管理：跨所有課程的收件匣。上方一列工具：四種狀態（含數量）、課程篩選、授權、製作新短片；
// 下方是目前狀態的短片，點一下打開那一支、停在要做的那一步。
export default function TeacherShortManage({ onNav }) {
  const [courses, setCourses] = useState([]);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [bucket, setBucket] = useState('mine');
  const [courseFilter, setCourseFilter] = useState(ALL_COURSES);
  const [consentOpen, setConsentOpen] = useState(false);

  const apply = useCallback(({ list, rows }) => {
    setCourses(list);
    setItems(rows);
    setError('');
  }, []);
  const load = useCallback(() => fetchManageData().then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    fetchManageData()
      .then((data) => { if (alive) apply(data); })
      .catch((err) => { if (alive) { setError(recutErrorText(err)); setItems([]); } });
    return () => { alive = false; };
  }, [apply]);

  const hasWaiting = Boolean(items?.some((item) => item.bucket === 'waiting'));
  useVisiblePolling(() => { load().catch(() => {}); }, MANAGE_REFRESH_MS, hasWaiting);

  const open = (item) => {
    requestOpenScript({ scriptId: item.scriptId, courseId: item.courseId, page: SHORT_STUDIO_PAGE });
    onNav?.(SHORT_STUDIO_PAGE);
  };
  const createNew = () => {
    const only = courses.length === 1 ? courses[0]._id : courseFilter;
    requestNewShort({ page: SHORT_STUDIO_PAGE, courseId: only || '' });
    onNav?.(SHORT_STUDIO_PAGE);
  };
  const multiCourse = courses.length > 1;
  // 功能未開放是正常狀態，不是錯誤：只說明一句，不顯示空清單與製作按鈕。
  const featureOff = error === recutErrorText({ status: 404, code: 'NOT_FOUND' });
  const ready = items !== null && !featureOff && courses.length > 0;

  const inCourse = (items || []).filter((item) => !courseFilter || item.courseId === String(courseFilter));
  const rows = inCourse.filter((item) => item.bucket === bucket);

  return (
    <div className="rc rc-manage">
      <div className="rc-main">
        {/* 頁名在頂欄；這裡補一個給螢幕報讀器的頁面標題。 */}
        <h1 className="rc-visually-hidden">短影片管理</h1>
        {ready && (
          <div className="rc-toolbar">
            {/* 主要動作放最前面：左邊底色較深，橘色按鈕不會和右上角的光暈糊在一起。 */}
            <button type="button" className="rc-btn rc-btn-primary rc-manage-new" onClick={createNew}>
              <span aria-hidden="true"><Ic n="plus" s={16} /></span>製作新短片
            </button>
            <div className="rc-tabs" role="tablist" aria-label="短片狀態">
              {SHORT_GROUPS.map((group) => {
                const count = inCourse.filter((item) => item.bucket === group.bucket).length;
                return (
                  <button key={group.bucket} type="button" role="tab" id={`rc-tab-${group.bucket}`} className="rc-tab"
                    aria-selected={bucket === group.bucket} aria-controls="rc-manage-rows" data-tone={group.bucket}
                    onClick={() => setBucket(group.bucket)}>
                    <span className="rc-tab-icon" aria-hidden="true"><Ic n={groupIcon(group.bucket)} s={15} /></span>
                    {group.title}<span className="rc-tab-count">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="rc-toolbar-end">
              {multiCourse && (
                <select className="rc-select rc-select-compact" aria-label="課程" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
                  <option value={ALL_COURSES}>全部課程</option>
                  {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
                </select>
              )}
              <button type="button" className="rc-btn rc-btn-outline" onClick={() => setConsentOpen(true)}>授權</button>
            </div>
          </div>
        )}
        {items === null && <p className="rc-reason">載入中…</p>}
        {error && <p className={featureOff ? 'rc-reason rc-reason-start' : 'rc-error'} role={featureOff ? 'status' : 'alert'}>{error}</p>}
        {ready && (
          <div id="rc-manage-rows" role="tabpanel" aria-labelledby={`rc-tab-${bucket}`} className="rc-inbox">
            {!rows.length && <p className="rc-empty">{EMPTY_TEXT[bucket]}</p>}
            {rows.length > 0 && (
              <ul className="rc-list rc-list-flush">
                {rows.map((item) => (
                  <li key={item.scriptId}>
                    <button type="button" className="rc-inbox-row" onClick={() => open(item)}>
                      <span className="rc-dot" data-tone={item.tone} aria-hidden="true" />
                      <span className="rc-inbox-title">{item.question}</span>
                      <span className="rc-inbox-meta">
                        {[MODE_TEXT[item.mode], multiCourse && !courseFilter ? item.courseTitle : ''].filter(Boolean).join('・')}
                      </span>
                      <span className="rc-inbox-time">{formatAgo(item.updatedAt)}</span>
                      <span className="rc-inbox-status" data-tone={item.bucket}>{item.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {courses.length > 0 && (
        <SheetDialog open={consentOpen} title="授權" onClose={() => setConsentOpen(false)}>
          {consentOpen && <RecutConsentManager courses={courses} titled={false} />}
        </SheetDialog>
      )}
    </div>
  );
}
