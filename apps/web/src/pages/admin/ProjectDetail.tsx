import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Tabs } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/ui/badge';
import { FinancialsPanel } from '@/features/FinancialsPanel';
import { BudgetPanel } from '@/features/BudgetPanel';
import { TasksPanel } from '@/features/TasksPanel';
import { ExpensesPanel } from '@/features/ExpensesPanel';
import { AttendancePanel } from '@/features/AttendancePanel';
import { StockPanel } from '@/features/StockPanel';
import { DocumentsPanel } from '@/features/DocumentsPanel';
import { ReportsPanel } from '@/features/ReportsPanel';

const TABS = [
  { id: 'financials', label: 'Financials' },
  { id: 'budget', label: 'Budget' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'stock', label: 'Stock' },
  { id: 'documents', label: 'Documents' },
  { id: 'reports', label: 'Daily reports' },
];

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const [tab, setTab] = useState('financials');

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  if (!project) return <p className="text-sm text-slate-500">Loading project…</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link
          to="/admin/projects"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={16} /> Projects
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
        <p className="text-sm text-slate-500">
          {project.clientName} · {project.location} · {fmtDate(project.startDate)} →{' '}
          {fmtDate(project.expectedCompletion)} · Supervisor:{' '}
          {project.supervisor?.name ?? 'Unassigned'}
        </p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'financials' && <FinancialsPanel projectId={projectId} />}
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
