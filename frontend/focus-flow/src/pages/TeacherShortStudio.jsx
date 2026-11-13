import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/recut.css';
import * as api from '../services/recut.js';
import { createScript as createAvatarScript, generateVersion, listAssets } from '../services/shortScript.js';
import {
  MAX_BATCH, batchRoom, chipTone, consentNeeds, describeShort, recallLastScript, recutErrorText, rememberLastScript, scriptQuestion,
} from '../services/recutFlow.js';
import {
  OPEN_SCRIPT_EVENT, consumePendingScriptOpen, isScriptTargetForPage, pickInitialCourseId, recallShortScriptCourse, rememberShortScriptCourse,
} from '../utils/scriptDeepLink.js';
import useCompactLayout from '../hooks/useCompactLayout';
import RecutWorkspace from './RecutWorkspace';
import AvatarWorkspace from './AvatarWorkspace';
import { RecutConsentGate } from './RecutConsent';
import useRecutConsent from '../hooks/useRecutConsent';
import { PrimaryAction, StateChip } from './recutUi';

export const SHORT_STUDIO_PAGE = 'shortStudio';
const BUCKET_ORDER = { mine: 0, waiting: 1, done: 2, closed: 3 };
const NEW_SHORT = '__new__';

// 短影片製作：左欄這門課的短片與批次進度，中欄講稿，右欄時長與主要按鈕。
// recut 與數位分身都在這裡做，選題時一起選產片方式（UX-24）。
export default function TeacherShortStudio({ onNav }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [scripts, setScripts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [mode, setMode] = useState('recut');
  const [consentStep, setConsentStep] = useState(false);
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
    const [list, courseAssets] = await Promise.all([api.listScripts(id), listAssets(id).catch(() => [])]);
    setScripts(list);
    setAssets(courseAssets);
    return { list, courseAssets };
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
    loadScripts(courseId).then(({ list, courseAssets }) => {
      if (!alive) return;
      const wanted = target && list.find((s) => String(s._id) === String(target.scriptId));
      const firstMine = list.find((s) => describeShort(s, courseAssets).bucket === 'mine');
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

  const sorted = useMemo(() => [...scripts].sort((a, b) => BUCKET_ORDER[describeShort(a, assets).bucket] - BUCKET_ORDER[describeShort(b, assets).bucket]), [scripts, assets]);
  const selected = scripts.find((s) => String(s._id) === selectedId) || null;
  const nextMine = sorted.find((s) => String(s._id) !== selectedId && describeShort(s, assets).bucket === 'mine');
  const reload = useCallback(() => loadScripts(courseId), [loadScripts, courseId]);

  const onStateChange = useCallback((id, recut) => {
    setScripts((prev) => prev.map((s) => (String(s._id) === id ? { ...s, recut } : s)));
  }, []);

  const rootRef = useRef(null);
  // 固定跳到這一步的主要按鈕（停用時也在 Tab 順序裡，會念出原因）；這一步沒有主要按鈕時，跳到第一個可按的動作，再不然回到標題。
  const focusActions = () => {
    const root = rootRef.current;
    const primary = root?.querySelector('[data-rc-actions] [data-rc-primary], .rc-side [data-rc-primary], .rc-dock [data-rc-primary]');
    const fallback = [...(root?.querySelectorAll('[data-rc-actions] button, .rc-side button') || [])].find((button) => !button.disabled);
    const target = primary || fallback || root?.querySelector('h1');
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  };
  // 手機上換一支短片時回到頁首，從問題開始看。
  const openShort = (id) => {
    setPicking(false);
    setSelectedId(id);
    if (compact) rootRef.current?.scrollIntoView({ block: 'start' });
  };
  const openPicker = () => {
    setPicking(true);
    setSelectedId('');
    setChosen([]);
    setBatchErrors([]);
    setCandidates(null);
    setConsentStep(false);
  };
  useEffect(() => {
    if (picking && candidates === null && courseId) {
      let alive = true;
      api.listCandidates(courseId).then((list) => alive && setCandidates(list)).catch((err) => { if (alive) { setCandidates([]); setError(recutErrorText(err)); } });
      return () => { alive = false; };
    }
    return undefined;
  }, [picking, candidates, courseId]);

  // 後端同樣限制同一門課最多 5 支 recut 同時產生講稿；已在產生中的也算進去。
  const room = mode === 'recut' ? batchRoom(scripts) : MAX_BATCH;
  const changeMode = (next) => { setMode(next); setChosen((prev) => prev.slice(0, next === 'recut' ? batchRoom(scripts) : MAX_BATCH)); };
  const toggleTopic = (topicKey) => setChosen((prev) => (prev.includes(topicKey)
    ? prev.filter((key) => key !== topicKey)
    : prev.length >= room ? prev : [...prev, topicKey]));

  const needs = consentNeeds(consent);
  const needsConsent = Boolean(consent) && (needs.content || needs.voice);

  // 一批最多 5 支：依序建立並開始產生，個別失敗不擋其他主題。
  const startBatch = async () => {
    if (mode === 'recut' && needsConsent && terms) { setConsentStep(true); return; }
    setStarting(true);
    setError('');
    const failures = [];
    let firstId = '';
    for (const topicKey of chosen) {
      const candidate = candidates.find((c) => c.topicKey === topicKey);
      try {
        if (mode === 'recut') {
          const script = await api.createRecutScript(courseId, topicKey);
          await api.startGeneration(script._id);
          if (!firstId) firstId = String(script._id);
          continue;
        }
        const script = await createAvatarScript(courseId, topicKey);
        await generateVersion(script._id);
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

  const featureOff = /未開放/.test(error);

  const pickerActions = (
    <div className={compact ? 'rc-dock' : 'rc-panel'} data-rc-actions>
      <PrimaryAction label={chosen.length ? `開始製作 ${chosen.length} 支` : '開始製作'} onClick={startBatch} busy={starting}
        disabled={!chosen.length} reason={candidates?.length === 0 ? '這門課目前沒有可做的問題' : room ? `勾選要做的問題，最多 ${room} 支` : '已有 5 支在產生講稿，完成後再開始'} />
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
  else if (picking && consentStep && terms) {
    body = <RecutConsentGate key={courseId} courseId={courseId} consent={consent} terms={terms}
      onRecorded={(latest) => { setConsent(latest); setConsentStep(false); }} />;
  } else if (picking) {
    body = (
      <>
        <div className="rc-col rc-main">
          <section className="rc-panel" aria-labelledby="rc-topics-title">
            <fieldset className="rc-pills" style={{ border: 0, margin: '0 0 22px', padding: 0 }} disabled={starting}>
              <legend className="rc-visually-hidden">產片方式</legend>
              {[['recut', '原片剪輯', '用你的課堂原音剪成'], ['avatar', '數位分身', '系統寫腳本，你自己製作']].map(([value, label, detail]) => (
                <label key={value} className="rc-pill rc-mode" style={{ flex: 1 }}>
                  <input type="radio" name="rc-mode" checked={mode === value} onChange={() => changeMode(value)} />
                  <span><strong>{label}</strong><span>{detail}</span></span>
                </label>
              ))}
            </fieldset>
            <h1 id="rc-topics-title" tabIndex={-1} className="rc-question" style={{ marginBottom: 12 }}>學生最常問的問題</h1>
            {candidates === null && <p className="rc-reason">載入中…</p>}
            {candidates?.length === 0 && <p>這門課目前沒有足夠的學生提問。</p>}
            {candidates?.length > 0 && (
              <ul className="rc-topics">
                {candidates.map((candidate) => {
                  const checked = chosen.includes(candidate.topicKey);
                  const full = !checked && chosen.length >= room;
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
    const onNext = nextMine ? () => setSelectedId(String(nextMine._id)) : undefined;
    body = selected.productionMode === 'recut'
      ? <RecutWorkspace key={selectedId} script={selected} onStateChange={onStateChange} onNext={onNext} onManage={onNav ? () => onNav('shortManage') : undefined} />
      : <AvatarWorkspace key={selectedId} script={selected} assets={assets} onChanged={reload} onNext={onNext} />;
  } else body = <div className="rc-col rc-main" />;

  return (
    <div ref={rootRef} className="rc rc-studio">
      <nav className="rc-col" aria-label="這門課的短片">
        {/* 鍵盤捷徑：只在 Tab 到時出現，直接跳到這一步的主要按鈕，不必經過整份清單與講稿。 */}
        {(selected || picking) && !featureOff && (
          <button type="button" className="rc-skip" onClick={focusActions}>跳到主要動作</button>
        )}
        <div className="rc-panel">
          <div className={compact ? 'rc-nav-row' : undefined}>
            <label>
              <span className="rc-field-label">課程</span>
              <select className="rc-select" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
              </select>
            </label>
            {compact && !featureOff && (
              <label>
                <span className="rc-field-label">短片</span>
                <select className="rc-select" value={picking ? NEW_SHORT : selectedId} disabled={!courseId}
                  onChange={(event) => (event.target.value === NEW_SHORT ? openPicker() : openShort(event.target.value))}>
                  {!picking && !selectedId && <option value="">選擇短片</option>}
                  {sorted.map((script) => <option key={script._id} value={String(script._id)}>{`${scriptQuestion(script)}（${describeShort(script, assets).label}）`}</option>)}
                  <option value={NEW_SHORT}>＋ 新增短片</option>
                </select>
              </label>
            )}
          </div>
          {!compact && (
            <ul className="rc-list">
              {sorted.map((script) => {
                const info = describeShort(script, assets);
                const id = String(script._id);
                return (
                  <li key={id}>
                    <button type="button" className="rc-list-item" aria-current={id === selectedId && !picking ? 'true' : undefined}
                      onClick={() => openShort(id)}>
                      <span className="rc-list-title">{scriptQuestion(script)}</span>
                      <StateChip tone={chipTone(info)}>{info.label}</StateChip>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!compact && !featureOff && (
            <button type="button" className="rc-btn rc-btn-outline rc-btn-block" style={{ marginTop: 12 }}
              aria-pressed={picking} onClick={openPicker} disabled={!courseId}>新增短片</button>
          )}
        </div>
      </nav>
      {body}
    </div>
  );
}
