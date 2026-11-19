// 管理員使用者頁的前端篩選：搜尋（姓名／Email）、身分、帳號啟用狀態。
export function filterUsers(users, { query = '', role = 'all', status = 'all' } = {}) {
  const q = String(query).trim().toLowerCase();
  return users.filter((u) => {
    if (role !== 'all' && u.role !== role) return false;
    if (status === 'active' && !u.isActive) return false;
    if (status === 'inactive' && u.isActive) return false;
    if (!q) return true;
    return String(u.name ?? '').toLowerCase().includes(q) || String(u.email ?? '').toLowerCase().includes(q);
  });
}
