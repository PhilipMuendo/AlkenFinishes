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
const ClientsPage = lazy(() =>
  import('./pages/admin/Clients').then((m) => ({ default: m.ClientsPage })),
);
const LeadsPage = lazy(() =>
  import('./pages/admin/Leads').then((m) => ({ default: m.LeadsPage })),
);
const QuotationsPage = lazy(() =>
  import('./pages/admin/Quotations').then((m) => ({ default: m.QuotationsPage })),
);
const ContractsPage = lazy(() =>
  import('./pages/admin/Contracts').then((m) => ({ default: m.ContractsPage })),
);
const CalendarPage = lazy(() =>
  import('./pages/admin/Calendar').then((m) => ({ default: m.CalendarPage })),
);
const ProjectDetailPage = lazy(() =>
  import('./pages/admin/ProjectDetail').then((m) => ({ default: m.ProjectDetailPage })),
);
const WorkersPage = lazy(() =>
  import('./pages/admin/Workers').then((m) => ({ default: m.WorkersPage })),
);
const ToolsPage = lazy(() => import('./pages/admin/Tools').then((m) => ({ default: m.ToolsPage })));
const PayrollPage = lazy(() =>
  import('./pages/admin/Payroll').then((m) => ({ default: m.PayrollPage })),
);
const TaxPage = lazy(() => import('./pages/admin/Tax').then((m) => ({ default: m.TaxPage })));
const SuppliersPage = lazy(() =>
  import('./pages/admin/Suppliers').then((m) => ({ default: m.SuppliersPage })),
);
const InvoicesPage = lazy(() =>
  import('./pages/admin/Invoices').then((m) => ({ default: m.InvoicesPage })),
);
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
    <div className="flex min-h-screen items-center justify-center text-sm text-fg-muted">
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
            <Route path="clients" element={<ClientsPage />} />
            <Route path="leads" element={<LeadsPage />} />
            <Route path="quotations" element={<QuotationsPage />} />
            <Route path="contracts" element={<ContractsPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="workers" element={<WorkersPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="tax" element={<TaxPage />} />
            <Route path="payroll" element={<PayrollPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="calendar" element={<CalendarPage />} />
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
