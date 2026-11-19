import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/recut.css';
import * as api from '../services/recut.js';
import { createScript as createAvatarScript, generateVersion, listAssets } from '../services/shortScript.js';
import {
  MAX_BATCH, SHORT_GROUPS, batchRoom, consentNeeds, needsAnyConsent, recallLastScript, recutErrorText, rememberLastScript, sortManageItems, toManageItem,
} from '../services/recutFlow.js';
import {
  OPEN_SCRIPT_EVENT, consumePendingScriptOpen, isScriptTargetForPage, pickInitialCourseId, recallShortScriptCourse, rememberShortScriptCourse,
} from '../utils/scriptDeepLink.js';
import useCompactLayout from '../hooks/useCompactLayout';
import RecutWorkspace from './RecutWorkspace';
import AvatarWorkspace from './AvatarWorkspace';
import { RecutConsentGate } from './RecutConsent';
import useRecutConsent from '../hooks/useRecutConsent';
import { FoldGroup, PrimaryAction, StatusDot } from './recutUi';

export const SHORT_STUDIO_PAGE = 'shortStudio';
const NEW_SHORT = '__new__';
const MANAGE_PAGE = 'shortManage';
// 選題先列提問人數最多的幾題，其餘收進「更多題目」。
const TOP_TOPICS = 8;

// 短影片製作：左欄這門課的短片（依等你處理／處理中／已上架分組摺疊），右邊是這一支的工作區。
// recut 與數位分身都在這裡做，選題時一起選產片方式（UX-24）；版面與摺疊規則見 UX-25。
export default function TeacherShortStudio({ onNav }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [scripts, setScripts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [mode, setMode] = useState('recut');
  const [consentStep, setConsentStep] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [returnId, setReturnId] = useState('');
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [batchErrors, setBatchErrors] = useState([]);
  const [target, setTarget] = useState(() => consumePendingScriptOpen(SHORT_STUDIO_PAGE) || recallLastScript());
  const { terms, consent, setConsent, error: consentError, loading: consentLoading } = useRecutConsent(courseId);
  const compact = useCompactLayout();
  // 1100px 以下左欄改成上方下拉選單，工作區用滿寬度。
  const narrow = useCompactLayout('(max-width: 1100px)');

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
      if (target?.intent === 'new') { setPicking(true); setReturnId(''); setTarget(null); return; }
      const wanted = target && list.find((s) => String(s._id) === String(target.scriptId));
      const firstMine = sortManageItems(list.map((s) => toManageItem(s, null, courseAssets))).find((item) => item.bucket === 'mine');
      const pickId = wanted ? String(wanted._id) : firstMine?.scriptId || (list[0] ? String(list[0]._id) : '');
      if (pickId) setSelectedId(pickId);
      else setPicking(true);
      setTarget(null);
    }).catch((err) => alive && setError(recutErrorText(err)));
    return () => { alive = false; };
    // target 只在換課程或深連結時讀一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, loadScripts]);

  // 深連結指向同一門課的另一支時，直接切過去。
  useEffect(() => {
    if (!target) return;
    // 「製作新短片」：同一門課（或沒指定課）時直接進選題。
    if (target.intent === 'new' && courseId && (!target.courseId || String(target.courseId) === String(courseId))) {
      setReturnId(''); setPicking(true); setSelectedId(''); setChosen([]); setBatchErrors([]); setCandidates(null); setConsentStep(false); setTarget(null);
      return;
    }
    if (!scripts.length || String(target.courseId) !== String(courseId)) return;
    const wanted = scripts.find((s) => String(s._id) === String(target.scriptId));
    if (wanted) { setSelectedId(String(wanted._id)); setPicking(false); setTarget(null); }
  }, [target, scripts, courseId]);

  useEffect(() => {
    if (selectedId) rememberLastScript({ courseId, scriptId: selectedId });
  }, [courseId, selectedId]);

  // 和管理頁同一套分組與排序：等你處理在前，越接近完成的越前面。
  const rows = useMemo(() => sortManageItems(scripts.map((script) => toManageItem(script, null, assets))), [scripts, assets]);
  const groups = SHORT_GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => row.bucket === group.bucket) }));
  const selected = scripts.find((s) => String(s._id) === selectedId) || null;
  const nextMine = rows.find((row) => row.scriptId !== selectedId && row.bucket === 'mine');
  const reload = useCallback(() => loadScripts(courseId), [loadScripts, courseId]);

  const onStateChange = useCallback((id, recut) => {
    setScripts((prev) => prev.map((s) => (String(s._id) === id ? { ...s, recut } : s)));
  }, []);

  const rootRef = useRef(null);
  // 固定跳到這一步的主要按鈕（停用時也在 Tab 順序裡，會念出原因）；這一步沒有主要按鈕時，跳到第一個可按的動作，再不然回到標題。
  const focusActions = () => {
    const root = rootRef.current;
    const primary = root?.querySelector('[data-rc-actions] [data-rc-primary], .rc-dock [data-rc-primary]');
    const fallback = [...(root?.querySelectorAll('[data-rc-actions] button') || [])].find((button) => !button.disabled);
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
    if (!picking) setReturnId(selectedId);
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

  const needsConsent = Boolean(consent) && needsAnyConsent(consentNeeds(consent, mode));

  // 一批最多 5 支：依序建立並開始產生，個別失敗不擋其他主題。
  // 同意剛記錄完成時（skipConsent）直接接著開始，不讓老師回到選題再按一次。
  const startBatch = async ({ skipConsent = false } = {}) => {
    if (!skipConsent && needsConsent && terms) { setConsentStep(true); return; }
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

  // 這門課已經做過（或正在做）的題目不再出現在候選裡，避免選到後才收到「已存在」。
  const madeTopicKeys = new Set(scripts.map((script) => script.topicKey).filter(Boolean));
  const shownCandidates = candidates === null ? null : candidates.filter((candidate) => !madeTopicKeys.has(candidate.topicKey))
    .sort((a, b) => (b.uniqueAskerCount || 0) - (a.uniqueAskerCount || 0));
  const cancelPicker = () => {
    const back = rows.find((row) => row.scriptId === returnId) || rows[0];
    setPicking(false);
    setSelectedId(back ? back.scriptId : '');
  };

  const featureOff = /未開放/.test(error);

  const pickerActions = (
    <div className={compact ? 'rc-dock' : 'rc-head-actions'} data-rc-actions>
      <div className="rc-actions">
      <PrimaryAction label={chosen.length ? `開始製作 ${chosen.length} 支` : '開始製作'} onClick={() => startBatch()} busy={starting}
        disabled={!chosen.length} reason={shownCandidates?.length === 0 ? '' : room ? `勾選要做的問題，最多 ${room} 支` : '已有 5 支在產生講稿，完成後再開始'} />
      {scripts.length > 0 && (
        <button type="button" className="rc-btn rc-btn-outline rc-btn-block rc-mt-s" disabled={starting}
          onClick={cancelPicker}>取消</button>
      )}
      {batchErrors.map((failure) => (
        <p key={failure.topicKey} className="rc-error rc-mt-s" role="alert">{failure.question}：{failure.message}</p>
      ))}
      </div>
    </div>
  );

  // 電腦版：選完題目就在清單底下開始，不固定、不擠在標題旁。左邊是已選數量，右邊取消與開始製作。
  const pickerFoot = (
    <div className="rc-picker-foot" data-rc-actions>
      <p className="rc-picker-count" aria-live="polite">
        {room ? <>已選 <strong>{chosen.length}</strong>／{room} 支</> : '已有 5 支在產生講稿，完成後再開始'}
      </p>
      {scripts.length > 0 && (
        <button type="button" className="rc-btn rc-btn-outline" disabled={starting} onClick={cancelPicker}>取消</button>
      )}
      <PrimaryAction label={chosen.length ? `開始製作 ${chosen.length} 支` : '開始製作'} onClick={() => startBatch()} busy={starting} disabled={!chosen.length} />
      {batchErrors.map((failure) => (
        <p key={failure.topicKey} className="rc-error rc-picker-error" role="alert">{failure.question}：{failure.message}</p>
      ))}
    </div>
  );

  const topicItem = (candidate) => {
    const checked = chosen.includes(candidate.topicKey);
    const full = !checked && chosen.length >= room;
    return (
      <li key={candidate.topicKey}>
        <label className="rc-check" data-full={full || undefined}>
          <input type="checkbox" checked={checked} disabled={full || starting} onChange={() => toggleTopic(candidate.topicKey)} />
          <span className="rc-check-body rc-topic-body">
            <strong>{candidate.question}</strong>
            <span className="rc-topic-count">{candidate.uniqueAskerCount} 人</span>
          </span>
        </label>
      </li>
    );
  };

  let body;
  if (!courses.length && !error) body = <div className="rc-col rc-main"><p className="rc-reason">載入中…</p></div>;
  else if (featureOff || (!courseId && error)) body = <div className="rc-col rc-main"><section className="rc-panel"><p>{error}</p></section></div>;
  else if (!courses.length) body = <div className="rc-col rc-main"><section className="rc-panel"><p>還沒有課程。</p></section></div>;
  else if (consentLoading) body = <div className="rc-col rc-main"><p className="rc-reason">載入中…</p></div>;
  else if (consentError && !consent) body = <div className="rc-col rc-main"><section className="rc-panel"><p className="rc-error">{consentError}</p></section></div>;
  else if (picking && consentStep && terms) {
    body = <RecutConsentGate key={`${courseId}-${mode}`} courseId={courseId} mode={mode} consent={consent} terms={terms}
      onRecorded={(latest) => { setConsent(latest); setConsentStep(false); startBatch({ skipConsent: true }); }} />;
  } else if (picking) {
    body = (
      <>
        <div className="rc-col rc-main">
          <section className="rc-panel rc-picker-head" aria-labelledby="rc-topics-title">
            <h1 id="rc-topics-title" tabIndex={-1} className="rc-question">學生最常問的問題</h1>
            <fieldset className="rc-pills rc-fieldset rc-mode-set" disabled={starting}>
              <legend className="rc-visually-hidden">產片方式</legend>
              {[['recut', '原片剪輯', '用你的課堂原音剪成'], ['avatar', '數位分身', '系統寫腳本，你在自己電腦製作']].map(([value, label, detail]) => (
                <label key={value} className="rc-pill rc-mode">
                  <input type="radio" name="rc-mode" checked={mode === value} onChange={() => changeMode(value)} />
                  <span><strong>{label}</strong><span>{detail}</span></span>
                </label>
              ))}
            </fieldset>
          </section>
          <section className="rc-panel" aria-label="題目">
            {shownCandidates === null && <p className="rc-reason">載入中…</p>}
            {shownCandidates?.length === 0 && <p>這門課目前還沒有足夠的學生提問。學生在網頁或 LINE 提問後，題目會出現在這裡。</p>}
            {shownCandidates?.length > 0 && (
              <>
                <ul className="rc-topics">{shownCandidates.slice(0, TOP_TOPICS).map(topicItem)}</ul>
                {shownCandidates.length > TOP_TOPICS && (
                  <FoldGroup title="更多題目" count={shownCandidates.length - TOP_TOPICS} className="rc-fold-more"
                    forceOpen={shownCandidates.slice(TOP_TOPICS).some((candidate) => chosen.includes(candidate.topicKey))}>
                    <ul className="rc-topics">{shownCandidates.slice(TOP_TOPICS).map(topicItem)}</ul>
                  </FoldGroup>
                )}
                {!compact && pickerFoot}
              </>
            )}
          </section>
          {compact && pickerActions}
        </div>
      </>
    );
  } else if (selected) {
    // 這門課還有等你處理的就接下一支；都處理完了改成回管理頁看其他課程。
    const onNext = nextMine ? () => openShort(nextMine.scriptId) : onNav ? () => onNav(MANAGE_PAGE) : undefined;
    const nextLabel = nextMine ? `下一支：${nextMine.question}` : '回短影片管理';
    body = selected.productionMode === 'recut'
      ? <RecutWorkspace key={selectedId} script={selected} onStateChange={onStateChange} onChanged={reload} onNext={onNext} nextLabel={nextLabel} />
      : <AvatarWorkspace key={selectedId} script={selected} assets={assets} onChanged={reload} onNext={onNext} nextLabel={nextLabel} />;
  } else body = <div className="rc-col rc-main" />;

  return (
    <div ref={rootRef} className="rc rc-studio">
      <nav className="rc-col" aria-label="這門課的短片">
        {/* 鍵盤捷徑：只在 Tab 到時出現，直接跳到這一步的主要按鈕，不必經過整份清單與講稿。 */}
        {(selected || picking) && !featureOff && (
          <button type="button" className="rc-skip" onClick={focusActions}>跳到主要動作</button>
        )}
        <div className="rc-nav">
          <div className={narrow ? 'rc-nav-row' : undefined}>
            <label>
              <span className="rc-field-label">課程</span>
              <select className="rc-select" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
              </select>
            </label>
            {narrow && !featureOff && (
              <label>
                <span className="rc-field-label">短片</span>
                <select className="rc-select" value={picking ? NEW_SHORT : selectedId} disabled={!courseId}
                  onChange={(event) => (event.target.value === NEW_SHORT ? openPicker() : openShort(event.target.value))}>
                  {!picking && !selectedId && <option value="">選擇短片</option>}
                  <option value={NEW_SHORT}>＋ 新增短片</option>
                  {groups.filter((group) => group.rows.length).map((group) => (
                    <optgroup key={group.bucket} label={`${group.title}（${group.rows.length}）`}>
                      {group.rows.map((row) => <option key={row.scriptId} value={row.scriptId}>{`${row.question}・${row.status}`}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
          </div>
          {!narrow && !featureOff && (
            <button type="button" className="rc-btn rc-btn-outline rc-btn-block rc-mt-m"
              aria-pressed={picking} onClick={openPicker} disabled={!courseId}>＋ 新增短片</button>
          )}
          {!narrow && groups.map((group) => (
            <FoldGroup key={group.bucket} id={`studio-${group.bucket}`} title={group.title} count={group.rows.length} tone={group.bucket}>
              <ul className="rc-list rc-list-flush">
                {group.rows.map((row) => (
                  <li key={row.scriptId}>
                    <button type="button" className="rc-list-item" aria-current={row.scriptId === selectedId && !picking ? 'true' : undefined}
                      onClick={() => openShort(row.scriptId)}>
                      <StatusDot tone={row.tone} label={row.label} />
                      <span className="rc-list-title">{row.question}</span>
                      <span className="rc-list-status" data-tone={row.bucket}>{row.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </FoldGroup>
          ))}
        </div>
      </nav>
      {body}
    </div>
  );
}
