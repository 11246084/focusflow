import { useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import { retryAssetUpload, uploadAsset } from '../services/shortScript';
import { describeAssetState } from '../services/shortScriptStatus';
import { formatFileSize } from './teacherUploadUtils';
import { EmptyRow, ErrorBanner, Pill } from './shortScriptUi';
import { ACCENT, BODY, DIVIDER, GHOST_BTN, MUTED, SECTION_LABEL, SMALL_BTN, describeError } from './shortScriptStyles';

// 成品上傳區（成品上傳頁 TeacherShortUploads.jsx 使用）：教師拍完影片回來上傳，
// 只建立待審核的成品，不直接上架（規格書 R-08）。表單狀態都留在這個元件內，
// 對外只透過 onChanged 通知重讀資料。呼叫端用 key={script._id} 讓換腳本時表單歸零。

// 兩個確認框都是必勾：規格書 R-07／附錄 K.5 要求教師明示確認 AI 揭露與書面同意，
// 系統不代為取得也不驗真偽，只記錄確認時間。少勾任何一個後端回 SHORT_ASSET_DISCLOSURE_REQUIRED。
function ConfirmRow({ checked, disabled, onChange, children }) {
  return (
    <label className="ss-confirm-row" style={{ cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: ACCENT, width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
      />
      <span>{children}</span>
    </label>
  );
}

function AssetStateRow({ label, value, tone }) {
  return (
    <div className="ss-asset-state">
      <span style={MUTED}>{label}</span>
      <Pill tone={tone}>{value}</Pill>
    </div>
  );
}

export default function ShortAssetPanel({ script, version, assets, compact = false, onChanged }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState(script.topic || '');
  const [description, setDescription] = useState('');
  const [drag, setDrag] = useState(false);
  const [confirmedAi, setConfirmedAi] = useState(false);
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const inputRef = useRef(null);

  if (!version) return <EmptyRow>這份腳本還沒生成，請先到「短影片腳本」頁生成腳本，才能上傳成品。</EmptyRow>;

  function resetForm() {
    setFile(null);
    setDescription('');
    setConfirmedAi(false);
    setConfirmedConsent(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function pickFile(files) {
    const picked = files?.[0];
    if (!picked) return;
    setFile(picked);
    setNotice('');
    setError('');
    // 同一個檔案連續選兩次時 change 事件不會再觸發，選完就清掉 input 的值。
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleUpload() {
    if (!file) { setError('請先選擇成品影片檔。'); return; }
    if (!confirmedAi || !confirmedConsent) {
      setError('請先確認 AI 揭露標示與教師書面同意，兩項都確認才能上傳。');
      return;
    }
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      await uploadAsset(script._id, {
        file,
        title: title.trim() || script.topic,
        description: description.trim(),
        versionNo: version.versionNo,
      });
      resetForm();
      setNotice('已送出。系統正在把影片以「非公開」傳上 YouTube，傳完就能在「短影片審核」頁看片審核；審核通過後學生才看得到。');
      // 上傳可能把同一份腳本既有的待上架成品換代，腳本狀態也可能改變，兩邊都要重讀。
      await onChanged?.();
    } catch (requestError) {
      // 失敗時保留教師已選的檔案、標題與勾選，修正後可直接再送。
      setError(describeError(requestError));
    } finally {
      setBusy('');
    }
  }

  async function handleRetry(assetId) {
    setBusy(`retry:${assetId}`);
    setError('');
    try {
      await retryAssetUpload(assetId);
      await onChanged?.();
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setBusy('');
    }
  }

  const uploading = busy === 'upload';
  const openPicker = () => { if (!uploading) inputRef.current?.click(); };

  return (
    <div className="ss-asset-panel">
      <ErrorBanner style={{ margin: '16px 20px 0' }}>{error}</ErrorBanner>

      {script.status !== 'dismissed' && (
        <div style={{ padding: '16px 20px', borderBottom: assets.length ? DIVIDER : 'none' }}>
          <div style={{ ...SECTION_LABEL, marginBottom: 6 }}>上傳成品 · 依第 {version.versionNo} 版腳本拍出來的影片</div>
          {script.status === 'changes_requested' && (
            <div className="card-sm" style={{ padding: '10px 14px', marginBottom: 12, background: 'rgba(255,255,255,0.03)', ...BODY }}>
              這份腳本目前是「需修改」。這裡會用<strong>目前的第 {version.versionNo} 版</strong>重傳成品，不重新生成腳本；
              適合腳本沒問題、只需要重錄或重剪影片的情況。審核通過後就會上架。
              要改腳本內容，請到「短影片腳本」頁依回饋重新生成。
            </div>
          )}
          {script.status === 'approved' && (
            // 後端行為（decisions.md 第 5 節）：已發布的成品不換代，這次上傳會建立另一支成品，
            // 通過審核後也會上架；目前上架的影片不會自動下架。
            <div role="note" className="card-sm ss-warning">
              <strong>這份腳本已經上架。</strong>在這裡上傳的新影片會成為另一支成品；它通過審核後也會上架，
              目前已上架的影片<strong>不會自動下架</strong>，兩支可能同時出現在學生的短影片牆。
            </div>
          )}
          <div style={{ ...BODY, marginBottom: 12 }}>
            上傳後系統會立刻以 YouTube「非公開」傳上去，讓你在「短影片審核」頁看片審核。
            <strong style={{ color: '#fff' }}>已傳上 YouTube 不等於學生看得到</strong>：審核通過後才會進學生的短影片牆；
            退回時影片會轉成「私人」，理由寫回第 {version.versionNo} 版腳本。
          </div>

          <div
            className="upload-z ss-dropzone"
            role="button"
            tabIndex={0}
            aria-label={file ? `已選擇 ${file.name}，按下可更換檔案` : '選擇成品影片檔'}
            style={{ opacity: uploading ? 0.6 : 1 }}
            onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDrag(false);
              if (!uploading) pickFile(event.dataTransfer.files);
            }}
            onClick={openPicker}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(); } }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".mp4,.mov,.mkv,video/mp4,video/quicktime,video/x-matroska"
              style={{ display: 'none' }}
              onChange={(event) => pickFile(event.target.files)}
            />
            {file ? (
              <>
                <div style={{ color: ACCENT }}><Ic n="film" s={24} /></div>
                <div className="ss-file-name">{file.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  {formatFileSize(file.size)} · 點擊可換一支
                </div>
              </>
            ) : (
              <>
                <div style={{ color: ACCENT }}><Ic n="up" s={26} /></div>
                <div style={{ fontSize: 14, fontWeight: 600, color: drag ? '#fff' : 'rgba(255,255,255,0.78)' }}>
                  {compact ? '點擊選擇成品影片' : '拖曳成品影片至此'}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
                  {compact ? '' : '或點擊選擇檔案 · '}MP4、MOV、MKV，單支最大 500 MB
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="ff-label" htmlFor="ss-asset-title">YouTube 標題</label>
            <input
              id="ss-asset-title"
              className="ff-input ss-field"
              value={title}
              placeholder={script.topic}
              disabled={uploading}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="ff-label" htmlFor="ss-asset-description">YouTube 說明（選填）</label>
            <textarea
              id="ss-asset-description"
              className="ff-input ss-field"
              rows={2}
              value={description}
              placeholder="影片說明，會一併帶到 YouTube"
              disabled={uploading}
              style={{ resize: 'vertical' }}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="card-sm" style={{ padding: '12px 16px', marginTop: 12, background: 'rgba(255,255,255,0.03)' }}>
            <div style={SECTION_LABEL}>上傳前必須確認</div>
            <ConfirmRow checked={confirmedAi} disabled={uploading} onChange={setConfirmedAi}>
              AI 揭露已處理：有 AI 生成畫面或數位分身的，已加上全片常駐標示；純實拍影片不需要。
            </ConfirmRow>
            <ConfirmRow checked={confirmedConsent} disabled={uploading} onChange={setConfirmedConsent}>
              授權已處理：使用教師數位分身的，已取得該教師書面同意；沒用分身不需要。
            </ConfirmRow>
            <div style={{ ...MUTED, marginTop: 8, lineHeight: 1.7 }}>系統只記錄你的確認與時間，不會代為檢查或取得同意書。</div>
          </div>

          <div className="ss-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-primary"
              style={SMALL_BTN}
              disabled={Boolean(busy) || !file || !confirmedAi || !confirmedConsent}
              onClick={handleUpload}
            >
              <Ic n="up" s={13} />
              {uploading ? '上傳中…（請勿關閉頁面）' : '上傳成品並送審'}
            </button>
            {file && !uploading && (
              <button type="button" className="btn-primary" style={GHOST_BTN} onClick={resetForm}>清除</button>
            )}
          </div>

          {notice && (
            <div role="status" className="ss-notice">{notice}</div>
          )}
        </div>
      )}

      {assets.length > 0 && (
        <div style={{ padding: '16px 20px' }}>
          <div style={{ ...SECTION_LABEL, marginBottom: 4 }}>這份腳本的成品</div>
          {assets.map((asset) => {
            const state = describeAssetState(asset);
            return (
              <div key={asset.id} style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13.5, color: '#fff', fontWeight: 600, overflowWrap: 'anywhere' }}>{asset.title}</div>
                <div style={{ ...MUTED, marginTop: 2 }}>
                  第 {asset.generationVersion} 代成品 · 依第 {asset.sourceVersionNo ?? '?'} 版腳本
                </div>
                <div className="ss-asset-states">
                  <AssetStateRow
                    label="審核"
                    value={state.review}
                    tone={{ 待審核: 'amber', 審核通過: 'green', 已退回: 'orange' }[state.review]}
                  />
                  <AssetStateRow
                    label="YouTube"
                    value={state.youtube}
                    tone={asset.upload?.status === 'failed' ? 'orange' : asset.upload?.status === 'uploaded' ? 'indigo' : 'amber'}
                  />
                  <AssetStateRow label="學生" value={state.students} tone={state.studentVisible ? 'green' : 'grey'} />
                </div>
                {asset.youtubeUrl && (
                  <a href={asset.youtubeUrl} target="_blank" rel="noreferrer" className="ss-link">在 YouTube 開啟 ↗</a>
                )}
                {asset.upload?.status === 'failed' && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 12.5, color: '#ff8b72', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                      {asset.upload.error || '傳送失敗。'}
                    </div>
                    {asset.upload.retrySafe ? (
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ ...GHOST_BTN, marginTop: 6 }}
                        disabled={Boolean(busy)}
                        onClick={() => handleRetry(asset.id)}
                      >
                        <Ic n="sync" s={13} />
                        {busy === `retry:${asset.id}` ? '重試中…' : '重試上傳'}
                      </button>
                    ) : (
                      <div style={{ ...MUTED, marginTop: 4, lineHeight: 1.7 }}>
                        這次失敗可能已經送出影片內容，直接重試會在頻道留下重複影片。
                        需由管理員確認 YouTube 是否已收到，處理後會自動更新。
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {script.status === 'dismissed' && !assets.length && (
        <EmptyRow>這份腳本已否決，不會再產出成品。</EmptyRow>
      )}
      {script.status === 'dismissed' && assets.length > 0 && (
        <div style={{ ...MUTED, padding: '0 20px 16px' }}>這份腳本已否決，不能再上傳新成品。</div>
      )}
    </div>
  );
}
