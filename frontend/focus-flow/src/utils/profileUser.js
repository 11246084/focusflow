// Keep Profile's local form state and the authenticated dashboard state in sync
// through the existing onProfileUpdated callback contract.
export function applyProfileUserUpdate({ user, setCurrentUser, onProfileUpdated }) {
  if (!user || typeof user !== 'object') return false;
  setCurrentUser(user);
  onProfileUpdated?.(user);
  return true;
}
