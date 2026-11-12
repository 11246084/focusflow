import { useCallback, useEffect, useMemo, useState } from 'react';
import '../styles/recut.css';
import * as api from '../services/recut.js';
import {
  MAX_BATCH, consentNeeds, describeScript, isRecutScript, recallLastScript, recutErrorText, rememberLastScript, scriptQuestion,
} from '../services/recutFlow.js';
import {
  OPEN_SCRIPT_EVENT, consumePendingScriptOpen, isScriptTargetForPage, pickInitialCourseId, recallShortScriptCourse, rememberShortScriptCourse,
} from '../utils/scriptDeepLink.js';
import useCompactLayout from '../hooks/useCompactLayout';
import RecutWorkspace from './RecutWorkspace';
import { RecutConsentGate } from './RecutConsent';
import useRecutConsent from '../hooks/useRecutConsent';
import { PrimaryAction, StateChip } from './recutUi';

export const SHORT_STUDIO_PAGE = 'shortStudio';
const BUCKET_ORDER = { mine: 0, waiting: 1, done: 2 };

// 短影片製作：左欄這門課的短片與批次進度，中欄講稿，右欄時長與主要按鈕。
export default function TeacherShortStudio({ onNav }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [scripts, setScripts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [batchErrors, setBatchErrors] = useState([]);
  const [target, setTarget] = useState(() => consumePendingScriptOpen(SHORT_STUDIO_PAGE) || recallLastScript());
  const { terms, consent, setConsent, error: consentError, loading: consentLoading } = useRecutConsent(courseId);
  const compact = useCompactLayout();

  useEffect(() => {
    let alive = true;
    api.listCourses().then((list) => {
      if (!alive) return;
      setCourses(list);
      setCourseId(pickInitialCourseId(list, { requestedId: target?.courseId, rememberedId: recallShortScriptCourse() }));
    }).catch((err) => alive && setError(recutErrorText(err)));
    return () => { alive = false; };
    // 只在第一次載入時決定課程。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOpen = (event) => {
      if (!isScriptTargetForPage(event.detail, SHORT_STUDIO_PAGE)) return;
      consumePendingScriptOpen(SHORT_STUDIO_PAGE);
      setTarget(event.detail);
      if (event.detail.courseId) setCourseId(event.detail.courseId);
    };
    window.addEventListener(OPEN_SCRIPT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SCRIPT_EVENT, onOpen);
  }, []);

  const loadScripts = useCallback(async (id) => {
    const list = (await api.listScripts(id)).filter(isRecutScript);
    setScripts(list);
    return list;
  }, []);

  useEffect(() => {
    if (!courseId) return undefined;
    let alive = true;
    rememberShortScriptCourse(courseId);
    setScripts([]);
    setSelectedId('');
    setPicking(false);
    setCandidates(null);
    setChosen([]);
    loadScripts(courseId).then((list) => {
      if (!alive) return;
      const wanted = target && list.find((s) => String(s._id) === String(target.scriptId));
      const firstMine = list.find((s) => describeScript(s).bucket === 'mine');
      const pick = wanted || firstMine || list[0];
      if (pick) setSelectedId(String(pick._id));
      else setPicking(true);
      setTarget(null);
    }).catch((err) => alive && setError(recutErrorText(err)));
    return () => { alive = false; };
    // target 只在換課程或深連結時讀一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, loadScripts]);

  // 深連結指向同一門課的另一支時，直接切過去。
  useEffect(() => {
    if (!target || !scripts.length || String(target.courseId) !== String(courseId)) return;
    const wanted = scripts.find((s) => String(s._id) === String(target.scriptId));
    if (wanted) { setSelectedId(String(wanted._id)); setPicking(false); setTarget(null); }
  }, [target, scripts, courseId]);

  useEffect(() => {
    if (selectedId) rememberLastScript({ courseId, scriptId: selectedId });
  }, [courseId, selectedId]);

  const sorted = useMemo(() => [...scripts].sort((a, b) => BUCKET_ORDER[describeScript(a).bucket] - BUCKET_ORDER[describeScript(b).bucket]), [scripts]);
  const selected = scripts.find((s) => String(s._id) === selectedId) || null;
  const nextMine = sorted.find((s) => String(s._id) !== selectedId && describeScript(s).bucket === 'mine');

  const onStateChange = useCallback((id, recut) => {
    setScripts((prev) => prev.map((s) => (String(s._id) === id ? { ...s, recut } : s)));
  }, []);

  const openPicker = () => {
    setPicking(true);
    setSelectedId('');
    setChosen([]);
    setBatchErrors([]);
    setCandidates(null);
  };
  useEffect(() => {
    if (picking && candidates === null && courseId) {
      let alive = true;
      api.listCandidates(courseId).then((list) => alive && setCandidates(list)).catch((err) => { if (alive) { setCandidates([]); setError(recutErrorText(err)); } });
      return () => { alive = false; };
    }
    return undefined;
  }, [picking, candidates, courseId]);

  const toggleTopic = (topicKey) => setChosen((prev) => (prev.includes(topicKey)
    ? prev.filter((key) => key !== topicKey)
    : prev.length >= MAX_BATCH ? prev : [...prev, topicKey]));

  // 一批最多 5 支：依序建立並開始產生，個別失敗不擋其他主題。
  const startBatch = async () => {
    setStarting(true);
    setError('');
    const failures = [];
    let firstId = '';
    for (const topicKey of chosen) {
      const candidate = candidates.find((c) => c.topicKey === topicKey);
      try {
        const script = await api.createRecutScript(courseId, topicKey);
        await api.startGeneration(script._id);
        if (!firstId) firstId = String(script._id);
      } catch (err) {
        failures.push({ topicKey, question: candidate?.question || topicKey, message: recutErrorText(err) });
      }
    }
    setStarting(false);
    setBatchErrors(failures);
    await loadScripts(courseId).catch(() => {});
    if (firstId) { setSelectedId(firstId); setPicking(false); setChosen([]); setCandidates(null); }
  };

  const needs = consentNeeds(consent);
  const needsConsent = Boolean(consent) && (needs.content || needs.voice);
  const featureOff = /未開放/.test(error);

  const pickerActions = (
    <div className={compact ? 'rc-dock' : 'rc-panel'}>
      <PrimaryAction label={chosen.length ? `開始製作 ${chosen.length} 支` : '開始製作'} onClick={startBatch} busy={starting}
        disabled={!chosen.length} reason={`勾選要做的問題，一次最多 ${MAX_BATCH} 支`} />
      {scripts.length > 0 && (
        <button type="button" className="rc-btn rc-btn-outline rc-btn-block" style={{ marginTop: 8 }} disabled={starting}
          onClick={() => { setPicking(false); setSelectedId(String(sorted[0]._id)); }}>返回</button>
      )}
      {batchErrors.map((failure) => (
        <p key={failure.topicKey} className="rc-error" role="alert" style={{ marginTop: 8 }}>{failure.question}：{failure.message}</p>
      ))}
    </div>
  );

  let body;
  if (!courses.length && !error) body = <div className="rc-col rc-main"><p className="rc-reason">載入中…</p></div>;
  else if (featureOff || (!courseId && error)) body = <div className="rc-col rc-main"><section className="rc-panel"><p>{error}</p></section></div>;
  else if (!courses.length) body = <div className="rc-col rc-main"><section className="rc-panel"><p>還沒有課程。</p></section></div>;
  else if (consentLoading) body = <div className="rc-col rc-main"><p className="rc-reason">載入中…</p></div>;
  else if (consentError && !consent) body = <div className="rc-col rc-main"><section className="rc-panel"><p className="rc-error">{consentError}</p></section></div>;
  else if (needsConsent && terms && (picking || !selected)) {
    body = <RecutConsentGate key={courseId} courseId={courseId} consent={consent} terms={terms} onRecorded={setConsent} />;
  } else if (picking) {
    body = (
      <>
        <div className="rc-col rc-main">
          <section className="rc-panel" aria-labelledby="rc-topics-title">
            <h1 id="rc-topics-title" className="rc-question" style={{ marginBottom: 12 }}>學生最常問的問題</h1>
            {candidates === null && <p className="rc-reason">載入中…</p>}
            {candidates?.length === 0 && <p>這門課目前沒有足夠的學生提問。</p>}
            {candidates?.length > 0 && (
              <ul className="rc-topics">
                {candidates.map((candidate) => {
                  const checked = chosen.includes(candidate.topicKey);
                  const full = !checked && chosen.length >= MAX_BATCH;
                  return (
                    <li key={candidate.topicKey}>
                      <label className="rc-check" style={full ? { opacity: 0.55 } : undefined}>
                        <input type="checkbox" checked={checked} disabled={full || starting} onChange={() => toggleTopic(candidate.topicKey)} />
                        <span className="rc-check-body">
                          <strong>{candidate.question}</strong>
                          <span>{candidate.uniqueAskerCount} 人問過</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {compact && pickerActions}
        </div>
        <aside className="rc-col rc-side">{!compact && pickerActions}</aside>
      </>
    );
  } else if (selected) {
    body = (
      <RecutWorkspace key={selectedId} script={selected} onStateChange={onStateChange}
        onNext={nextMine ? () => setSelectedId(String(nextMine._id)) : undefined} />
    );
  } else body = <div className="rc-col rc-main" />;

  return (
    <div className="rc rc-studio">
      <nav className="rc-col" aria-label="這門課的短片">
        <div className="rc-panel">
          <label>
            <span className="rc-field-label">課程</span>
            <select className="rc-select" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
              {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
            </select>
          </label>
          {compact ? (sorted.length > 0 && (
            <label style={{ display: 'block', marginTop: 12 }}>
              <span className="rc-field-label">短片</span>
              <select className="rc-select" value={picking ? '' : selectedId} onChange={(event) => { if (event.target.value) { setPicking(false); setSelectedId(event.target.value); } }}>
                {picking && <option value="">新增短片</option>}
                {sorted.map((script) => <option key={script._id} value={String(script._id)}>{`${describeScript(script).label}・${scriptQuestion(script)}`}</option>)}
              </select>
            </label>
          )) : (
            <ul className="rc-list">
              {sorted.map((script) => {
                const info = describeScript(script);
                const id = String(script._id);
                return (
                  <li key={id}>
                    <button type="button" className="rc-list-item" aria-current={id === selectedId && !picking ? 'true' : undefined}
                      onClick={() => { setPicking(false); setSelectedId(id); }}>
                      <span className="rc-list-title">{scriptQuestion(script)}</span>
                      <StateChip tone={info.state === 'render_failed' || info.label === '產生失敗' ? 'error' : info.bucket}>{info.label}</StateChip>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" className="rc-btn rc-btn-outline rc-btn-block" style={{ marginTop: 12 }}
            aria-pressed={picking} onClick={openPicker} disabled={!courseId}>新增短片</button>
          <button type="button" className="rc-btn-text" style={{ marginTop: 8 }} onClick={() => onNav?.('shortScripts')}>數位分身短片</button>
        </div>
      </nav>
      {body}
    </div>
  );
}
