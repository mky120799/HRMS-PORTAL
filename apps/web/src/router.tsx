import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { getAuth, hasPermission, hasRole, type Permission, type Role } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';

// Pages are code-split: each route downloads its own chunk on first visit.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const LeavePage = lazy(() => import('./pages/LeavePage').then((m) => ({ default: m.LeavePage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const HiringPage = lazy(() => import('./pages/HiringPage').then((m) => ({ default: m.HiringPage })));
const CareersPage = lazy(() => import('./pages/CareersPage').then((m) => ({ default: m.CareersPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage })));
const AttendancePayrollPage = lazy(() => import('./pages/AttendancePayrollPage').then((m) => ({ default: m.AttendancePayrollPage })));
const PayrollAdminPage = lazy(() => import('./pages/PayrollAdminPage').then((m) => ({ default: m.PayrollAdminPage })));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })));
const PerformancePage = lazy(() => import('./pages/PerformancePage').then((m) => ({ default: m.PerformancePage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const BillingPage = lazy(() => import('./pages/BillingPage').then((m) => ({ default: m.BillingPage })));
const SuperAdminPage = lazy(() => import('./pages/SuperAdminPage').then((m) => ({ default: m.SuperAdminPage })));
const SecurityPage = lazy(() => import('./pages/SecurityPage').then((m) => ({ default: m.SecurityPage })));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));

const Loading = () => <div className="p-10 text-center text-muted-foreground">Loading…</div>;

// Client-side guards only shape navigation; every rule is enforced again by the API.
function Protected() {
  if (!getAuth()) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}

function RequireRole({ allowed }: { allowed: Role[] }) {
  if (!hasRole(allowed)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function RequirePermission({ allowed }: { allowed: Permission[] }) {
  if (!hasPermission(allowed)) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/careers/:slug" element={<CareersPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route element={<Protected />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/attendance" element={<AttendancePayrollPage />} />
        <Route path="/leave" element={<LeavePage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route element={<RequirePermission allowed={['analytics.read']} />}>
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Route>
        <Route element={<RequirePermission allowed={['hiring.read']} />}>
          <Route path="/hiring" element={<HiringPage />} />
        </Route>
        <Route element={<RequirePermission allowed={['payroll.read', 'payroll.run.manage', 'payroll.finalize']} />}>
          <Route path="/payroll" element={<PayrollAdminPage />} />
        </Route>
        <Route element={<RequirePermission allowed={['tenant.settings.manage']} />}>
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route element={<RequirePermission allowed={['tenant.billing.manage']} />}>
          <Route path="/billing" element={<BillingPage />} />
        </Route>
        <Route element={<RequirePermission allowed={['audit.read']} />}>
          <Route path="/audit-logs" element={<AuditLogsPage />} />
        </Route>
        <Route element={<RequireRole allowed={['SUPER_ADMIN']} />}>
          <Route path="/super-admin" element={<SuperAdminPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
