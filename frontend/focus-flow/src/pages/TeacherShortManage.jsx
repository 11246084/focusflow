import { useCallback, useEffect, useState } from 'react';
import '../styles/recut.css';
import * as api from '../services/recut.js';
import { listAssets } from '../services/shortScript.js';
import { MANAGE_REFRESH_MS, formatAgo, recutErrorText, sortManageItems, toManageItem } from '../services/recutFlow.js';
import { requestOpenScript } from '../utils/scriptDeepLink.js';
import { RecutConsentManager } from './RecutConsent';
import { StateChip } from './recutUi';
import { SHORT_STUDIO_PAGE } from './TeacherShortStudio';

const SECTIONS = [
  { bucket: 'mine', title: '等你處理' },
  { bucket: 'waiting', title: '處理中' },
  { bucket: 'done', title: '已上架' },
];

async function fetchManageData() {
  const list = await api.listCourses();
  const perCourse = await Promise.all(list.map(async (course) => {
    const [scripts, assets] = await Promise.all([api.listScripts(course._id), listAssets(course._id).catch(() => [])]);
    return scripts.map((script) => toManageItem(script, course, assets));
  }));
  return { list, rows: sortManageItems(perCourse.flat()) };
}

// 短影片管理：跨所有課程，打開就知道哪些在等你；點一下打開那一支、停在要做的那一步。
export default function TeacherShortManage({ onNav }) {
  const [courses, setCourses] = useState([]);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

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
  useEffect(() => {
    if (!hasWaiting) return undefined;
    const timer = setInterval(() => { load().catch(() => {}); }, MANAGE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasWaiting, load]);

  const open = (item) => {
    requestOpenScript({ scriptId: item.scriptId, courseId: item.courseId, page: SHORT_STUDIO_PAGE });
    onNav?.(SHORT_STUDIO_PAGE);
  };
  const multiCourse = courses.length > 1;
  // 功能未開放是正常狀態，不是錯誤：只說明一句，不顯示空清單與製作按鈕。
  const featureOff = error === recutErrorText({ status: 404, code: 'NOT_FOUND' });

  return (
    <div className="rc rc-manage">
      <div className="rc-main">
        {items === null && <p className="rc-reason">載入中…</p>}
        {error && <section className="rc-panel"><p className={featureOff ? undefined : 'rc-error'} role={featureOff ? 'status' : 'alert'}>{error}</p></section>}
        {items && !featureOff && SECTIONS.map((section) => {
          const rows = items.filter((item) => item.bucket === section.bucket);
          if (section.bucket !== 'mine' && !rows.length) return null;
          return (
            <section key={section.bucket} className="rc-panel" aria-labelledby={`rc-sec-${section.bucket}`}>
              <div className="rc-manage-heading">
                <h2 id={`rc-sec-${section.bucket}`}>{section.title}</h2>
                <span>{rows.length}</span>
              </div>
              {!rows.length && <p className="rc-empty">{items.length ? '目前沒有等你處理的短片。' : '還沒有短片。'}</p>}
              <ul className="rc-list" style={{ marginTop: 0 }}>
                {rows.map((item) => (
                  <li key={item.scriptId}>
                    <button type="button" className="rc-row" onClick={() => open(item)}>
                      <span className="rc-row-title">{item.question}</span>
                      <span className="rc-row-meta">
                        <StateChip tone={item.tone}>{item.label}</StateChip>
                        <span className="rc-row-course">{[multiCourse ? item.courseTitle : '', formatAgo(item.updatedAt)].filter(Boolean).join('・')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {items && !featureOff && (
          <button type="button" className="rc-btn rc-btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => onNav?.(SHORT_STUDIO_PAGE)}>製作新短片</button>
        )}
      </div>
      <aside className="rc-side">
        {courses.length > 0 && <RecutConsentManager courses={courses} />}
      </aside>
    </div>
  );
}
