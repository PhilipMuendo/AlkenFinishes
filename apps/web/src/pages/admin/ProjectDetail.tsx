import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { AppUser, Project, ProjectStatus } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { cn, focusRingOnMuted } from '@/lib/utils';
import { Tabs } from '@/components/ui/tabs';
import { Select } from '@/components/ui/input';
import { QueryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { FinancialsPanel } from '@/features/FinancialsPanel';
import { BudgetPanel } from '@/features/BudgetPanel';
import { PaymentsPanel } from '@/features/PaymentsPanel';
import { TasksPanel } from '@/features/TasksPanel';
import { ExpensesPanel } from '@/features/ExpensesPanel';
import { AttendancePanel } from '@/features/AttendancePanel';
import { StockPanel } from '@/features/StockPanel';
import { DocumentsPanel } from '@/features/DocumentsPanel';
import { ReportsPanel } from '@/features/ReportsPanel';
import { InvoicesPanel } from '@/features/InvoicesPanel';
import { SnagsPanel } from '@/features/SnagsPanel';
import { SafetyPanel } from '@/features/SafetyPanel';
import { BusinessReportsPanel } from '@/features/BusinessReportsPanel';
import { CommandCentrePanel } from '@/features/CommandCentrePanel';

/**
 * Fourteen flat tabs overflowed the bar and made everything equally important.
 * Grouping them puts the Command Centre first and lets the rest sort into the
 * four questions actually asked of a site: what is happening on it, is the work
 * any good, where is the money, and what is on it.
 *
 * The tab ids are unchanged, so every existing deep link still resolves.
 */
const GROUPS = [
  { id: 'command', label: 'Command Centre', tabs: [{ id: 'overview', label: 'Command Centre' }] },
  {
    id: 'site',
    label: 'Site',
    tabs: [
      { id: 'tasks', label: 'Tasks & programme' },
      { id: 'reports', label: 'Daily reports' },
      { id: 'attendance', label: 'Attendance' },
      { id: 'documents', label: 'Photos & documents' },
    ],
  },
  {
    id: 'quality',
    label: 'Quality & safety',
    tabs: [
      { id: 'snags', label: 'Snag list' },
      { id: 'safety', label: 'Safety' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    tabs: [
      { id: 'financials', label: 'Financials' },
      { id: 'budget', label: 'Budget' },
      { id: 'invoices', label: 'Invoices' },
      { id: 'payments', label: 'Payments' },
      { id: 'expenses', label: 'Expenses' },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    tabs: [
      { id: 'stock', label: 'Stock' },
      { id: 'export', label: 'Export' },
    ],
  },
] as const;

const TAB_TO_GROUP: Map<string, string> = new Map(
  GROUPS.flatMap((g) => g.tabs.map((t) => [t.id as string, g.id as string])),
);
const VALID_TABS = new Set<string>(TAB_TO_GROUP.keys());

const STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const qc = useQueryClient();
  // The tab lives in the URL so a Command Centre card can link straight to the
  // tab that owns its data, and so a tab is shareable and survives a reload.
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') ?? 'overview';
  const tab = VALID_TABS.has(requested) ? requested : 'overview';
  const activeGroup = TAB_TO_GROUP.get(tab) ?? 'command';

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === 'overview') next.delete('tab');
    else next.set('tab', id);
    setParams(next, { replace: true });
  };

  const selectGroup = (groupId: string) => {
    const group = GROUPS.find((g) => g.id === groupId);
    if (group) setTab(group.tabs[0].id);
  };

  const projectQuery = useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });
  const { data: users } = useQuery({
    queryKey: queryKeys.users.all(),
    queryFn: () => api<AppUser[]>('/users'),
  });
  const supervisors = users?.filter((u) => u.role === 'SUPERVISOR' && u.active) ?? [];

  function patchProject(body: Record<string, unknown>) {
    return api(`/projects/${projectId}`, { method: 'PATCH', body });
  }
  function onProjectChange() {
    void qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    void qc.invalidateQueries({ queryKey: queryKeys.projects.all() });
    void qc.invalidateQueries({ queryKey: queryKeys.analytics.company() });
  }

  const setStatus = useMutation({
    mutationFn: (status: ProjectStatus) => patchProject({ status }),
    onSuccess: onProjectChange,
  });
  const setSupervisor = useMutation({
    mutationFn: (supervisorId: string | null) => patchProject({ supervisorId }),
    onSuccess: onProjectChange,
  });

  const currentGroup = GROUPS.find((g) => g.id === activeGroup) ?? GROUPS[0];

  return (
    <QueryState
      query={projectQuery}
      errorTitle="Couldn’t load this project"
      skeleton={<ProjectSkeleton />}
    >
      {(project) => (
        <div className="space-y-5">
          <div>
            <Link
              to="/admin/projects"
              className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              <ChevronLeft size={16} /> Projects
            </Link>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">{project.name}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={project.status}
                  onChange={(e) => setStatus.mutate(e.target.value as ProjectStatus)}
                  className="h-9 w-auto text-sm"
                  aria-label="Project status"
                  disabled={setStatus.isPending}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
                <Select
                  value={project.supervisor?.id ?? ''}
                  onChange={(e) => setSupervisor.mutate(e.target.value || null)}
                  className="h-9 w-auto text-sm"
                  aria-label="Assigned supervisor"
                  disabled={setSupervisor.isPending}
                >
                  <option value="">Unassigned</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              {project.code && (
                <span className="font-medium text-fg-subtle">{project.code} · </span>
              )}
              {project.clientName} · {project.location} · {fmtDate(project.startDate)} →{' '}
              {fmtDate(project.expectedCompletion)}
              {project.contract?.contractNo && (
                <>
                  {' · '}
                  <Link
                    to="/admin/contracts"
                    className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
                  >
                    {project.contract.contractNo}
                  </Link>
                </>
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Tabs
              tabs={GROUPS.map((g) => ({ id: g.id, label: g.label }))}
              active={activeGroup}
              onChange={selectGroup}
            />
            {/* A single-tab group is its own heading — a second row repeating it
            would be noise. */}
            {currentGroup.tabs.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {currentGroup.tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-sm font-medium transition-colors',
                      focusRingOnMuted,
                      tab === t.id
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {tab === 'overview' && <CommandCentrePanel projectId={projectId} />}
          {tab === 'financials' && <FinancialsPanel projectId={projectId} />}
          {tab === 'invoices' && <InvoicesPanel projectId={projectId} />}
          {tab === 'payments' && <PaymentsPanel projectId={projectId} />}
          {tab === 'budget' && <BudgetPanel projectId={projectId} />}
          {tab === 'tasks' && <TasksPanel projectId={projectId} />}
          {tab === 'expenses' && <ExpensesPanel projectId={projectId} />}
          {tab === 'attendance' && <AttendancePanel projectId={projectId} />}
          {tab === 'stock' && <StockPanel projectId={projectId} />}
          {tab === 'documents' && <DocumentsPanel projectId={projectId} />}
          {tab === 'reports' && <ReportsPanel projectId={projectId} canSubmit={false} />}
          {tab === 'snags' && <SnagsPanel projectId={projectId} />}
          {tab === 'safety' && <SafetyPanel projectId={projectId} />}
          {tab === 'export' && <BusinessReportsPanel projectId={projectId} />}
        </div>
      )}
    </QueryState>
  );
}

function ProjectSkeleton() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-1/3" />
        <Skeleton className="mt-2 h-4 w-2/3" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
