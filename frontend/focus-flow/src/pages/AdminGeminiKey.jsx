import { useCallback, useEffect, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import {
  PERSISTENCE_LABELS, SOURCE_LABELS, STORAGE_ERROR_LABELS,
  activateGeminiKey, canActivate, describeCheck, fetchGeminiKeyStatus, needsStepUp, stepUpAdmin, testGeminiKey,
} from '../services/geminiKey';

const TITLE = { fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff' };
const MUTED = { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.6 };
const ROW = { display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', fontSize: 13, flexWrap: 'wrap' };
const LABEL = { color: 'rgba(255,255,255,0.55)', minWidth: 96 };
const formatTime = (value) => (value ? new Date(value).toLocaleString('zh-TW', { hour12: false }) : '—');

export default function AdminGeminiKey() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  // 金鑰只存在這個元件的 state：不寫入 localStorage、網址或任何持久化儲存，啟用或離開頁面後清除。
  const [apiKey, setApiKey] = useState('');
  const [password, setPassword] = useState('');
  const [showStepUp, setShowStepUp] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState(null);
  const passwordRef = useRef(null);

  const refresh = useCallback(() => fetchGeminiKeyStatus()
    .then((data) => { setStatus(data); setStatusError(''); })
    .catch((e) => { setStatusError(e.message || '無法讀取金鑰狀態。'); }), []);

  useEffect(() => {
    let active = true;
    fetchGeminiKeyStatus()
      .then((data) => { if (active) { setStatus(data); setStatusError(''); } })
      .catch((e) => { if (active) setStatusError(e.message || '無法讀取金鑰狀態。'); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (showStepUp) passwordRef.current?.focus(); }, [showStepUp]);

  // 有密碼就先做 step-up；失敗時顯示密碼欄，讓管理員重新輸入後再按一次。
  const run = async (kind, action) => {
    setBusy(kind); setError(''); setNotice('');
    try {
      if (showStepUp) {
        if (!password) throw Object.assign(new Error('請輸入你的管理員密碼。'), { code: 'STEP_UP_REQUIRED' });
        await stepUpAdmin(password);
        setPassword(''); setShowStepUp(false);
      }
      await action();
    } catch (e) {
      if (needsStepUp(e)) setShowStepUp(true);
      if (/^GEMINI_KEY_(?:TEST_|CHANGED_CONCURRENTLY)/.test(e.code || '')) setTestResult(null);
      setError(e.code === 'TOO_MANY_LOGIN_ATTEMPTS'
        ? '高風險操作的密碼驗證已暫時鎖定，請 15 分鐘後再試；一般登入不受影響。'
        : (e.message || '操作失敗，請稍後再試。'));
    } finally {
      setBusy('');
    }
  };

  const handleTest = () => run('test', async () => {
    setTestResult(null);
    const result = await testGeminiKey(apiKey.trim());
    setTestResult(result);
    setNotice('測試通過。確認無誤後請在 10 分鐘內按「啟用這把金鑰」。');
  });

  const handleActivate = () => run('activate', async () => {
    if (!window.confirm('確定要把全站的 Gemini 金鑰換成剛測試通過的這把嗎？新金鑰所屬的 Google 專案將負擔問答、短片製作與上傳處理的 Gemini 用量。')) return;
    const result = await activateGeminiKey(apiKey.trim(), testResult.testId);
    setApiKey(''); setTestResult(null);
    setNotice(`已啟用新金鑰（${formatTime(result.activatedAt)}）。之後的請求會使用新金鑰，不需重啟後端；進行中的上傳處理會沿用原金鑰至完成。${result.persistence === 'memory' ? '注意：這台主機沒有設定保存檔，後端重啟後會回到環境變數的金鑰。' : ''}`);
    await refresh();
  });

  const onKeyChange = (event) => {
    setApiKey(event.target.value);
    // 換了輸入就必須重新測試；後端也會拒絕與測試不同的金鑰。
    if (testResult) { setTestResult(null); setNotice(''); }
  };

  const unavailable = Boolean(status && !status.rotationAvailable);
  const ready = canActivate(testResult);

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...TITLE, fontSize: 15 }}>Gemini API 金鑰</div>
        <button className="btn-primary" onClick={refresh} disabled={Boolean(busy)} style={{ padding: '9px 20px', fontSize: 12 }}><Ic n="sync" s={13} />重新整理</button>
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 12 }}>
        <div style={{ ...TITLE, marginBottom: 10 }}>目前使用中的金鑰</div>
        {statusError && <div role="alert" style={{ fontSize: 12, color: '#f87171' }}>{statusError}</div>}
        {!statusError && !status && <div style={MUTED}>讀取中…</div>}
        {status && <>
          <div style={ROW}><span style={LABEL}>來源</span><span>{SOURCE_LABELS[status.source] || status.source}</span></div>
          <div style={ROW}><span style={LABEL}>啟用時間</span><span>{formatTime(status.activatedAt)}</span></div>
          <div style={ROW}><span style={LABEL}>保存方式</span><span>{PERSISTENCE_LABELS[status.persistence] || status.persistence}</span></div>
          {status.models && <div style={ROW}><span style={LABEL}>測試項目</span><span>向量 {status.models.embedding}（{status.models.embeddingDimensions} 維）、文字生成 {status.models.generation.join('、')}</span></div>}
          {status.modelsError && <div role="alert" style={{ fontSize: 12, color: '#facc15', marginTop: 6 }}>系統的 Gemini 模型設定有誤，暫時無法測試金鑰。</div>}
          {unavailable && <div role="alert" style={{ fontSize: 12, color: '#facc15', marginTop: 6, lineHeight: 1.6 }}>
            這台主機目前無法在網頁上更換金鑰{status.storageError ? `：${STORAGE_ERROR_LABELS[status.storageError] || status.storageError}` : ''}。目前仍使用主機環境變數的金鑰，請由有主機權限的人檢查 GEMINI_KEY_OVERRIDE_FILE 設定。
          </div>}
        </>}
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 12 }}>
        <div style={{ ...TITLE, marginBottom: 4 }}>更換金鑰</div>
        <div style={{ ...MUTED, marginBottom: 14 }}>
          測試會使用新金鑰的額度，確認搜尋向量與文字生成功能。通過後，按「啟用這把金鑰」即可切換全站。
        </div>

        <label className="ff-label" htmlFor="gemini-key-input">新的 Gemini API 金鑰</label>
        <input
          id="gemini-key-input" className="ff-input" type="password" value={apiKey} onChange={onKeyChange}
          autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" data-lpignore="true"
          disabled={Boolean(busy) || unavailable} placeholder="貼上 Google AI Studio 的 API 金鑰"
          style={{ marginBottom: 14 }}
        />

        {showStepUp && <div style={{ marginBottom: 14 }}>
          <label className="ff-label" htmlFor="gemini-key-step-up">重新輸入你的管理員密碼</label>
          <p className="auth-help">更換全站金鑰屬於高風險操作，驗證後 5 分鐘內可繼續測試與啟用。</p>
          <input id="gemini-key-step-up" ref={passwordRef} className="ff-input" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)} disabled={Boolean(busy)} />
        </div>}

        {error && <div role="alert" style={{ fontSize: 12.5, color: '#fb923c', marginBottom: 12, lineHeight: 1.6 }}>{error}</div>}
        {notice && <div role="status" style={{ fontSize: 12.5, color: '#86efac', marginBottom: 12, lineHeight: 1.6 }}>{notice}</div>}

        {testResult && <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
          {testResult.checks.map((check) => <li key={`${check.check}:${check.model}`}>{describeCheck(check)}</li>)}
          <li style={MUTED}>測試結果有效至 {formatTime(testResult.expiresAt)}</li>
        </ul>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn-primary" onClick={handleTest}
            disabled={Boolean(busy) || unavailable || !apiKey.trim()} style={{ padding: '9px 20px', fontSize: 12 }}>
            {busy === 'test' ? '測試中…' : '測試金鑰'}
          </button>
          <button type="button" className="btn-primary" onClick={handleActivate}
            disabled={Boolean(busy) || unavailable || !ready} style={{ padding: '9px 20px', fontSize: 12, opacity: ready ? 1 : 0.5 }}>
            {busy === 'activate' ? '啟用中…' : '啟用這把金鑰'}
          </button>
        </div>
      </div>
    </div>
  );
}
