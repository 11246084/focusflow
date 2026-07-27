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

function isAbortError(error) {
  return error?.name === 'AbortError';
}

async function fetchAvatarObjectUrl({ token, signal }) {
  const response = await fetch(`${BACKEND_ORIGIN}/api/v1/auth/me/avatar`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
    signal,
  });

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

export default function Profile({ role }) {
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

    const formData = new FormData();
    formData.append('avatar', file);
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

      <div className="card" style={{ padding: 26, maxWidth: '100%', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 16 }}>帳號資訊</div>
        <div className="ff-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="ff-label">姓名</label>
            <div className="ff-input" style={{ background: 'rgba(255,255,255,0.03)', cursor: 'default' }}>{displayName}</div>
          </div>
          <div>
            <label className="ff-label">Email</label>
            <div className="ff-input" style={{ background: 'rgba(255,255,255,0.03)', cursor: 'default' }}>{user.email || '—'}</div>
          </div>
        </div>
      </div>

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
