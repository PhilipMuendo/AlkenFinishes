import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AdminLayout } from './components/layout/AdminLayout';
import { SupervisorLayout } from './components/layout/SupervisorLayout';
import { LoginPage } from './pages/Login';
import { CompanyDashboard } from './pages/admin/CompanyDashboard';
import { ProjectsPage } from './pages/admin/Projects';
import { ProjectDetailPage } from './pages/admin/ProjectDetail';
import { WorkersPage } from './pages/admin/Workers';
import { UsersPage } from './pages/admin/Users';
import { SettingsPage } from './pages/admin/Settings';
import { MySitesPage } from './pages/supervisor/MySites';
import { SiteDetailPage } from './pages/supervisor/SiteDetail';

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
      Loading…
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (user.role === 'SUPERADMIN') {
    return (
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<CompanyDashboard />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="workers" element={<WorkersPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<SupervisorLayout />}>
        <Route path="/sites" element={<MySitesPage />} />
        <Route path="/sites/:projectId" element={<SiteDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/sites" replace />} />
    </Routes>
  );
}
