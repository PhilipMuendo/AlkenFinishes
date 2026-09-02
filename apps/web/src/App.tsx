import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/Login';

const SignContractPage = lazy(() =>
  import('./pages/public/SignContract').then((m) => ({ default: m.SignContractPage })),
);

// Route-level code splitting: supervisors never download the admin bundle
// (recharts included), and vice versa.
const AdminLayout = lazy(() =>
  import('./components/layout/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const SupervisorLayout = lazy(() =>
  import('./components/layout/SupervisorLayout').then((m) => ({ default: m.SupervisorLayout })),
);
const CompanyDashboardPage = lazy(() =>
  import('./pages/admin/CompanyDashboard').then((m) => ({ default: m.CompanyDashboardPage })),
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
const CompanyExpensesPage = lazy(() =>
  import('./pages/admin/CompanyExpenses').then((m) => ({ default: m.CompanyExpensesPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/admin/Reports').then((m) => ({ default: m.ReportsPage })),
);
const AccountantSitesPage = lazy(() =>
  import('./pages/admin/AccountantSites').then((m) => ({ default: m.AccountantSitesPage })),
);
const AccountantProjectMoneyPage = lazy(() =>
  import('./pages/admin/AccountantProjectMoney').then((m) => ({
    default: m.AccountantProjectMoneyPage,
  })),
);
const UsersPage = lazy(() => import('./pages/admin/Users').then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() =>
  import('./pages/admin/Settings').then((m) => ({ default: m.SettingsPage })),
);
const TodayPage = lazy(() =>
  import('./pages/supervisor/Today').then((m) => ({ default: m.TodayPage })),
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

/**
 * Old paths still resolve.
 *
 * The admin routes were renamed to match what the navigation has always called
 * them (Sites, Equipment, Receivables, Payables, Team). Anything already
 * bookmarked, pasted into a WhatsApp thread or sitting in someone's history
 * still has to land, so the previous path redirects instead of 404ing.
 */
function RedirectSite() {
  const { projectId } = useParams();
  return <Navigate to={`/admin/sites/${projectId}`} replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Public — a client signing a contract has no session of their own, so
  // this is checked before the loading/login gates below, which apply to
  // every other route. The first (and only) unauthenticated route in the app.
  if (location.pathname.startsWith('/sign/')) {
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/sign/:token" element={<SignContractPage />} />
        </Routes>
      </Suspense>
    );
  }

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
    // One unexpected null used to unmount the whole app — including the
    // navigation out of it, which in a standalone PWA leaves a white rectangle
    // and no way back. Panels carry their own boundaries; this is the backstop.
    <ErrorBoundary variant="page" label="Alken Decor">
      <Suspense fallback={<Loading />}>
        {user.role === 'SUPERADMIN' || user.role === 'ACCOUNTANT' ? (
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              {user.role === 'SUPERADMIN' ? (
                <Route index element={<CompanyDashboardPage />} />
              ) : (
                <Route index element={<Navigate to="/admin/receivables" replace />} />
              )}
              {user.role === 'SUPERADMIN' && <Route path="clients" element={<ClientsPage />} />}
              {user.role === 'SUPERADMIN' && <Route path="leads" element={<LeadsPage />} />}
              {user.role === 'SUPERADMIN' && <Route path="quotations" element={<QuotationsPage />} />}
              {user.role === 'SUPERADMIN' && <Route path="contracts" element={<ContractsPage />} />}
              {user.role === 'SUPERADMIN' ? (
                <>
                  <Route path="sites" element={<ProjectsPage />} />
                  <Route path="sites/:projectId" element={<ProjectDetailPage />} />
                </>
              ) : (
                <>
                  <Route path="sites" element={<AccountantSitesPage />} />
                  <Route path="sites/:projectId" element={<AccountantProjectMoneyPage />} />
                </>
              )}
              {user.role === 'SUPERADMIN' && <Route path="workers" element={<WorkersPage />} />}
              {user.role === 'SUPERADMIN' && <Route path="equipment" element={<ToolsPage />} />}
              <Route path="receivables" element={<InvoicesPage />} />
              <Route path="payables" element={<SuppliersPage />} />
              <Route path="company-expenses" element={<CompanyExpensesPage />} />
              <Route path="tax" element={<TaxPage />} />
              <Route path="payroll" element={<PayrollPage />} />
              {user.role === 'SUPERADMIN' && <Route path="reports" element={<ReportsPage />} />}
              {user.role === 'SUPERADMIN' && <Route path="calendar" element={<CalendarPage />} />}
              {user.role === 'SUPERADMIN' && <Route path="team" element={<UsersPage />} />}
              {user.role === 'SUPERADMIN' && <Route path="settings" element={<SettingsPage />} />}
              {/* Sections are addressable, so a specific card can be linked to. */}
              {user.role === 'SUPERADMIN' && (
                <Route path="settings/:section" element={<SettingsPage />} />
              )}

              {/* Renamed routes — see RedirectSite. */}
              {user.role === 'SUPERADMIN' && (
                <>
                  <Route path="projects" element={<Navigate to="/admin/sites" replace />} />
                  <Route path="projects/:projectId" element={<RedirectSite />} />
                  <Route path="tools" element={<Navigate to="/admin/equipment" replace />} />
                  <Route path="users" element={<Navigate to="/admin/team" replace />} />
                </>
              )}
              <Route path="invoices" element={<Navigate to="/admin/receivables" replace />} />
              <Route path="suppliers" element={<Navigate to="/admin/payables" replace />} />
            </Route>
            <Route
              path="*"
              element={
                <Navigate to={user.role === 'SUPERADMIN' ? '/admin' : '/admin/receivables'} replace />
              }
            />
          </Routes>
        ) : (
          <Routes>
            <Route element={<SupervisorLayout />}>
              <Route path="/today" element={<TodayPage />} />
              <Route path="/sites" element={<MySitesPage />} />
              <Route path="/sites/:projectId" element={<SiteDetailPage />} />
            </Route>
            {/* Today, not the site list: the job is almost always today's job. */}
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        )}
      </Suspense>
    </ErrorBoundary>
  );
}
