import { NavLink, useNavigate, Link } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  Calendar,
  CalendarClock, 
  Bell, 
  LogOut,
  Building2,
  User,
  Briefcase
} from 'lucide-react';
import { clearAuth, getAuth, hasRole } from '../lib/auth';
import { Button } from './ui/button';
import { Avatar, AvatarFallback } from './ui/avatar';
import { cn } from '../lib/utils';

export function Layout({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const auth = getAuth();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-[260px] bg-slate-900/80 backdrop-blur-xl border-r border-white/10 text-white flex flex-col p-6 shrink-0 fixed inset-y-0 z-20">
        <h1 className="text-2xl font-bold mb-8 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
          HRMS Portal
        </h1>
        
        <nav className="flex flex-col gap-2 flex-1">
          <NavLink 
            to="/" 
            end
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              isActive ? "bg-primary text-white font-semibold" : "text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            <LayoutDashboard size={20} />
            Dashboard
          </NavLink>
          
          <NavLink 
            to="/employees"
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              isActive ? "bg-primary text-white font-semibold" : "text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Users size={20} />
            Employees
          </NavLink>
          
          {hasRole(['ADMIN', 'EMPLOYEE', 'MANAGER']) && (
            <NavLink 
              to="/attendance" 
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive ? "bg-primary text-white font-semibold" : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
            >
              <Calendar size={20} />
              Attendance & Payroll
            </NavLink>
          )}
          
          <NavLink 
            to="/leave" 
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              isActive ? "bg-primary text-white font-semibold" : "text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            <CalendarClock size={20} />
            Leave Management
          </NavLink>
          
          <NavLink 
            to="/notifications"
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              isActive ? "bg-primary text-white font-semibold" : "text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Bell size={20} />
            Notifications
          </NavLink>
          
          {auth?.user.role === 'ADMIN' && (
            <NavLink 
              to="/hiring"
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive ? "bg-primary text-white font-semibold" : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
            >
              <Briefcase size={20} />
              Hiring
            </NavLink>
          )}
        </nav>

        <div className="mt-auto pt-6 border-t border-white/10">
          <div className="flex items-center gap-3 mb-4 text-slate-400 text-sm">
            <Building2 size={16} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {auth?.user.tenantId}
            </span>
          </div>
          <Button
            variant="destructive"
            className="w-full flex items-center justify-center gap-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-400"
            onClick={() => {
              clearAuth();
              nav('/login');
            }}
          >
            <LogOut size={18} />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-[260px] p-8">
        <header className="flex items-center justify-between mb-8 pb-4 border-b border-border/40">
          <div className="flex items-center gap-4">
            <Avatar className="h-10 w-10 font-semibold bg-primary text-primary-foreground">
              <AvatarFallback className="bg-primary text-white">
                {auth?.user.name?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="font-semibold text-[15px]">{auth?.user.name}</div>
              <div className="text-muted-foreground text-xs">{auth?.user.role}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" asChild className="rounded-full bg-background/50 backdrop-blur-sm">
              <Link to="/profile">
                <User size={18} className="text-muted-foreground" />
              </Link>
            </Button>
          </div>
        </header>
        
        <section className="animate-fade-in">
          {children}
        </section>
      </main>
    </div>
  );
}
