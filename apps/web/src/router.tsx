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
      <Route element={<Protected />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/leave" element={<LeavePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route element={<RequireRole allowed={['ADMIN']} />}>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/hiring" element={<HiringPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
