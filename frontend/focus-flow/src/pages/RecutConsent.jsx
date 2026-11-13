import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../services/recut.js';
import { consentNeeds, newRequestId, recutErrorText } from '../services/recutFlow.js';
import { recallShortScriptCourse } from '../utils/scriptDeepLink.js';
import { ConfirmDialog, PrimaryAction, StateChip } from './recutUi';

// 第一次製作時在流程內同意，依產片方式問不同的項目：
// 原片剪輯＝授課內容（依課程）＋老師原音（教師全域）；數位分身＝授課內容＋肖像＋聲音複製。
// 確認框一律預設不勾；合成語音尚未開放，原片剪輯只提供老師原音。
const GATE_ITEMS = [
  { kind: 'content', choice: 'granted', title: '同意這門課的授課內容用來製作短片', body: (terms) => [terms.content, terms.processing] },
  { kind: 'voice', choice: 'original', title: '短片使用我的授課原音', body: (terms) => [terms.voice] },
  { kind: 'avatarLikeness', choice: 'granted', title: '同意數位分身使用我的肖像', body: (terms) => [terms.avatarLikeness] },
  { kind: 'voiceClone', choice: 'granted', title: '同意數位分身複製我的聲音', body: (terms) => [terms.voiceClone] },
];

export function RecutConsentGate({ courseId, mode = 'recut', consent, terms, onRecorded }) {
  const needs = consentNeeds(consent, mode);
  const items = GATE_ITEMS.filter((item) => needs[item.kind]);
  const [checked, setChecked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 同一次決定重送沿用同一個 requestId，避免重複紀錄。
  const requestIds = useMemo(() => Object.fromEntries(GATE_ITEMS.map((item) => [item.kind, newRequestId()])), []);
  const ready = items.every((item) => checked.has(item.kind));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      let latest = consent;
      for (const item of items) {
        latest = await api.recordConsent(courseId, { kind: item.kind, choice: item.choice, termsVersion: terms.version, requestId: requestIds[item.kind] });
      }
      onRecorded(latest);
    } catch (err) {
      setError(recutErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rc-col rc-main">
        <section className="rc-panel rc-main" aria-labelledby="rc-consent-title">
          <h1 id="rc-consent-title" className="rc-question">{terms.title}</h1>
          <p className="rc-reason rc-reason-start">{terms.notice}</p>
          {items.map((item) => (
            <label key={item.kind} className="rc-check">
              <input type="checkbox" checked={checked.has(item.kind)} onChange={(event) => setChecked((prev) => {
                const next = new Set(prev);
                if (event.target.checked) next.add(item.kind); else next.delete(item.kind);
                return next;
              })} />
              <span className="rc-check-body"><strong>{item.title}</strong>{item.body(terms).filter(Boolean).map((text) => <span key={text}>{text}</span>)}</span>
            </label>
          ))}
          <p className="rc-reason rc-reason-start">{terms.withdrawal}</p>
        </section>
      </div>
      <aside className="rc-col rc-side">
        <div className="rc-panel" data-rc-actions>
          <PrimaryAction label="同意並繼續" onClick={submit} busy={busy} disabled={!ready} reason="勾選上面的同意後才能繼續" />
          {error && <p className="rc-error rc-mt-s" role="alert">{error}</p>}
        </div>
      </aside>
    </>
  );
}

const KIND_TEXT = { content: '授課內容', voice: '老師原音', avatarLikeness: '數位分身肖像', voiceClone: '數位分身聲音複製' };
const ACTION_TEXT = { stopWork: '停止製作中的短片', archiveAsset: '從學生短片牆移除', makeYouTubePrivate: 'YouTube 轉為私人' };

// 管理頁的授權設定：目前同意狀態、撤回（逐支或全選，預設都不選）、未完成的下架工作。
export function RecutConsentManager({ courses }) {
  // 預設顯示老師最近在短影片製作用的那門課，剛同意完回來看得到「已同意」。
  const [courseId, setCourseId] = useState(() => {
    const recent = recallShortScriptCourse();
    return String(courses.find((course) => String(course._id) === String(recent))?._id || courses[0]?._id || '');
  });
  const [terms, setTerms] = useState(null);
  const [consent, setConsent] = useState(null);
  const [error, setError] = useState('');
  const [withdrawKind, setWithdrawKind] = useState(null);
  const [assets, setAssets] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [requestId, setRequestId] = useState('');

  const load = useCallback(async () => {
    if (!courseId) return;
    try {
      const [nextTerms, nextConsent] = await Promise.all([api.getConsentTerms(), api.getConsent(courseId)]);
      setTerms(nextTerms);
      setConsent(nextConsent);
      setError('');
    } catch (err) { setError(recutErrorText(err)); }
  }, [courseId]);
  useEffect(() => { load(); }, [load]);

  const openWithdraw = async (kind) => {
    setError('');
    try {
      const data = await api.listWithdrawalAssets(courseId, kind);
      setAssets(data.assets || []);
      setSelected(new Set());
      setRequestId(newRequestId());
      setWithdrawKind(kind);
    } catch (err) { setError(recutErrorText(err)); }
  };
  const allSelected = assets.length > 0 && selected.size === assets.length;
  const submitWithdraw = async () => {
    setBusy(true);
    try {
      const job = await api.withdrawConsent(courseId, { kind: withdrawKind, termsVersion: terms.version, requestId,
        ...(allSelected ? { selectAll: true } : { selectedAssetIds: [...selected] }) });
      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
      setWithdrawKind(null);
      await load();
    } catch (err) { setError(recutErrorText(err)); setWithdrawKind(null); }
    finally { setBusy(false); }
  };
  const retry = async (job) => {
    setBusy(true);
    try {
      const next = await api.retryWithdrawal(courseId, job.id);
      setJobs((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    } catch (err) { setError(recutErrorText(err)); }
    finally { setBusy(false); }
  };

  const content = consent?.decisions?.content?.choice;
  const voice = consent?.voiceMode;
  return (
    <section className="rc-panel" aria-labelledby="rc-consent-manage">
      <h2 id="rc-consent-manage" className="rc-section-title">授權</h2>
      {courses.length > 1 && (
        <label className="rc-field rc-field-first">
          <span className="rc-field-label">課程</span>
          <select className="rc-select" value={courseId} onChange={(event) => { setCourseId(event.target.value); setJobs([]); }}>
            {courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
          </select>
        </label>
      )}
      <ul className="rc-list rc-list-flush">
        <li className="rc-row rc-row-static">
          <span className="rc-row-title">授課內容</span>
          <span className="rc-inline">
            {content === 'granted' ? <StateChip tone="done">已同意</StateChip> : <StateChip tone="mine">{content === 'withdrawn' ? '已撤回' : '未同意'}</StateChip>}
            {content === 'granted' && <button type="button" className="rc-btn-text" onClick={() => openWithdraw('content')}>撤回</button>}
          </span>
        </li>
        <li className="rc-row rc-row-static">
          <span className="rc-row-title">老師原音<span className="rc-row-course rc-block">所有課程共用</span></span>
          <span className="rc-inline">
            {voice === 'original' ? <StateChip tone="done">使用中</StateChip> : <StateChip tone="mine">未選擇</StateChip>}
            {voice === 'original' && <button type="button" className="rc-btn-text" onClick={() => openWithdraw('voice')}>撤回</button>}
          </span>
        </li>
        {/* 數位分身的兩項同意只在做過決定後才列出，沒用過數位分身的老師不會看到多餘的項目。 */}
        {['avatarLikeness', 'voiceClone'].filter((kind) => consent?.decisions?.[kind]).map((kind) => {
          const choice = consent.decisions[kind].choice;
          return (
            <li key={kind} className="rc-row rc-row-static">
              <span className="rc-row-title">{KIND_TEXT[kind]}</span>
              <span className="rc-inline">
                {choice === 'granted' ? <StateChip tone="done">已同意</StateChip> : <StateChip tone="mine">{choice === 'withdrawn' ? '已撤回' : '未同意'}</StateChip>}
                {choice === 'granted' && <button type="button" className="rc-btn-text" onClick={() => openWithdraw(kind)}>撤回</button>}
              </span>
            </li>
          );
        })}
      </ul>
      {jobs.map((job) => {
        const open = (job.actions || []).filter((action) => action.status !== 'completed');
        const done = job.status === 'completed' && !open.length;
        return (
          <div key={job.id} role="status" className="rc-mt-m">
            {done ? <StateChip tone="done">{KIND_TEXT[job.kind]}已撤回，下架完成</StateChip> : (
              <>
                <StateChip tone="error">尚有下架工作</StateChip>
                <ul className="rc-bullets rc-bullets-spaced">
                  {open.map((action) => <li key={action.id}>{ACTION_TEXT[action.type] || action.type}{action.manualActionRequired ? '（已通知管理員）' : ''}</li>)}
                </ul>
                <button type="button" className="rc-btn rc-btn-outline" disabled={busy} onClick={() => retry(job)}>再試一次</button>
              </>
            )}
          </div>
        );
      })}
      {error && <p className="rc-error rc-mt-s" role="alert">{error}</p>}

      <ConfirmDialog open={Boolean(withdrawKind)} title={`撤回${KIND_TEXT[withdrawKind] || ''}同意`} danger busy={busy}
        confirmLabel={selected.size ? `撤回並下架 ${selected.size} 支` : '撤回'} onConfirm={submitWithdraw} onClose={() => setWithdrawKind(null)}>
        <p>{withdrawKind === 'voice' ? '撤回後，所有課程都不能再用你的原音製作新短片。' : ['avatarLikeness', 'voiceClone'].includes(withdrawKind) ? '撤回後，不能再用數位分身製作新短片。' : '撤回後，這門課不能再製作新短片。'}勾選的短片會從學生短片牆移除；已被下載或轉傳的影片無法收回。</p>
        {assets.length > 0 ? (
          <div className="rc-scroll-list">
            <label className="rc-check">
              <input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(assets.map((asset) => asset.id)) : new Set())} />
              <span className="rc-check-body"><strong>全選（{assets.length} 支）</strong></span>
            </label>
            {assets.map((asset) => (
              <label key={asset.id} className="rc-check">
                <input type="checkbox" checked={selected.has(asset.id)} onChange={(event) => setSelected((prev) => {
                  const next = new Set(prev);
                  if (event.target.checked) next.add(asset.id); else next.delete(asset.id);
                  return next;
                })} />
                <span className="rc-check-body"><strong>{asset.title || '未命名短片'}</strong></span>
              </label>
            ))}
          </div>
        ) : <p className="rc-reason rc-reason-start rc-mt-s">沒有已完成的短片。</p>}
      </ConfirmDialog>
    </section>
  );
}
