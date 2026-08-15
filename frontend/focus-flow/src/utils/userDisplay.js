export function getDisplayName(user) {
  // Never fall back to a hard-coded demo identity when the authenticated
  // profile is incomplete or still loading.
  const name = typeof user?.name === 'string' ? user.name.trim() : '';
  return name || '訪客';
}

export function getStudentWelcomeSubtitle(user) {
  const displayName = getDisplayName(user);
  return displayName === '訪客' ? '歡迎回來' : `歡迎回來，${displayName}`;
}
