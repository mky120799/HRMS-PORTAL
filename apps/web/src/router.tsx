import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { getAuth, hasRole } from './lib/auth';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { LeavePage } from './pages/LeavePage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SignupPage } from './pages/SignupPage';
import { ProfilePage } from './pages/ProfilePage';
import { HiringPage } from './pages/HiringPage';
import { CareersPage } from './pages/CareersPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AttendancePayrollPage } from './pages/AttendancePayrollPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { PerformancePage } from './pages/PerformancePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { SettingsPage } from './pages/SettingsPage';

function Protected() {
  if (!getAuth()) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function RequireRole({ allowed }: { allowed: string[] }) {
  if (!hasRole(allowed)) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/careers" element={<CareersPage />} />
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
        <Route path="/profile" element={<ProfilePage />} />
        <Route element={<RequireRole allowed={['ADMIN', 'MANAGER']} />}>
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/hiring" element={<HiringPage />} />
        </Route>
        <Route element={<RequireRole allowed={['ADMIN']} />}>
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
