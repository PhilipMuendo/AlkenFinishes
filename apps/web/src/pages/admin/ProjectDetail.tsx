import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';
import type { AppUser, Project, ProjectStatus } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Tabs } from '@/components/ui/tabs';
import { Select } from '@/components/ui/input';
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

const TABS = [
  { id: 'financials', label: 'Financials' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'payments', label: 'Payments' },
  { id: 'budget', label: 'Budget' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'stock', label: 'Stock' },
  { id: 'documents', label: 'Documents' },
  { id: 'reports', label: 'Daily reports' },
];

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
  const [tab, setTab] = useState('financials');

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<AppUser[]>('/users'),
  });
  const supervisors = users?.filter((u) => u.role === 'SUPERVISOR' && u.active) ?? [];

  function patchProject(body: Record<string, unknown>) {
    return api(`/projects/${projectId}`, { method: 'PATCH', body });
  }
  function onProjectChange() {
    void qc.invalidateQueries({ queryKey: ['project', projectId] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['analytics', 'company'] });
  }

  const setStatus = useMutation({
    mutationFn: (status: ProjectStatus) => patchProject({ status }),
    onSuccess: onProjectChange,
  });
  const setSupervisor = useMutation({
    mutationFn: (supervisorId: string | null) => patchProject({ supervisorId }),
    onSuccess: onProjectChange,
  });

  if (!project) return <p className="text-sm text-fg-muted">Loading project…</p>;

  return (
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
          {project.clientName} · {project.location} · {fmtDate(project.startDate)} →{' '}
          {fmtDate(project.expectedCompletion)}
        </p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

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
    </div>
  );
}
