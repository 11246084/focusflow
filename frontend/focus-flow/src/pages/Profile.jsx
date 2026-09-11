import { useCallback, useEffect, useRef, useState } from 'react';
import { Ic } from '../components/Icons';
import {
  apiFetch,
  BACKEND_ORIGIN,
  getToken,
  getUser,
  setUser,
} from '../api';

const ROLE_LABELS = { student: '學生 · Student', teacher: '教師 · Teacher', admin: '管理員 · Admin' };
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
// Avatars are stored in MongoDB, so shrink to a small square before upload (backend cap is 1 MiB).
const AVATAR_OUTPUT_SIZE = 256;
const AVATAR_OUTPUT_QUALITY = 0.85;

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, AVATAR_OUTPUT_QUALITY));
}

// Center-crop to a square and scale down; browsers that cannot encode WebP fall back to JPEG.
async function resizeAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(AVATAR_OUTPUT_SIZE, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  let blob = await canvasToBlob(canvas, 'image/webp');
  if (blob?.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg');
  }
  if (!blob) throw new Error('頭像處理失敗，請換一張圖片再試。');
  return blob;
}

async function fetchAvatarObjectUrl({ token, signal }) {
  const response = await fetch(`${BACKEND_ORIGIN}/api/v1/auth/me/avatar`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
    signal,
  });

  // A missing avatar is not an error for the viewer; fall back to the initial.
  if (response.status === 404) return null;

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(errorBody.message || '頭像讀取失敗。');
    error.code = errorBody.error?.code;
    throw error;
  }

  return URL.createObjectURL(await response.blob());
}

function AvatarUploader({ name, previewUrl, onPick, disabled }) {
  const fileInputRef = useRef(null);
  const openPicker = () => {
    if (!disabled) fileInputRef.current?.click();
  };
  return (
    <div
      aria-disabled={disabled}
      style={{ position: 'relative', width: 84, height: 84, flexShrink: 0, opacity: disabled ? 0.6 : 1 }}
    >
      <div
        onClick={openPicker}
        style={{
          width: 84, height: 84, borderRadius: '50%', cursor: disabled ? 'wait' : 'pointer', overflow: 'hidden',
          background: previewUrl ? undefined : 'linear-gradient(135deg,#F14F21,#a01a50)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 30, color: '#fff',
          border: '2px solid rgba(255,255,255,0.14)',
        }}
        title={disabled ? '頭像上傳中' : '點擊更換頭像'}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover',cursor: 'pointer'}} />
        ) : (
          name.charAt(0)
        )}
      </div>
      <div
        onClick={openPicker}
        style={{
          position: 'absolute', bottom: -2, right: -2, width: 32, height: 32, borderRadius: '50%',
          background: '#F14F21', border: '2px solid #260c1e', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#fff', cursor: disabled ? 'wait' : 'pointer',
        }}
      >
        <Ic n="up" s={13} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (file) void onPick(file);
        }}
      />
    </div>
  );
}

function StudentExtra({ stats, loading }) {
  const cards = [
    [stats?.coursesCount ?? '-', '已選修課程'],
    [stats?.totalQueries ?? '-', '累計提問次數'],
    [stats?.weeklyQueries ?? '-', '本週提問次數'],
    [`${stats?.answerRate ?? 0}%`, '回答命中率'],
  ];
  return (
    <div className="ff-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
      {cards.map(([value, label]) => (
        <div key={label} className="stat-card">
          <div className="stat-val" style={{ fontSize: 26 }}>{loading ? '-' : value}</div>
          <div className="stat-sub" style={{ marginTop: 4 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function TeacherExtra({ stats, loading }) {
  const cards = [
    [stats?.coursesCount ?? '-', '建立課程數'],
    [stats?.videosCount ?? '-', '上傳影片數'],
    [stats?.segmentsCount ?? '-', '索引片段數'],
    [stats?.queriesCount ?? '-', '課程累計提問'],
  ];
  return (
    <div className="ff-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
      {cards.map(([value, label]) => (
        <div key={label} className="stat-card">
          <div className="stat-val" style={{ fontSize: 26 }}>{loading ? '-' : value}</div>
          <div className="stat-sub" style={{ marginTop: 4 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function AccountInfoCard({ user, onSaved }) {
  const [form, setForm] = useState({ name: user.name || '', email: user.email || '', currentPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Follow the server-refreshed profile unless the user is mid-edit.
  const [lastUser, setLastUser] = useState(user);
  if (lastUser !== user) {
    setLastUser(user);
    setForm({ name: user.name || '', email: user.email || '', currentPassword: '' });
  }

  const emailChanged = form.email.trim().toLowerCase() !== String(user.email || '').toLowerCase();
  const nameChanged = form.name.trim() !== (user.name || '');
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!form.name.trim()) return setError('姓名不可空白。');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('請輸入有效的 Email。');
    if (emailChanged && !form.currentPassword) return setError('修改 Email 需要輸入目前密碼。');
    if (!nameChanged && !emailChanged) return setError('沒有需要儲存的變更。');

    const body = {};
    if (nameChanged) body.name = form.name.trim();
    if (emailChanged) Object.assign(body, { email: form.email.trim(), currentPassword: form.currentPassword });

    setSaving(true);
    try {
      const response = await apiFetch('/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSaved(response.data.user);
      setMessage(emailChanged ? '已更新，下次請用新的 Email 登入。' : '已更新。');
    } catch (err) {
      const messages = {
        CURRENT_PASSWORD_INCORRECT: '目前密碼不正確。',
        DUPLICATE_RESOURCE: '這個 Email 已被其他帳號使用。',
      };
      setError(messages[err.code] || err.message || '更新失敗。');
    } finally {
      setSaving(false);
    }
    return undefined;
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 26, maxWidth: '100%', marginBottom: 20 }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 16 }}>帳號資訊</div>
      <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label className="ff-label" htmlFor="profile-name">姓名</label>
          <input id="profile-name" className="ff-input" value={form.name} onChange={update('name')} disabled={saving} style={{ width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label className="ff-label" htmlFor="profile-email">Email</label>
          <input id="profile-email" className="ff-input" type="email" autoComplete="email" value={form.email} onChange={update('email')} disabled={saving} style={{ width: '100%', boxSizing: 'border-box' }} />
        </div>
      </div>
      {emailChanged && (
        <div style={{ marginTop: 16, maxWidth: 360 }}>
          <label className="ff-label" htmlFor="profile-current-password">目前密碼（修改 Email 需驗證）</label>
          <input id="profile-current-password" className="ff-input" type="password" autoComplete="current-password" value={form.currentPassword} onChange={update('currentPassword')} disabled={saving} style={{ width: '100%', boxSizing: 'border-box' }} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <div role={error ? 'alert' : 'status'} style={{ fontSize: 12, minHeight: 18, color: error ? '#ff8a8a' : '#86efac' }}>
          {error || message}
        </div>
        <button className="btn-primary" type="submit" disabled={saving || (!nameChanged && !emailChanged)} style={{ padding: '9px 18px', fontSize: 12.5 }}>
          {saving ? '儲存中…' : '儲存變更'}
        </button>
      </div>
    </form>
  );
}

function ChangePasswordCard() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!form.currentPassword) return setError('請輸入目前密碼。');
    if (form.newPassword.length < 8) return setError('新密碼至少需要 8 個字元。');
    if (form.newPassword !== form.confirmPassword) return setError('兩次輸入的新密碼不一致。');
    if (form.newPassword === form.currentPassword) return setError('新密碼不可與目前密碼相同。');

    setSaving(true);
    try {
      await apiFetch('/auth/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage('密碼已更新，下次登入請使用新密碼。');
    } catch (err) {
      setError(err.code === 'CURRENT_PASSWORD_INCORRECT' ? '目前密碼不正確。' : (err.message || '修改密碼失敗。'));
    } finally {
      setSaving(false);
    }
    return undefined;
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 26, maxWidth: '100%', marginBottom: 20 }}>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 16 }}>修改密碼</div>
      <div className="ff-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {[
          ['currentPassword', '目前密碼', 'current-password'],
          ['newPassword', '新密碼（至少 8 碼）', 'new-password'],
          ['confirmPassword', '確認新密碼', 'new-password'],
        ].map(([field, label, autoComplete]) => (
          <div key={field}>
            <label className="ff-label" htmlFor={`pw-${field}`}>{label}</label>
            <input
              id={`pw-${field}`}
              className="ff-input"
              type="password"
              autoComplete={autoComplete}
              value={form[field]}
              onChange={update(field)}
              disabled={saving}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <div role={error ? 'alert' : 'status'} style={{ fontSize: 12, minHeight: 18, color: error ? '#ff8a8a' : '#86efac' }}>
          {error || message}
        </div>
        <button className="btn-primary" type="submit" disabled={saving} style={{ padding: '9px 18px', fontSize: 12.5 }}>
          {saving ? '更新中…' : '更新密碼'}
        </button>
      </div>
    </form>
  );
}

export default function Profile({ role, onProfileUpdated }) {
  const [user, setCurrentUser] = useState(() => getUser() || {});
  const displayName = user.name || '訪客';
  const [previewUrl, setPreviewUrl] = useState(null);
  const [avatarLoading, setAvatarLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarMessage, setAvatarMessage] = useState('');
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(role === 'student' || role === 'teacher');
  const mountedRef = useRef(false);
  const profileGenerationRef = useRef(0);
  const profileAbortRef = useRef(null);
  const uploadGenerationRef = useRef(0);
  const uploadAbortRef = useRef(null);
  const uploadPendingRef = useRef(false);

  const refreshProfile = useCallback(async ({ showLoading = true } = {}) => {
    const sessionToken = getToken();
    if (!mountedRef.current || !sessionToken) return false;

    // Cancel the prior generation so an older profile read cannot win this request race.
    const requestId = profileGenerationRef.current + 1;
    profileGenerationRef.current = requestId;
    profileAbortRef.current?.abort();
    const controller = new AbortController();
    profileAbortRef.current = controller;

    const requestIsCurrent = () => (
      mountedRef.current
      && !controller.signal.aborted
      && requestId === profileGenerationRef.current
      // A response from a previous login session must never replace the current user's profile.
      && getToken() === sessionToken
    );

    if (showLoading && requestIsCurrent()) {
      setAvatarLoading(true);
      setAvatarError('');
    }

    // This request owns its blob URL until it is committed to preview state or revoked.
    let objectUrl = null;
    try {
      const res = await apiFetch('/auth/me', { signal: controller.signal });
      if (!requestIsCurrent()) return false;

      const freshUser = res.data.user;
      if (freshUser.hasAvatar) {
        objectUrl = await fetchAvatarObjectUrl({
          token: sessionToken,
          signal: controller.signal,
        });
      }

      if (!requestIsCurrent()) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        return false;
      }

      setCurrentUser(freshUser);
      setUser(freshUser);
      setPreviewUrl(objectUrl);
      objectUrl = null;
      return true;
    } catch (error) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      if (isAbortError(error) || !requestIsCurrent()) return false;
      setAvatarError(error.message || '個人資料讀取失敗。');
      return false;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (requestId === profileGenerationRef.current) {
        profileAbortRef.current = null;
      }
      if (showLoading && requestIsCurrent()) {
        setAvatarLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshProfile();
    return () => {
      mountedRef.current = false;
      profileGenerationRef.current += 1;
      uploadGenerationRef.current += 1;
      profileAbortRef.current?.abort();
      uploadAbortRef.current?.abort();
      profileAbortRef.current = null;
      uploadAbortRef.current = null;
      uploadPendingRef.current = false;
    };
  }, [refreshProfile]);

  useEffect(() => (
    () => {
      // Revoke the previous blob URL when the preview changes or the page unmounts.
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  ), [previewUrl]);

  useEffect(() => {
    if (role !== 'student' && role !== 'teacher') return;
    apiFetch(`/stats/${role}`)
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [role]);

  async function handlePickAvatar(file) {
    if (uploadPendingRef.current) return;

    const sessionToken = getToken();
    if (!mountedRef.current || !sessionToken) return;

    setAvatarError('');
    setAvatarMessage('');

    if (!AVATAR_TYPES.has(file.type)) {
      setAvatarError('僅支援 JPEG、PNG 或 WebP 頭像。');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('頭像檔案不可超過 5 MiB。');
      return;
    }

    let resized;
    try {
      resized = await resizeAvatar(file);
    } catch {
      setAvatarError('無法讀取這張圖片，請換一張再試。');
      return;
    }
    if (!mountedRef.current || getToken() !== sessionToken) return;

    const formData = new FormData();
    formData.append('avatar', resized, resized.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg');
    // Upload generations prevent a stale completion from refreshing a newer session's avatar.
    const requestId = uploadGenerationRef.current + 1;
    uploadGenerationRef.current = requestId;
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    uploadPendingRef.current = true;
    setAvatarUploading(true);

    const requestIsCurrent = () => (
      mountedRef.current
      && !controller.signal.aborted
      && requestId === uploadGenerationRef.current
      && getToken() === sessionToken
    );

    try {
      await apiFetch('/auth/me/avatar', {
        method: 'PUT',
        body: formData,
        signal: controller.signal,
      });
      if (!requestIsCurrent()) return;

      const refreshed = await refreshProfile({ showLoading: false });
      if (refreshed && requestIsCurrent()) {
        setAvatarMessage('頭像已更新。');
      }
    } catch (error) {
      if (isAbortError(error) || !requestIsCurrent()) return;
      setAvatarError(error.message || '頭像上傳失敗，請稍後再試。');
    } finally {
      if (requestId === uploadGenerationRef.current) {
        uploadPendingRef.current = false;
        uploadAbortRef.current = null;
        if (mountedRef.current && getToken() === sessionToken) {
          setAvatarUploading(false);
        }
      }
    }
  }

  return (
    <div className="fu scrl" style={{ padding: 26, height: '100%' }}>
      <div className="card" style={{ padding: 26, maxWidth: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 22, marginBottom: 20 }}>
        <AvatarUploader
          name={displayName}
          previewUrl={previewUrl}
          onPick={handlePickAvatar}
          disabled={avatarUploading}
        />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: '#fff' }}>{displayName}</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{user.email || '未提供 Email'}</div>
          <span className="badge bo" style={{ marginTop: 10 }}>{ROLE_LABELS[role] || role}</span>
          <div style={{ fontSize: 12, marginTop: 10, minHeight: 18, color: avatarError ? '#ff8a8a' : 'rgba(255,255,255,0.55)' }}>
            {avatarError || avatarMessage || (avatarUploading ? '頭像上傳中…' : (avatarLoading ? '頭像讀取中…' : '點擊頭像可上傳 JPEG、PNG 或 WebP，最大 5 MiB。'))}
          </div>
        </div>
      </div>

      <AccountInfoCard
        user={user}
        onSaved={(freshUser) => {
          setCurrentUser(freshUser);
          setUser(freshUser);
          onProfileUpdated?.();
        }}
      />

      <ChangePasswordCard />

      {(role === 'student' || role === 'teacher') && (
        <div style={{ maxWidth: '100%' }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12 }}>
            {role === 'student' ? '學習概況' : '教學概況'}
          </div>
          {role === 'student' ? <StudentExtra stats={stats} loading={statsLoading} /> : <TeacherExtra stats={stats} loading={statsLoading} />}
        </div>
      )}
    </div>
  );
}
