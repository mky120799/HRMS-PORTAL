import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Calendar,
  CalendarClock,
  Bell,
  LogOut,
  Building2,
  User,
  Briefcase,
  FileText,
  Target,
  BarChart3,
  CreditCard,
  Settings,
  ShieldAlert,
  Shield,
  Activity,
  Wallet,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { clearAuth, getAuth, hasPermission, hasRole, type Permission } from "../lib/auth";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { cn } from "../lib/utils";
import { AiChatWidget } from "./AiChatWidget";
import { DemoBanner } from "./DemoBanner";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Shown when the user holds any of these permissions. Menus only shape navigation; the API enforces access. */
  permissions?: Permission[];
  visible?: () => boolean;
  badge?: "unread";
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/employees", label: "Employees", icon: Users },
  {
    to: "/attendance",
    label: "Attendance & Payroll",
    icon: Calendar,
    visible: () => hasRole(["ADMIN", "HR_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "EMPLOYEE", "MANAGER"]),
  },
  { to: "/leave", label: "Leave Management", icon: CalendarClock },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/performance", label: "Performance & OKRs", icon: Target },
  { to: "/notifications", label: "Notifications", icon: Bell, badge: "unread" },
  { to: "/security", label: "Security & Privacy", icon: Shield },
  { to: "/analytics", label: "Analytics", icon: BarChart3, permissions: ["analytics.read"] },
  { to: "/hiring", label: "Hiring", icon: Briefcase, permissions: ["hiring.read"] },
  { to: "/payroll", label: "Payroll", icon: Wallet, permissions: ["payroll.read", "payroll.run.manage", "payroll.finalize"] },
  { to: "/billing", label: "Billing", icon: CreditCard, permissions: ["tenant.billing.manage"] },
  { to: "/settings", label: "Settings", icon: Settings, permissions: ["tenant.settings.manage"] },
  { to: "/audit-logs", label: "Audit Logs", icon: Activity, permissions: ["audit.read"] },
];

const navLinkClass = (activeClass: string) => ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
    isActive ? cn(activeClass, "text-white font-semibold") : "text-slate-400 hover:text-white hover:bg-white/5",
  );

export function Layout({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const auth = getAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () =>
      (await api.get<{ count: number }>("/notifications/unread-count")).data,
    enabled: Boolean(auth),
    refetchInterval: 30_000,
  });

  // The mobile drawer closes after navigating and on Escape.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const items = NAV_ITEMS.filter(
    (item) => (!item.permissions || hasPermission(item.permissions)) && (!item.visible || item.visible()),
  );
  const unreadCount = unread.data?.count ?? 0;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Backdrop behind the mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" aria-hidden onClick={() => setMenuOpen(false)} />
      )}

      {/* Sidebar: always visible from lg up, a slide-in drawer below that */}
      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        className={cn(
          "w-[260px] bg-slate-900 lg:bg-slate-900/80 backdrop-blur-xl border-r border-white/10 text-white flex flex-col p-6 shrink-0 fixed inset-y-0 left-0 z-40 transition-transform duration-200",
          menuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            HRMS Portal
          </h1>
          <button
            type="button"
            className="lg:hidden rounded-md p-1 text-slate-400 hover:text-white"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <nav className="flex flex-col gap-2 flex-1 overflow-y-auto -mx-2 px-2">
          {items.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass("bg-primary")}>
              <Icon size={20} aria-hidden />
              {label}
              {badge === "unread" && unreadCount > 0 && (
                <span
                  className="ml-auto min-w-5 rounded-full bg-indigo-500 px-1.5 py-0.5 text-center text-xs font-medium text-white"
                  aria-label={`${unreadCount} unread`}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </NavLink>
          ))}

          {auth?.user.role === "SUPER_ADMIN" && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-3">
                System
              </p>
              <NavLink to="/super-admin" className={navLinkClass("bg-indigo-500")}>
                <ShieldAlert size={20} className="text-indigo-400" aria-hidden />
                Super Admin
              </NavLink>
            </div>
          )}
        </nav>

        <div className="mt-auto pt-6 border-t border-white/10">
          <div className="flex items-center gap-3 mb-4 text-slate-400 text-sm">
            <Building2 size={16} aria-hidden />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {auth?.tenant?.name ?? auth?.tenant?.slug ?? "Workspace"}
            </span>
          </div>
          <Button
            variant="destructive"
            className="w-full flex items-center justify-center gap-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-400"
            onClick={async () => {
              await api.post("/auth/logout").catch(() => undefined); // revoke the refresh token server-side
              clearAuth();
              nav("/login");
            }}
          >
            <LogOut size={18} aria-hidden />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 lg:ml-[260px]">
        <DemoBanner />
        <div className="p-4 sm:p-6 lg:p-8">
          <header className="flex items-center justify-between gap-4 mb-6 lg:mb-8 pb-4 border-b border-border/40">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Button
                variant="outline"
                size="icon"
                className="lg:hidden shrink-0"
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                aria-controls="app-sidebar"
                aria-expanded={menuOpen}
              >
                <Menu size={18} aria-hidden />
              </Button>
              <Avatar className="h-10 w-10 shrink-0 font-semibold bg-primary text-primary-foreground">
                <AvatarFallback className="bg-primary text-white">
                  {auth?.user.name?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-semibold text-[15px] truncate">
                  {auth?.user.name}
                </div>
                <div className="text-muted-foreground text-xs truncate">
                  {auth?.user.role}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                asChild
                className="rounded-full bg-background/50 backdrop-blur-sm"
              >
                <Link to="/profile" aria-label="My profile">
                  <User size={18} className="text-muted-foreground" aria-hidden />
                </Link>
              </Button>
            </div>
          </header>

          <section className="animate-fade-in">{children}</section>
        </div>
      </main>

      {/* Global AI Chat Widget */}
      <AiChatWidget />
    </div>
  );
}
