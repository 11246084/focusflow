import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FEEDBACK_TYPES,
  STATUS_LABELS,
  createScript,
  formatTimestamp,
  generateVersion,
  getScript,
  isFeatureDisabledError,
  latestVersion,
  listCandidates,
  listCourses,
  listScripts,
  reviewScript,
} from '../services/shortScript';
import { renderScriptMarkdown } from '../services/shortScriptTemplate';

const ARC_LABELS = {
  hook: '鉤子',
  context: '交代',
  reveal: '給正解',
  deepen: '加深',
  evidence: '證據',
  climax: '高潮',
  conclusion: '結論',
  ending: '收尾',
};

export default function TeacherShortScripts() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [scripts, setScripts] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [metaphorIndex, setMetaphorIndex] = useState(0);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  // 「這版不要」面板：不是審核關卡（規格書 2.0），只是重新生成前讓教師講一句哪裡不對。
  // 沒有這句話，模型會在沒有任何指引下重寫，結果多半跟上一版差不多。
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenType, setRegenType] = useState(FEEDBACK_TYPES[0].value);
  const [regenNote, setRegenNote] = useState('');

  useEffect(() => {
    listCourses()
      .then((list) => {
        setCourses(list);
        if (list.length) setCourseId(list[0]._id);
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  const refresh = useCallback(async () => {
    if (!courseId) return;

    setLoading(true);
    setError('');
    try {
      const [scriptList, candidateResult] = await Promise.all([
        listScripts(courseId),
        listCandidates(courseId),
      ]);
      setScripts(scriptList);
      setCandidates(candidateResult.candidates);
      setFeatureDisabled(false);
    } catch (requestError) {
      // 功能未啟用與一般錯誤要分開告知，否則教師只會看到「找不到」而不知原因。
      if (isFeatureDisabledError(requestError)) {
        setFeatureDisabled(true);
      } else {
        setError(requestError.message);
      }
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    setSelected(null);
    refresh();
  }, [refresh]);

  const version = latestVersion(selected);

  const markdown = useMemo(
    () => (selected && version ? renderScriptMarkdown(selected, version, metaphorIndex) : ''),
    [selected, version, metaphorIndex],
  );

  async function runAction(label, action) {
    setBusy(label);
    setError('');
    try {
      const result = await action();
      if (result) setSelected(result);
      await refresh();
    } catch (requestError) {
      setError(`${requestError.message}${requestError.code ? `（${requestError.code}）` : ''}`);
    } finally {
      setBusy('');
    }
  }

  async function handleOpen(scriptId) {
    setError('');
    setCopied(false);
    setMetaphorIndex(0);
    setRegenOpen(false);
    setRegenNote('');
    try {
      setSelected(await getScript(scriptId));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  // generated 狀態的腳本不能直接重生（狀態機沒有 generated → generated），
  // 要先帶著回饋退回再生成；changes_requested 的回饋已經在上一版裡（成品退回時寫入），直接生成即可。
  async function handleRegenerate() {
    if (selected.status === 'changes_requested') {
      return runAction('generate', () => generateVersion(selected._id));
    }

    const note = regenNote.trim();
    if (!note) {
      setError('請先寫一句哪裡不對，重新生成才有依據。');
      return null;
    }

    return runAction('generate', async () => {
      await reviewScript(selected._id, {
        decision: 'request_changes',
        feedback: note,
        feedbackType: regenType,
      });
      const result = await generateVersion(selected._id);
      setRegenOpen(false);
      setRegenNote('');
      return result;
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      // 部分瀏覽器在非 HTTPS 或未授權時會拒絕剪貼簿寫入；此時請教師手動選取。
      setError('瀏覽器拒絕寫入剪貼簿，請手動選取下方內容複製。');
    }
  }

  if (featureDisabled) {
    return (
      <div className="card-sm">
        <h3>短影片腳本</h3>
        <p>此功能尚未啟用。請在後端設定 <code>SHORT_SCRIPT_AUTOMATION_ENABLED=true</code> 後重新整理。</p>
      </div>
    );
  }

  return (
    <div className="fu scrl">
      <div className="card-sm">
        <label className="ff-label" htmlFor="short-script-course">課程</label>
        <select
          id="short-script-course"
          value={courseId}
          onChange={(event) => setCourseId(event.target.value)}
        >
          {!courses.length && <option value="">目前沒有可用課程</option>}
          {courses.map((course) => (
            <option key={course._id} value={course._id}>{course.title}</option>
          ))}
        </select>

        <div className="review-btn-row">
          <button
            type="button"
            className="btn-primary"
            disabled={!courseId || Boolean(busy)}
            onClick={() => runAction('create', () => createScript(courseId))}
          >
            {busy === 'create' ? '選題中…' : '自動選題並凍結證據'}
          </button>
          <button type="button" className="btn-outline" disabled={loading} onClick={refresh}>
            重新整理
          </button>
        </div>

        {error && <p className="required-mark">{error}</p>}
      </div>

      <div className="ff-grid-2">
        <div className="card-sm">
          <h3>腳本（{scripts.length}）</h3>
          {!scripts.length && !loading && <p className="optional-mark">尚未建立任何腳本。</p>}
          <ul className="reject-reason-list">
            {scripts.map((script) => (
              <li key={script._id} className="reject-reason-item">
                <button type="button" className="btn-outline" onClick={() => handleOpen(script._id)}>
                  {script.topic}
                </button>
                <span className="optional-mark">{STATUS_LABELS[script.status] || script.status}</span>
              </li>
            ))}
          </ul>

          <h3>候選主題（唯讀預覽）</h3>
          <p className="optional-mark">下一次自動選題會從這裡挑第一個通過證據檢查的主題。</p>
          <ol className="reject-reason-list">
            {candidates.map((candidate) => (
              <li key={candidate.topicKey} className="reject-reason-item">
                {candidate.question}
                <span className="optional-mark">
                  {candidate.uniqueAskerCount} 人問過 · 共 {candidate.totalAskCount} 次
                  · 合併 {candidate.variants?.length || 1} 種問法
                </span>
              </li>
            ))}
            {!candidates.length && !loading && <li className="optional-mark">沒有符合條件的候選主題。</li>}
          </ol>
        </div>

        <div className="card-sm">
          {!selected && <p className="optional-mark">從左側選一份腳本查看內容。</p>}

          {selected && (
            <>
              <h3>{selected.topic}</h3>
              <p className="optional-mark">{STATUS_LABELS[selected.status] || selected.status}</p>

              {selected.selectionReason && (
                <p className="optional-mark">
                  排名第 {selected.selectionReason.rank}
                  · {selected.selectionReason.uniqueAskerCount} 人問過
                  · 共 {selected.selectionReason.totalAskCount} 次
                  · 證據 {selected.selectionReason.evidenceCount} 筆
                </p>
              )}

              {!version && (
                <div className="review-btn-row">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={Boolean(busy)}
                    onClick={() => runAction('generate', () => generateVersion(selected._id))}
                  >
                    {busy === 'generate' ? '生成中（約 30–45 秒）…' : '生成腳本'}
                  </button>
                </div>
              )}

              {version && (
                <>
                  <h4>視覺隱喻（選一組，會寫進複製出的腳本）</h4>
                  {(version.payload.visualMetaphorOptions || []).map((option, index) => (
                    <label key={option.label} className="reject-reason-checkbox">
                      <input
                        type="radio"
                        name="short-script-metaphor"
                        checked={metaphorIndex === index}
                        onChange={() => { setMetaphorIndex(index); setCopied(false); }}
                      />
                      {option.label}
                    </label>
                  ))}

                  {/* 規格書 2.1：教師必須看得到證據與 STT 原文才判斷得出引用是否正確，
                      只看口白不夠——口白讀起來通順不代表引用對。 */}
                  <h4>證據對照表（未修飾的逐字稿原文）</h4>
                  <ul className="reject-reason-list">
                    {(selected.evidence || []).map((item) => (
                      <li key={item.chunkId} className="reject-reason-item">
                        <strong>[{item.code}]</strong>{' '}
                        <span className="optional-mark">
                          {formatTimestamp(item.startSec)}–{formatTimestamp(item.endSec)}
                          {item.expandedFrom ? ' · 鄰接擴展' : ' · 檢索命中'}
                        </span>
                        <div>{item.rawText}</div>
                      </li>
                    ))}
                  </ul>

                  <h4>分鏡（第 {version.versionNo} 版）</h4>
                  <ol className="reject-reason-list">
                    {version.payload.shots.map((shot) => (
                      <li key={shot.shotNo} className="reject-reason-item">
                        <strong>鏡 {String(shot.shotNo).padStart(2, '0')}</strong>{' '}
                        <span className="optional-mark">
                          {ARC_LABELS[shot.arcRole] || shot.arcRole} · {shot.timeRange}
                        </span>
                        <div>{shot.narration}</div>
                        <div className="optional-mark">字幕：{shot.subtitle}</div>
                        <div className="optional-mark">
                          依據：{shot.basedOn === 'template' ? 'template' : (shot.basedOn || []).join('、')}
                        </div>
                      </li>
                    ))}
                  </ol>

                  <div className="review-btn-row">
                    <button type="button" className="btn-primary" onClick={handleCopy}>
                      {copied ? '已複製到剪貼簿' : '複製完整腳本'}
                    </button>
                    {selected.status === 'changes_requested' ? (
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={Boolean(busy)}
                        onClick={handleRegenerate}
                      >
                        {busy === 'generate' ? '重新生成中…' : '依回饋重新生成'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={Boolean(busy) || selected.status === 'dismissed'}
                        onClick={() => setRegenOpen((open) => !open)}
                      >
                        這版不要，重新生成
                      </button>
                    )}
                  </div>

                  {selected.status === 'changes_requested' && version.feedback && (
                    <p className="optional-mark">
                      將依此回饋重新生成（{FEEDBACK_TYPES.find((type) => type.value === version.feedbackType)?.label || version.feedbackType}）：{version.feedback}
                    </p>
                  )}

                  {regenOpen && selected.status !== 'changes_requested' && (
                    <div className="card-sm">
                      {FEEDBACK_TYPES.map((type) => (
                        <label key={type.value} className="reject-reason-checkbox">
                          <input
                            type="radio"
                            name="short-script-regen-type"
                            checked={regenType === type.value}
                            onChange={() => setRegenType(type.value)}
                          />
                          {type.label}
                          <span className="optional-mark">（{type.hint}）</span>
                        </label>
                      ))}
                      <textarea
                        rows={2}
                        placeholder="一句話：哪裡不對？"
                        value={regenNote}
                        onChange={(event) => setRegenNote(event.target.value)}
                      />
                      <div className="review-btn-row">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={Boolean(busy)}
                          onClick={handleRegenerate}
                        >
                          {busy === 'generate' ? '重新生成中（約 30–45 秒）…' : '退回並重新生成'}
                        </button>
                        <button type="button" className="btn-outline" onClick={() => setRegenOpen(false)}>
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  <h4>完整腳本（可直接複製貼進製作流程）</h4>
                  <textarea
                    readOnly
                    value={markdown}
                    rows={20}
                    onFocus={(event) => event.target.select()}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
