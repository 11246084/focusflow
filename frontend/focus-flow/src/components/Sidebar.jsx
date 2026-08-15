import { Ic } from './Icons';
import { navItems, roleLabels, roleDot } from './navigationConfig';
import { getUser } from '../api';
import { getDisplayName } from '../utils/userDisplay';

export default function Sidebar({ role, active, onNav, onLogout }) {
  const items = navItems[role] || [];
  const displayName = getDisplayName(getUser());
  return (
    <div className="sidebar">

      {/* Logo */}
      <div className="sidebar-logo">
        <img src="/assets/lockup-white.png" alt="Focus Flow" style={{ width: '100%' }} />
      </div>

      {/* Nav items */}
      <div className="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {items.map(it => (
          <div
            key={it.id}
            className={`nav-item${active === it.id ? ' active' : ''}`}
            onClick={() => onNav(it.id)}
          >
            <span className="ni"><Ic n={it.ic} s={16} /></span>
            {it.label}
          </div>
        ))}
      </div>

      {/* Footer: role + sign out */}
      <div className="sidebar-footer">
        <div className="sidebar-role-card">
          <div className="sidebar-role-label">
            <div className="sidebar-role-dot" style={{ background: roleDot[role] }} />
            <span className="sidebar-role-text">{roleLabels[role]}</span>
          </div>
          <div className="sidebar-username">{displayName}</div>
        </div>

        <div className="nav-item" onClick={onLogout}>
          <span className="ni"><Ic n="out" s={15} /></span>
          Sign Out
        </div>
      </div>

    </div>
  );
}
