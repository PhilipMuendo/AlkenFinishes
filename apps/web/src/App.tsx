import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/Login';

// Route-level code splitting: supervisors never download the admin bundle
// (recharts included), and vice versa.
const AdminLayout = lazy(() =>
  import('./components/layout/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const SupervisorLayout = lazy(() =>
  import('./components/layout/SupervisorLayout').then((m) => ({ default: m.SupervisorLayout })),
);
const CompanyDashboard = lazy(() =>
  import('./pages/admin/CompanyDashboard').then((m) => ({ default: m.CompanyDashboard })),
);
const ProjectsPage = lazy(() =>
  import('./pages/admin/Projects').then((m) => ({ default: m.ProjectsPage })),
);
const ProjectDetailPage = lazy(() =>
  import('./pages/admin/ProjectDetail').then((m) => ({ default: m.ProjectDetailPage })),
);
const WorkersPage = lazy(() =>
  import('./pages/admin/Workers').then((m) => ({ default: m.WorkersPage })),
);
const ToolsPage = lazy(() => import('./pages/admin/Tools').then((m) => ({ default: m.ToolsPage })));
const ReportsPage = lazy(() =>
  import('./pages/admin/Reports').then((m) => ({ default: m.ReportsPage })),
);
const UsersPage = lazy(() => import('./pages/admin/Users').then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() =>
  import('./pages/admin/Settings').then((m) => ({ default: m.SettingsPage })),
);
const MySitesPage = lazy(() =>
  import('./pages/supervisor/MySites').then((m) => ({ default: m.MySitesPage })),
);
const SiteDetailPage = lazy(() =>
  import('./pages/supervisor/SiteDetail').then((m) => ({ default: m.SiteDetailPage })),
);

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

  return (
    <Suspense fallback={<Loading />}>
      {user.role === 'SUPERADMIN' ? (
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<CompanyDashboard />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="workers" element={<WorkersPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route element={<SupervisorLayout />}>
            <Route path="/sites" element={<MySitesPage />} />
            <Route path="/sites/:projectId" element={<SiteDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/sites" replace />} />
        </Routes>
      )}
    </Suspense>
  );
}
