import { NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  CalendarClock, 
  Bell, 
  LogOut,
  Building2,
  User
} from 'lucide-react';
import { clearAuth, getAuth } from '../lib/auth';

export function Layout({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const auth = getAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>HRMS Portal</h1>
        <nav>
          <NavLink to="/" end>
            <LayoutDashboard size={20} style={{ marginRight: 12 }} />
            Dashboard
          </NavLink>
          <NavLink to="/employees">
            <Users size={20} style={{ marginRight: 12 }} />
            Employees
          </NavLink>
          <NavLink to="/leave">
            <CalendarClock size={20} style={{ marginRight: 12 }} />
            Leave Management
          </NavLink>
          <NavLink to="/notifications">
            <Bell size={20} style={{ marginRight: 12 }} />
            Notifications
          </NavLink>
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div className="row gap" style={{ marginBottom: 16, color: '#94a3b8', fontSize: 13 }}>
            <Building2 size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {auth?.user.tenantId}
            </span>
          </div>
          <button
            className="row gap"
            style={{ width: '100%', justifyContent: 'center', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
            onClick={() => {
              clearAuth();
              nav('/login');
            }}
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="row gap">
            <div style={{ background: 'var(--primary)', color: 'white', width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: 600 }}>
              {auth?.user.name.charAt(0)}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{auth?.user.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{auth?.user.role}</div>
            </div>
          </div>
          <div className="row gap">
            <button style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid rgba(0,0,0,0.1)' }}>
              <User size={18} />
            </button>
          </div>
        </header>
        <section>{children}</section>
      </main>
    </div>
  );
}
