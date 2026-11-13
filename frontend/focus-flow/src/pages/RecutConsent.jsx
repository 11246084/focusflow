import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../services/recut.js';
import { consentNeeds, newRequestId, recutErrorText } from '../services/recutFlow.js';
import { ConfirmDialog, PrimaryAction, StateChip } from './recutUi';

// 第一次製作時在流程內同意：授課內容（依課程）＋使用老師原音（教師全域）。
// 確認框一律預設不勾；合成語音尚未開放，這一輪只提供老師原音。
export function RecutConsentGate({ courseId, consent, terms, onRecorded }) {
  const needs = consentNeeds(consent);
  const [contentChecked, setContentChecked] = useState(false);
  const [voiceChecked, setVoiceChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 同一次決定重送沿用同一個 requestId，避免重複紀錄。
  const requestIds = useMemo(() => ({ content: newRequestId(), voice: newRequestId() }), []);
  const ready = (!needs.content || contentChecked) && (!needs.voice || voiceChecked);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      let latest = consent;
      if (needs.content) latest = await api.recordConsent(courseId, { kind: 'content', choice: 'granted', termsVersion: terms.version, requestId: requestIds.content });
      if (needs.voice) latest = await api.recordConsent(courseId, { kind: 'voice', choice: 'original', termsVersion: terms.version, requestId: requestIds.voice });
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
          {needs.content && (
            <label className="rc-check">
              <input type="checkbox" checked={contentChecked} onChange={(event) => setContentChecked(event.target.checked)} />
              <span className="rc-check-body"><strong>同意這門課的授課內容用來製作短片</strong><span>{terms.content}</span><span>{terms.processing}</span></span>
            </label>
          )}
          {needs.voice && (
            <label className="rc-check">
              <input type="checkbox" checked={voiceChecked} onChange={(event) => setVoiceChecked(event.target.checked)} />
              <span className="rc-check-body"><strong>短片使用我的授課原音</strong><span>{terms.voice}</span></span>
            </label>
          )}
          <p className="rc-reason rc-reason-start">{terms.withdrawal}</p>
        </section>
      </div>
      <aside className="rc-col rc-side">
        <div className="rc-panel">
          <PrimaryAction label="同意並繼續" onClick={submit} busy={busy} disabled={!ready} reason="勾選上面的同意後才能繼續" />
          {error && <p className="rc-error rc-mt-s" role="alert">{error}</p>}
        </div>
      </aside>
    </>
  );
}

const KIND_TEXT = { content: '授課內容', voice: '老師原音' };
const ACTION_TEXT = { stopWork: '停止製作中的短片', archiveAsset: '從學生短片牆移除', makeYouTubePrivate: 'YouTube 轉為私人' };

// 管理頁的授權設定：目前同意狀態、撤回（逐支或全選，預設都不選）、未完成的下架工作。
export function RecutConsentManager({ courses }) {
  const [courseId, setCourseId] = useState(() => String(courses[0]?._id || ''));
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
        <p>{withdrawKind === 'voice' ? '撤回後，所有課程都不能再用你的原音製作新短片。' : '撤回後，這門課不能再製作新短片。'}勾選的短片會從學生短片牆移除；已被下載或轉傳的影片無法收回。</p>
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
